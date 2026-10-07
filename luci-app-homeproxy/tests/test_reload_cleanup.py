"""Private real ash/filesystem transaction tests; no proxy or daemon starts."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]


class ReloadCleanup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hp-reload-cleanup-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / 'run'
        self.runtime.mkdir()
        self.dns = self.root / 'dns/dnsmasq-homeproxy.d'
        self.dns.mkdir(parents=True)
        (self.runtime / 'sing-box-c.json').write_text('OLD CLIENT')
        (self.dns / 'redirect-dns.conf').write_text('OLD DNS')

    def invoke(self, fault='', operation='transaction'):
        init = (APP / 'root/etc/init.d/homeproxy').read_text()
        code = init[init.index('# Never copy'):init.index('\nstart_service()')]
        pre = r'''
CONF=homeproxy
cmp(){ command busybox cmp "$@"; }
procd_open_service(){ :; }
_homeproxy_start_service(){
 printf 'setup\n' >> "$ROOT/events"
 [ "$FAULT" != crash-installing ] || exit 99
 [ "$FAULT" != setup ] || return 1
 HP_CONFIG_CHANGED=1
 printf 'NEW CLIENT' > "$RUN_DIR/sing-box-c.json"
}
homeproxy_close_service(){ [ "$FAULT" != restore ]; }
log(){ printf '%s\n' "$*" >> "$ROOT/log"; }
rm(){
 if [ "$FAULT" = crash-clean ] && [ "$2" = "$RUN_DIR/.reload.pending" ]; then exit 99; fi
 if [ "$FAULT" = marker-cleanup ] && [ "$2" = "$RUN_DIR/reload.state" ]; then return 1; fi
 case "$*" in *'.reload.'*) case "$FAULT" in cleanup|backup-cleanup) return 1;; esac;; esac
 if [ "$FAULT" = restore ] && [ "$2" = "$RUN_DIR/sing-box-c.json" ]; then return 1; fi
 command rm "$@"
}
cp(){ case "$FAULT" in backup|backup-cleanup) return 1;; esac; command cp "$@"; }
'''
        script = self.root / 'case.sh'
        stop = init[init.index('stop_service() {'):init.index('\n# Upstream wrappers')]
        stubs = '\nconfig_load(){ :; }\nsync_subscription_cron(){ :; }\nclear_firewall(){ :; }\nclear_dnsmasq(){ :; }\n'
        action = 'stop_service' if operation == 'stop' else 'homeproxy_transaction'
        script.write_text(pre + code + stop + stubs + '\n' + action + '\n')
        result = subprocess.run(['busybox', 'ash', str(script)], text=True, capture_output=True,
                                env=dict(os.environ, ROOT=str(self.root), RUN_DIR=str(self.runtime),
                                         DNSMASQ_DIR=str(self.dns), FAULT=fault), timeout=10)
        self.assertEqual(result.stderr, '')
        return result.returncode

    def stages(self):
        return list(self.runtime.glob('.reload.*'))

    def test_success_cleanup_failure_is_reported_and_retry_is_bounded(self):
        for _ in range(4):
            self.assertNotEqual(self.invoke('cleanup'), 0)
            self.assertEqual(len(self.stages()), 1)
        self.assertEqual(self.invoke(), 0)
        self.assertEqual(self.stages(), [])

    def test_unresolved_restore_blocks_new_generations(self):
        self.assertNotEqual(self.invoke('restore'), 0)
        backup = self.stages()[0]
        self.assertEqual((backup / 'sing-box-c.json').read_text(), 'OLD CLIENT')
        for _ in range(4):
            self.assertNotEqual(self.invoke(), 0)
            self.assertEqual(self.stages(), [backup])
        self.assertEqual((self.root / 'events').read_text().splitlines(), ['setup'])

    def test_legacy_backup_is_retained_and_blocks(self):
        legacy = self.runtime / '.reload.Abc123'
        legacy.mkdir()
        (legacy / 'sing-box-c.json').write_text('RECOVERY')
        self.assertNotEqual(self.invoke(), 0)
        self.assertEqual(self.stages(), [legacy])
        self.assertEqual((legacy / 'sing-box-c.json').read_text(), 'RECOVERY')
        self.assertFalse((self.root / 'events').exists())

    def test_exact_owned_phase_and_symlink_checks(self):
        state = self.runtime / 'reload.state'
        backup = self.runtime / '.reload.pending'
        backup.mkdir()
        (backup / 'sing-box-c.json').write_text('RECOVERY')
        for phase in ['installing', 'clean\n', 'preparing extra', '']:
            state.write_text(phase)
            self.assertNotEqual(self.invoke(), 0)
            self.assertEqual((backup / 'sing-box-c.json').read_text(), 'RECOVERY')
        state.unlink()
        external = self.root / 'external'
        external.write_text('clean')
        state.symlink_to(external)
        self.assertNotEqual(self.invoke(), 0)
        self.assertTrue(state.is_symlink())
        self.assertEqual(external.read_text(), 'clean')
        state.unlink()
        state.write_text('clean')
        backup.rename(self.root / 'saved')
        backup.symlink_to(self.root / 'saved', target_is_directory=True)
        self.assertNotEqual(self.invoke(), 0)
        self.assertEqual((self.root / 'saved/sing-box-c.json').read_text(), 'RECOVERY')

    def test_preparing_and_clean_phases_are_retried(self):
        for phase in ['preparing', 'clean']:
            with self.subTest(phase=phase):
                backup = self.runtime / '.reload.pending'
                backup.mkdir()
                (backup / 'partial').write_text('unused')
                (self.runtime / 'reload.state').write_text(phase)
                self.assertEqual(self.invoke(), 0)
                self.assertEqual(self.stages(), [])
                self.assertFalse((self.runtime / 'reload.state').exists())

    def test_failed_preparation_preserves_runtime(self):
        self.assertNotEqual(self.invoke('backup'), 0)
        self.assertEqual((self.runtime / 'sing-box-c.json').read_text(), 'OLD CLIENT')
        self.assertEqual(self.stages(), [])
        self.assertFalse((self.root / 'events').exists())
        self.assertEqual(self.invoke(), 0)

    def test_recovered_setup_failure_removes_backup(self):
        self.assertNotEqual(self.invoke('setup'), 0)
        self.assertEqual(self.stages(), [])
        self.assertEqual((self.runtime / 'sing-box-c.json').read_text(), 'OLD CLIENT')

    def test_stop_retries_only_disposable_backup(self):
        self.assertNotEqual(self.invoke('cleanup'), 0)
        self.assertEqual(self.invoke(operation='stop'), 0)
        self.assertEqual(self.stages(), [])
        self.assertFalse((self.runtime / 'reload.state').exists())

    def test_native_procd_lock_serializes_and_is_reentrant(self):
        base = Path(os.environ.get('OPENWRT_SOURCE', '/opt/test-tools/openwrt-runtime'))
        procd = (base / 'package/system/procd/files/procd.sh').read_text()
        begin = procd.index('procd_lock() {')
        lock = procd[begin:procd.index('\n}', begin) + 2]
        private = self.root / 'runtime'
        (private / 'var/lock').mkdir(parents=True)
        init = (APP / 'root/etc/init.d/homeproxy').read_text()
        body = init[init.index('# Never copy'):init.index('\nstart_service()')]
        script = self.root / 'lock.sh'
        script.write_text(lock + '''
procd_open_service(){ procd_lock; }
homeproxy_close_service(){ :; }
log(){ :; }
_homeproxy_start_service(){
 mkdir "$ROOT/active" || return 1
 sleep 0.05
 rmdir "$ROOT/active"
}
procd_lock
procd_lock
''' + body + '\nhomeproxy_transaction\n')
        env = dict(os.environ, ROOT=str(self.root), RUN_DIR=str(self.runtime),
                   DNSMASQ_DIR=str(self.dns), IPKG_INSTROOT=str(private),
                   initscript='/etc/init.d/homeproxy', CONF='homeproxy')
        processes = [subprocess.Popen(['busybox', 'ash', str(script)], env=env,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(3)]
        for process in processes:
            _, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual(stderr, b'')
        self.assertEqual(self.stages(), [])
        self.assertFalse((self.root / 'active').exists())

    def test_process_exit_clean_retries_but_installing_blocks(self):
        self.assertEqual(self.invoke('crash-clean'), 99)
        self.assertEqual(len(self.stages()), 1)
        self.assertEqual(self.invoke(), 0)
        self.assertEqual(self.stages(), [])
        self.assertEqual(self.invoke('crash-installing'), 99)
        backup = self.stages()[0]
        self.assertNotEqual(self.invoke(), 0)
        self.assertEqual(self.stages(), [backup])

    def test_marker_unlink_failure_blocks_allocation_and_retries(self):
        for _ in range(3):
            self.assertNotEqual(self.invoke('marker-cleanup'), 0)
            self.assertEqual(self.stages(), [])
            self.assertEqual((self.runtime / 'reload.state').read_text(), 'clean')
        self.assertEqual((self.root / 'events').read_text().splitlines(), ['setup'])
        self.assertEqual(self.invoke(), 0)
        self.assertFalse((self.runtime / 'reload.state').exists())

    def test_stop_preserves_unresolved_recovery(self):
        self.assertNotEqual(self.invoke('restore'), 0)
        backup = self.stages()[0]
        self.assertNotEqual(self.invoke(operation='stop'), 0)
        self.assertEqual((backup / 'sing-box-c.json').read_text(), 'OLD CLIENT')
        self.assertNotEqual(self.invoke(), 0)
        self.assertEqual(self.stages(), [backup])

    def test_preparation_cleanup_failure_is_bounded_and_retried(self):
        for _ in range(3):
            self.assertNotEqual(self.invoke('backup-cleanup'), 0)
            self.assertEqual(len(self.stages()), 1)
            self.assertEqual((self.runtime / 'reload.state').read_text(), 'preparing')
        self.assertFalse((self.root / 'events').exists())
        self.assertEqual(self.invoke(), 0)
        self.assertEqual(self.stages(), [])


if __name__ == '__main__':
    unittest.main()
