"""Native UCI pending delete/revert plus real generator tombstone semantics."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from client_generator_fixture import ClientGenerator

class DomainRevert(unittest.TestCase):
    def test_deleted_group_is_excluded_from_conflict_check_without_unlink(self):
        from test_domain_lists import production_source
        with tempfile.TemporaryDirectory(prefix='hp-domain-move-') as directory:
            root = Path(directory)
            for name in ('config', 'saved', 'diversion'):
                (root / name).mkdir()
            (root / 'config/homeproxy').write_text("config domain_route 'route_old'\n option enabled '1'\n option node 'n1'\n")
            tombstone = root / 'diversion/route_old.txt'
            tombstone.write_text('moved.example\n')
            script = root / 'case.uc'
            script.write_text("import {cursor as native_cursor} from 'uci'; import {open,readfile,writefile,rename,unlink,rmdir,lsdir,lstat} from 'fs';\n" +
                              'const HP_DIR=' + json.dumps(str(root)) + ';\n' +
                              'function cursor(){return native_cursor(' + json.dumps(str(root / 'config')) + ',' + json.dumps(str(root / 'saved')) + ');}\n' +
                              "function validation(t,s){return !!match(s,/^[a-z.-]+$/);}\n" + production_source() +
                              "const legacy=methods.domainlist_write.call({args:{lists:{direct:'moved.example'},routing_mode:'global',group_states:{}}}); if(legacy.result !== false) die('legacy callers must still validate committed groups');\n" +
                              "printf('%J',methods.domainlist_write.call({args:{lists:{direct:'moved.example'},routing_mode:'global',group_states:{},groups_complete:true}}));\n")
            result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads(result.stdout)['result'], result.stdout)
            self.assertEqual(tombstone.read_text(), 'moved.example\n')

    def test_pending_uci_delete_revert_preserves_domain_bytes(self):
        with tempfile.TemporaryDirectory(prefix='hp-domain-revert-') as directory:
            root=Path(directory)
            for name in ('config','saved'): (root/name).mkdir()
            (root/'config/homeproxy').write_text("config domain_route 'route_test'\n option enabled '1'\n option node 'n1'\n")
            domain=root/'route_test.txt'
            original=b'keep.example\n';domain.write_bytes(original)
            script=root/'case.uc'
            script.write_text("import {cursor} from 'uci';\nconst u=cursor(%s,%s); u.load('homeproxy');\n" %
                              (json.dumps(str(root/'config')),json.dumps(str(root/'saved'))) +
                              "if(!u.delete('homeproxy','route_test') || !u.save('homeproxy')) die('delete failed');\n" +
                              "if(u.get('homeproxy','route_test') !== null) die('pending delete absent');\n" +
                              "if(!u.revert('homeproxy')) die('revert failed'); u.unload('homeproxy'); u.load('homeproxy');\n" +
                              "if(u.get('homeproxy','route_test') !== 'domain_route') die('revert did not restore');\n")
            run=subprocess.run(['ucode',str(script)],capture_output=True,text=True,timeout=10)
            self.assertEqual(run.returncode,0,run.stderr)
            self.assertEqual(domain.read_bytes(),original)

    def test_generator_ignores_tombstone_until_uci_section_is_restored(self):
        with ClientGenerator() as f:
            domains={'route_test':'keep.example\n'}
            config=f.generate(domains=domains)
            self.assertNotIn('keep.example',json.dumps(config))
            f.sections['route_test']={'.type':'domain_route','enabled':'1','node':'node1','label':'kept'}
            config=f.generate(domains=domains)
            self.assertIn('keep.example',json.dumps(config))

if __name__ == '__main__': unittest.main()
