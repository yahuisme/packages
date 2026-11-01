"""Complete collector stdout/stderr/status/iw argv differential under BusyBox ash.
Defaults to an immutable git baseline and temporary artifacts below private TMPDIR.
Optional PERF_BASELINE_STATUS/PERF_OUT preserve external local evidence workflows.
No hardware, host sockets or services are accessed.
"""
import json
import hashlib
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]
BASELINE_COMMIT = 'c9636f029c8fbd631cfecff43eff301d8eb898ba'
CASES = [
    ('normal', b'phy#0\n\tInterface wlan0\n Interface ap-mld\n', 0),
    ('whitespace', b' \tInterface\t wlan0 \t ignored\nInterface\twlan1\n', 0),
    ('no-final-newline', b'Interface wlan0', 0),
    ('trailing-newlines', b'Interface wlan0\n\n\n', 0),
    ('empty', b'', 0),
    ('blank', b' \t\n\n', 0),
    ('incomplete', b'Interface\nInterface  \n NotInterface wlan0\n', 0),
    ('invalid', b'Interface invalid/name\nInterface bad;command\nInterface bad\\name\nInterface $evil\nInterface bad*\n', 0),
    ('valid-order-duplicates', b'Interface z:1\nInterface .abc-2_3\nInterface wlan0\nInterface z:1\n', 0),
    ('carriage-and-control', b'Interface wlan0\r\n\rInterface wlan1\nInterface\vwlan2\nInterface\fwlan3\n', 0),
    ('carriage-return', b'Interface wlan0\r\n\rInterface wlan1\n', 0),
    ('vertical-tab', b'Interface\vwlan2\n', 0),
    ('form-feed', b'Interface\fwlan3\n', 0),
    ('failed-partial', b'Interface wlan0\n', 1),
    ('failed-empty', b'', 2),
    ('probe-failure', b'Interface broken\nInterface wlan0\n', 0),
    ('recovered', b'Interface wlan0\n', 0),
]

def compare(baseline, out, busybox, strace):
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='wifi7-parser-', dir=os.environ['TMPDIR']) as directory:
        root = Path(directory)
        bindir = root / 'bin'
        bindir.mkdir()
        sockets = root / 'hostapd'
        sockets.mkdir()
        sock = socket.socket(socket.AF_UNIX)
        sock.bind(str(sockets / 'wlan0'))
        try:
            for name, source in {
                'iw': '''#!/bin/sh
printf '%s\\n' "$*" >> "$IW_CALLS"
if [ "$*" = dev ]; then "$FIXTURE_BUSYBOX" cat "$DEVICES"; exit "$DEVICE_CODE"; fi
[ "$2" != broken ] || { printf 'partial failure\\n'; exit 7; }
printf 'fixture %s\\n' "$*"
''',
                'awk': '''#!/bin/sh
printf 'awk\\n' >> "$AWK_CALLS"
exec "$FIXTURE_BUSYBOX" awk "$@"
''',
                'hostapd_cli': '''#!/bin/sh
printf '%s\\n' "$*" >> "$HOSTAPD_CALLS"
printf 'state=ENABLED\\nfreq=5180\\n'
''',
            }.items():
                # Every fixture shell and applet uses the runtime being compared.
                (bindir / name).write_text(source.replace('#!/bin/sh', '#!' + busybox + ' ash', 1))
                (bindir / name).chmod(0o755)
            scripts = {}
            for variant, path in [('baseline', baseline), ('current', APP / 'root/usr/libexec/wifi7-status')]:
                scripts[variant] = root / variant
                scripts[variant].write_text(path.read_text().replace('/var/run/hostapd', str(sockets)))
            for name, data, code in CASES:
                (root / 'devices').write_bytes(data)
                for args in [[], ['summary']]:
                    pair = []
                    for variant in ['baseline', 'current']:
                        logs = {key: root / key for key in ['IW_CALLS', 'AWK_CALLS', 'HOSTAPD_CALLS']}
                        for p in logs.values():
                            p.write_bytes(b'')
                        trace = out / (name + ('-summary' if args else '-full') + '-' + variant + '.strace')
                        env = dict(os.environ, PATH=str(bindir), FIXTURE_BUSYBOX=busybox, DEVICES=str(root/'devices'), DEVICE_CODE=str(code), **{key:str(p) for key,p in logs.items()})
                        r = subprocess.run([strace,'-f','-e','trace=process','-o',str(trace),busybox,'ash',str(scripts[variant]),*args],env=env,capture_output=True)
                        text = trace.read_text()
                        pair.append(dict(stdout=r.stdout.decode(),stderr=r.stderr.decode(),status=r.returncode,
                            iw=logs['IW_CALLS'].read_text().splitlines(),hostapd=logs['HOSTAPD_CALLS'].read_text().replace(str(sockets),'<private-hostapd>').splitlines(),
                            awk=len(logs['AWK_CALLS'].read_text().splitlines()),clones=sum(
                                bool(re.search(r'(?:\b(?:clone3?|vfork|fork)\(.*|<\.\.\. (?:clone3?|vfork|fork) resumed>.*)\s= [1-9][0-9]*$', line))
                                for line in text.splitlines())))
                        assert (root/'devices').read_bytes() == data
                    before, after = pair
                    for key in ['stdout','stderr','status','iw','hostapd']:
                        assert after[key] == before[key], (name,args,key,pair)
                    expected_awk = 1 if code == 0 else 0
                    assert before['awk'] == after['awk'] == expected_awk, (name, pair)
                    if code == 0:
                        assert after['clones'] < before['clones'], (name, args, pair)
                    else:
                        assert after['clones'] == before['clones'], (name, args, pair)
                    results.append(dict(case=name,args=args,before=before,after=after))
            (out/'collector.json').write_text(json.dumps(results,indent=2))
            (out/'collector-sources.json').write_text(json.dumps({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [baseline, APP/'root/usr/libexec/wifi7-status', Path(busybox), Path(strace), Path(__file__)]},indent=2))
            print('PASS',len(results),'complete collector differential cases, isolated argv/output/status, input bytes unchanged')
            print(json.dumps({key:[sum(r['before'][key] for r in results),sum(r['after'][key] for r in results)] for key in ['awk','clones']}))
        finally:
            sock.close()

class CollectorEquivalenceTest(unittest.TestCase):
    def test_complete_collector_differential(self):
        # Resolve tools before the fixture narrows PATH; wrappers use this exact BusyBox.
        busybox, strace = shutil.which('busybox'), shutil.which('strace')
        self.assertIsNotNone(busybox, 'BusyBox is required on PATH')
        self.assertIsNotNone(strace, 'strace is required on PATH')
        self.assertTrue(os.environ.get('TMPDIR'), 'Set TMPDIR to private scratch')
        with tempfile.TemporaryDirectory(prefix='wifi7-collector-', dir=os.environ['TMPDIR']) as directory:
            root = Path(directory)
            if os.environ.get('PERF_BASELINE_STATUS'):
                baseline = Path(os.environ['PERF_BASELINE_STATUS'])
            else:
                baseline = root / 'root/usr/libexec/wifi7-status'
                baseline.parent.mkdir(parents=True)
                baseline.write_bytes(subprocess.check_output(
                    ['git', 'show', BASELINE_COMMIT + ':luci-app-wifi7/root/usr/libexec/wifi7-status'], cwd=APP.parent))
            out = Path(os.environ['PERF_OUT']) if os.environ.get('PERF_OUT') else root / 'results'
            compare(baseline, out, busybox, strace)


if __name__ == '__main__':
    unittest.main()
