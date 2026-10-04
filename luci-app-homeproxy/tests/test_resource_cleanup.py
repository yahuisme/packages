"""Real ash updater/fs/ucode with loopback HTTP; decoder and init isolated."""
import fcntl
import hashlib
import http.server
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

APP = Path(__file__).resolve().parents[1]
SCRIPT = APP / 'root/etc/homeproxy/scripts/update_resources.sh'


class ResourceCleanup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='homeproxy-cleanup-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.resources = self.root / 'resources'
        self.resources.mkdir()
        self.run_dir = self.root / 'run'
        self.payload = b'SRS\x01fixture'
        self.generation = 1
        self.requests = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append(self.path)
                if self.path.endswith('/version'):
                    body = json.dumps({'sha': format(owner.generation, '040x'),
                        'commit': {'committer': {'date': '2024-02-03T04:05:06Z'}}}).encode()
                elif '/digest?' in self.path:
                    blob = hashlib.sha1(b'blob ' + str(len(owner.payload)).encode() + b'\0' + owner.payload).hexdigest()
                    body = json.dumps({'sha': blob}).encode()
                else:
                    body = owner.payload
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        tools = self.root / 'bin'
        tools.mkdir()
        scripts = {
            'decoder': '#!/bin/sh\nexit 0\n',
            'init': '#!/bin/sh\n[ "$1" != reload ] || [ "$FAIL_RELOAD" != 1 ]\n',
            'ucode': '#!/bin/sh\nexec /usr/local/bin/ucode -L "$UCODE_LIB_DIR" "$@"\n',
            'rm': '''#!/bin/sh
for arg do
 case "$arg" in
 *.old.*.cleanup-ready) [ "$FAIL_DELETE_PROOF" != 1 ] || exit 1 ;;
 *.old.*) [ "$FAIL_DELETE_OLD" != 1 ] || exit 1 ;;
 *.new.*) [ "$FAIL_DELETE_NEW" != 1 ] || exit 1 ;;
 esac
done
exec /bin/rm "$@"
''',
            'cp': '''#!/bin/sh
printf '%s\n' "$*" >> "$CP_LOG"
/bin/cp "$@" || exit $?
[ "$CRASH_STAGE" != 1 ] || kill -KILL "$PPID"
''',
            'mv': '''#!/bin/sh
case "$1" in *.old.*) [ "$FAIL_RESTORE" != 1 ] || exit 1;; esac
/bin/mv "$@" || exit $?
case "$2" in
 *.old.*) [ "$INJECT_PROOF_LINK" != 1 ] || ln -s "$EXTERNAL_PROOF" "$2.cleanup-ready";;
esac
exit 0
'''
        }
        for name, content in scripts.items():
            p = tools / name
            p.write_text(content)
            p.chmod(0o755)
        self.env = dict(os.environ, PATH=str(tools) + ':' + os.environ['PATH'],
            UCODE_LIB_DIR=os.environ.get('UCODE_LIB_DIR', '/opt/test-tools/ucode/build'),
            RESOURCES_DIR=str(self.resources), DASHBOARD_DIR=str(self.root/'dashboard'),
            RUN_DIR=str(self.run_dir), SING_BOX=str(tools/'decoder'),
            HOMEPROXY_INIT=str(tools/'init'), CP_LOG=str(self.root/'cp.log'))
        url = f'http://127.0.0.1:{self.server.server_port}'
        for kind in ('GEOIP', 'GEOSITE'):
            self.env[kind+'_SOURCE'] = url+'/'+kind.lower()
            self.env[kind+'_VERSION_URL'] = url+'/'+kind.lower()+'/version'
            self.env[kind+'_DIGEST_URL'] = url+'/'+kind.lower()+'/digest'
        for kind in ('geoip', 'geosite'):
            (self.resources/(kind+'_cn.srs')).write_bytes(b'old '+kind.encode())
            (self.resources/(kind+'_cn.ver')).write_text('old')
        (self.resources/'private.txt').write_text('preserve')

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def update(self, status=0, args=None):
        p = subprocess.run(['busybox', 'ash', str(SCRIPT)] + (args or []),
            env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(p.returncode, status, p.stderr)
        return p

    def result(self):
        return dict(line.split('=', 1) for line in
            (self.run_dir/'update_resources.result').read_text().splitlines())

    def snapshot(self):
        return {p.name:p.read_bytes() for p in self.resources.iterdir() if p.is_file()}

    def test_failed_backup_delete_reports_failure_and_retries_without_growth(self):
        self.env['FAIL_DELETE_OLD'] = '1'
        self.update(1)
        self.assertEqual(self.result()['status'], '1')
        backups = list(self.root.glob('resources.old.*'))
        self.assertTrue(backups)
        after = self.snapshot()
        self.generation = 2
        for _ in range(3):
            self.update(1)
            self.assertEqual(self.snapshot(), after)
            self.assertEqual(sorted(p.name for p in self.root.glob('resources.old.*')),
                sorted(p.name for p in backups))
        self.env['FAIL_DELETE_OLD'] = '0'
        self.update()
        self.assertEqual(list(self.root.glob('resources.old.*')), [])
        self.assertEqual((self.resources/'private.txt').read_text(), 'preserve')
    def test_orphan_proof_unlink_failure_blocks_growth_until_healthy_noop(self):
        self.env['FAIL_DELETE_PROOF'] = '1'
        observations = []
        staging_log = None
        for generation in range(1, 5):
            self.generation = generation
            self.update(1)
            if generation == 1:
                staging_log = (self.root/'cp.log').read_bytes()
            else:
                self.assertEqual((self.root/'cp.log').read_bytes(), staging_log)
            self.assertEqual(self.result()['status'], '1')
            observations.append((
                len(list(self.root.glob('resources.old.*.cleanup-ready'))),
                len(self.requests), self.snapshot()))
            self.assertEqual([p for p in self.root.glob('resources.old.*') if p.is_dir()], [])
            self.assertEqual(list(self.root.glob('resources.new.*')), [])
            self.assertEqual(list(self.run_dir.glob('resources-update.*')), [])
        self.assertEqual([count for count, _, _ in observations], [1, 1, 1, 1])
        self.assertEqual([requests for _, requests, _ in observations], [observations[0][1]] * 4)
        self.assertTrue(all(snapshot == observations[0][2] for _, _, snapshot in observations))
        proof = next(self.root.glob('resources.old.*.cleanup-ready'))
        old = Path(str(proof).removesuffix('.cleanup-ready'))
        self.assertRegex(proof.read_text(), f'^committed {old} [0-9]+:[0-9]+\\n$')
        self.env['FAIL_DELETE_PROOF'] = '0'
        self.generation = 1
        self.update(3)
        self.assertEqual(self.result()['status'], '3')
        self.assertEqual(list(self.root.glob('resources.old.*')), [])
        self.assertEqual(self.snapshot(), observations[0][2])

    def test_orphan_proofs_require_owned_path_exact_format_and_regular_file(self):
        external = self.root/'external-proof'
        external.write_bytes(b'private external bytes\x00\n')
        before = self.snapshot()
        for base in ('resources', 'dashboard'):
            for kind in ('empty', 'wrong', 'no-newline', 'extra-newline', 'wrong-path',
                    'bad-device', 'bad-inode', 'nul', 'unowned', 'link', 'dangling', 'directory'):
                with self.subTest(base=base, proof=kind):
                    old = self.root/(base+'.old.'+('keep' if kind == 'unowned' else '1234'))
                    marker = Path(str(old)+'.cleanup-ready')
                    valid = f'committed {old} 123:456\n'.encode()
                    if kind in ('link', 'dangling'):
                        marker.symlink_to(external if kind == 'link' else self.root/'absent')
                    elif kind == 'directory':
                        marker.mkdir()
                    else:
                        marker.write_bytes({'empty':b'', 'wrong':b'ready\n',
                            'no-newline':valid[:-1], 'extra-newline':valid+b'\n',
                            'wrong-path':valid.replace(b'.1234 ', b'.5678 '),
                            'bad-device':valid.replace(b'123:456', b'x:456'),
                            'bad-inode':valid.replace(b'123:456', b'123:x'),
                            'nul':valid+b'\x00', 'unowned':valid}[kind])
                    original = marker.read_bytes() if kind not in ('link', 'dangling', 'directory') else None
                    try:
                        for _ in range(2):
                            self.update(1)
                            self.assertEqual(self.result()['status'], '1')
                            self.assertEqual(self.snapshot(), before)
                            self.assertEqual(self.requests, [])
                            self.assertFalse((self.root/'cp.log').exists())
                            self.assertEqual(external.read_bytes(), b'private external bytes\x00\n')
                            self.assertFalse((self.root/'absent').exists())
                            if kind in ('link', 'dangling'):
                                self.assertTrue(marker.is_symlink())
                            elif kind == 'directory':
                                self.assertTrue(marker.is_dir())
                            else:
                                self.assertEqual(marker.read_bytes(), original)
                    finally:
                        if kind == 'directory':
                            marker.rmdir()
                        else:
                            marker.unlink()

    def test_dashboard_orphan_proof_cleanup_retries_before_not_installed_noop(self):
        dashboard = self.root/'dashboard'
        dashboard.mkdir()
        (dashboard/'index.html').write_bytes(b'old dashboard')
        self.env['FAIL_DELETE_PROOF'] = '1'
        for _ in range(4):
            self.update(1, ['dashboard-remove'])
            self.assertFalse(dashboard.exists())
            self.assertIn('status=1', (self.run_dir/'dashboard.result').read_text())
            self.assertEqual(len(list(self.root.glob('dashboard.old.*.cleanup-ready'))), 1)
            self.assertEqual([p for p in self.root.glob('dashboard.old.*') if p.is_dir()], [])
            self.assertEqual(self.requests, [])
        self.env['FAIL_DELETE_PROOF'] = '0'
        self.update(3, ['dashboard-remove'])
        self.assertEqual(list(self.root.glob('dashboard.old.*')), [])
        self.assertFalse(dashboard.exists())
        self.assertEqual(self.requests, [])

    def test_inherited_marker_link_does_not_overwrite_external_bytes(self):
        external = self.root/'external-private'
        external.write_bytes(b'private bytes\x00do not overwrite\n')
        (self.resources/'.cleanup-ready').symlink_to(external)
        self.update()
        self.assertEqual(external.read_bytes(), b'private bytes\x00do not overwrite\n')
        self.assertTrue((self.resources/'.cleanup-ready').is_symlink())

    def test_old_inherited_markers_never_authorize_discard(self):
        external = self.root/'external-private'
        external.write_bytes(b'keep external\x00bytes\n')
        for kind in ('empty', 'wrong', 'ready', 'link'):
            with self.subTest(marker=kind):
                old = self.root/'resources.old.1234'
                old.mkdir()
                (old/'recovery').write_bytes(b'old recovery')
                marker = old/'.cleanup-ready'
                if kind == 'link':
                    marker.symlink_to(external)
                else:
                    marker.write_bytes({'empty':b'', 'wrong':b'wrong\n', 'ready':b'ready\n'}[kind])
                before = self.snapshot()
                requests = len(self.requests)
                for _ in range(2):
                    self.update(1)
                    self.assertEqual((old/'recovery').read_bytes(), b'old recovery')
                    self.assertEqual(self.snapshot(), before)
                    self.assertEqual(len(self.requests), requests)
                    self.assertEqual(external.read_bytes(), b'keep external\x00bytes\n')
                if kind == 'link':
                    self.assertTrue(marker.is_symlink())
                else:
                    self.assertEqual(marker.read_bytes(), {'empty':b'', 'wrong':b'wrong\n', 'ready':b'ready\n'}[kind])
                # Remove only this fixture generation between subcases.
                marker.unlink()
                (old/'recovery').unlink()
                old.rmdir()

    def test_inherited_marker_cannot_discard_failed_rollback(self):
        external = self.root/'external-private'
        external.write_bytes(b'keep external\x00bytes\n')
        for kind in ('ready', 'link'):
            with self.subTest(marker=kind):
                marker = self.resources/'.cleanup-ready'
                if kind == 'link':
                    marker.symlink_to(external)
                else:
                    marker.write_bytes(b'ready\n')
                before = self.snapshot()
                self.env.update(FAIL_RELOAD='1', FAIL_RESTORE='1')
                self.update(1)
                self.assertEqual(self.result()['apply_failed'], '1')
                self.assertEqual(self.result()['rollback_failed'], '1')
                backups = list(self.root.glob('resources.old.*'))
                self.assertEqual(len(backups), 1)
                old = backups[0]
                self.env.update(FAIL_RELOAD='0', FAIL_RESTORE='0')
                requests = len(self.requests)
                for _ in range(2):
                    self.update(1)
                    self.assertEqual(list(self.root.glob('resources.old.*')), backups)
                    self.assertEqual({p.name:p.read_bytes() for p in old.iterdir() if p.is_file()}, before)
                    self.assertEqual(len(self.requests), requests)
                    self.assertEqual(external.read_bytes(), b'keep external\x00bytes\n')
                self.assertEqual((old/'.cleanup-ready').is_symlink(), kind == 'link')
                self.assertFalse(Path(str(old)+'.cleanup-ready').exists())
                # Manually recover fixture data, not through the updater.
                self.resources.rmdir()
                old.rename(self.resources)
                (self.resources/'.cleanup-ready').unlink()

    def test_sidecar_requires_exact_bytes_and_generation_identity(self):
        for name in ('empty', 'wrong', 'no-newline', 'extra-newline',
                'wrong-generation', 'wrong-inode', 'link'):
            with self.subTest(marker=name):
                old = self.root/'resources.old.1234'
                old.mkdir()
                (old/'recovery').write_bytes(b'keep recovery')
                marker = Path(str(old)+'.cleanup-ready')
                identity = f'{old.stat().st_dev}:{old.stat().st_ino}'
                valid = f'committed {old} {identity}\n'.encode()
                external = self.root/'external-proof'
                external.write_bytes(valid)
                requests = len(self.requests)
                try:
                    if name == 'link':
                        marker.symlink_to(external)
                    else:
                        marker.write_bytes({'empty':b'', 'wrong':b'ready\n',
                            'no-newline':valid[:-1], 'extra-newline':valid+b'\n',
                            'wrong-generation':valid.replace(b'.1234 ', b'.5678 '),
                            'wrong-inode':f'committed {old} 0:0\n'.encode()}[name])
                    for _ in range(2):
                        self.update(1)
                        self.assertEqual((old/'recovery').read_bytes(), b'keep recovery')
                        self.assertEqual(external.read_bytes(), valid)
                        self.assertEqual(len(self.requests), requests)
                finally:
                    marker.unlink(missing_ok=True)
                    if old.exists():
                        shutil.rmtree(old)

    def test_existing_generation_proof_blocks_before_swap(self):
        external = self.root/'external-proof'
        external.write_bytes(b'private external bytes\x00\n')
        before = self.snapshot()
        for kind in ('file', 'link', 'dangling'):
            with self.subTest(marker=kind):
                env = dict(self.env, SCRIPT=str(SCRIPT), EXTERNAL=str(external), KIND=kind,
                    FAIL_RELOAD='1', FAIL_RESTORE='1')
                program = '''marker="$RESOURCES_DIR.old.$$.cleanup-ready"
case "$KIND" in
file) printf 'preexisting\n' > "$marker";;
link) ln -s "$EXTERNAL" "$marker";;
dangling) ln -s "$EXTERNAL.absent" "$marker";;
esac
exec busybox ash "$SCRIPT"
'''
                p = subprocess.run(['busybox', 'ash', '-c', program], env=env,
                    capture_output=True, text=True, timeout=15)
                self.assertEqual(p.returncode, 1, p.stderr)
                self.assertTrue(self.resources.is_dir(), 'must block before active directory swap')
                self.assertEqual(self.snapshot(), before)
                self.assertEqual(self.requests, [])
                self.assertEqual(external.read_bytes(), b'private external bytes\x00\n')
                self.assertFalse(Path(str(external)+'.absent').exists())
                self.assertEqual([p for p in self.root.glob('resources.old.*') if p.is_dir()], [])
                markers = list(self.root.glob('resources.old.*.cleanup-ready'))
                self.assertEqual(len(markers), 1)
                if kind == 'file':
                    self.assertEqual(markers[0].read_bytes(), b'preexisting\n')
                else:
                    self.assertTrue(markers[0].is_symlink())
                markers[0].unlink()

    def test_proof_creation_refuses_late_symlink(self):
        for kind in ('file', 'dangling'):
            with self.subTest(target=kind):
                external = self.root/('external-'+kind)
                if kind == 'file':
                    external.write_bytes(b'private binary\x00bytes\n')
                self.env.update(INJECT_PROOF_LINK='1', EXTERNAL_PROOF=str(external))
                self.update(1)
                self.assertEqual(self.result()['status'], '1')
                self.assertEqual((self.resources/'geoip_cn.srs').read_bytes(), self.payload)
                if kind == 'file':
                    self.assertEqual(external.read_bytes(), b'private binary\x00bytes\n')
                else:
                    self.assertFalse(external.exists())
                backups = [p for p in self.root.glob('resources.old.*') if p.is_dir()]
                self.assertEqual(len(backups), 1)
                proof = Path(str(backups[0])+'.cleanup-ready')
                self.assertTrue(proof.is_symlink())
                requests = len(self.requests)
                self.env['INJECT_PROOF_LINK'] = '0'
                self.update(1)
                self.assertEqual(len(self.requests), requests)
                self.assertTrue(backups[0].exists())
                proof.unlink()
                shutil.rmtree(backups[0])
                self.generation += 1

    def test_dashboard_inherited_link_cleanup_failure_retries_safely(self):
        dashboard = self.root/'dashboard'
        dashboard.mkdir()
        (dashboard/'index.html').write_bytes(b'old dashboard')
        external = self.root/'external-private'
        external.write_bytes(b'private dashboard bytes\x00\n')
        (dashboard/'.cleanup-ready').symlink_to(external)
        self.env['FAIL_DELETE_OLD'] = '1'
        self.update(1, ['dashboard-remove'])
        self.assertFalse(dashboard.exists())
        self.assertIn('status=1', (self.run_dir/'dashboard.result').read_text())
        backups = [p for p in self.root.glob('dashboard.old.*') if p.is_dir()]
        self.assertEqual(len(backups), 1)
        old = backups[0]
        self.assertEqual(external.read_bytes(), b'private dashboard bytes\x00\n')
        proof = Path(str(old)+'.cleanup-ready')
        identity = f'{old.stat().st_dev}:{old.stat().st_ino}'
        self.assertTrue(proof.is_file(), 'successful publication must own a sidecar proof')
        self.assertEqual(proof.read_bytes(), f'committed {old} {identity}\n'.encode())
        self.update(1, ['dashboard-remove'])
        self.assertTrue(old.exists())
        self.env['FAIL_DELETE_OLD'] = '0'
        self.update(3, ['dashboard-remove'])
        self.assertEqual(list(self.root.glob('dashboard.old.*')), [])
        self.assertEqual(external.read_bytes(), b'private dashboard bytes\x00\n')
        self.assertEqual(self.requests, [])

    def test_crash_staging_is_cleaned_on_retry(self):
        self.env['CRASH_STAGE'] = '1'
        before = self.snapshot()
        self.update(-9)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(list(self.root.glob('resources.new.*'))), 1)
        self.assertEqual(len(list(self.run_dir.glob('resources-update.*'))), 1)
        self.env['CRASH_STAGE'] = '0'
        self.update()
        self.assertEqual(list(self.root.glob('resources.new.*')), [])
        self.assertEqual(list(self.run_dir.glob('resources-update.*')), [])

    def test_noop_stage_cleanup_failure_is_reported_and_retried(self):
        self.update()
        before = self.snapshot()
        self.env['FAIL_DELETE_NEW'] = '1'
        self.update(1)
        self.assertEqual(self.result()['status'], '1')
        self.assertTrue(list(self.root.glob('resources.new.*')))
        self.assertEqual(self.snapshot(), before)
        self.env['FAIL_DELETE_NEW'] = '0'
        self.update(3)
        self.assertEqual(list(self.root.glob('resources.new.*')), [])

    def test_unresolved_recovery_backup_blocks_further_updates(self):
        self.env.update(FAIL_RELOAD='1', FAIL_RESTORE='1')
        self.update(1)
        backups = list(self.root.glob('resources.old.*'))
        self.assertEqual(len(backups), 1)
        saved = {p.name:p.read_bytes() for p in backups[0].iterdir()}
        self.env.update(FAIL_RELOAD='0', FAIL_RESTORE='0')
        requests = len(self.requests)
        for _ in range(3):
            self.update(1)
            self.assertEqual(list(self.root.glob('resources.old.*')), backups)
            self.assertEqual({p.name:p.read_bytes() for p in backups[0].iterdir()}, saved)
        self.assertEqual(len(self.requests), requests)

    def test_cleanup_does_not_follow_symlinks_or_remove_unowned_names(self):
        outside = self.root/'outside'
        outside.mkdir()
        (outside/'important').write_text('keep')
        (self.root/'resources.new.1234').symlink_to(outside, target_is_directory=True)
        unowned = self.root/'resources.new.keep'
        unowned.mkdir()
        self.update()
        self.assertEqual((outside/'important').read_text(), 'keep')
        self.assertTrue(unowned.exists())

    def test_stale_cleanup_respects_busy_lock(self):
        self.run_dir.mkdir()
        stale = self.root/'resources.new.1234'
        stale.mkdir()
        with (self.run_dir/'update_resources.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.update(2)
            self.assertTrue(stale.exists())
        self.update()
        self.assertFalse(stale.exists())

    def test_cleanup_repeated_generations_remain_bounded(self):
        for revision in range(1, 21):
            self.generation = revision
            self.update()
            self.assertEqual(list(self.root.glob('resources.old.*')), [])
            self.assertEqual(list(self.root.glob('resources.new.*')), [])
            self.assertEqual(list(self.run_dir.glob('resources-update.*')), [])
        self.assertEqual(len(self.snapshot()), 5)

    def test_legacy_backup_is_retained_and_does_not_accumulate(self):
        old = self.root/'resources.old.1234'
        old.mkdir()
        (old/'recovery').write_text('keep')
        before = self.snapshot()
        for _ in range(3):
            self.update(1)
            self.assertEqual(self.snapshot(), before)
            self.assertEqual(list(self.root.glob('resources.old.*')), [old])
        self.assertEqual((old/'recovery').read_text(), 'keep')
        self.assertEqual(self.requests, [])

    def test_cleanup_failure_prevents_a_new_generation(self):
        stale = self.root/'resources.new.1234'
        stale.mkdir()
        (stale/'old').write_text('abandoned staging')
        before = self.snapshot()
        self.env['FAIL_DELETE_NEW'] = '1'
        for _ in range(3):
            self.update(1)
            self.assertEqual(self.snapshot(), before)
            self.assertEqual(list(self.root.glob('resources.new.*')), [stale])
        self.assertEqual(self.requests, [])
        self.env['FAIL_DELETE_NEW'] = '0'
        self.update()
        self.assertFalse(stale.exists())


if __name__ == '__main__':
    unittest.main()
