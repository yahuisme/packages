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
        for prefix in ('/etc/config', '/tmp/flowsense-committed', '/var/run/npu-jitter.json', '/sys/class/net/*', '/proc/uptime'):
            rpc = rpc.replace(prefix, str(self.d) + prefix)
        (self.d / 'proc/uptime').write_text('100.0 0\n')
        (self.d / 'rpc').write_text(rpc)

    def test_monitor_getter_ignores_staged_delta_and_override(self):
        config = self.d / 'etc/config/npu-monitor'
        before = (config.read_bytes(), config.stat().st_mtime_ns)
        for setting in ('target=unsaved.example', 'enabled=0'):
            subprocess.run([str(self.d / 'bin/uci'), 'set', 'npu-monitor.@jitter[0].' + setting],
                           env=self.env, check=True)
        delta = (self.d / 'delta/npu-monitor').read_bytes()
        self.assertEqual(self.call('getOverview')['monitor'], dict(target='example.com', enabled=True))
        (self.d / 'override/npu-monitor').write_text("config jitter\n option target 'override.example'\n option enabled '0'\n")
        self.assertEqual(self.call('getOverview')['monitor'], dict(target='example.com', enabled=True))
        self.assertEqual((config.read_bytes(), config.stat().st_mtime_ns), before)
        self.assertEqual((self.d / 'delta/npu-monitor').read_bytes(), delta)
        self.assertFalse((self.d / 'monitor-restarts').exists())
        self.assertEqual(list((self.d / 'tmp').iterdir()), [])

    def test_monitor_shipped_default_real_form_save_apply_reset(self):
        config = self.d / 'etc/config/npu-monitor'
        config.write_bytes((ROOT / 'root/etc/config/npu-monitor').read_bytes())
        before = (config.read_bytes(), config.stat().st_mtime_ns)
        # A normal first visit must not change the shipped configuration.
        monitor = self.call('getOverview')['monitor']
        self.assertEqual((config.read_bytes(), config.stat().st_mtime_ns), before)
        self.assertFalse((self.d / 'monitor-restarts').exists())
        self.run_monitor_form(dict(target='223.5.5.5', enabled=True))
        self.assertEqual(monitor, dict(target='223.5.5.5', enabled=True))
        self.assertNotEqual(config.read_bytes(), before[0])  # only the explicit Apply commits
        self.assertEqual(self.call('getOverview')['monitor'], dict(target='saved.example', enabled=False))
        self.assertEqual(list((self.d / 'tmp').iterdir()), [])

    def test_monitor_explicit_zero_real_form_save_apply_reset(self):
        (self.d / 'etc/config/npu-monitor').write_text("config jitter\n option target 'example.com'\n option enabled '0'\n")
        self.run_monitor_form(dict(target='example.com', enabled=False))

    def test_monitor_explicit_one_real_form_save_apply_reset(self):
        self.run_monitor_form(dict(target='example.com', enabled=True))

    def test_monitor_present_option_read_failure_real_form_stays_locked(self):
        wrapper = (self.d / 'bin/uci').read_text()
        self.script('uci', wrapper.replace('#!/bin/sh\n', '#!/bin/sh\ncase "$*" in *"get npu-monitor.@jitter[0].enabled") exit 1;; esac\n', 1))
        self.run_monitor_form(None)

    def test_monitor_default_and_individual_read_failures(self):
        config = self.d / 'etc/config/npu-monitor'
        wrapper = (self.d / 'bin/uci').read_text()
        for option in ('', " option enabled '0'\n", " option enabled '1'\n"):
            config.write_text("config jitter\n option target '223.5.5.5'\n" + option)
            before = (config.read_bytes(), config.stat().st_mtime_ns)
            for command in ('show npu-monitor.@jitter[0]', 'get npu-monitor.@jitter[0].target',
                            'get npu-monitor.@jitter[0].enabled'):
                with self.subTest(option=option, failure=command):
                    self.script('uci', wrapper.replace('#!/bin/sh\n', '#!/bin/sh\ncase "$*" in *"' + command + '") exit 1;; esac\n', 1))
                    monitor = self.call('getOverview')['monitor']
                    if not option and command.endswith('.enabled'):
                        self.assertEqual(monitor, dict(target='223.5.5.5', enabled=True))
                    else:
                        self.assertIsNone(monitor)
                    self.assertEqual((config.read_bytes(), config.stat().st_mtime_ns), before)
                    self.assertEqual(list((self.d / 'tmp').iterdir()), [])
        self.assertFalse((self.d / 'monitor-restarts').exists())

    def test_monitor_default_ignores_staged_enabled(self):
        config = self.d / 'etc/config/npu-monitor'
        config.write_bytes((ROOT / 'root/etc/config/npu-monitor').read_bytes())
        before = (config.read_bytes(), config.stat().st_mtime_ns)
        subprocess.run([str(self.d / 'bin/uci'), 'set', 'npu-monitor.@jitter[0].enabled=0'], env=self.env, check=True)
        delta = (self.d / 'delta/npu-monitor').read_bytes()
        (self.d / 'override/npu-monitor').write_text("config jitter\n option target 'override.example'\n option enabled '0'\n")
        self.assertEqual(self.call('getOverview')['monitor'], dict(target='223.5.5.5', enabled=True))
        self.assertEqual((config.read_bytes(), config.stat().st_mtime_ns), before)
        self.assertEqual((self.d / 'delta/npu-monitor').read_bytes(), delta)
        self.assertEqual(list((self.d / 'tmp').iterdir()), [])

    def run_monitor_form(self, expected):
        import os
        result = subprocess.run(['node', str(ROOT / 'tests/test_view.js')],
                                env=dict(os.environ, MONITOR_RPC=str(self.d / 'rpc'),
                                         MONITOR_BUSYBOX=self.busybox,
                                         MONITOR_PATH=self.env['PATH'],
                                         MONITOR_EXPECTED=json.dumps(expected)),
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS real UCI monitor', result.stdout)

    def test_monitor_getter_read_failure_is_unknown(self):
        config = self.d / 'etc/config/npu-monitor'
        for contents in ("config jitter\n option enabled '0'\n",
                         "config jitter\n option target 'bad/target'\n option enabled '0'\n",
                         "config jitter\n option target 'example.com'\n option enabled 'bad'\n",
                         "not valid uci '\n"):
            with self.subTest(contents=contents):
                config.write_text(contents)
                self.assertIsNone(self.call('getOverview')['monitor'])
        config.unlink()
        self.assertIsNone(self.call('getOverview')['monitor'])
        self.assertEqual(list((self.d / 'tmp').iterdir()), [])
        self.assertFalse((self.d / 'monitor-restarts').exists())

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

    def test_directory_pending_is_storage_error_for_all_methods(self):
        pending = self.d / 'etc/flowsense/pending.json'
        pending.mkdir(parents=True)
        before = self.snapshot()
        mtimes = {path: (self.d / path).stat().st_mtime_ns for path in before}
        for method in ('saveSettings', 'getSettings', 'applySettings'):
            with self.subTest(method=method):
                result = self.call('saveSettings', dict(hardware=0, vlan=-1, pppoe=-1, ap=-1, target='saved.example', enabled=0)) if method == 'saveSettings' else self.call(method)
                self.assertEqual(result, dict(success=False, error='storage'))
        self.assertEqual(list(pending.iterdir()), [])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual({path: (self.d / path).stat().st_mtime_ns for path in before}, mtimes)
        self.assertFalse((self.d / 'restarts').exists())
        self.assertFalse((self.d / 'monitor-restarts').exists())
        pending.rmdir()
        self.assertTrue(self.stage(hardware=0)['success'])
        self.assertEqual(self.call('getSettings')['pending']['hardware'], 0)
        self.assertTrue(self.call('applySettings')['success'])

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

