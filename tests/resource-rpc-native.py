"""Real rpcd/ucode + production updater + delayed private HTTP, no WAN/core/service.
Run as root with OPENWRT_ROOTFS, prebuilt digest.so and host curl already present.
The test creates its own net/PID namespace; bound memory via the CI runner.
"""
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import zipfile

APP = Path(__file__).resolve().parents[1] / 'luci-app-homeproxy'


def exercise(root):
    subprocess.run(['ip', 'link', 'set', 'lo', 'up'], check=True)
    payload = b'SRS\x01resource-job-fixture'
    blob = hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr('site/index.html', 'dashboard fixture')
    requests = []
    delay = [22]
    generation = [1]

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            if self.path.endswith('/version'):
                pause = delay[0]
                delay[0] = 0
                time.sleep(pause)
                body = json.dumps({'sha': str(generation[0]) * 40,
                    'commit': {'committer': {'date': '2026-10-31T00:00:00Z'}}}).encode()
            elif '/digest?' in self.path:
                body = json.dumps({'sha': blob}).encode()
            elif self.path.endswith('.srs'):
                body = payload
            else:
                body = archive.getvalue()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = dict(os.environ, PATH='/usr/sbin:/usr/bin:/sbin:/bin')
    url = f'http://127.0.0.1:{server.server_port}'
    for kind in ['GEOIP', 'GEOSITE', 'DASHBOARD']:
        for name, endpoint in [('VERSION_URL', 'version'), ('DIGEST_URL', 'digest'), ('SOURCE', 'data')]:
            env[f'{kind}_{name}'] = f'{url}/{kind.lower()}/{endpoint}'

    def command(*args, timeout=8):
        return subprocess.run(['chroot', str(root), *args], env=env,
                              capture_output=True, text=True, timeout=timeout)

    def rpc(method, args):
        started = time.monotonic()
        p = command('ubus', '-t', '20', 'call', 'luci.homeproxy', method, json.dumps(args))
        assert p.returncode == 0, (p.stdout, p.stderr)
        assert time.monotonic() - started < 3, (method, 'not a short RPC')
        return json.loads(p.stdout)

    us = subprocess.Popen(['chroot', str(root), 'ubusd'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rp = None
    try:
        deadline = time.monotonic() + 5
        while command('ubus', 'list').returncode:
            assert time.monotonic() < deadline, 'ubusd readiness'
            time.sleep(.05)
        rp = subprocess.Popen(['chroot', str(root), 'rpcd'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 5
        while 'luci.homeproxy' not in command('ubus', 'list').stdout:
            assert time.monotonic() < deadline, 'rpcd object readiness'
            time.sleep(.05)

        start_time = time.monotonic()
        first = rpc('resources_update', {'scope': 'geoip'})
        assert first['state'] == 'running' and first['job'], first
        assert rpc('resources_job_status', {'job': first['job']})['state'] == 'running'
        assert rpc('dashboard_manage', {'action': 'update'})['status'] == 2
        assert command('/etc/homeproxy/scripts/update_resources.sh', 'rules', 'geosite').returncode == 2
        assert not (root/'etc/homeproxy/resources/geoip_cn.srs').exists()

        def complete(task, timeout=35):
            deadline = time.monotonic() + timeout
            while True:
                status = rpc('resources_job_status', {'job': task['job']})
                if status['state'] == 'done':
                    return status
                assert time.monotonic() < deadline, 'job completion deadline'
                time.sleep(.1)

        done = complete(first)
        elapsed = time.monotonic() - start_time
        assert elapsed >= 22, elapsed
        assert done['status'] == 0 and done['resources'] == [{'type': 'geoip_cn', 'status': 0}], done
        assert (root/'etc/homeproxy/resources/geoip_cn.srs').read_bytes() == payload
        assert (root/'etc/homeproxy/resources/geoip_cn.ver').read_text() == '20261031000000 ' + '1'*40 + '\n'
        assert not (root/'etc/homeproxy/dashboard').exists()
        assert all('/geoip/' in path for path in requests), requests
        # Reproduce init's recursive service-uid chown. The sibling task controls
        # (including the transaction lock) must remain root-owned and inaccessible.
        for path in [root/'var/run/homeproxy', *(root/'var/run/homeproxy').rglob('*')]:
            os.chown(path, 5566, 5566, follow_symlinks=False)
        controls = root/'var/run/homeproxy.resources'
        assert controls.stat().st_uid == 0 and controls.stat().st_mode & 0o777 == 0o700
        child = os.fork()
        if child == 0:
            os.chroot(root)
            os.setgroups([]); os.setgid(5566); os.setuid(5566)
            for target in ['/var/run/homeproxy.resources/result', '/var/run/homeproxy.resources/update.lock']:
                try:
                    with open(target, 'w') as f:
                        f.write('status=0\n')
                except PermissionError:
                    continue
                os._exit(1)
            os._exit(0)
        assert os.waitpid(child, 0)[1] == 0, 'service uid can forge task evidence or replace lock'
        # Completed result survives an unrelated synchronous lock holder.
        assert rpc('resources_job_status', {'job': first['job']}) == done
        assert rpc('resources_job_status', {'job': 'unknown'})['status'] == 1
        # Scope/manual opt-in and dashboard explicit install/remove stay intact.
        before = len(requests)
        manual = complete(rpc('resources_update', {'scope': 'manual'}))
        assert manual['status'] == 0 and not any('/dashboard/' in p for p in requests[before:]), manual
        delay[0] = 22
        dashboard_started = time.monotonic()
        installed = complete(rpc('dashboard_manage', {'action': 'update'}))
        assert time.monotonic() - dashboard_started >= 22
        assert installed['status'] == 0 and (root/'etc/homeproxy/dashboard/index.html').read_text() == 'dashboard fixture', installed
        assert rpc('resources_job_status', {'job': first['job']})['status'] == 1  # no newer task result substituted
        # Force running readiness + failed reload/restore; production rollback flags retained.
        generation[0] = 2
        (root/'tmp/fail-reload').write_text('1')
        failed = complete(rpc('dashboard_manage', {'action': 'update'}))
        assert failed['status'] == 1 and failed['apply_failed'] and failed['rollback_failed'], failed
        assert (root/'etc/homeproxy/dashboard/index.html').read_text() == 'dashboard fixture'
        (root/'tmp/fail-reload').unlink()
        removed = complete(rpc('dashboard_manage', {'action': 'remove'}))
        assert removed['status'] == 0 and not (root/'etc/homeproxy/dashboard').exists(), removed
        evidence = {'delayed_seconds': 22, 'elapsed': elapsed, 'start': first, 'done': done,
                    'manual': manual, 'dashboard_install': installed, 'dashboard_reload_failure': failed,
                    'dashboard_remove': removed, 'http_requests': requests,
                    'limits': 'Native rpcd/ucode/fs/UCI/digest + real curl. Decoder and service are stubs; private loopback net/PID namespace, no real router/core/WAN.'}
        print(json.dumps(evidence), flush=True)
    finally:
        if rp:
            rp.terminate(); rp.wait(timeout=3)
        us.terminate(); us.wait(timeout=3)
        server.shutdown()


class ResourceJobsNative(unittest.TestCase):
    def test_delayed_http_native_rpc(self):
        rootfs = Path(os.environ.get('OPENWRT_ROOTFS', '/opt/test-tools/openwrt/packages-ci/rootfs.tar.gz'))
        digest = Path(os.environ.get('OPENWRT_DIGEST', '/opt/test-tools/openwrt/packages-ci/runtime/usr/lib/ucode/digest.so'))
        self.assertTrue(rootfs.is_file() and digest.is_file(), 'prebuilt rootfs + digest required; no builds')
        with tempfile.TemporaryDirectory(prefix='hp-resource-jobs-') as directory:
            root = Path(directory)
            with tarfile.open(rootfs) as t:
                t.extractall(root, filter='fully_trusted')
            for d in ['dev', 'tmp', 'var/run/ubus', 'var/run/homeproxy', 'etc/homeproxy/scripts', 'etc/homeproxy/resources']:
                (root/d).mkdir(parents=True, exist_ok=True)
            for name, minor in [('null', 3), ('random', 8), ('urandom', 9)]:
                os.mknod(root/('dev/'+name), 0o20666, os.makedev(1, minor))
            for plugin in (root/'usr/lib/rpcd').glob('*.so'):
                if plugin.name != 'ucode.so':
                    plugin.unlink()
            for p in (root/'usr/share/rpcd/ucode').iterdir():
                p.unlink()
            for p in (APP/'root/etc/homeproxy/scripts').iterdir():
                shutil.copy2(p, root/'etc/homeproxy/scripts'/p.name)
            shutil.copy2(APP/'root/usr/share/rpcd/ucode/luci.homeproxy', root/'usr/share/rpcd/ucode/luci.homeproxy')
            shutil.copy2(digest, root/'usr/lib/ucode/digest.so')
            shutil.copy2(APP/'root/etc/config/homeproxy', root/'etc/config/homeproxy')
            files = ['/usr/bin/curl', '/usr/bin/unzip']
            for tool in list(files):
                for word in subprocess.check_output(['ldd', tool], text=True).split():
                    if word.startswith('/') and Path(word).is_file():
                        files.append(word)
            for name in set(files):
                dest = root/name.lstrip('/')
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(name, dest); dest.chmod(0o755)
            for name, body in [('usr/bin/sing-box', '#!/bin/sh\nexit 0\n'),
                               ('etc/init.d/homeproxy', '#!/bin/sh\n[ "$1" = running ] && { [ -f /tmp/fail-reload ]; exit $?; }\n[ ! -f /tmp/fail-reload ]\n')]:
                p = root/name; p.write_text(body); p.chmod(0o755)
            p = subprocess.run(['unshare', '--net', '--pid', '--fork', '--kill-child', sys.executable,
                                str(Path(__file__).resolve()), '--exercise', str(root)],
                               capture_output=True, text=True, timeout=90)
            print(p.stdout)
            self.assertEqual(p.returncode, 0, p.stdout+p.stderr)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--exercise':
        exercise(Path(sys.argv[2]))
    else:
        unittest.main()
