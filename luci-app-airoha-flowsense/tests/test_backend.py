import json
import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile
import unittest

root = pathlib.Path(__file__).resolve().parents[1]


def get_dependency(name):
    requested = os.environ.get(name.upper() + '_BIN') or name
    found = shutil.which(requested)
    return str(pathlib.Path(found).resolve()) if found else None


UCI = get_dependency('uci')
JSONFILTER = get_dependency('jsonfilter')
BUSYBOX = get_dependency('busybox')


@unittest.skipUnless(UCI and JSONFILTER and BUSYBOX, 'uci, jsonfilter and busybox binaries are required')
class BackendRealToolsTest(unittest.TestCase):
    def test_backend_durable_save_and_ppe(self):
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td)
            for name in ('bin', 'config', 'delta', 'fresh'):
                (d / name).mkdir()
            (d / 'config/npu-monitor').write_text("config jitter\n option target '223.5.5.5'\n option enabled '1'\n")
            common = root / 'root/usr/libexec/flowsense-common.sh'
            rpc = (root / 'root/usr/libexec/rpcd/luci.airoha_flowsense').read_text().replace(
                '/usr/libexec/flowsense-common.sh', str(common)).replace(
                '/etc/init.d/npu-jitter restart', 'fake_restart').replace(
                '/sys/kernel/debug/ppe/entries', str(d / 'entries'))
            (d / 'rpc').write_text(rpc)
            assert UCI and JSONFILTER and BUSYBOX
            (d / 'bin/jsonfilter').symlink_to(JSONFILTER)
            (d / 'bin/uci').write_text('''#!/bin/sh
if [ -n "$FAIL_COMMAND" ] && [ "$1" = "$FAIL_COMMAND" ] && [ ! -e "$FAIL_MARKER" ]; then
    touch "$FAIL_MARKER"
    exit 1
fi
exec ''' + shlex.join([UCI, '-c', str(d / 'config'), '-t', str(d / 'delta')]) + ' "$@"\n')
            (d / 'bin/fake_restart').write_text('''#!/bin/sh
printf 'restart\n' >> "$RESTART_LOG"
if [ "$FAIL_RESTART" = 1 ] && [ ! -e "$FAIL_MARKER" ]; then
    touch "$FAIL_MARKER"
    exit 1
fi
''')
            for p in (d / 'bin').iterdir():
                if not p.is_symlink():
                    p.chmod(0o755)
            env = dict(os.environ, PATH=str(d / 'bin') + ':' + os.environ['PATH'],
                       FAIL_MARKER=str(d / 'failed'), RESTART_LOG=str(d / 'restarts'))

            def call(method, payload=None, extra=None):
                assert BUSYBOX
                result = subprocess.run([BUSYBOX, 'ash', str(d / 'rpc'), 'call', method],
                                        input=json.dumps(payload or {}) + '\n', text=True,
                                        capture_output=True, env=dict(env, **(extra or {})), timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)

            def persisted():
                assert UCI
                return tuple(subprocess.check_output(
                    [UCI, '-c', str(d / 'config'), '-t', str(d / 'fresh'), 'get',
                     'npu-monitor.@jitter[0].' + key], text=True).strip()
                             for key in ('target', 'enabled'))

            initial = persisted()
            self.assertFalse(call('setMonitor', {'target': 'bad"target', 'enabled': 1})['success'])
            self.assertEqual(persisted(), initial)
            self.assertFalse((d / 'restarts').exists())

            for failure in ({'FAIL_COMMAND': 'set'}, {'FAIL_COMMAND': 'commit'}, {'FAIL_RESTART': '1'}):
                (d / 'failed').unlink(missing_ok=True)
                self.assertFalse(call('setMonitor', {'target': 'example.com', 'enabled': 0}, failure)['success'])
                self.assertTrue((d / 'failed').exists(), failure)
                self.assertEqual(persisted(), initial, failure)

            self.assertTrue(call('setMonitor', {'target': 'example.com', 'enabled': 0})['success'])
            self.assertEqual(persisted(), ('example.com', '0'))
            self.assertTrue((d / 'restarts').read_text().splitlines())

            (d / 'entries').write_text(pathlib.Path(__file__).with_name('ppe-fixture.txt').read_text())
            p = call('getPpeEntries')
            self.assertEqual(p['total'], 4)
            self.assertEqual(p['bnd'], 2)
            self.assertEqual(p['unb'], 1)

            (d / 'entries').unlink()
            self.assertFalse(call('getPpeEntries')['available'])


if __name__ == '__main__':
    unittest.main()
