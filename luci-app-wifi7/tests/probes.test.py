"""Run read-only collectors against isolated command fixtures, never hardware."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


class ProbeTests(unittest.TestCase):
    def test_periodic_status_does_not_read_kernel_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'iw').write_text('#!/bin/sh\nexit 0\n')
            (root / 'dmesg').write_text('#!/bin/sh\nprintf called > "$CALL_LOG"\n')
            for name in ['iw', 'dmesg']:
                (root / name).chmod(0o755)
            env = dict(os.environ, PATH=directory+':/usr/bin:/bin', CALL_LOG=str(root/'calls'))
            result = subprocess.run(['sh', str(APP/'root/usr/libexec/wifi7-status')], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertFalse((root/'calls').exists(), 'Periodic probe must not reread dmesg')

    def test_all_collectors_reject_arguments(self):
        for script in (APP/'root/usr/libexec').iterdir():
            result = subprocess.run(['sh', str(script), 'unexpected'], capture_output=True)
            self.assertEqual(result.returncode, 2, script.name)

    def test_firmware_is_bounded_and_argument_rejecting(self):
        script = APP/'root/usr/libexec/wifi7-firmware'
        self.assertTrue(script.exists())
        result = subprocess.run(['sh', str(script), 'unexpected'], capture_output=True)
        self.assertEqual(result.returncode, 2)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'dmesg').write_text('#!/bin/sh\nprintf "noise\\nmt7996: firmware version old\\nmt7996: firmware version new\\n"\n')
            (root/'dmesg').chmod(0o755)
            result = subprocess.run(['sh', str(script)], env=dict(os.environ, PATH=directory+':/usr/bin:/bin'), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), 'firmware version new')
            (root/'dmesg').write_text('#!/bin/sh\nprintf "mt7996: firmware version ' + 'x'*1024 + '\\n"\n')
            result = subprocess.run(['sh', str(script)], env=dict(os.environ, PATH=directory+':/usr/bin:/bin'), capture_output=True, text=True)
            self.assertEqual(len(result.stdout.rstrip('\n')), 512)


if __name__ == '__main__':
    unittest.main()
