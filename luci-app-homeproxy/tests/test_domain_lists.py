import json
import subprocess
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
RPC = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
HELPER = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()


def production_source():
    functions = HELPER[HELPER.index('export function normalizeDomainList'):HELPER.index('export function resolveLanPolicy')]
    functions = functions.replace('export function', 'function')
    functions += HELPER[HELPER.index('export function isBinary'):HELPER.index('export function getTime')].replace('export function', 'function')
    helpers = RPC[RPC.index('function validDomainListId'):RPC.index('const methods =')]
    methods = RPC[RPC.index('\tdomainlist_write: {'):RPC.index('\n\tcertificate_write: {')]
    return functions + helpers + 'const methods = {\n' + methods + '\n};\n'


class DomainListTransactions(unittest.TestCase):
    def run_case(self, action='write', fault=''):
        with tempfile.TemporaryDirectory(prefix='homeproxy-domain-') as directory:
            root = Path(directory)
            diversion = root / 'diversion'
            diversion.mkdir()
            (diversion / 'direct.txt').write_text('old-direct.example\n')
            (diversion / 'proxy.txt').write_text('old-proxy.example\n')
            source = '''
import { open as real_open, readfile, writefile as real_writefile, rename as real_rename,
         unlink as real_unlink, mkdtemp, rmdir, lsdir, lstat } from 'fs';
const HP_DIR = %s, FAULT = %s;
let locks = 0, stages = [], backup_writes = 0, install_renames = 0;
function cursor() { return { load: () => true, get: () => null, foreach: () => null }; }
function validation(t, s) { return !!match(s, /^[a-z.-]+$/); }
function system(s) { return 0; }
function open(path, mode, perm) {
  let fd = real_open(path, mode, perm);
  if (index(path, 'domainlist.lock') >= 0) {
    locks++;
    if (FAULT === 'lock') return null;
  }
  return fd;
}
function writefile(path, content) {
  if (index(path, '.bak') >= 0) {
    backup_writes++;
    if (FAULT === 'backup-short') return real_writefile(path, substr(content, 0, 4));
    if (FAULT === 'backup-null') { real_writefile(path, ''); return null; }
  }
  return real_writefile(path, content);
}
function rename(source, target) {
  if (index(source, '/.domainlist.') >= 0 && index(source, '.new') >= 0) {
    install_renames++;
    push(stages, source);
    if ((FAULT === 'install' || FAULT === 'restore') && install_renames === 2) return false;
    if (FAULT === 'restore' && install_renames > 2) return false;
  }
  if (FAULT === 'restore' && index(source, '.bak') >= 0) return false;
  return real_rename(source, target);
}
function unlink(path) { return real_unlink(path); }
''' % (json.dumps(directory), json.dumps(fault))
            source += production_source()
            if action == 'write':
                source += '''let result = methods.domainlist_write.call({args:{lists:{direct:'new-direct.example',proxy:'new-proxy.example'},routing_mode:'bypass_mainland_china',group_states:{}}});\n'''
            elif action == 'empty':
                source += '''let result = methods.domainlist_write.call({args:{lists:{direct:''},routing_mode:'global',group_states:{}}});\n'''
            else:
                source += "let result = methods.domainlist_remove.call({args:{id:'custom'}});\n"
            source += '''printf('%J', { result, locks, stages, backup_writes,
 direct: readfile(HP_DIR + '/diversion/direct.txt'),
 proxy: readfile(HP_DIR + '/diversion/proxy.txt') });\n'''
            script = root / 'case.uc'
            script.write_text(source)
            run = subprocess.run(['ucode', str(script)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            return json.loads(run.stdout)

    def test_backup_short_or_empty_write_aborts_before_install(self):
        for fault in ('backup-short', 'backup-null'):
            with self.subTest(fault=fault):
                row = self.run_case(fault=fault)
                self.assertFalse(row['result']['result'])
                self.assertEqual(row['stages'], [])
                self.assertEqual(row['direct'], 'old-direct.example\n')
                self.assertEqual(row['proxy'], 'old-proxy.example\n')

    def test_failed_install_verifies_restore_and_retains_recovery(self):
        row = self.run_case(fault='restore')
        self.assertFalse(row['result']['result'])
        self.assertIn('restore', row['result']['error'])

    def test_write_and_remove_share_transaction_lock(self):
        self.assertEqual(self.run_case()['locks'], 1)
        self.assertEqual(self.run_case(action='remove')['locks'], 1)
        self.assertFalse(self.run_case(fault='lock')['result']['result'])

    def test_each_write_uses_unique_private_staging_paths(self):
        first = self.run_case()
        second = self.run_case()
        self.assertTrue(first['result']['result'])
        self.assertEqual(len(first['stages']), 2)
        self.assertEqual(len(set(first['stages'])), 2)
        self.assertTrue(all('/.domainlist.' in p for p in first['stages']))
        self.assertNotEqual(first['stages'], second['stages'])

    def test_empty_content_is_installed(self):
        row = self.run_case(action='empty')
        self.assertTrue(row['result']['result'])
        self.assertEqual(row['direct'], '')

    def test_concurrent_writes_validate_under_the_transaction_lock(self):
        with tempfile.TemporaryDirectory(prefix='homeproxy-domain-race-') as directory:
            root = Path(directory)
            diversion = root / 'diversion'
            diversion.mkdir()
            (diversion / 'direct.txt').write_text('old-direct.example\n')
            (diversion / 'proxy.txt').write_text('old-proxy.example\n')
            processes = []
            for role, lists in (
                ('direct', "{direct:'collision.example'}"),
                ('proxy', "{proxy:'collision.example'}"),
            ):
                source = '''
import { open as real_open, readfile, writefile, rename, unlink, mkdtemp, rmdir, lsdir, lstat } from 'fs';
const HP_DIR = %s, ROLE = %s;
function cursor() { return { load: () => true, get: () => null, foreach: () => null }; }
function validation(t, s) { return !!match(s, /^[a-z.-]+$/); }
function system(s) { return 0; }
function open(path, mode, perm) {
  let fd = real_open(path, mode, perm);
  if (index(path, 'domainlist.lock') >= 0) {
    writefile(HP_DIR + '/diversion/' + ROLE + '.ready', '1');
    for (let i = 0; i < 500 &&
         (readfile(HP_DIR + '/diversion/direct.ready') === null ||
          readfile(HP_DIR + '/diversion/proxy.ready') === null); i++)
      system('sleep 0.01');
  }
  return fd;
}
''' % (json.dumps(directory), json.dumps(role))
                source += production_source()
                source += "let result = methods.domainlist_write.call({args:{lists:%s,routing_mode:'bypass_mainland_china',group_states:{}}}); printf('%%J', result);\n" % lists
                script = root / f'{role}.uc'
                script.write_text(source)
                processes.append(subprocess.Popen(['ucode', str(script)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
            results = []
            for process in processes:
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, stderr)
                results.append(json.loads(stdout))
            self.assertEqual(sum(row['result'] is True for row in results), 1, results)
            self.assertEqual(sum(row['result'] is False and 'conflicts' in row['error'] for row in results), 1, results)
            self.assertNotEqual((diversion / 'direct.txt').read_text(), (diversion / 'proxy.txt').read_text())


class DomainListCleanupLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='homeproxy-domain-lifecycle-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.diversion = self.root / 'diversion'
        self.diversion.mkdir()
        (self.diversion / 'direct.txt').write_bytes(b'old-direct.example\n')
        (self.diversion / 'proxy.txt').write_bytes(b'old-proxy.example\n')

    def run_rpc(self, fault='', action='write', expected_exit=0):
        source = '''
import { open, readfile, writefile as real_writefile, rename as real_rename,
         unlink as real_unlink, mkdtemp, rmdir as real_rmdir, lsdir, lstat } from 'fs';
const HP_DIR = %s, FAULT = %s;
let installs = 0;
function cursor() { return { load: () => true, get: () => null, foreach: () => null }; }
function validation(t, s) { return !!match(s, /^[a-z.-]+$/); }
function system(s) { return 0; }
function writefile(path, content) {
  if (index(path, '.new') >= 0) {
    if (FAULT === 'stage-short') return real_writefile(path, substr(content, 0, 4));
    if (FAULT === 'stage-null') { real_writefile(path, ''); return null; }
    if (FAULT === 'stage-zero') return real_writefile(path, '');
    if (FAULT === 'restore-short' && installs >= 2) return real_writefile(path, substr(content, 0, 4));
  }
  if (index(path, '/.state') >= 0 && index(FAULT, 'marker-') === 0 && content === substr(FAULT, 7)) {
    real_writefile(path, '');
    return null;
  }
  if (FAULT === 'crash-preparing' && index(path, '.new') >= 0) {
    real_writefile(path, content);
    exit(99);
  }
  if (FAULT === 'crash-committed' && content === 'clean') {
    real_writefile(path, content);
    exit(99);
  }
  return real_writefile(path, content);
}
function rename(source, target) {
  if (index(source, '.new') >= 0 && index(source, '/.domainlist.') >= 0) {
    installs++;
    if (FAULT === 'crash-installing' && installs === 2) exit(99);
    if (FAULT === 'install-corrupt' && installs === 2) {
      real_rename(source, target);
      real_writefile(target, 'corrupted.example\n');
      return true;
    }
    if (installs === 2 && (index(FAULT, 'restore') >= 0 || FAULT === 'install')) return false;
  }
  if ((index(source, '.bak') >= 0 || installs > 2) && index(FAULT, 'restore') >= 0) {
    if (FAULT === 'restore-fail') return false;
    if (FAULT === 'restore-short') return real_rename(source, target);
    real_rename(source, target);
    real_writefile(target, 'corrupted.example\n');
    return true;
  }
  return real_rename(source, target);
}
function unlink(path) {
  if (FAULT === 'cleanup-backup' && index(path, '.bak') >= 0) return false;
  if (FAULT === 'cleanup-marker' && index(path, '/.state') >= 0) return false;
  return real_unlink(path);
}
function rmdir(path) {
  if (FAULT === 'cleanup-directory' && index(path, '/.domainlist.') >= 0) return false;
  return real_rmdir(path);
}
''' % (json.dumps(str(self.root)), json.dumps(fault))
        source += production_source()
        if action == 'remove':
            source += "let result = methods.domainlist_remove.call({args:{id:'custom'}});\n"
        else:
            source += "let result = methods.domainlist_write.call({args:{lists:{direct:'new-direct.example',proxy:'new-proxy.example'},routing_mode:'bypass_mainland_china',group_states:{}}});\n"
        source += "printf('%J', {result, installs});\n"
        script = self.root / 'case.uc'
        script.write_text(source)
        run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
        self.assertEqual(run.returncode, expected_exit, run.stderr)
        return json.loads(run.stdout) if expected_exit == 0 else {}

    def staging(self):
        return sorted(self.diversion.glob('.domainlist.*'))

    def test_failed_cleanup_reports_failure_and_retry_does_not_accumulate(self):
        for fault in ('cleanup-backup', 'cleanup-directory', 'cleanup-marker'):
            with self.subTest(fault=fault):
                for _ in range(5):
                    row = self.run_rpc(fault)
                    self.assertFalse(row['result']['result'], row)
                    self.assertEqual(len(self.staging()), 1)
                    self.assertEqual((self.diversion / 'direct.txt').read_bytes(), b'new-direct.example\n')
                    self.assertEqual((self.diversion / 'proxy.txt').read_bytes(), b'new-proxy.example\n')
                self.assertTrue(self.run_rpc()['result']['result'])
                self.assertEqual(self.staging(), [])

    def test_failed_restore_verification_keeps_all_original_backup_bytes(self):
        row = self.run_rpc('restore-corrupt')
        self.assertFalse(row['result']['result'])
        self.assertIn('restore', row['result']['error'])
        stage, = self.staging()
        self.assertTrue((stage / 'direct.bak').is_file(), 'recovery backup was consumed before restore verification')
        self.assertEqual((stage / 'direct.bak').read_bytes(), b'old-direct.example\n')
        self.assertEqual((stage / 'proxy.bak').read_bytes(), b'old-proxy.example\n')
        self.assertFalse(self.run_rpc()['result']['result'])
        self.assertEqual(self.staging(), [stage])

    def test_installed_byte_mismatch_rolls_back_all_lists(self):
        row = self.run_rpc('install-corrupt')
        self.assertFalse(row['result']['result'])
        self.assertEqual((self.diversion / 'direct.txt').read_bytes(), b'old-direct.example\n')
        self.assertEqual((self.diversion / 'proxy.txt').read_bytes(), b'old-proxy.example\n')
        self.assertEqual(self.staging(), [])
        self.assertTrue(self.run_rpc()['result']['result'])

    def test_crash_preparing_and_committed_stages_are_cleaned_on_retry(self):
        for fault in ('crash-preparing', 'crash-committed'):
            with self.subTest(fault=fault):
                self.run_rpc(fault, expected_exit=99)
                self.assertEqual(len(self.staging()), 1)
                self.assertTrue(self.run_rpc()['result']['result'])
                self.assertEqual(self.staging(), [])

    def test_interrupted_install_keeps_recovery_and_blocks_write_and_remove(self):
        self.run_rpc('crash-installing', expected_exit=99)
        stage, = self.staging()
        original_files = {p.name: p.read_bytes() for p in stage.iterdir()}
        active = {p.name: p.read_bytes() for p in self.diversion.glob('*.txt')}
        for action in ('write', 'remove', 'write'):
            self.assertFalse(self.run_rpc(action=action)['result']['result'])
            self.assertEqual(self.staging(), [stage])
            self.assertEqual({p.name: p.read_bytes() for p in stage.iterdir()}, original_files)
            self.assertEqual({p.name: p.read_bytes() for p in self.diversion.glob('*.txt')}, active)

    def test_legacy_recovery_is_not_deleted_or_accumulated(self):
        stage = self.diversion / '.domainlist.legacy'
        stage.mkdir()
        (stage / 'direct.bak').write_bytes(b'recovery.example\n')
        for _ in range(3):
            self.assertFalse(self.run_rpc()['result']['result'])
            self.assertEqual(self.staging(), [stage])
            self.assertEqual((stage / 'direct.bak').read_bytes(), b'recovery.example\n')

    def test_symlink_marker_cannot_authorize_deleting_recovery_backups(self):
        stage = self.diversion / '.domainlist.legacy'
        stage.mkdir()
        external = self.root / 'external-state'
        external.write_text('clean')
        (stage / '.state').symlink_to(external)
        (stage / 'direct.bak').write_bytes(b'recovery.example\n')
        self.assertFalse(self.run_rpc()['result']['result'])
        self.assertEqual((stage / 'direct.bak').read_bytes(), b'recovery.example\n')
        self.assertTrue((stage / '.state').is_symlink())

    def test_short_null_and_zero_staging_writes_preserve_active_bytes_and_retry(self):
        for fault in ('stage-short', 'stage-null', 'stage-zero'):
            with self.subTest(fault=fault):
                self.assertFalse(self.run_rpc(fault)['result']['result'])
                self.assertEqual((self.diversion / 'direct.txt').read_bytes(), b'old-direct.example\n')
                self.assertEqual((self.diversion / 'proxy.txt').read_bytes(), b'old-proxy.example\n')
                self.assertEqual(self.staging(), [])
        self.assertTrue(self.run_rpc()['result']['result'])

    def test_recoverable_install_failure_restores_all_bytes_and_retry(self):
        self.assertFalse(self.run_rpc('install')['result']['result'])
        self.assertEqual((self.diversion / 'direct.txt').read_bytes(), b'old-direct.example\n')
        self.assertEqual((self.diversion / 'proxy.txt').read_bytes(), b'old-proxy.example\n')
        self.assertEqual(self.staging(), [])
        self.assertTrue(self.run_rpc()['result']['result'])

    def test_restore_write_and_rename_failures_keep_backups_and_block_retry(self):
        for fault in ('restore-short', 'restore-fail'):
            with self.subTest(fault=fault):
                row = self.run_rpc(fault)
                self.assertFalse(row['result']['result'])
                stage, = self.staging()
                self.assertEqual((stage / 'direct.bak').read_bytes(), b'old-direct.example\n')
                self.assertEqual((stage / 'proxy.bak').read_bytes(), b'old-proxy.example\n')
                self.assertFalse(self.run_rpc()['result']['result'])
                self.assertEqual(self.staging(), [stage])
                # Isolated manual recovery before the next independent fault case.
                for path in stage.iterdir():
                    path.unlink()
                stage.rmdir()
                (self.diversion / 'direct.txt').write_bytes(b'old-direct.example\n')
                (self.diversion / 'proxy.txt').write_bytes(b'old-proxy.example\n')

    def test_failed_markers_block_further_accumulation_without_deleting_uncertain_backups(self):
        for fault in ('marker-preparing', 'marker-installing', 'marker-clean'):
            with self.subTest(fault=fault):
                row = self.run_rpc(fault)
                self.assertFalse(row['result']['result'])
                stage, = self.staging()
                retained = {p.name: p.read_bytes() for p in stage.iterdir()}
                for _ in range(3):
                    self.assertFalse(self.run_rpc()['result']['result'])
                    self.assertEqual(self.staging(), [stage])
                    self.assertEqual({p.name: p.read_bytes() for p in stage.iterdir()}, retained)
                for path in stage.iterdir():
                    path.unlink()
                stage.rmdir()


if __name__ == '__main__':
    unittest.main()
