"""Real BusyBox/jshn/UCI, redirected persistent storage and harmless services."""
import json
from pathlib import Path
import subprocess
import test_acceleration as fixture
ROOT, TOOLS = fixture.ROOT, fixture.TOOLS
import unittest


class SettingsTest(unittest.TestCase):
    script = fixture.AccelerationTest.script
    knob = fixture.AccelerationTest.knob
    conf = fixture.AccelerationTest.conf
    call = fixture.AccelerationTest.call
    snapshot = fixture.AccelerationTest.snapshot
    def setUp(self):
        fixture.AccelerationTest.setUp(self)
        (self.d / 'bin/jsonfilter').symlink_to(TOOLS / 'bin/jsonpath')
        (self.d / 'etc/config/npu-monitor').write_text("config jitter\n option target 'example.com'\n option enabled '1'\n")
        self.script('monitor_restart', '#!/bin/sh\nprintf restart >> "' + str(self.d / 'monitor-restarts') + '"\n[ "$MONITOR_FAIL" != 1 ]\n')
        source = (ROOT / 'root/usr/libexec/flowsense-settings.sh').read_text().replace('/usr/share/libubox/jshn.sh', str(TOOLS / 'share/libubox/jshn.sh')).replace('/etc/flowsense', str(self.d / 'etc/flowsense')).replace('/var/run/flowsense-settings.lock', str(self.d / 'var/run/flowsense-settings.lock'))
        (self.d / 'settings.sh').write_text(source)
        rpc = (self.d / 'rpc').read_text().replace('/usr/libexec/flowsense-settings.sh', str(self.d / 'settings.sh')).replace('/etc/init.d/npu-jitter restart', str(self.d / 'bin/monitor_restart'))
        (self.d / 'rpc').write_text(rpc)

    def stage(self, **values):
        return self.call('saveSettings', dict(dict.fromkeys(('hardware', 'vlan', 'pppoe', 'ap', 'enabled'), -1), target='', **values))

    def test_pending_save_refresh_apply_partial_retry(self):
        self.assertIsNone(self.call('getSettings')['pending'])
        self.assertFalse((self.d / 'etc/flowsense').exists(), 'read-only load must not create storage')
        before = self.snapshot()
        payload = dict(hardware=0, vlan=-1, pppoe=-1, ap=-1, target='saved.example', enabled=0)
        self.assertTrue(self.call('saveSettings', payload)['success'])
        for path, contents in before.items():
            self.assertEqual((self.d / path).read_bytes(), contents)
        self.assertFalse((self.d / 'restarts').exists())
        self.assertFalse((self.d / 'monitor-restarts').exists())
        self.assertEqual(self.call('getSettings')['pending'], payload)
        pending = self.d / 'etc/flowsense/pending.json'
        self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
        self.assertEqual(pending.parent.stat().st_mode & 0o777, 0o700)
        result = self.call('applySettings', MONITOR_FAIL='1')
        self.assertEqual(result, dict(success=False, acceleration='applied', monitor='failed', monitor_error='rollback'))
        self.assertFalse(self.call()['hardware']['enabled'])
        retry = self.call('getSettings')['pending']
        self.assertEqual(retry['hardware'], -1)
        self.assertEqual(retry['target'], 'saved.example')
        restarts = (self.d / 'restarts').read_bytes()
        self.assertEqual(self.call('applySettings'), dict(success=True, acceleration='unchanged', monitor='applied'))
        self.assertEqual((self.d / 'restarts').read_bytes(), restarts)
        self.assertIsNone(self.call('getSettings')['pending'])
        self.assertIn("saved.example", (self.d / 'etc/config/npu-monitor').read_text())
        self.assertTrue(self.call('saveSettings', dict(payload, hardware=1, target='both.example', enabled=1))['success'])
        self.assertEqual(self.call('applySettings'), dict(success=True, acceleration='applied', monitor='applied'))
        self.assertTrue(self.call()['hardware']['enabled'])

    def test_invalid_lock_and_acceleration_failure(self):
        payload = dict(hardware=0, vlan=-1, pppoe=-1, ap=-1, target='', enabled=-1)
        for invalid in (dict(payload, hardware='0'), dict(payload, target='../bad', enabled=1), dict(payload, path='/tmp/evil')):
            self.assertFalse(self.call('saveSettings', invalid)['success'])
        self.assertTrue(self.call('saveSettings', payload)['success'])
        self.assertEqual(self.call('applySettings', RESTART_FAIL='1'), dict(success=False, acceleration='failed', monitor='unchanged', acceleration_error='apply'))
        self.assertEqual(self.call('getSettings')['pending'], payload)
        self.assertTrue(self.call('applySettings')['success'])
        lock = self.d / 'var/run/flowsense-settings.lock'
        lock.mkdir()
        self.assertEqual(self.call('saveSettings', payload)['error'], 'busy')
        lock.rmdir()
        pending = self.d / 'etc/flowsense/pending.json'
        pending.symlink_to(self.config)
        self.assertEqual(self.call('saveSettings', payload)['error'], 'storage')

