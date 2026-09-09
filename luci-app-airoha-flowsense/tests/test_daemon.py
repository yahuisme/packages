import json
import os
import pathlib
import subprocess
import tempfile
import unittest

root = pathlib.Path(__file__).resolve().parents[1]


class DaemonTest(unittest.TestCase):
    def test_daemon_isolated_execution(self):
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td)
            (d / 'bin').mkdir()
            (d / 'bin/ping').write_text('#!/bin/sh\nprintf "round-trip min/avg/max = 10.000/10.000/10.000 ms\\n"\n')
            (d / 'bin/sleep').write_text('#!/bin/sh\nkill -TERM "$PPID"\n')
            for p in (d / 'bin').iterdir():
                p.chmod(0o755)
            s = (root / 'root/usr/libexec/npu-jitter-daemon').read_text().replace(
                '/usr/libexec/flowsense-common.sh', str(root / 'root/usr/libexec/flowsense-common.sh')).replace(
                '/tmp/npu-jitter.json', str(d / 'result.json'))
            (d / 'daemon').write_text(s)
            subprocess.run(['busybox', 'ash', str(d / 'daemon'), 'example.com'],
                           env=dict(os.environ, PATH=str(d / 'bin') + ':' + os.environ['PATH']),
                           timeout=5, check=True)
            data = json.loads((d / 'result.json').read_text())
            self.assertEqual(data['deviation'], 0)
            self.assertEqual(data['loss'], 0)
            self.assertEqual(data['samples'], 1)
            self.assertFalse(list(d.glob('result.json.*')))


if __name__ == '__main__':
    unittest.main()
