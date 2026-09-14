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
         unlink as real_unlink, mkdtemp, rmdir } from 'fs';
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
import { open as real_open, readfile, writefile, rename, unlink, mkdtemp, rmdir } from 'fs';
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


if __name__ == '__main__':
    unittest.main()
