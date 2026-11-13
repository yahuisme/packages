"""Production JS/ucode conflict parity and single-group work bound."""
import json

import subprocess
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


class DomainConflictCost(unittest.TestCase):
    def test_single_group_does_not_visit_entry_pairs(self):
        source = (APP / 'htdocs/luci-static/resources/view/homeproxy/client.js').read_text()
        functions = source[source.index('function domainSuffixOverlap'):source.index('const callCurrentNode')]
        script = functions + '''
let reads=0;
const group={get id(){reads++; return 'only';},suffixes:Array.from({length:4000},(_,i)=>'host'+i+'.example.com'),keywords:[]};
if(findDomainListConflict([group])!==null) throw Error('false conflict');
if(reads>10000) throw Error('same-group work remains quadratic: '+reads);
console.log(JSON.stringify({idReads:reads}));
'''
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_native_single_group_comparisons_stay_linear(self):
        source = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
        functions = source[source.index('function domainSuffixOverlap'):source.index('export function resolveLanPolicy')].replace('export function', 'function')
        # Count pair visitation without changing matching or loop control.
        if 'const left = entries[i], right = entries[j];' in functions:
            functions = functions.replace('const left = entries[i], right = entries[j];',
                                          'checks++; const left = entries[i], right = entries[j];')
        else:
            self.assertIn('for (let right in previous) {', functions)
            functions = functions.replace('for (let right in previous) {',
                                          'for (let right in previous) { checks++;')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cost.uc'
            path.write_text('let checks=0;\n' + functions + '''
const group={id:'only',suffixes:[],keywords:[]};
for(let i=0;i<4000;i++) push(group.suffixes,'host'+i+'.example.com');
if(findDomainGroupConflict([group])!==null || checks>4000) die('quadratic same-group pairs: '+checks);
print(checks);
''')
            result = subprocess.run(['ucode', str(path)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, '0')

    def test_js_and_ucode_preserve_first_conflict_and_nonconflicts(self):
        helper = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
        uc = helper[helper.index('function domainSuffixOverlap'):helper.index('export function resolveLanPolicy')].replace('export function', 'function')
        client = (APP / 'htdocs/luci-static/resources/view/homeproxy/client.js').read_text()
        js = client[client.index('function domainSuffixOverlap'):client.index('const callCurrentNode')]
        cases = [
            [], [{'id':'one','suffixes':['example.com','sub.example.com'],'keywords':['ample']}],
            [{'id':'a','suffixes':['example.com'],'keywords':[]},{'id':'b','suffixes':['sub.example.com'],'keywords':[]}],
            [{'id':'a','suffixes':['x.test'],'keywords':['video']},{'id':'b','suffixes':['video.example'],'keywords':['vid']}],
            [{'id':'a','suffixes':['one.test','two.test'],'keywords':['first']},{'id':'b','suffixes':['two.test','one.test'],'keywords':['second']}],
            [{'id':'a','suffixes':['notexample.com'],'keywords':[]},{'id':'b','suffixes':['example.com'],'keywords':[]}],
            [{'id':'same','suffixes':['example.com'],'keywords':[]},{'id':'same','suffixes':['example.com'],'keywords':[]}]
        ]
        expected = [None, None, ('b','sub.example.com','a','example.com'),
                    ('b','video.example','a','video'), ('b','two.test','a','two.test'), None, None]
        for groups, want in zip(cases, expected):
            with self.subTest(groups=groups), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'conflict.uc'
                path.write_text(uc + '\nprint(sprintf("%J",findDomainGroupConflict(' + json.dumps(groups) + ')));')
                result = subprocess.run(['ucode', str(path)], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                native = json.loads(result.stdout)
                result = subprocess.run(['node', '-e', js + '\nconsole.log(JSON.stringify(findDomainListConflict(' + json.dumps(groups) + ')));'], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                browser = json.loads(result.stdout)
                def normalized(value, frontend=False):
                    if value is None:
                        return None
                    return tuple(value[side]['group']['id'] if frontend and field=='group' else value[side][field]
                                 for side in ('left','right') for field in ('group','value'))
                self.assertEqual(normalized(native), want)
                self.assertEqual(normalized(browser, True), want)


if __name__ == '__main__':
    unittest.main()
