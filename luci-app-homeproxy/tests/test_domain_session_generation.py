"""UCI-owned domain lists must drive the complete production generator."""
import unittest
import json
from pathlib import Path
import subprocess
import tempfile
from client_generator_fixture import ClientGenerator


class DomainSessionGeneration(unittest.TestCase):
    def test_native_libuci_missing_and_multiline_text(self):
        helper = (Path(__file__).resolve().parents[1] /
                  'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
        functions = helper[helper.index('export function domainListPath'):
                           helper.index('export function splitDomainList')].replace('export function', 'function')
        with tempfile.TemporaryDirectory(prefix='hp-domain-native-read-') as directory:
            root = Path(directory)
            for name in ('config', 'saved', 'diversion'):
                (root / name).mkdir()
            (root / 'config/homeproxy').write_text("config homeproxy 'diversion'\n")
            (root / 'diversion/direct.txt').write_text('legacy.example\n')
            source = "import {cursor} from 'uci'; import {readfile} from 'fs';\n"
            source += 'const HP_DIR=' + json.dumps(directory) + ';\n' + functions
            source += 'let u=cursor(%s,%s);u.load("homeproxy");\n' % (
                json.dumps(str(root / 'config')), json.dumps(str(root / 'saved')))
            source += '''let missing=u.get('homeproxy','diversion','direct_list');
let legacy=readDomainList(u,'direct');
u.set('homeproxy','diversion','direct_list','one.example\ntwo.example\n');u.save('homeproxy');u.commit('homeproxy');
u.unload('homeproxy');u.load('homeproxy');
printf('%J',{missing,type:type(missing),legacy,text:readDomainList(u,'direct')});
'''
            script = root / 'case.uc'
            script.write_text(source)
            run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(json.loads(run.stdout), {'missing': None, 'type': None,
                             'legacy': 'legacy.example\n', 'text': 'one.example\ntwo.example\n'})

    def test_committed_text_overrides_retained_legacy_files_for_all_groups(self):
        with ClientGenerator() as f:
            f.sections['diversion'] = {'.type': 'homeproxy',
                                       'direct_list': 'new-direct.example\n',
                                       'proxy_list': 'new-proxy.example\n'}
            f.sections['route_test'] = {'.type': 'domain_route', 'enabled': '1',
                                        'node': 'node1', 'domain_list': 'new-route.example\n'}
            out = f.generate(domains={name: 'old-' + name + '.example\n'
                                      for name in ('direct', 'proxy', 'route_test')})
            text = str(out)
            for group in ('direct', 'proxy', 'route'):
                self.assertIn('new-' + group + '.example', text)
            self.assertNotIn('old-', text)

    def test_explicit_empty_does_not_resurrect_a_legacy_file(self):
        with ClientGenerator() as f:
            for content in ('', '\n'):
                f.sections['diversion'] = {'.type': 'homeproxy', 'direct_list': content}
                out = f.generate(domains={'direct': 'stale.example\n'})
                self.assertNotIn('stale.example', str(out))

    def test_missing_adapter_value_falls_back_and_nontext_is_rejected(self):
        with ClientGenerator() as f:
            # The platform adapter's missing dict key evaluates to native ucode
            # null, like native libuci.get(), not a separate JS undefined type.
            self.assertIn('legacy.example', str(f.generate(domains={'direct': 'legacy.example\n'})))
            f.sections['diversion'] = {'.type': 'homeproxy', 'direct_list': ['invalid.example']}
            with self.assertRaisesRegex(AssertionError, 'Invalid domain list text'):
                f.generate()

    def test_disabled_group_retains_text_without_consuming_it(self):
        with ClientGenerator() as f:
            f.sections['route_test'] = {'.type': 'domain_route', 'enabled': '0',
                                        'node': 'node1', 'domain_list': 'retained.example\n'}
            self.assertNotIn('retained.example', str(f.generate()))
            f.sections['route_test']['enabled'] = '1'
            self.assertIn('retained.example', str(f.generate()))
