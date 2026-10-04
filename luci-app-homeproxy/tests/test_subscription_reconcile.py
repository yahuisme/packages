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


NODE = hashlib.md5((GROUP + ':keep').encode()).hexdigest()
TCP = 'proxies:\n  - {name: keep, type: trojan, server: proxy.example, port: 443, password: new}\n'
WS = TCP.replace('password: new}', 'password: new, network: ws}')


class NativeSubscription(unittest.TestCase):
    """Real parser/helpers/main/renderer + private native libuci CLI adapter.

    Download and service boundaries remain fixtures; no host config or daemon.
    Set SUBSCRIPTION_EVIDENCE_DIR to retain each private case and diagnostics.
    """
    def run_native(self, payload, *, fault=(), extra='', original=None, urls=None):
        h = (BASE / 'homeproxy.uc').read_text()
        s = (BASE / 'update_subscriptions.uc').read_text()
        with tempfile.TemporaryDirectory(prefix='subscription-') as directory:
            root = Path(directory)
            for part in ('config', 'override', 'saved'):
                (root / part).mkdir()
            if original is None:
                original = f"""config config 'config'
 option main_node 'nil'
config node '{NODE}'
 option label 'keep'
 option grouphash '{GROUP}'
 option type 'trojan'
 option address 'proxy.example'
 option port '443'
 option password 'old'
 option tls '1'
 option tls_sni 'old.example'
 option tls_insecure '1'
 option transport 'ws'
 option ws_path '/old'
""" + extra
            (root / 'config/homeproxy').write_text(original)
            (root / 'before.uci').write_text(original)
            (root / 'fault.json').write_text(json.dumps(fault))
            (root / 'calls.jsonl').touch()
            bridge = Path(__file__).with_name('subscription_uci_fixture.py')
            source = "import {md5} from 'digest'; import {popen} from 'fs';\n"
            source += 'const root=' + json.dumps(str(root)) + ',bridge=' + json.dumps(str(bridge)) + ';\n'
            source += h[h.index('export function shellQuote'):h.index('export function isBinary')].replace('export function', 'function')
            source += 'const payload=' + json.dumps(payload) + ',subscription_urls=' + json.dumps(urls or [URL]) + ';\n'
            source += '''function rpc(...args) {
 const fd=popen('python3 '+shellQuote(bridge)+' '+shellQuote(root)+' '+shellQuote(sprintf('%J',args)), 'r');
 const text=fd.read('all'); if(fd.close()!==0) die(text); return json(text);
}
const uci={foreach:function(c,t,fn){for(let n in rpc('all')) if(n['.type']===t) fn(n);},
 get:(...a)=>rpc('get',...a),get_first:(...a)=>rpc('get_first',...a),
 set:(...a)=>rpc('set',...a),delete:(...a)=>rpc('delete',...a),
 changes:(...a)=>rpc('changes',...a),commit:(...a)=>rpc('commit',...a)};
const node_cache={},node_config_cache={},node_result=[],reconcile_group={};
const user_agent='fixture',update_proxy=null,allow_insecure='0',packet_encoding='xudp',resources_updated=false;
const uciconfig='homeproxy',ucinode='node',ucimain='config';
const filter_mode='disabled',filter_keywords=[];
function wGET(url){return type(payload)==='object' ? payload[url] : payload;}
function reload_service(){warn('RELOAD\\n');return true;}
function apply_updated_resources(){return true;}
function log_error(...args){warn(sprintf('%J',args)+'\\n');}
'''
            source += h[h.index('export function isEmpty'):h.index('export function hasForceProxyRules')].replace('export function', 'function')
            source += PREAMBLE[PREAMBLE.index('function validation'):].replace('function log(...args) {}', "function log(...args) {warn(join(' ',args)+'\\n');}")
            source += h[h.index('export function decodeBase64Str'):h.index('/* String parser end */')].replace('export function', 'function')
            source += s[s.index('const invalid_filter_patterns'):s.index('/* String helper end */')]
            source += s[s.index('function has_value'):]
            script = root / 'main.uc'
            script.write_text(source)
            command = ['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/opt/test-tools/ucode/build')]
            result = subprocess.run(command + [str(script)], capture_output=True, text=True, timeout=60)
            (root / 'stderr.log').write_text(result.stderr)
            self.assertTrue((root / 'calls.jsonl').exists(), result.stderr)
            calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
            after = (root / 'config/homeproxy').read_text()
            # Read only committed state, not CLI adapter's uncommitted private deltas.
            saved = root / 'saved/homeproxy'
            if saved.exists():
                (root / 'pending.uci').write_bytes(saved.read_bytes())
                saved.unlink()
            from subscription_uci_fixture import bridge as read_uci
            committed = read_uci(root, ['all'])
            self.assertIsInstance(committed, list)
            sections = {n['.name']: n for n in committed}
            render = h[h.index('export function strToBool'):h.index('export function validateHostname')].replace('export function', 'function')
            render = PREAMBLE[:PREAMBLE.index('function validation')] + render
            render += 'print(sprintf("%J",map(' + json.dumps(list(sections.values())) + ',(n)=>removeBlankAttrs(renderOutbound(n)))));'
            (root / 'render.uc').write_text(render)
            rendered = subprocess.run(command + [str(root / 'render.uc')], capture_output=True, text=True, timeout=10)
            self.assertEqual(rendered.returncode, 0, rendered.stderr)
            (root / 'rendered.json').write_text(rendered.stdout)
            evidence = os.environ.get('SUBSCRIPTION_EVIDENCE_DIR')
            if evidence:
                import shutil
                target = Path(evidence) / self._testMethodName / root.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(root, target)
            return {'result': result, 'before': original, 'after': after, 'calls': calls,
                    'sections': sections, 'rendered': json.loads(rendered.stdout)}

    def test_partial_renames_reuse_connection_and_preserve_references(self):
        original = "config config 'config'\n option main_node 'nil'\n"
        # Both unrelated connections must survive a malformed sibling response.
        seed = self.run_native(GOOD + BAD + '    password: old-secret\n', original=original)
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        old_id = hashlib.md5((GROUP + ':old-unparsed').encode()).hexdigest()
        original = seed['after'].replace("option main_node 'nil'",
            f"option main_node '{good_id}'\n list main_urltest_nodes '{good_id}'\n list main_urltest_nodes '{old_id}'")
        counts, sizes, payload = [], [], ''
        for generation in range(6):
            payload = GOOD.replace('name: good', f'name: renamed-{generation}') + BAD
            state = self.run_native(payload, original=original)
            self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
            nodes = {key: node for key, node in state['sections'].items() if node.get('grouphash') == GROUP}
            counts.append(len(nodes))
            sizes.append(len(state['after'].encode()))
            self.assertEqual(set(nodes), {good_id, old_id}, state['result'].stderr)
            self.assertEqual(nodes[good_id]['label'], f'renamed-{generation}')
            self.assertEqual(nodes[old_id]['password'], 'old-secret')
            config = state['sections']['config']
            self.assertEqual(config['main_node'], good_id)
            self.assertEqual(config['main_urltest_nodes'], [good_id, old_id])
            self.assertIn('0 added, 1 updated, 0 removed.', state['result'].stderr)
            original = state['after']
        self.assertEqual(counts, [2] * 6)
        self.assertEqual(len(set(sizes)), 1)
        repeated = self.run_native(payload, original=original)
        self.assertEqual(repeated['result'].returncode, 0, repeated['result'].stderr)
        self.assertEqual(repeated['after'], original)
        self.assertFalse(any(call[0] in ('set', 'delete', 'commit') for call in repeated['calls']))

    def test_old_raw_label_returning_cannot_steal_reused_selected_id(self):
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        renamed = GOOD.replace('name: good', 'name: renamed')
        unrelated = GOOD.replace('good.example', 'unrelated.example')
        for main in (good_id, 'urltest'):
            for reverse in (False, True):
                with self.subTest(main=main, reverse=reverse):
                    original = f"config config 'config'\n option main_node '{main}'\n list main_urltest_nodes '{good_id}'\n"
                    seed = self.run_native(GOOD + BAD + '    password: unseen-secret\n', original=original)
                    self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
                    state = self.run_native(renamed + BAD, original=seed['after'])
                    self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
                    old_id = hashlib.md5((GROUP + ':old-unparsed').encode()).hexdigest()
                    entries = [unrelated.split('proxies:\n')[1], renamed.split('proxies:\n')[1]]
                    payload = 'proxies:\n' + ''.join(reversed(entries) if reverse else entries) + BAD
                    original = state['after']
                    for generation in range(3):
                        state = self.run_native(payload, original=original)
                        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
                        nodes = {key: node for key, node in state['sections'].items() if node.get('grouphash') == GROUP}
                        self.assertEqual(len(nodes), 3)
                        self.assertEqual(nodes[good_id]['address'], 'good.example')
                        self.assertEqual(nodes[good_id]['label'], 'renamed')
                        self.assertEqual(nodes[old_id]['password'], 'unseen-secret')
                        self.assertEqual(state['sections']['config']['main_node'], main)
                        self.assertEqual(state['sections']['config']['main_urltest_nodes'], good_id)
                        self.assertEqual(sum(n['address'] == 'unrelated.example' for n in nodes.values()), 1)
                        outbound = next(n for n in state['rendered'] if n.get('tag') == f'cfg-{good_id}-out')
                        self.assertEqual(outbound['server'], 'good.example')
                        if generation:
                            self.assertEqual(state['after'], original)
                            self.assertFalse(any(call[0] in ('set', 'delete', 'commit') for call in state['calls']))
                        original = state['after']

    def test_reused_raw_label_survives_unique_display_and_connection_updates(self):
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        old_id = hashlib.md5((GROUP + ':old-unparsed').encode()).hexdigest()
        other_url = 'https://fixture.invalid/other'
        other_group = hashlib.md5(other_url.encode()).hexdigest()
        for raw_label, cross_group in (('direct-out', False), ('direct-out', True), ('shared', True)):
            for main in (good_id, 'urltest'):
                with self.subTest(raw_label=raw_label, main=main, cross_group=cross_group):
                    other = GOOD.replace('name: good', f'name: {raw_label}').replace('good.example', 'other.example')
                    original = f"config config 'config'\n option main_node '{main}'\n list main_urltest_nodes '{good_id}'\n"
                    urls = [URL, other_url]
                    seed = self.run_native({URL: GOOD + BAD + '    password: unseen-secret\n',
                                           other_url: other if cross_group else None},
                                           original=original, urls=urls)
                    self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
                    renamed = GOOD.replace('name: good', f'name: {raw_label}')
                    state = self.run_native({URL: renamed + BAD, other_url: None}, original=seed['after'], urls=urls)
                    self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
                    self.assertNotEqual(state['sections'][good_id]['label'], raw_label)
                    if not cross_group:
                        self.assertEqual(state['sections'][good_id]['label'], 'direct-out (2)')
                    other_nodes = {key: n for key, n in state['sections'].items() if n.get('grouphash') == other_group}
                    initial_count = len(state['sections'])
                    updated = renamed.replace('password: secret\n',
                        'password: changed\n    network: ws\n    ws-opts: {path: /new}\n    sni: new.example\n    skip-cert-verify: true\n')
                    original = state['after']
                    for generation, payload in enumerate((updated + BAD, updated + BAD,
                            renamed.replace('password: secret', 'password: final') + BAD,
                            renamed.replace('password: secret', 'password: final') + BAD)):
                        state = self.run_native({URL: payload, other_url: None}, original=original, urls=urls)
                        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
                        self.assertEqual(len(state['sections']), initial_count)
                        expected_password = 'changed' if payload == updated + BAD else 'final'
                        node = state['sections'][good_id]
                        self.assertEqual(node['subscription_source_label'], raw_label)
                        self.assertEqual(node['password'], expected_password)
                        self.assertEqual(state['sections']['config']['main_node'], main)
                        self.assertEqual(state['sections']['config']['main_urltest_nodes'], good_id)
                        self.assertEqual(state['sections'][old_id]['password'], 'unseen-secret')
                        self.assertEqual({key: n for key, n in state['sections'].items() if n.get('grouphash') == other_group}, other_nodes)
                        outbound = next(n for n in state['rendered'] if n.get('tag') == f'cfg-{good_id}-out')
                        self.assertEqual(outbound['password'], expected_password)
                        self.assertNotIn('subscription_source_label', json.dumps(outbound))
                        if expected_password == 'changed':
                            self.assertEqual(node['ws_path'], '/new')
                            self.assertEqual(node['tls_sni'], 'new.example')
                            self.assertEqual(node['tls_insecure'], '1')
                            self.assertEqual(outbound['transport']['path'], '/new')
                        else:
                            for key in ('transport', 'ws_path', 'tls_sni', 'tls_insecure'):
                                self.assertNotIn(key, node)
                            self.assertNotIn('transport', outbound)
                            self.assertNotIn('server_name', outbound['tls'])
                            self.assertNotIn('insecure', outbound['tls'])
                        if generation in (1, 3):
                            self.assertEqual(state['after'], original)
                            self.assertFalse(any(call[0] in ('set', 'delete', 'commit') for call in state['calls']))
                        original = state['after']
                    full = self.run_native({URL: GOOD.replace('name: good', 'name: complete'), other_url: None},
                                           original=original, urls=urls)
                    self.assertEqual(full['result'].returncode, 0, full['result'].stderr)
                    self.assertNotIn(old_id, full['sections'])
                    self.assertNotIn(good_id, full['sections'])
                    self.assertEqual({key: n for key, n in full['sections'].items() if n.get('grouphash') == other_group}, other_nodes)

    def test_reused_renamed_node_still_cleans_optional_fields(self):
        seed = self.run_native(WS, original="config config 'config'\n option main_node 'nil'\n")
        renamed = WS.replace('name: keep', 'name: renamed')
        state = self.run_native(renamed + BAD, original=seed['after'])
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        self.assertIn(NODE, state['sections'])
        # A later refresh changes options but not the new label. Existing label
        # identity must still find the section whose ID predates the rename.
        original = state['after'].replace("option transport 'ws'",
            "option transport 'ws'\n option ws_path '/old'\n option tls_sni 'old.example'\n option tls_insecure '1'")
        updated = self.run_native(renamed + BAD, original=original)
        self.assertEqual(updated['result'].returncode, 0, updated['result'].stderr)
        self.assertEqual(set(updated['sections']), {'config', NODE})
        for key in ('ws_path', 'tls_sni', 'tls_insecure'):
            self.assertNotIn(key, updated['sections'][NODE])
        outbound = next(n for n in updated['rendered'] if n.get('password') == 'new')
        self.assertNotIn('path', outbound['transport'])
        self.assertNotIn('server_name', outbound['tls'])
        self.assertNotIn('insecure', outbound['tls'])
        self.assertIn('0 added, 1 updated, 0 removed.', updated['result'].stderr)

    def test_connection_identity_normalizes_singleton_lists(self):
        payload = GOOD.replace('    password: secret\n', '    password: secret\n    alpn: [h2]\n')
        seed = self.run_native(payload, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        state = self.run_native(payload.replace('name: good', 'name: renamed') + BAD, original=seed['after'])
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        self.assertEqual(set(state['sections']), {'config', good_id})
        self.assertEqual(state['sections'][good_id]['tls_alpn'], 'h2')
        repeated = self.run_native(payload.replace('name: good', 'name: renamed') + BAD,
                                   original=state['after'])
        self.assertEqual(repeated['result'].returncode, 0, repeated['result'].stderr)
        self.assertEqual(repeated['after'], state['after'])
        self.assertFalse(any(call[0] in ('set', 'delete', 'commit') for call in repeated['calls']))

    def test_partial_rename_preserves_active_urltest_selection(self):
        seed = self.run_native(GOOD, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        original = seed['after'].replace("option main_node 'nil'",
            f"option main_node 'urltest'\n list main_urltest_nodes '{good_id}'")
        state = self.run_native(GOOD.replace('name: good', 'name: renamed') + BAD, original=original)
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        self.assertEqual(state['sections']['config']['main_node'], 'urltest')
        self.assertEqual(state['sections']['config']['main_urltest_nodes'], good_id)
        self.assertEqual(set(state['sections']), {'config', good_id})

    def test_unrelated_valid_partial_node_adds_without_pruning_old_connection(self):
        seed = self.run_native(GOOD, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        payload = GOOD.replace('name: good', 'name: unrelated').replace('good.example', 'unrelated.example') + BAD
        state = self.run_native(payload, original=seed['after'])
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        unrelated_id = hashlib.md5((GROUP + ':unrelated').encode()).hexdigest()
        self.assertEqual(set(state['sections']), {'config', good_id, unrelated_id})
        self.assertEqual(state['sections'][good_id]['address'], 'good.example')
        self.assertEqual(state['sections'][unrelated_id]['address'], 'unrelated.example')
        self.assertIn('1 added, 0 updated, 0 removed.', state['result'].stderr)

    def test_partial_rename_does_not_merge_ambiguous_existing_connections(self):
        seed = self.run_native(GOOD, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        # Two existing IDs may intentionally represent the same connection.
        twin = '\nconfig node \'twin\'\n' + ''.join(
            f" option {key} '{value}'\n" for key, value in seed['sections'][good_id].items()
            if not key.startswith('.') and key != 'label') + " option label 'twin'\n"
        original = seed['after'] + twin
        payload = GOOD.replace('name: good', 'name: renamed') + BAD
        state = self.run_native(payload, original=original)
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        new_id = hashlib.md5((GROUP + ':renamed').encode()).hexdigest()
        self.assertEqual(set(state['sections']), {'config', good_id, 'twin', new_id})
        self.assertEqual(state['sections'][good_id]['label'], 'good')
        self.assertEqual(state['sections']['twin']['label'], 'twin')
        self.assertIn('1 added, 0 updated, 0 removed.', state['result'].stderr)
        repeated = self.run_native(payload, original=state['after'])
        self.assertEqual(repeated['result'].returncode, 0, repeated['result'].stderr)
        self.assertEqual(repeated['after'], state['after'])
        self.assertFalse(any(call[0] in ('set', 'delete', 'commit') for call in repeated['calls']))

    def test_partial_rename_does_not_merge_ambiguous_incoming_connections(self):
        # SIP008's numeric versus string port hashes differ in the existing
        # parser deduplication, but normalize to the same persisted connection.
        node = dict(remarks='old', server='proxy.example', server_port=443,
                    method='aes-128-gcm', password='secret')
        seed = self.run_native(json.dumps([node]), original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        old_id = hashlib.md5((GROUP + ':old').encode()).hexdigest()
        payload = json.dumps([dict(node, remarks='first'),
                              dict(node, remarks='second', server_port='443'),
                              dict(node, remarks='invalid', server_port=0)])
        state = self.run_native(payload, original=seed['after'])
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        self.assertEqual(len([n for n in state['sections'].values() if n.get('grouphash') == GROUP]), 3)
        self.assertEqual(state['sections'][old_id]['label'], 'old')
        self.assertIn('2 added, 0 updated, 0 removed.', state['result'].stderr)
        repeated = self.run_native(payload, original=state['after'])
        self.assertEqual(repeated['result'].returncode, 0, repeated['result'].stderr)
        self.assertEqual(repeated['after'], state['after'])
        self.assertFalse(any(call[0] in ('set', 'delete', 'commit') for call in repeated['calls']))

    def test_partial_rename_duplicate_input_matches_once(self):
        payload = GOOD.replace('name: good', 'name: renamed')
        seed = self.run_native(GOOD, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        state = self.run_native(payload + payload.split('proxies:\n')[1] + BAD,
                                original=seed['after'], urls=[URL, URL + '#alias'])
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        self.assertEqual(set(state['sections']), {'config', good_id})
        self.assertEqual(state['sections'][good_id]['label'], 'renamed')
        self.assertIn('0 added, 1 updated, 0 removed.', state['result'].stderr)

    def test_partial_matching_never_uses_manual_other_group_or_different_options(self):
        seed = self.run_native(GOOD, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        other_url = 'https://fixture.invalid/other'
        other_group = hashlib.md5(other_url.encode()).hexdigest()
        originals = [
            seed['after'].replace(f"option grouphash '{GROUP}'", ''),
            seed['after'].replace(f"option grouphash '{GROUP}'", f"option grouphash '{other_group}'"),
            seed['after'].replace("option password 'secret'", "option password 'different'"),
            seed['after'].replace("option tls '1'", "option tls '0'"),
        ]
        for original in originals:
            with self.subTest(original=original):
                state = self.run_native({URL: GOOD.replace('name: good', 'name: renamed') + BAD,
                                         other_url: None}, original=original, urls=[URL, other_url])
                self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
                self.assertEqual(state['sections'][good_id]['label'], 'good')
                self.assertEqual(len([n for n in state['sections'].values() if n.get('.type') == 'node']), 2)

    def test_complete_rename_keeps_existing_removal_policy(self):
        seed = self.run_native(GOOD, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(seed['result'].returncode, 0, seed['result'].stderr)
        good_id = hashlib.md5((GROUP + ':good').encode()).hexdigest()
        new_id = hashlib.md5((GROUP + ':renamed').encode()).hexdigest()
        state = self.run_native(GOOD.replace('name: good', 'name: renamed'), original=seed['after'])
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        self.assertNotIn(good_id, state['sections'])
        self.assertEqual(set(state['sections']), {'config', new_id})
        self.assertIn('1 added, 0 updated, 1 removed.', state['result'].stderr)

    def test_new_node_omits_nulls_and_duplicate_input_is_noop(self):
        state = self.run_native(WS, original="config config 'config'\n option main_node 'nil'\n")
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        self.assertEqual(state['sections'][NODE]['password'], 'new')
        self.assertFalse(any(call[0] == 'set' and call[-1] is None for call in state['calls']))
        repeated = self.run_native(WS + WS.split('proxies:\n')[1], original=state['after'], urls=[URL, URL + '#alias'])
        self.assertEqual(repeated['result'].returncode, 0, repeated['result'].stderr)
        self.assertEqual(repeated['after'], state['after'])
        self.assertFalse(any(call[0] in ('set', 'delete', 'commit') for call in repeated['calls']))

    def test_all_invalid_native_preserves_committed_bytes(self):
        state = self.run_native('proxies:\n' + BAD)
        self.assertEqual(state['result'].returncode, 1, state['result'].stderr)
        self.assertEqual(state['after'], state['before'])
        self.assertEqual(state['calls'], [])

    def test_failed_creation_never_deletes_existing_section(self):
        # The hash may already name a user node; a failed create must not clean
        # it up as if it were newly allocated by this invocation.
        original = f"config config 'config'\n option main_node 'nil'\nconfig node '{NODE}'\n option label 'manual'\n"
        state = self.run_native(WS, original=original, fault=('set', 'homeproxy', NODE, 'node'))
        self.assertEqual(state['result'].returncode, 1, state['result'].stderr)
        self.assertEqual(state['after'], original)
        self.assertFalse(any(call[0] in ('delete', 'commit') for call in state['calls']))

    def test_write_failures_abort_without_commit_or_success(self):
        cases = [
            ('update', WS, ('set', 'homeproxy', NODE, 'password'), ''),
            ('optional-delete', WS, ('delete', 'homeproxy', NODE, 'ws_path'), ''),
            ('section-delete', TCP, ('delete', 'homeproxy', 'removed'), "config node 'removed'\n option grouphash 'removed'\n"),
            ('create', GOOD, ('set', 'homeproxy', hashlib.md5((GROUP + ':good').encode()).hexdigest(), 'node'), ''),
            ('new-option', GOOD, ('set', 'homeproxy', hashlib.md5((GROUP + ':good').encode()).hexdigest(), 'password'), ''),
            ('label-helper', WS, ('set', 'homeproxy', 'manual', 'label'), "config node 'manual'\n"),
            ('urltest-helper', WS, ('delete', 'homeproxy', 'config', 'main_urltest_nodes'), ''),
            ('fallback-helper', WS, ('set', 'homeproxy', 'config', 'main_node'), ''),
            ('commit', WS, ('commit', 'homeproxy'), ''),
        ]
        for name, payload, fault, extra in cases:
            with self.subTest(fault=name):
                if name == 'urltest-helper':
                    extra = "config config 'config'\n option main_node 'nil'\n list main_urltest_nodes 'missing'\n"
                if name == 'fallback-helper':
                    extra = "config config 'config'\n option main_node 'missing'\n"
                state = self.run_native(payload, fault=fault, extra=extra)
                self.assertEqual(state['result'].returncode, 1, state['result'].stderr)
                self.assertEqual(state['after'], state['before'])
                self.assertEqual(sum(call[0] == 'commit' for call in state['calls']), int(name == 'commit'))
                self.assertNotIn('Successfully updated subscriptions.', state['result'].stderr)
                self.assertNotIn('RELOAD', state['result'].stderr)

    def test_partial_matches_replace_transport_but_keep_unmatched(self):
        extra = f"config node 'unmatched'\n option label 'unmatched'\n option grouphash '{GROUP}'\nconfig node 'manual'\n option label 'manual'\n"
        for partial in (False, True):
            with self.subTest(partial=partial):
                state = self.run_native(TCP + (BAD if partial else ''), extra=extra)
                self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
                self.assertNotIn('transport', state['sections'][NODE])
                self.assertNotIn('ws_path', state['sections'][NODE])
                self.assertEqual('unmatched' in state['sections'], partial)
                self.assertEqual(state['sections']['manual']['label'], 'manual')
                outbound = next(n for n in state['rendered'] if n.get('password') == 'new')
                self.assertNotIn('transport', outbound)
                self.assertIn('0 added, 1 updated', state['result'].stderr)

    def test_optional_null_removes_old_uci_and_outbound_fields(self):
        state = self.run_native(WS)
        self.assertEqual(state['result'].returncode, 0, state['result'].stderr)
        node = state['sections'][NODE]
        for key in ('ws_path', 'tls_sni', 'tls_insecure'):
            self.assertNotIn(key, node)
        self.assertEqual(node['password'], 'new')
        outbound = next(n for n in state['rendered'] if n.get('password') == 'new')
        self.assertEqual(outbound['transport']['type'], 'ws')
        self.assertNotIn('path', outbound['transport'])
        self.assertNotIn('server_name', outbound['tls'])
        self.assertNotIn('insecure', outbound['tls'])


if __name__ == '__main__':
    unittest.main()
