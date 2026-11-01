"""Native-fs full RPC equivalence and the boundary of one-byte index probes.

No service/network/compilation. A private PTY supplies bytes followed by EIO;
only index-path IO is redirected to its inherited native descriptor.
"""
import hashlib
import json
import os
from pathlib import Path
import pty
import subprocess
import tempfile
import tty
import unittest

APP = Path(__file__).resolve().parents[1]
RPC = APP / 'root/usr/share/rpcd/ucode/luci.homeproxy'


class DashboardReadBoundary(unittest.TestCase):
    def execute(self, root, probe=False, fault=None, unreadable=False):
        source = RPC.read_text()
        if probe:
            source = source.replace("!!length(readfile(`${HP_DIR}/dashboard/index.html`) || '')",
                                    "indexPresent(`${HP_DIR}/dashboard/index.html`)")
        http = root / 'http.uc'
        http.write_text('export function urldecode_params(v) { return {}; };')
        helper = root / 'helper.uc'
        helper.write_text((APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
                          .replace("from 'luci.http'", 'from ' + json.dumps(str(http)))
                          .replace("'/etc/homeproxy'", json.dumps(str(root / 'hp'))))
        source = source.replace("'/etc/homeproxy/scripts/homeproxy.uc'", json.dumps(str(helper)))
        source = source.replace('open, popen, readfile,', 'open as nativeOpen, fdopen, popen, readfile as nativeReadfile,')
        wrappers = '''
let indexBytes = 0, reads = 0, closes = 0;
const indexPath = HP_DIR + '/dashboard/index.html';
function readfile(path) {
    if (path !== indexPath) return nativeReadfile(path);
    reads++;
    let data;
    if (getenv('HP_FAULT_FD')) {
        const fd = fdopen(int(getenv('HP_FAULT_FD')), 'r');
        data = fd.read(1048576); fd.close(); closes++;
    } else data = nativeReadfile(path);
    indexBytes += length(data || '');
    return data;
}
function open(path, mode) {
    const fd = (path === indexPath && getenv('HP_FAULT_FD')) ?
        fdopen(int(getenv('HP_FAULT_FD')), mode) : nativeOpen(path, mode);
    if (path !== indexPath || !fd) return fd;
    return {
        read: function(size) { reads++; const data = fd.read(size); indexBytes += length(data || ''); return data; },
        close: function() { closes++; return fd.close(); }
    };
}
// Candidate only, never installed as production code.
function indexPresent(path) {
    const fd = open(path, 'r');
    if (!fd) return false;
    let present;
    try { present = !!length(fd.read(1) || ''); }
    catch (e) { fd.close(); die(e); }
    fd.close();
    return present;
}
'''
        source = source.replace('const RESOURCES = {', wrappers + '\nconst RESOURCES = {')
        source = source.replace("return { 'luci.homeproxy': methods };", '''
const results = [methods.resources_get.call()];
if (!getenv('HP_FAULT_FD')) {
    writefile(indexPath, ''); push(results, methods.resources_get.call());
    writefile(indexPath, 'nil'); push(results, methods.resources_get.call());
}
print(sprintf('%J', { results, indexBytes, reads, closes }));''')
        script = root / 'rpc.uc'
        script.write_text(source)
        env = dict(os.environ)
        fds = ()
        directory_fd = None
        if unreadable:
            root.chmod(0o755)
            directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            visible_root = f'/proc/self/fd/{directory_fd}'
            # Resolve the full RPC without unused helper imports for this
            # uid-only case: realpath module imports traverse /root (0700).
            begin = source.index('import {\n')
            end = source.index(';', begin) + 1
            names = source[begin + len('import {'):source.index('}', begin)].replace('\n', '').replace('\t', '').split(',')
            placeholders = ', '.join(n.strip() + ' = null' for n in names if n.strip() not in ['HP_DIR', 'RUN_DIR'])
            source = source[:begin] + 'const ' + placeholders + '; const HP_DIR = ' + json.dumps(str(root / 'hp')) + "; const RUN_DIR = '/unused';" + source[end:]
            script.write_text(source.replace(str(root), visible_root))
            script = Path(visible_root) / 'rpc.uc'
            fds = (directory_fd,)
        master = None
        if fault is not None:
            master, slave = pty.openpty()
            tty.setraw(slave)
            if fault:
                os.write(slave, fault)
            os.close(slave)
            env['HP_FAULT_FD'] = str(master)
            fds = (master,)
        options = {}
        if unreadable and os.geteuid() == 0:
            # setuid in the child only; never change host files or identities.
            options = {'user': 65534, 'group': 65534, 'extra_groups': []}
        try:
            run = subprocess.run(['ucode', str(script)], env=env, capture_output=True,
                                 text=True, timeout=10, pass_fds=fds, **options)
        finally:
            if master is not None:
                os.close(master)
            if directory_fd is not None:
                os.close(directory_fd)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        evidence = os.environ.get('HP_P2_EVIDENCE')
        if evidence:
            out = Path(evidence)
            out.mkdir(parents=True, exist_ok=True)
            name = f"rpc-{'short' if probe else 'full'}-{root.name}-{len(fault) if fault is not None else 'regular'}"
            (out / (name + '.json')).write_text(json.dumps(result, indent=2) + '\n')
            (out / (name + '.uc')).write_text(source)
            (out / (name + '-helper.uc')).write_text(helper.read_text())
            (out / (name + '-http.uc')).write_text(http.read_text())
            (out / 'rpc-source.sha256').write_text(hashlib.sha256(RPC.read_bytes()).hexdigest() + '\n')
        return result

    def fixture(self, root, state):
        hp = root / 'hp'
        (hp / 'dashboard').mkdir(parents=True)
        (hp / 'resources').mkdir()
        for path, data in [('resources/geoip_cn.ver', '20260908094002 ' + 'a' * 40),
                           ('resources/geosite_cn.ver', 'legacy-hash'),
                           ('dashboard/dashboard.ver', '2026-09-08')]:
            (hp / path).write_text(data)
        index = hp / 'dashboard/index.html'
        if state == 'directory':
            index.mkdir()
        elif state != 'missing':
            index.write_bytes(b'x' * 32768 if state == 'large' else b'nil' if state == 'nil' else b'blocked' if state == 'unreadable' else b'')
        return index

    def test_complete_rpc_regular_files_and_fresh_calls(self):
        for state in ['missing', 'empty', 'nil', 'large', 'directory', 'unreadable']:
            with self.subTest(state=state), tempfile.TemporaryDirectory(prefix='hp-index-') as d:
                root = Path(d)
                index = self.fixture(root, state)
                # For real EACCES the unprivileged child must traverse only this
                # private fixture tree, including its generated module imports.
                unreadable = state == 'unreadable'
                if unreadable:
                    index.chmod(0)
                baseline = self.execute(root, unreadable=unreadable)
                if index.is_file() and not unreadable:
                    index.write_bytes(b'x' * 32768 if state == 'large' else b'nil' if state == 'nil' else b'')
                candidate = self.execute(root, probe=True, unreadable=unreadable)
                self.assertEqual(candidate['results'], baseline['results'])
                self.assertEqual(baseline['results'][0]['resources'][-1]['installed'], state in ['nil', 'large'])
                self.assertEqual([r['resources'][-1]['installed'] for r in baseline['results'][1:]],
                                 [False, False] if state in ['directory', 'unreadable'] else [False, True])
                if state == 'large':
                    self.assertEqual(baseline['indexBytes'], 32771)
                    self.assertEqual(candidate['indexBytes'], 2)
                    self.assertEqual(candidate['closes'], 3)
                    if os.environ.get('HP_P2_REQUIRE_BOUNDED'):
                        self.assertLessEqual(baseline['indexBytes'], 3, 'production still reads full dashboard index')
                if unreadable and os.geteuid() == 0:
                    self.assertEqual(index.read_bytes(), b'blocked')
                if unreadable:
                    self.assertEqual(index.stat().st_mode & 0o777, 0)

    def test_native_late_read_error_makes_one_byte_non_equivalent(self):
        with tempfile.TemporaryDirectory(prefix='hp-index-eio-') as d:
            root = Path(d)
            self.fixture(root, 'missing')
            for payload in [b'', b'x' * 8192]:
                with self.subTest(bytes_before_eio=len(payload)):
                    full = self.execute(root, fault=payload)
                    short = self.execute(root, probe=True, fault=payload)
                    self.assertFalse(full['results'][0]['resources'][-1]['installed'])
                    self.assertEqual(short['results'][0]['resources'][-1]['installed'], bool(payload))
                    self.assertEqual(short['closes'], 1)
                    if payload:
                        if os.environ.get('HP_P2_REQUIRE_SHORT_EQ'):
                            self.assertEqual(full['results'], short['results'], 'one-byte probe changes late-EIO status')
                        self.assertNotEqual(full['results'], short['results'])
                        self.assertEqual(short['indexBytes'], 1)


if __name__ == '__main__':
    unittest.main()
