"""Execute the RPC resource-version parser with real ucode (no router imports)."""
from pathlib import Path
import json
import re
import subprocess
import unittest

APP = Path(__file__).resolve().parents[1]

class Display(unittest.TestCase):
    def test_precision_and_legacy(self):
        src = (APP/'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        match = re.search(r"const stored = .*?const version = .*?;", src, re.S)
        self.assertIsNotNone(match)
        assert match is not None
        parser = match.group()
        parser = parser[parser.index('//'):]
        for stored, expected in [
            ('20260908094002 '+ 'a'*40, '20260908094002'),
            ('20260908094002', '20260908094002'),
            ('2026-09-08 '+ 'a'*40, '2026-09-08'),
            ('2026-09-08', '2026-09-08'),
            ('a'*40, None), ('', None), ('20260908094002 garbage', None)
        ]:
            r = subprocess.run(['ucode', '-e', 'const stored = '+json.dumps(stored)+';'+parser+'print(sprintf("%J", version));'], capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(r.stdout), expected, stored)

if __name__ == '__main__':
    unittest.main()
