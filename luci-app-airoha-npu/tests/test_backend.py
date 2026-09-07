#!/usr/bin/env python3
"""Isolated RPC tests. UCI_BIN and JSONFILTER_BIN select host-built tools."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

PACKAGE = Path(__file__).resolve().parents[1]
BACKEND = PACKAGE / 'root/usr/libexec/rpcd/luci.airoha_npu'

class Backend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.policy = self.root / 'sys/devices/system/cpu/cpufreq/policy0'
        self.policy.mkdir(parents=True)
        (self.root / 'var/lock').mkdir(parents=True)
        self.env = dict(os.environ, NPU_ROOT=str(self.root),
                        NPU_JSONFILTER=os.environ.get('JSONFILTER_BIN', 'jsonfilter'))
        for name, value in {'scaling_available_governors': 'performance powersave schedutil',
                            'scaling_governor': 'schedutil',
                            'scaling_available_frequencies': '500000 1200000 1400000',
                            'scaling_min_freq': '500000', 'scaling_max_freq': '1200000',
                            'scaling_cur_freq': '500000'}.items():
            (self.policy / name).write_text(value + '\n')

    def call(self, method, args=None):
        return json.loads(subprocess.check_output(['sh', str(BACKEND), 'call', method],
                         input=json.dumps(args or {}).encode(), env=self.env))

    def test_cpu_validation(self):
        for bad in ['.*', '-e', 'performance powersave', 'sched', '', None, ['performance']]:
            self.assertIn('error', self.call('setGovernor', {'governor': bad}))
            self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'schedutil')
        self.assertEqual(self.call('setGovernor', {'governor': 'performance'})['result'], 'ok')
        for bad in ['0500000', '500000.0', '5e5', '+500000', '500000\n', '50000', 500000, None]:
            self.assertIn('error', self.call('setMaxFreq', {'freq': bad}))
        self.assertEqual(self.call('setMaxFreq', {'freq': '1400000'})['result'], 'ok')
        self.assertEqual((self.policy / 'scaling_max_freq').read_text().strip(), '1400000')
        self.assertEqual((self.policy / 'scaling_min_freq').read_text().strip(), '500000')
        self.assertEqual(self.call('getStatus')['cpu_cur_freq'], 500000)
        self.assertNotIn('actual_mhz', self.call('setMaxFreq', {'freq': '1200000'}))

    def test_write_and_readback_failures(self):
        # /dev/null accepts writes but returns a mismatched readback. No hardware I/O.
        target = self.policy / 'scaling_max_freq'
        target.unlink()
        target.symlink_to('/dev/null')
        self.assertEqual(self.call('setMaxFreq', {'freq': '1400000'})['error'], 'unavailable')
        # Override the copied backend's fixed read helper to emulate kernel clamping.
        copied = self.root / 'rpc'
        copied.write_text(BACKEND.read_text().replace(
            'read_value() { cat "$1" 2>/dev/null; }',
            'read_value() { case "$1" in */scaling_max_freq) printf "1200000\\n";; *) cat "$1" 2>/dev/null;; esac; }'))
        result = json.loads(subprocess.check_output(['sh', str(copied), 'call', 'setMaxFreq'],
                            input=b'{"freq":"1400000"}', env=self.env))
        self.assertEqual(result['error'], 'write_failed')
        target.unlink()
        target.symlink_to('/dev/full')
        result = json.loads(subprocess.check_output(['sh', str(copied), 'call', 'setMaxFreq'],
                            input=b'{"freq":"1400000"}', env=self.env))
        self.assertEqual(result['error'], 'rollback_failed')

    def test_flow_transaction(self):
        config = self.root / 'etc/config'
        config.mkdir(parents=True)
        firewall = config / 'firewall'
        original = "config defaults\n\toption flow_offloading '1'\n\toption flow_offloading_hw '0'\n\toption input 'DROP'\n"
        firewall.write_text(original)
        (self.root / 'tmp').mkdir()
        reload = self.root / 'reload'
        reload.write_text('#!/bin/sh\nexit 0\n')
        reload.chmod(0o755)
        self.env.update(NPU_UCI=os.environ.get('UCI_BIN', 'uci'), NPU_FIREWALL=str(reload))
        self.assertEqual(self.call('getFlowOffload')['enabled'], False)
        self.assertEqual(self.call('setFlowOffload', {'enabled': '1'}).get('result'), 'ok')
        self.assertEqual(self.call('getFlowOffload')['enabled'], True)
        saved = firewall.read_bytes()
        reload.write_text('#!/bin/sh\nexit 1\n')
        self.assertEqual(self.call('setFlowOffload', {'enabled': '0'})['error'], 'rollback_failed')
        self.assertEqual(firewall.read_bytes(), saved)
        self.assertIn('error', self.call('setFlowOffload', {}))
        firewall.write_text(original)
        self.assertFalse(self.call('getFlowOffload')['enabled'])

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
        (dt / 'compatible').write_bytes(b'quote"\\\x01test\0')
        self.assertEqual(self.call('getInfo')['soc_compat'], 'quote"\\\x01test')

    def test_surface(self):
        source = BACKEND.read_text()
        for forbidden in ('devmem', 'setOverclock', 'getPpeEntries', 'modprobe', 'bridge-nf-', '_run_with_deadline'):
            self.assertNotIn(forbidden, source)
        methods = json.loads(subprocess.check_output(['sh', str(BACKEND), 'list']))
        self.assertEqual(set(methods), {'getStatus', 'getInfo', 'getFlowOffload', 'setFlowOffload', 'setGovernor', 'setMaxFreq'})

if __name__ == '__main__':
    unittest.main()
