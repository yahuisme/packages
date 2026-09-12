"""Execute backend functions with isolated producers; never read device PPE or write UCI."""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'root/usr/libexec/rpcd/luci.airoha_flowsense').read_text()
FUNCTIONS = SOURCE[SOURCE.index('json_number()'):SOURCE.index('case "$1:$2" in')]

class SamplingTest(unittest.TestCase):
    def run_shell(self, script, args=()):
        return subprocess.check_output(['busybox', 'ash', '-c', script, 'test', *args], text=True)

    def test_decimal_json_and_bounds(self):
        for value in ['1..2', '.', '01', '00.2', '-1', 'NaN', '1e2', '60000.1', '1\n2', '']:
            result = self.run_shell(FUNCTIONS + '\njson_decimal "$1"', [value])
            self.assertIsNone(json.loads(result), value)
        for value in ['0', '0.0', '1.25', '60000']:
            self.assertEqual(json.loads(self.run_shell(FUNCTIONS + '\njson_decimal "$1"', [value])), float(value))
        self.assertIsNone(json.loads(self.run_shell(FUNCTIONS + '\njson_decimal 100.1 100')))

    def test_overview_contract(self):
        script = FUNCTIONS + """
uci() { printf '1'; }
fs_target() { return 0; }
get_jitter() { printf null; }
get_interfaces() { printf '[]'; }
get_overview
"""
        result = json.loads(self.run_shell(script))
        self.assertIn('interfaces', result)
        self.assertNotIn('ppe', result)
        self.assertNotIn('get_ppe', SOURCE)
        self.assertNotIn('getPpeEntries', SOURCE)

if __name__ == '__main__':
    unittest.main()
