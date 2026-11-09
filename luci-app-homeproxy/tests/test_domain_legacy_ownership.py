"""ACL-exposed legacy setters cannot shadow UCI transaction-owned text."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_domain_lists import production_source


class DomainLegacyOwnership(unittest.TestCase):
    def test_managed_lists_reject_file_write_and_remove_under_existing_lock(self):
        with tempfile.TemporaryDirectory(prefix='hp-domain-owner-') as directory:
            root = Path(directory)
            (root / 'diversion').mkdir()
            for name in ('direct', 'custom'):
                (root / 'diversion' / (name + '.txt')).write_text('legacy.example\n')
            source = "import {open,readfile,writefile,rename,unlink,rmdir,lsdir,lstat} from 'fs';\n"
            source += 'const HP_DIR=' + json.dumps(directory) + ';\n'
            source += "function cursor(){return {load:()=>true,get:(c,s,o)=>o in ['direct_list','domain_list']?'managed.example\\n':null,foreach:()=>null};}\n"
            source += "function validation(t,s){return !!match(s,/^[a-z.-]+$/);}\n" + production_source()
            source += "printf('%J',[methods.domainlist_write.call({args:{lists:{direct:'replacement.example'},routing_mode:'global',group_states:{}}}),methods.domainlist_remove.call({args:{id:'custom'}})]);\n"
            script = root / 'case.uc'
            script.write_text(source)
            run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            for result in json.loads(run.stdout):
                self.assertFalse(result['result'], result)
                self.assertIn('UCI', result['error'])
            for name in ('direct', 'custom'):
                self.assertEqual((root / 'diversion' / (name + '.txt')).read_text(), 'legacy.example\n')

    def test_legacy_write_validates_other_committed_uci_list(self):
        with tempfile.TemporaryDirectory(prefix='hp-domain-owner-conflict-') as directory:
            root = Path(directory)
            (root / 'diversion').mkdir()
            (root / 'diversion/proxy.txt').write_text('old-proxy.example\n')
            source = "import {open,readfile,writefile,rename,unlink,rmdir,lsdir,lstat} from 'fs';\n"
            source += 'const HP_DIR=' + json.dumps(directory) + ';\n'
            source += "function cursor(){return {load:()=>true,get:(c,s,o)=>o==='proxy_list'?'managed.example\\n':null,foreach:()=>null};}\n"
            source += "function validation(t,s){return !!match(s,/^[a-z.-]+$/);}\n" + production_source()
            source += "printf('%J',methods.domainlist_write.call({args:{lists:{direct:'sub.managed.example'},routing_mode:'bypass_mainland_china',group_states:{}}}));\n"
            script = root / 'case.uc'
            script.write_text(source)
            run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            result = json.loads(run.stdout)
            self.assertFalse(result['result'])
            self.assertIn('conflicts', result['error'])
            self.assertFalse((root / 'diversion/direct.txt').exists())
