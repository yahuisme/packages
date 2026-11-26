"""Runtime initializer's native in-memory transaction and failure boundaries."""
import json
import os
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'root/usr/libexec/homeproxy-runtime-init'


class RuntimeInit(unittest.TestCase):
    def run_case(self, fault='', initialized=False):
        with tempfile.TemporaryDirectory(prefix='hp-runtime-transaction-') as directory:
            root = Path(directory)
            for part in ('bin', 'run', 'config', 'saved', 'override'):
                (root / part).mkdir()
            config = root / 'config/homeproxy'
            config.write_text("config homeproxy 'infra'\n option clash_api_port '9090'\n"
                              " option clash_api_port_initialized '1'\n"
                              "config homeproxy 'config'\n option dashboard_port '9095'\n"
                              f" option dashboard_port_initialized '{int(initialized)}'\n")
            before = config.read_bytes(), config.stat().st_mtime_ns
            # This module wraps the real binding; only set/commit return paths
            # are injected. No shared CLI draft is ever used by production.
            adapter = root / 'uci.uc'
            adapter.write_text('''import { cursor as native_cursor } from 'uci';
export function cursor() {
 const c = native_cursor();
 return {
  load: (path) => c.load(path),
  get: (p,s,o) => c.get(p,s,o),
  foreach: (p,t,cb) => c.foreach(p,t,cb),
  set: (p,s,o,v) => getenv('FAULT') == 'set' ? null : c.set(p,s,o,v),
  commit: (p) => getenv('FAULT') == 'commit' ? null : c.commit(p)
 };
};
'''.replace('native_cursor();', 'native_cursor(' + json.dumps(str(root / 'config')) + ');'))
            for name, body in (
                    ('random', '#!/bin/sh\n[ "$FAULT" != random_port ] || exit 1\nprintf 12345\n'),
                    ('core', '#!/bin/sh\nprintf 1.14.4\n')):
                path = root / 'bin' / name
                path.write_text(body)
                path.chmod(0o755)
            calls = root / 'ucode-calls'
            runtime = root / 'bin/ucode'
            native_ucode = shutil.which('ucode')
            assert native_ucode, 'native ucode runtime is required'
            runtime.write_text('#!/bin/sh\nprintf "call\\n" >> ' + shlex.quote(str(calls)) +
                               '\nexec ' + shlex.quote(native_ucode) + ' "$@"\n')
            runtime.chmod(0o755)
            script = root / 'runtime-init'
            script.write_text(SCRIPT.read_text().replace('const c = uci.cursor();',
                              'const c = fixture_cursor();').replace("ucode -l uci -e '\n",
                              "ucode -l uci -e '\nimport { cursor as fixture_cursor } from " +
                              json.dumps(str(adapter)) + ";\n")
                              .replace('/etc/config', str(root / 'config'))
                              # Ordinary CI runs unprivileged; the separate
                              # native-rootfs/log suites verify uid 0 ownership.
                              .replace('chown root:root', f'chown {os.getuid()}:{os.getgid()}')
                              .replace('/var/run/homeproxy', str(root / 'run'))
                              .replace('/usr/libexec/homeproxy-random-port', str(root / 'bin/random'))
                              .replace('/usr/bin/sing-box', str(root / 'bin/core')))
            result = subprocess.run(['busybox', 'ash', str(script)],
                                    env=dict(os.environ, FAULT=fault, PATH=str(root / 'bin') + ':' + os.environ['PATH']),
                                    capture_output=True, text=True, timeout=15)
            self.ucode_calls = len(calls.read_text().splitlines())
            return result, before, (config.read_bytes(), config.stat().st_mtime_ns)

    def test_reads_settings_once_then_commits_with_existing_readback(self):
        result, before, after = self.run_case(initialized=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(after, before)
        self.assertEqual(self.ucode_calls, 2, 'one settings snapshot plus one native commit/readback process')

    def test_set_commit_and_random_failures_leave_persistent_bytes(self):
        for fault in ('set', 'commit', 'random_port'):
            with self.subTest(fault=fault):
                result, before, after = self.run_case(fault)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(after, before)

    def test_success_and_no_change(self):
        result, before, after = self.run_case(initialized=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(after, before)
        result, _, after = self.run_case()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b"option dashboard_port '12345'", after[0])
        self.assertIn(b"option dashboard_port_initialized '1'", after[0])


if __name__ == '__main__':
    unittest.main()
