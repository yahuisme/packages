#!/usr/bin/env python3
"""Isolated RPC tests. UCI_BIN and JSONFILTER_BIN select host-built tools."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

PACKAGE = Path(__file__).resolve().parents[1]
BACKEND = PACKAGE / 'root/usr/libexec/rpcd/luci.airoha_npu'

UCI_PATH = os.environ.get('UCI_BIN') or shutil.which('uci')
JSONFILTER_PATH = os.environ.get('JSONFILTER_BIN') or shutil.which('jsonfilter')

JSONFILTER_SCRIPT = '''#!/usr/bin/env python3
import json, sys
s = None
target = None
mode = 'e'
it = iter(sys.argv[1:])
for arg in it:
    if arg == '-s': s = next(it)
    elif arg == '-t': mode = 't'; target = next(it)
    elif arg == '-e': mode = 'e'; target = next(it)
if s is None:
    s = sys.stdin.read()
try:
    data = json.loads(s)
    key = target.replace('@.', '')
    val = data.get(key)
    if mode == 't':
        if isinstance(val, str): print('string')
        elif isinstance(val, int) and not isinstance(val, bool): print('number')
        elif isinstance(val, bool): print('boolean')
        elif val is None: sys.exit(1)
        else: print('object')
    else:
        if val is not None:
            if isinstance(val, (dict, list)): sys.exit(1)
            print(val)
        else:
            sys.exit(1)
except Exception:
    sys.exit(1)
'''

UCI_SCRIPT = r'''#!/usr/bin/env python3
import sys
from pathlib import Path
import re

args = sys.argv[1:]
config_dir = None
delta_dir = None
it = iter(args)
clean_args = []
for arg in it:
    if arg == '-q': pass
    elif arg == '-c': config_dir = Path(next(it))
    elif arg in ('-P', '-C', '-t'): next(it)
    else: clean_args.append(arg)

if not clean_args:
    sys.exit(0)

cmd = clean_args[0]
if config_dir is None:
    raise RuntimeError('Fixture UCI requires a private config directory')
firewall_file = config_dir / 'firewall'

def read_firewall():
    if not firewall_file.exists(): return {}
    content = firewall_file.read_text()
    res = {}
    cur_sec = None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith('config defaults'):
            cur_sec = 'defaults'
            res[cur_sec] = {}
        elif line.startswith('option') and cur_sec:
            parts = line.split(None, 2)
            if len(parts) == 3:
                key = parts[1]
                val = parts[2].strip("'\"")
                res[cur_sec][key] = val
    return res

if cmd == 'show':
    data = read_firewall()
    if 'defaults' not in data: sys.exit(1)
    print('firewall.@defaults[0]=defaults')
    for key, value in data['defaults'].items():
        print("firewall.@defaults[0].%s='%s'" % (key, value))
    sys.exit(0)

if cmd == 'get':
    target = clean_args[1]
    data = read_firewall()
    if target == 'firewall.@defaults[0]':
        if 'defaults' in data:
            print('defaults')
            sys.exit(0)
        sys.exit(1)
    elif target.startswith('firewall.@defaults[0].'):
        key = target.split('.', 2)[2]
        val = data.get('defaults', {}).get(key)
        if val is not None:
            print(val)
            sys.exit(0)
        sys.exit(1)
    sys.exit(1)

# This adapter intentionally cannot mutate configuration.
sys.exit(1)
'''

class Backend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.policy = self.root / 'sys/devices/system/cpu/cpufreq/policy0'
        self.policy.mkdir(parents=True)
        (self.root / 'var/lock').mkdir(parents=True)

        tool_bin = self.root / 'bin'
        tool_bin.mkdir(parents=True)
        
        jsonfilter_bin = JSONFILTER_PATH
        if not jsonfilter_bin:
            jf = tool_bin / 'jsonfilter'
            jf.write_text(JSONFILTER_SCRIPT)
            jf.chmod(0o755)
            jsonfilter_bin = str(jf)

        uci_bin = UCI_PATH
        if not uci_bin:
            ub = tool_bin / 'uci'
            ub.write_text(UCI_SCRIPT)
            ub.chmod(0o755)
            uci_bin = str(ub)

        self.env = dict(os.environ, NPU_ROOT=str(self.root),
                        NPU_JSONFILTER=jsonfilter_bin,
                        NPU_UCI=uci_bin)
        for name, value in {'scaling_available_governors': 'performance powersave schedutil',
                            'scaling_governor': 'schedutil',
                            'scaling_available_frequencies': '500000 1200000 1400000',
                            'scaling_min_freq': '500000', 'scaling_max_freq': '1200000',
                            'scaling_cur_freq': '500000'}.items():
            (self.policy / name).write_text(value + '\n')

    def call(self, method, args=None):
        return json.loads(subprocess.check_output(['busybox', 'ash', str(BACKEND), 'call', method],
                         input=json.dumps(args or {}).encode(), env=self.env))

    def test_status_builtin_reads_preserve_complete_file_values(self):
        # Compare byte-for-byte with the original cat-based getter, including
        # legacy multiline online output; do not silently normalize malformed data.
        oracle = self.root / 'cat-oracle'
        source = BACKEND.read_text()
        prefix, getter = source.split('get_status() {', 1)
        getter, suffix = getter.split('get_info() {', 1)
        oracle.write_text(prefix + 'get_status() {' + getter.replace('read_status_value', 'read_value') + 'get_info() {' + suffix)
        paths = [self.policy / ('scaling_' + name) for name in
                 ('cur_freq', 'max_freq', 'min_freq', 'governor')]
        paths += [self.root / 'sys/kernel/debug/clk/npu/clk_rate',
                  self.root / 'sys/devices/system/cpu/online']
        for p in paths:
            p.parent.mkdir(parents=True, exist_ok=True)
        values = [None, b'', b'500000', b'500000\n', b'500000\n\n',
                  b'500000\n600000', b'\n500000\n', b'0-1\n4-5\n',
                  b' schedutil\t\\test\r\nmore\n', b'bad"\\\x01\tend']
        for content in values:
            with self.subTest(content=content):
                for p in paths:
                    if p.exists(): p.unlink()
                    if content is not None: p.write_bytes(content)
                def run(script):
                    return subprocess.run(['busybox', 'ash', '-x', str(script), 'call', 'getStatus'],
                                          input=b'{}', env=self.env, capture_output=True, check=True)
                expected, actual = run(oracle), run(BACKEND)
                self.assertEqual(actual.stdout, expected.stdout)
                # One cat still consumes RPC stdin; none may read status files.
                cats = re.findall(rb'^\++ cat(?: |$)', actual.stderr, re.M)
                self.assertEqual(len(cats), 1, 'six status file reads must use shell builtins')

    def test_cpu_validation(self):
        payload = {'governor': 'performance', 'freq': '1400000'}
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        for field, values in {
                'governor': ['.*', '-e', 'performance powersave', 'sched', '', None, ['performance']],
                'freq': ['0500000', '500000.0', '5e5', '+500000', '500000\n', '50000', 500000, None]
        }.items():
            for bad in values:
                self.assertEqual(self.call('saveSettings', dict(payload, **{field: bad})), {'error': 'invalid'})
                self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        self.assertEqual(self.call('saveSettings', payload), {'result': 'ok'})
        self.assertEqual(self.call('applySettings'), {'result': 'ok'})
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'performance')
        self.assertEqual((self.policy / 'scaling_max_freq').read_text().strip(), '1400000')
        self.assertEqual((self.policy / 'scaling_min_freq').read_text().strip(), '500000')
        self.assertEqual(self.call('getStatus')['cpu_cur_freq'], 500000)

    def test_unavailable_readback_preserves_other_field(self):
        self.assertEqual(self.call('saveSettings', {'governor': 'performance', 'freq': '1400000'}), {'result': 'ok'})
        target = self.policy / 'scaling_max_freq'
        target.unlink()
        target.symlink_to('/dev/null')
        self.assertEqual(self.call('applySettings'), {'error': 'unavailable'})
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'schedutil')

    def test_removed_setters_cannot_mutate_cpu(self):
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        for method in ('setGovernor', 'setMaxFreq'):
            self.assertEqual(self.call(method, {'governor': 'performance', 'freq': '1400000'}), {'error': 'unsupported'})
            self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        self.assertFalse((self.root / 'etc/airoha-npu').exists())

    def test_read_only_flow_status(self):
        config = self.root / 'etc/config'
        config.mkdir(parents=True)
        firewall = config / 'firewall'
        (self.root / 'tmp').mkdir()
        self.assertIsNone(self.call('getFlowOffload')['enabled'])
        for sw, hw, expected in [('1', '1', True), ('1', '0', False),
                                 ('0', '1', False), ('0', '0', False),
                                 ('invalid', '1', None)]:
            original = f"config defaults\n\toption flow_offloading '{sw}'\n\toption flow_offloading_hw '{hw}'\n"
            firewall.write_text(original)
            self.assertIs(self.call('getFlowOffload')['enabled'], expected)
            self.assertEqual(self.call('setFlowOffload', {'enabled': '1'})['error'], 'unsupported')
            self.assertEqual(firewall.read_text(), original)

    @unittest.skipUnless(UCI_PATH, 'requires real UCI (set UCI_BIN)')
    def test_committed_flow_ignores_staging_and_overrides(self):
        config = self.root / 'etc/config'
        config.mkdir(parents=True)
        (self.root / 'tmp').mkdir()
        stage, override = self.root / 'staged', self.root / 'override'
        stage.mkdir(); override.mkdir()
        firewall = config / 'firewall'
        wrapper = self.root / 'uci-private'
        # Explicit isolation from the backend must not inherit wrapper -t paths.
        wrapper.write_text('#!/bin/sh\ncase " $* " in *" -C "*) exec "$REAL_UCI" "$@";; esac\n'
                           'exec "$REAL_UCI" -C "$TEST_OVERRIDE" -t "$TEST_STAGE" "$@"\n')
        wrapper.chmod(0o700)
        self.env.update(NPU_UCI=str(wrapper), REAL_UCI=str(UCI_PATH),
                        TEST_OVERRIDE=str(override), TEST_STAGE=str(stage))
        def uci(*args):
            return subprocess.check_output([str(UCI_PATH), '-c', str(config), '-C', str(override),
                                            '-t', str(stage), *args], env=self.env, text=True)
        for committed, staged in [('1', '0'), ('0', '1')]:
            with self.subTest(committed=committed):
                firewall.write_text("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '%s'\n" % committed)
                before = (firewall.read_bytes(), firewall.stat().st_mtime_ns)
                uci('set', 'firewall.@defaults[0].flow_offloading_hw=' + staged)
                delta = uci('changes', 'firewall')
                self.assertIn("flow_offloading_hw='%s'" % staged, delta)
                self.assertIs(self.call('getFlowOffload')['enabled'], committed == '1')
                self.assertEqual(uci('changes', 'firewall'), delta)
                self.assertEqual((firewall.read_bytes(), firewall.stat().st_mtime_ns), before)
                uci('revert', 'firewall')
                (override / 'firewall').write_text("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '%s'\n" % staged)
                self.assertIs(self.call('getFlowOffload')['enabled'], committed == '1')
                (override / 'firewall').unlink()
        self.assertEqual(list((self.root / 'tmp').iterdir()), [])

    @unittest.skipUnless(UCI_PATH, 'requires real UCI (set UCI_BIN)')
    def test_flow_read_failures_and_defaults(self):
        config = self.root / 'etc/config'
        config.mkdir(parents=True)
        (self.root / 'tmp').mkdir()
        firewall = config / 'firewall'
        original = "config defaults\n option flow_offloading '1'\n option flow_offloading_hw '1'\n"
        firewall.write_text(original)
        wrapper = self.root / 'uci-failure'
        wrapper.write_text('#!/bin/sh\ncase " $* " in *"$FAIL_READ"*) exit 1;; esac\nexec "$REAL_UCI" "$@"\n')
        wrapper.chmod(0o700)
        self.env.update(NPU_UCI=str(wrapper), REAL_UCI=str(UCI_PATH))
        before = (firewall.read_bytes(), firewall.stat().st_mtime_ns)
        for target in ['get firewall.@defaults[0].flow_offloading ',
                       'get firewall.@defaults[0].flow_offloading_hw ',
                       'get firewall.@defaults[0] ', 'show firewall.@defaults[0] ']:
            with self.subTest(failure=target):
                self.env['FAIL_READ'] = target
                self.assertIsNone(self.call('getFlowOffload')['enabled'])
                self.assertEqual((firewall.read_bytes(), firewall.stat().st_mtime_ns), before)
        self.env['NPU_UCI'] = str(UCI_PATH)
        # Real UCI drops empty option values, so these are also absent/default-off.
        for content, expected in [("config defaults\n", False),
                                 ("config defaults\n option flow_offloading '1'\n", False),
                                 ("config defaults\n option flow_offloading_hw '1'\n", False),
                                 ("config defaults\n option flow_offloading '11'\n", None),
                                 ("config defaults\n option flow_offloading ''\n", False),
                                 ("config rule\n", None), ("config defaults\n option broken '\n", None)]:
            with self.subTest(content=content):
                firewall.write_text(content)
                self.assertIs(self.call('getFlowOffload')['enabled'], expected)
        self.assertEqual(list((self.root / 'tmp').iterdir()), [])
        (self.root / 'tmp').rmdir()
        self.assertIsNone(self.call('getFlowOffload')['enabled'])

    def test_official_without_cpufreq(self):
        for path in self.policy.iterdir():
            path.unlink()
        self.policy.rmdir()
        status = self.call('getStatus')
        self.assertIsNone(status['cpu_cur_freq'])
        self.assertIsNone(status['cpu_max_freq'])
        self.assertEqual(status['cpu_governor'], '')
        info = self.call('getInfo')
        self.assertEqual(info['governors'], '')
        self.assertEqual(info['frequencies'], '')
        self.assertEqual(self.call('getSettings'), {'result': 'ok', 'pending': None})
        payload = {'governor': 'performance', 'freq': '1400000'}
        self.assertEqual(self.call('saveSettings', payload), {'error': 'invalid'})
        self.assertEqual(self.call('applySettings'), {'error': 'unavailable'})
        self.assertFalse(self.policy.exists())
        self.assertFalse((self.root / 'etc/airoha-npu/pending.json').exists())

    def test_info_and_missing(self):
        dt = self.root / 'proc/device-tree'
        dt.mkdir(parents=True)
        (dt / 'compatible').write_bytes(b'example,board\0airoha,test\0')
        (self.root / 'sys/devices/system/cpu/online').write_text('0-1,4,6-7\n')
        self.assertEqual(self.call('getInfo').get('soc_compat'), 'example,board, airoha,test')
        status = self.call('getStatus')
        self.assertEqual(status['cpu_count'], 5)
        self.assertIsNone(status['npu_clock'])
        self.assertIsNone(status['npu_bound'])

        drivers = self.root / 'sys/bus/platform/drivers/airoha-npu'
        drivers.mkdir(parents=True)
        (drivers / '1e900000.npu').symlink_to(self.policy)
        self.assertTrue(self.call('getStatus')['npu_bound'])
        firmware = dt / 'soc/npu@1e900000'
        firmware.mkdir(parents=True)
        (firmware / 'firmware-name').write_bytes(b'airoha/rv32.bin\0')
        self.assertEqual(self.call('getInfo')['firmware_file'], '/lib/firmware/airoha/rv32.bin')
        self.assertEqual(self.call('getInfo')['firmware_file_version'], '')
        (dt / 'compatible').write_bytes(b'quote"\\\x01test\tend\0')
        self.assertEqual(self.call('getInfo')['soc_compat'], 'quote"\\\x01test\tend')

    def test_settings_staging(self):
        payload = {'governor': 'performance', 'freq': '1400000', 'ubus_rpc_session': 'fixture'}
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        self.assertIsNone(self.call('getSettings')['pending'])
        self.assertEqual(self.call('saveSettings', payload), {'result': 'ok'})
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        pending = self.root / 'etc/airoha-npu/pending.json'
        self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
        self.assertEqual(pending.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.call('getSettings')['pending'], {'governor': 'performance', 'freq': '1400000'})
        self.assertEqual(self.call('applySettings'), {'result': 'ok'})
        self.assertEqual(self.call('getStatus')['cpu_governor'], 'performance')
        self.assertEqual(self.call('getStatus')['cpu_max_freq'], 1400000)
        # Saved baseline remains durable after Apply; neither read nor reboot auto-applies it.
        self.assertEqual(self.call('getSettings')['pending'], json.loads(pending.read_text()))
        for gov, freq in [('schedutil', '1400000'), ('schedutil', '1200000'), ('performance', '500000')]:
            self.assertEqual(self.call('saveSettings', {'governor': gov, 'freq': freq}), {'result': 'ok'})
            self.assertEqual(self.call('applySettings'), {'result': 'ok'})
            self.assertEqual(self.call('getStatus')['cpu_governor'], gov)
            self.assertEqual(self.call('getStatus')['cpu_max_freq'], int(freq))
        original = pending.read_bytes()
        for changes in [{'governor': 'bad'}, {'freq': '500000\n'}, {'freq': 500000}, {'governor': None}]:
            self.assertEqual(self.call('saveSettings', dict(payload, **changes))['error'], 'invalid')
            self.assertEqual(pending.read_bytes(), original)
        lock = self.root / 'var/lock/luci-airoha-npu'
        lock.mkdir()
        self.assertEqual(self.call('applySettings')['error'], 'busy')
        self.assertEqual(self.call('saveSettings', payload)['error'], 'busy')
        lock.rmdir()
        pending.unlink(); pending.mkdir()
        self.assertEqual(self.call('saveSettings', payload)['error'], 'storage')
        pending.rmdir(); pending.write_text('{broken')
        self.assertEqual(self.call('getSettings')['error'], 'invalid')
        self.assertEqual(self.call('applySettings')['error'], 'invalid')
        pending.unlink(); pending.symlink_to(self.policy / 'scaling_governor')
        for method in ['getSettings', 'saveSettings', 'applySettings']:
            self.assertEqual(self.call(method, payload)['error'], 'storage')

    def test_settings_rollback(self):
        payload = {'governor': 'performance', 'freq': '1400000'}
        self.assertEqual(self.call('saveSettings', payload), {'result': 'ok'})
        copied = self.root / 'rpc'
        copied.write_text(BACKEND.read_text().replace(
            'read_value() { cat "$1" 2>/dev/null; }',
            'read_value() { case "$1" in */scaling_max_freq) printf "1200000\\n";; *) cat "$1" 2>/dev/null;; esac; }'))
        def apply():
            return json.loads(subprocess.check_output(['busybox', 'ash', str(copied), 'call', 'applySettings'], input=b'{}', env=self.env))
        self.assertEqual(apply()['error'], 'write_failed')
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'schedutil')
        self.assertEqual((self.policy / 'scaling_max_freq').read_text().strip(), '1200000')
        self.assertEqual(self.call('getSettings')['pending'], payload)
        target = self.policy / 'scaling_max_freq'
        target.unlink(); target.symlink_to('/dev/full')
        self.assertEqual(apply()['error'], 'rollback_failed')
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'schedutil')
        target.unlink(); target.write_text('1200000\n')
        self.assertEqual(self.call('applySettings'), {'result': 'ok'})

    def test_surface(self):
        source = BACKEND.read_text()
        for forbidden in ('devmem', 'setOverclock', 'getPpeEntries', 'modprobe', 'bridge-nf-', '_run_with_deadline'):
            self.assertNotIn(forbidden, source)
        methods = json.loads(subprocess.check_output(['sh', str(BACKEND), 'list']))
        self.assertEqual(set(methods), {'getStatus', 'getInfo', 'getFlowOffload', 'getSettings', 'saveSettings', 'applySettings'})

if __name__ == '__main__':
    unittest.main()
