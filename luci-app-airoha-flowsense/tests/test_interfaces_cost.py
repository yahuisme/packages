"""Port telemetry equivalence and process accounting on private BusyBox fixtures."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
from typing import Any
import unittest

ROOT = Path(__file__).resolve().parents[1]
RPC = ROOT / 'root/usr/libexec/rpcd/luci.airoha_flowsense'
COMMON = ROOT / 'root/usr/libexec/flowsense-common.sh'
KEYS = ('ifindex', 'carrier', 'speed', 'rx_bytes', 'tx_bytes', 'rx_errors',
        'tx_errors', 'rx_dropped', 'tx_dropped')
# Frozen pre-optimization getter, not reconstructed from the new implementation.
LEGACY = '''get_interfaces() {
    local dev name first=1 key sep ifindex carrier speed
    printf '['
    for dev in /sys/class/net/*; do
        [ -d "$dev/device" ] || [ -d "$dev/dsa" ] || continue
        [ ! -d "$dev/phy80211" ] || continue
        name=${dev##*/}; [ "$name" != "eth0" ] || continue
        case "$name" in ''|*[!a-zA-Z0-9_.:-]*) continue;; esac
        [ "$first" -eq 1 ] || printf ','; first=0
        ifindex=$(fs_read "$dev/ifindex")
        fs_uint "$ifindex" || ifindex=null
        carrier=$(fs_read "$dev/carrier")
        speed=$(fs_read "$dev/speed")
        printf '{"device":"%s","ifindex":%s,"carrier":%s,"speed":%s,"stats":{' "$name" "$ifindex" "$carrier" "$speed"
        sep=
        for key in rx_bytes tx_bytes rx_errors tx_errors rx_dropped tx_dropped; do printf '%s"%s":%s' "$sep" "$key" "$(fs_counter_read "$dev/statistics/$key")"; sep=,; done
        printf '}}'
    done
    printf ']'
}
'''


class InterfacesCostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)
        self.net = self.d / 'net'
        self.net.mkdir()
        self.busybox = os.environ.get('BUSYBOX_BIN') or shutil.which('busybox')
        assert self.busybox, 'real BusyBox required'
        source = RPC.read_text()
        functions = source[source.index('json_number()'):source.index('get_jitter()')]
        for name, body in [('before', LEGACY), ('after', functions)]:
            (self.d / name).write_text('. ' + shlex.quote(str(COMMON)) + '\n' +
                                      body.replace('/sys/class/net/*', str(self.net) + '/*') +
                                      '\nget_interfaces\n')

    def port(self, name, values):
        p = self.net / name
        (p / 'device').mkdir(parents=True, exist_ok=True)
        (p / 'statistics').mkdir(exist_ok=True)
        for key, value in zip(KEYS, values):
            target = p / ('statistics/' + key if key in KEYS[3:] else key)
            if target.exists():
                if target.is_dir(): target.rmdir()
                else: target.unlink()
            if value == 'directory': target.mkdir()
            elif value is not None: target.write_bytes(value)
        return p

    def snapshot(self):
        return {str(p): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.net.rglob('*') if p.is_file()}

    def run_getter(self, version, trace=False):
        command = [self.busybox, 'ash', str(self.d / version)]
        if trace:
            command = ['strace', '-f', '-qq', '-e', 'trace=process,openat', '-o',
                       str(self.d / (version + '.trace')), *command]
        r = subprocess.run(command, capture_output=True, timeout=10)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def test_complete_output_eof_errors_precision_and_freshness(self):
        cases = [None, b'', b'0\n', b'123\n', b'123', b'123\n\n', b'1\n2\n',
                 b' 12 \t\n', b'1 2\n', b'01\n', b'-1\n', b'1\\2\n', b'\r\n',
                 b'999999999999999\n', b'9999999999999999\n',
                 b'18446744073709551615\n', b'999999999999999999999\n', 'directory']
        for value in cases:
            with self.subTest(value=value):
                self.port('lan1', [b'7\n', value, b'1000\n', value, b'9007199254740993\n',
                                   value, b'0\n', value, b'0\n'])
                before = self.snapshot()
                old, new = self.run_getter('before'), self.run_getter('after')
                self.assertEqual((new.stdout, new.returncode), (old.stdout, old.returncode))
                # Shell diagnostics contain the script path/line, which necessarily
                # moves with refactoring; preserve the actual open-error messages.
                errors = lambda r: re.findall(rb"can't open [^\n]*", r.stderr)
                self.assertEqual(errors(new), errors(old))
                self.assertEqual(self.snapshot(), before)
                output = json.loads(new.stdout)[0]
                self.assertEqual(output['stats']['tx_bytes'], 9007199254740993)
                if value in (None, b'', b'123', 'directory'):
                    self.assertIsNone(output['carrier'])
                    self.assertIsNone(output['stats']['rx_bytes'])
        # Same-name new samples must be read, never cached across requests.
        self.port('lan1', [b'8\n'] * 9)
        self.assertEqual(json.loads(self.run_getter('after').stdout)[0]['ifindex'], 8)
        # Preserve all device exclusions and ordering, including empty snapshots.
        for name in ('eth0', 'wlan0', 'bad name', 'virtual'):
            p = self.port(name, [b'1\n'] * 9)
            if name == 'wlan0': (p / 'phy80211').mkdir()
            if name == 'virtual': (p / 'device').rmdir()
        self.assertEqual(self.run_getter('after').stdout, self.run_getter('before').stdout)

    def test_each_failed_slot_is_null_after_a_healthy_port(self):
        self.port('lan0', [b'7\n'] * 9)
        for index, key in enumerate(KEYS):
            for value in (None, b'123', b'01\n', b'999999999999999999999\n'):
                with self.subTest(key=key, value=value):
                    values: list[bytes | None] = [b'8\n'] * 9
                    values[index] = value
                    self.port('lan1', values)
                    old, new = self.run_getter('before'), self.run_getter('after')
                    self.assertEqual(new.stdout, old.stdout)
                    port = json.loads(new.stdout)[1]
                    actual = port[key] if index < 3 else port['stats'][key]
                    self.assertIsNone(actual)
        # No previous invocation leaks through a caller-global result slot.
        scope = self.d / 'scope'
        source = (self.d / 'after').read_text()
        scope.write_text(source.rsplit('\nget_interfaces\n', 1)[0] +
                         '\nfs_value=caller-sentinel\nget_interfaces >/dev/null\nprintf "%s" "$fs_value"\n')
        r = subprocess.run([self.busybox, 'ash', str(scope)], capture_output=True, timeout=10)
        self.assertEqual(r.stdout, b'caller-sentinel')
        shutil.rmtree(self.net)
        self.net.mkdir()
        self.assertEqual(self.run_getter('after').stdout, b'[]')

    def test_overview_complete_bytes_match_legacy_getter(self):
        import test_settings as settings
        fixture: Any = settings.SettingsTest('test_overview_only_reads_monitor_configuration')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.script('date', '#!/bin/sh\nprintf "1000\\n"\n')
        source = (fixture.d / 'rpc').read_text()
        start = source.index('interface_read()') if 'interface_read()' in source else source.index('get_interfaces()')
        oracle = source[:start] + LEGACY.replace('/sys/class/net/*', str(fixture.d / 'sys/class/net/*')) + source[source.index('get_jitter()'):]
        old_rpc = fixture.d / 'oracle-rpc'
        old_rpc.write_text(oracle)
        port = fixture.d / 'sys/class/net/lan1'
        (port / 'device').mkdir(parents=True)
        (port / 'statistics').mkdir()
        for key in KEYS:
            (port / ('statistics/' + key if key in KEYS[3:] else key)).write_text('123\n')
        for value in (None, dict(timestamp=1000, target='example.com', last_ping=0.125,
                                 deviation=0.25, samples=10, received=9, loss=10)):
            if value is not None:
                (fixture.d / 'var/run/npu-jitter.json').write_text(json.dumps(value))
            for speed in (b'1000\n', b'123', b'\n'):
                (port / 'speed').write_bytes(speed)
                before = fixture.snapshot()
                runs = [subprocess.run([fixture.busybox, 'ash', str(script), 'call', 'getOverview'],
                        input=b'{}', capture_output=True, env=fixture.env, timeout=10)
                        for script in (old_rpc, fixture.d / 'rpc')]
                self.assertEqual((runs[1].stdout, runs[1].stderr, runs[1].returncode),
                                 (runs[0].stdout, runs[0].stderr, runs[0].returncode))
                self.assertEqual(runs[1].returncode, 0)
                self.assertEqual(fixture.snapshot(), before)
                self.assertEqual(list((fixture.d / 'tmp').iterdir()), [])

    def test_nine_reads_per_port_without_helper_subprocesses(self):
        for name in ('lan1', 'lan2'):
            self.port(name, [b'7\n', b'1\n', b'1000\n'] + [b'18446744073709551615\n'] * 6)
        before = self.snapshot()
        results = {}
        for version in ('before', 'after'):
            r = self.run_getter(version, trace=True)
            trace = (self.d / (version + '.trace')).read_text()
            results[version] = dict(
                stdout=r.stdout.decode(), stderr=r.stderr.decode(), status=r.returncode,
                created_processes=len(re.findall(r'\b(?:clone|clone3|fork|vfork)\(.*(?:= [1-9][0-9]*|<unfinished \.\.\.>)', trace)),
                execve=len(re.findall(r'\bexecve\(', trace)),
                port_file_opens=len(re.findall(r'openat\([^\n]*' + re.escape(str(self.net)) + r'/[^\n]*(?:ifindex|carrier|speed|statistics/[^"/]+)"', trace)))
            out = os.environ.get('EQUIVALENCE_LOG_DIR')
            if out:
                out = Path(out); out.mkdir(parents=True, exist_ok=True)
                (out / ('flowsense-' + version + '.trace')).write_text(trace)
                (out / ('flowsense-' + version + '.json')).write_text(json.dumps(results[version], indent=2))
        self.assertEqual(results['before']['stdout'], results['after']['stdout'])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(results['before']['created_processes'], 18, results)
        self.assertEqual(results['before']['execve'], 1, results)
        self.assertEqual(results['after']['execve'], 1, results)
        self.assertEqual(results['before']['port_file_opens'], 18, results)
        self.assertEqual(results['after']['port_file_opens'], 18, results)
        print('FlowSense accounting:', json.dumps(results, sort_keys=True))
        self.assertEqual(results['after']['created_processes'], 0, results)


if __name__ == '__main__':
    unittest.main()
