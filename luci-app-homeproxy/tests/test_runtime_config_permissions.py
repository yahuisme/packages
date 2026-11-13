"""Private native ash runtime credential modes at transaction boundaries."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


class RuntimeConfigPermissions(unittest.TestCase):
    def test_existing_configs_and_recovery_are_protected_before_setup(self):
        with tempfile.TemporaryDirectory(prefix='hp-runtime-modes-') as directory:
            root = Path(directory)
            run = root / 'run'
            run.mkdir()
            for name in ('sing-box-c.json', 'sing-box-s.json'):
                path = run / name
                path.write_text('fixture-secret')
                path.chmod(0o644)
            source = (APP / 'root/etc/init.d/homeproxy').read_text()
            source = source[source.index('homeproxy_restore()'):source.index('start_service() {', source.index('homeproxy_transaction()'))]
            checks = '''
log() { :; }
_homeproxy_start_service() {
 python3 - "$RUN_DIR" <<'PY'
import sys,stat
from pathlib import Path
r=Path(sys.argv[1]); b=r/'.reload.pending'
assert stat.S_IMODE(b.stat().st_mode)==0o700
for name in ('sing-box-c.json','sing-box-s.json'):
 for p in (r/name,b/name):
  assert stat.S_IMODE(p.stat().st_mode)==0o600,(str(p),oct(p.stat().st_mode))
PY
}
homeproxy_close_service() { :; }
umask 022
homeproxy_transaction 1
'''
            result = subprocess.run(['busybox', 'ash', '-c', source + checks],
                                    env=dict(os.environ, RUN_DIR=str(run), DNSMASQ_DIR=str(root / 'dns/rules')),
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((run / '.reload.pending').exists())
            self.assertFalse((run / 'reload.state').exists())


if __name__ == '__main__':
    unittest.main()
