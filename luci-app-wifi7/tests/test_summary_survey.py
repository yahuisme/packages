"""Read-only summary must provide channel time without station dumps."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]

class SummarySurvey(unittest.TestCase):
    def test_three_radio_surveys_without_station_dump(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            iw = root / 'iw'
            iw.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$*" = dev ]; then
 printf 'phy#0\\n Interface wlan0\\n Interface wlan1\\n Interface wlan2\\n'
else
 case "$2" in wlan0) f=2412;; wlan1) f=5180;; wlan2) f=6135;; *) exit 1;; esac
 [ "$3 $4" = 'survey dump' ] || exit 1
 printf 'Survey data from %s\\n frequency: %s MHz [in use]\\n channel active time: 1000 ms\\n channel busy time: 0 ms\\n' "$2" "$f"
fi
''')
            iw.chmod(0o755)
            result = subprocess.run(['busybox', 'ash', str(APP/'root/usr/libexec/wifi7-status-summary')],
                env=dict(os.environ, PATH=str(root)+':/usr/bin:/bin', CALLS=str(root/'calls')),
                text=True, capture_output=True, check=True)
            for iface in ['wlan0', 'wlan1', 'wlan2']:
                self.assertIn('@@ survey '+iface+' 0', result.stdout)
            self.assertEqual((root/'calls').read_text().splitlines(),
                ['dev', 'dev wlan0 survey dump', 'dev wlan1 survey dump', 'dev wlan2 survey dump'])
            self.assertNotIn('station', result.stdout)

if __name__ == '__main__':
    unittest.main()
