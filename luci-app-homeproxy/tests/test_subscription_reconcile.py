"""Real parser and complete main(); only platform/transport boundaries are fixtures."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_subscription_parsing import BASE, PREAMBLE

URL = 'https://fixture.invalid/sub'
GROUP = hashlib.md5(URL.encode()).hexdigest()
GOOD = 'proxies:\n  - name: good\n    type: trojan\n    server: good.example\n    port: 443\n    password: secret\n'
BAD = '  - name: old-unparsed\n    type: trojan\n    server: old.example\n    port: 443\n'


class SubscriptionReconcile(unittest.TestCase):
    def run_main(self, payload, blacklist=(), urls=None):
        h = (BASE / 'homeproxy.uc').read_text()
        s = (BASE / 'update_subscriptions.uc').read_text()
        parser = PREAMBLE + h[h.index('export function decodeBase64Str'):h.index('/* String parser end */')].replace('export function', 'function')
        parser += s[s.index('function has_value'):s.index('function main()')]
        pre = '''import {md5} from 'digest';
const node_cache={},node_config_cache={},node_result=[],reconcile_group={};
const user_agent='fixture',update_proxy=null,allow_insecure='0',packet_encoding='xudp',resources_updated=false;
const uciconfig='homeproxy',ucinode='node',ucimain='config';
let deleted=[],writes=[],commits=0,fetches=0;
const old=[{'.name':'old-unparsed',grouphash:md5('https://fixture.invalid/sub'),label:'old-unparsed'},
 {'.name':'removed-group',grouphash:md5('https://fixture.invalid/removed')}, {'.name':'manual'}];
const uci={foreach:function(c,t,fn){for(let n in old) fn(n);},delete:function(c,n,k){push(deleted,{n,k});return true;},
set:function(...a){push(writes,a);return true;},get:function(c,n,k){return k==='main_node'?'nil':null;},
changes:()=>({changed:true}),commit:function(){commits++;return true;}};
function wGET(){fetches++;return payload;}
function filter_check(label){return label in blacklist;}
function synchronizeNodeLabels(){return {used:{},changed:0};}
function reserveUniqueLabel(used,label){return label;}
function reconcileUrltestNodes(){}
function reload_service(){return true;}
function apply_updated_resources(){return true;}
function log_error(...args){warn(sprintf('%J',args));}
'''
        pre = 'const payload=' + json.dumps(payload) + ',blacklist=' + json.dumps(blacklist) + ',subscription_urls=' + json.dumps(urls or [URL]) + ';\n' + pre
        source = pre + parser + s[s.index('function main()'):s.index('if (!isEmpty(subscription_urls))')]
        source += "main(); print(sprintf('%J',{deleted,writes,commits,fetches,reconcile_group,nodes:node_result}));"
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'main.uc'
            p.write_text(source)
            r = subprocess.run(['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/opt/test-tools/ucode/build'), str(p)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_scheme_case_full_main(self):
        import base64
        for scheme in ('socks4a', 'https'):
            suffix = '://User:p%40Ss@example.com:8443#MixedCase'
            def run(link):
                return self.run_main(base64.b64encode(link.encode()).decode())
            expected = run(scheme + suffix)
            self.assertEqual(len(expected['nodes']), 1)
            self.assertEqual(expected['commits'], 1)
            for variant in (scheme.upper(), 'SOCKS4a' if scheme == 'socks4a' else 'hTtPs'):
                with self.subTest(scheme=variant):
                    self.assertEqual(run(variant + suffix), expected)

    def test_null_parse_preserves_unmatched_group(self):
        r = self.run_main(GOOD + BAD)
        self.assertFalse(r['reconcile_group'][GROUP])
        self.assertNotIn('old-unparsed', [n['n'] for n in r['deleted']])
        self.assertIn('removed-group', [n['n'] for n in r['deleted']])
        self.assertEqual(len(r['nodes']), 1)
        self.assertEqual(r['commits'], 1)

    def test_complete_response_deletes_stale_not_manual(self):
        r = self.run_main(GOOD)
        self.assertTrue(r['reconcile_group'][GROUP])
        self.assertEqual([n['n'] for n in r['deleted']], ['old-unparsed', 'removed-group'])

    def test_filtered_valid_node_does_not_mark_partial(self):
        r = self.run_main(GOOD + BAD + '    password: secret\n', ['old-unparsed'])
        self.assertTrue(r['reconcile_group'][GROUP])
        self.assertIn('old-unparsed', [n['n'] for n in r['deleted']])
        self.assertEqual(len(r['nodes']), 1)

    def test_duplicate_nodes_and_urls_still_reconcile(self):
        r = self.run_main(GOOD + GOOD.split('proxies:\n')[1], urls=[URL, URL + '#alias'])
        self.assertTrue(r['reconcile_group'][GROUP])
        self.assertEqual(len(r['nodes']), 1)
        self.assertEqual(r['fetches'], 1)
        self.assertIn('old-unparsed', [n['n'] for n in r['deleted']])

    def test_empty_entry_does_not_mark_partial(self):
        import base64
        r = self.run_main(base64.b64encode(b'trojan://secret@good.example:443#good\n\ntrojan://secret@good.example:443#good').decode())
        self.assertTrue(r['reconcile_group'][GROUP])
        self.assertEqual(len(r['nodes']), 1)

    def test_all_invalid_keeps_existing_without_commit(self):
        r = self.run_main('proxies:\n' + BAD)
        self.assertEqual(r['deleted'], [])
        self.assertEqual(r['commits'], 0)


if __name__ == '__main__':
    unittest.main()
