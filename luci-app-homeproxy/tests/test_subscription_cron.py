"""Real BusyBox ash and private crontabs; lock/service boundaries are isolated."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

INIT = Path(__file__).resolve().parents[1] / 'root/etc/init.d/homeproxy'
OTHER = '7 3 * * * /unrelated\n'
JOB = '0 */6 * * * /etc/homeproxy/scripts/update_crond.sh #homeproxy_autosetup\n'


class SubscriptionCron(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='homeproxy-cron-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.table = self.root / 'root'
        self.notice = self.root / 'cron.update'
        self.table.write_text(OTHER)

    def run_cron(self, commands):
        source = INIT.read_text()
        source = source[source.index('validate_cron_number()'):source.index('_homeproxy_start_service()')]
        # Intercept the absolute service boundary even when testing old code.
        source = source.replace('/etc/init.d/cron', 'cron_service')
        preamble = r'''
CRON_FILE="$ROOT/root"
CRON_LOCK="$ROOT/lock"
CRON_TAG='#homeproxy_autosetup'
HP_DIR='/etc/homeproxy'
lock() { :; }
log() { printf '%s\n' "$*" >> "$ROOT/log"; }
cron_service() { printf '%s\n' "$*" >> "$ROOT/service-calls"; return 0; }
config_get_bool() { eval "$1=\${AUTO_UPDATE:-0}"; }
config_get() { eval "$1=\"\${SCHEDULE:-0 */6 * * *}\""; }
'''
        result = subprocess.run(
            ['busybox', 'ash'], input=preamble + source + '\n' + commands,
            env=dict(os.environ, ROOT=str(self.root)), capture_output=True, text=True,
            timeout=10)
        self.assertFalse((self.root / 'service-calls').exists(),
                         'must notify crond without reloading/restarting its service')
        return result

    def test_add_notifies_without_restarting_cron(self):
        result = self.run_cron("configure_subscription_cron 1 '0 */6 * * *'")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.table.read_text(), OTHER + JOB)
        self.assertEqual(self.notice.read_text(), 'root\n')
        self.assertEqual(self.table.stat().st_mode & 0o777, 0o600)

    def test_unchanged_does_not_notify(self):
        self.table.write_text(OTHER + JOB)
        result = self.run_cron("configure_subscription_cron 1 '0 */6 * * *'")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.table.read_text(), OTHER + JOB)
        self.assertFalse(self.notice.exists())

    def test_change_appends_notification(self):
        self.table.write_text(OTHER + JOB)
        self.notice.write_text('another-user\n')
        result = self.run_cron("configure_subscription_cron 1 '15 */8 * * *'")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.table.read_text(), OTHER + JOB.replace('0 */6', '15 */8'))
        self.assertEqual(self.notice.read_text(), 'another-user\nroot\n')

    def test_remove_notifies_once(self):
        self.table.write_text(OTHER + JOB)
        result = self.run_cron("configure_subscription_cron 0 '' && configure_subscription_cron 0 ''")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.table.read_text(), OTHER)
        self.assertEqual(self.notice.read_text(), 'root\n')

    def test_first_install(self):
        self.table.unlink()
        result = self.run_cron("configure_subscription_cron 1 '0 */6 * * *'")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.table.read_text(), JOB)
        self.assertEqual(self.notice.read_text(), 'root\n')

    def test_invalid_schedule_removes_only_own_job(self):
        self.table.write_text(OTHER + JOB)
        result = self.run_cron("configure_subscription_cron 1 '60 * * * *'")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.table.read_text(), OTHER)
        self.assertEqual(self.notice.read_text(), 'root\n')
        self.assertIn('invalid', (self.root / 'log').read_text())

    def test_notification_write_failure_is_reported(self):
        self.notice.mkdir()
        result = self.run_cron("configure_subscription_cron 1 '0 */6 * * *'")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cron.update', result.stderr)
        self.assertEqual(self.table.read_text(), OTHER + JOB)

    def test_sync_respects_client_and_auto_update(self):
        for ready, enabled in ((1, 1), (1, 0), (0, 1), (0, 0)):
            with self.subTest(ready=ready, enabled=enabled):
                self.table.write_text(OTHER)
                self.notice.unlink(missing_ok=True)
                result = self.run_cron(f'AUTO_UPDATE={enabled}; sync_subscription_cron {ready}')
                self.assertEqual(result.returncode, 0, result.stderr)
                active = bool(ready and enabled)
                self.assertEqual(self.table.read_text(), OTHER + (JOB if active else ''))
                self.assertEqual(self.notice.exists(), active)


if __name__ == '__main__':
    unittest.main()
