"""Complete updater with native ucode UCI, privately owned confdir/savedir.

Trace wrapper delegates to the actual cursor (including null errors). Download,
validation and service calls are explicit fixtures; no core or network starts.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import test_subscription_parsing as parser_fixture
from test_subscription_efficiency import evidence

BASE = Path(__file__).resolve().parents[1] / 'root/etc/homeproxy/scripts'
URL = 'https://fixture.invalid/sub'
OTHER = 'https://fixture.invalid/other'
FAILED = 'https://fixture.invalid/failed'
EMPTY = "config homeproxy 'config'\n option main_node 'nil'\n"
NODE = dict(remarks='shared', server='proxy.example', server_port=443,
            method='aes-128-gcm', password='secret')


def section_id(url, label):
    return hashlib.md5((hashlib.md5(url.encode()).hexdigest() + ':' + label).encode()).hexdigest()


class NativeSubscriptionEfficiency(unittest.TestCase):
    def run_main(self, payloads, original=EMPTY, *, fault=(), reload_ok=True,
                 native_settings=False):
        helper = (BASE / 'homeproxy.uc').read_text()
        updater = (BASE / 'update_subscriptions.uc').read_text()
        with tempfile.TemporaryDirectory(prefix='native-sub-work-') as directory:
            root = Path(directory)
            for name in ('config', 'saved'):
                (root / name).mkdir()
            config = root / 'config/homeproxy'
            config.write_text(original)
            source = "import {cursor} from 'uci';import {md5} from 'digest';import {writefile} from 'fs';\n"
            source += 'const native=cursor(%s,%s);native.load("homeproxy");\n' % (json.dumps(str(root/'config')), json.dumps(str(root/'saved')))
            source += 'const payloads=' + json.dumps(payloads) + ',fault=' + json.dumps(fault) + ';\n'
            if not native_settings:
                source += 'const subscription_urls=' + json.dumps(list(payloads)) + ';\n'
            source += '''let calls=[];
function invoke(op,args){
 push(calls,[op,...args]);
 let fail=length(fault)>0 && sprintf('%J',slice([op,...args],0,length(fault)))===sprintf('%J',fault);
 if(fail)return null;
 switch(op){
 case 'get':return native.get(...args);
 case 'get_first':return native.get_first(...args);
 case 'set':return native.set(...args);
 case 'delete':return native.delete(...args);
 case 'changes':return native.changes(...args);
 case 'commit':return native.commit(...args);
 }
}
const uci={foreach:(...a)=>native.foreach(...a),get:(...a)=>invoke('get',a),
get_first:(...a)=>invoke('get_first',a),set:(...a)=>invoke('set',a),
delete:(...a)=>invoke('delete',a),changes:(...a)=>invoke('changes',a),commit:(...a)=>invoke('commit',a)};
const node_cache={},node_config_cache={},node_result=[],reconcile_group={};
const update_proxy=null,resources_updated=false;
const uciconfig='homeproxy',ucinode='node',ucimain='config',ucisubscription='subscription';
function wGET(url){push(calls,['fetch',url]);return payloads[url];}
function apply_updated_resources(){warn('RESOURCES\\n');return true;}
function log_error(...a){warn('ERROR '+sprintf('%J',a)+'\\n');}
'''
            if native_settings:
                source += updater[updater.index('const allow_insecure'):updater.index('const resources_updated')]
            else:
                source += "const user_agent='fixture',allow_insecure='0',packet_encoding='xudp',filter_mode='disabled',filter_keywords=[];\n"
            source += 'function reload_service(){warn("RELOAD\\n");return ' + json.dumps(reload_ok) + ';}\n'
            source += helper[helper.index('export function isEmpty'):helper.index('export function strToBool')].replace('export function', 'function')
            source += parser_fixture.PREAMBLE[parser_fixture.PREAMBLE.index('function validation'):].replace('function log(...args) {}', "function log(...args){warn(join(' ',args)+'\\n');}")
            source += helper[helper.index('export function decodeBase64Str'):helper.index('/* String parser end */')].replace('export function', 'function')
            source += updater[updater.index('const invalid_filter_patterns'):updater.index('/* String helper end */')]
            source += updater[updater.index('function has_value'):updater.index('if (!isEmpty(subscription_urls))')]
            source += '''let code=0;
try{let result=call(main);if(result===false)code=1;else if(result===3)code=3;}catch(e){log_error(e);apply_updated_resources();code=1;}
let sections=[];native.foreach('homeproxy','node',(n)=>push(sections,n));
print(sprintf('%J',{ok:code===0,calls,sections,config:native.get_all('homeproxy','config'),node_result,reconcile_group}));
exit(code);'''
            script = root / 'main.uc'
            script.write_text(source)
            run = subprocess.run(['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/opt/test-tools/ucode/build'), str(script)],
                                 text=True, capture_output=True, timeout=20)
            self.assertTrue(run.stdout, run.stderr)
            data = json.loads(run.stdout)
            data.update(before=original, after=config.read_text(), stderr=run.stderr, returncode=run.returncode,
                        source_sha256=hashlib.sha256(source.encode()).hexdigest())
            return data

    def test_native_scalar_and_list_urls_import_and_noop_without_enabling(self):
        complete = json.dumps([NODE])
        states = []
        for syntax in ('option', 'list'):
            with self.subTest(syntax=syntax):
                original = EMPTY + "config homeproxy 'subscription'\n %s subscription_url '%s#Display'\n" % (syntax, URL)
                state = self.run_main({URL: complete}, original, native_settings=True)
                self.assertEqual(state['returncode'], 0, state['stderr'])
                self.assertEqual(len(state['sections']), 1, state['stderr'])
                self.assertEqual(state['sections'][0]['.name'], section_id(URL, 'shared'))
                self.assertEqual(state['config']['main_node'], 'nil')
                self.assertEqual([c for c in state['calls'] if c[0] == 'fetch'], [['fetch', URL]])
                self.assertIn("%s subscription_url '%s#Display'" % (syntax, URL), state['after'])
                repeat = self.run_main({URL: complete}, state['after'], native_settings=True)
                self.assertEqual(repeat['returncode'], 0, repeat['stderr'])
                self.assertEqual(repeat['after'], state['after'])
                self.assertFalse(any(c[0] in ('set', 'delete', 'commit') for c in repeat['calls']))
                self.assertIn('0 added, 0 updated, 0 removed.', repeat['stderr'])
                self.assertIn('Successfully updated subscriptions.', repeat['stderr'])
                states.append(state)
        if len(states) == 2:
            self.assertEqual(states[0]['sections'], states[1]['sections'])

    def test_native_url_list_keeps_order_and_deduplicates_fetches(self):
        original = EMPTY + "config homeproxy 'subscription'\n" + ''.join(
            " list subscription_url '%s'\n" % url for url in (OTHER + '#Other', URL, OTHER + '#Duplicate'))
        state = self.run_main({URL: json.dumps([NODE]), OTHER: json.dumps([NODE])},
                              original, native_settings=True)
        self.assertEqual(state['returncode'], 0, state['stderr'])
        self.assertEqual([c for c in state['calls'] if c[0] == 'fetch'], [['fetch', OTHER], ['fetch', URL]])
        self.assertEqual(len(state['sections']), 2)
        self.assertEqual(state['config']['main_node'], 'nil')

    def test_native_mixed_groups_same_connections_and_names_no_write_repeat(self):
        complete = json.dumps([NODE])
        seed = self.run_main({URL: complete, OTHER: complete, FAILED: complete})
        self.assertEqual(seed['returncode'], 0, seed['stderr'])
        original = seed['after'].replace("option main_node 'nil'", "option main_node 'urltest'\n list main_urltest_nodes '%s'\n list main_urltest_nodes '%s'" % (section_id(OTHER, 'shared'), section_id(FAILED, 'shared')))
        renamed = dict(NODE, remarks='renamed')
        invalid = dict(NODE, remarks='bad', server_port=0)
        results = [seed]
        for reverse in (False, True):
            payloads = {URL: complete, OTHER: json.dumps([renamed, invalid]), FAILED: None}
            if reverse:
                payloads = dict(reversed(list(payloads.items())))
            state = self.run_main(payloads, original)
            self.assertEqual(state['returncode'], 3, state['stderr'])
            self.assertNotIn('Successfully updated subscriptions.', state['stderr'])
            self.assertIn('Failed to fully update subscriptions: 2 subscription(s) failed.', state['stderr'])
            nodes = {n['.name']: n for n in state['sections']}
            self.assertEqual(set(nodes), {section_id(url, 'shared') for url in (URL, OTHER, FAILED)})
            self.assertEqual(nodes[section_id(OTHER, 'shared')]['subscription_source_label'], 'renamed')
            self.assertEqual(nodes[section_id(FAILED, 'shared')]['password'], 'secret')
            self.assertEqual(state['config']['main_node'], 'urltest')
            self.assertEqual(state['config']['main_urltest_nodes'], [section_id(OTHER, 'shared'), section_id(FAILED, 'shared')])
            repeat = self.run_main(payloads, state['after'])
            self.assertEqual(repeat['returncode'], 1, repeat['stderr'])
            self.assertNotIn('Successfully updated subscriptions.', repeat['stderr'])
            self.assertIn('Failed to fully update subscriptions: 2 subscription(s) failed.', repeat['stderr'])
            self.assertEqual(repeat['after'], state['after'])
            self.assertFalse(any(c[0] in ('set', 'delete', 'commit') for c in repeat['calls']))
            self.assertIn('0 added, 0 updated, 0 removed.', repeat['stderr'])
            results.extend([state, repeat])
        evidence('native-mixed', results)

    def test_native_mixed_failures_preserve_failed_group_and_commit_valid_group(self):
        complete = json.dumps([NODE])
        seed = self.run_main({URL: complete, FAILED: complete})
        self.assertEqual(seed['returncode'], 0, seed['stderr'])
        for failed_payload in (None, 'not a subscription', '"not a node list"', '42', '{}',
                               json.dumps([dict(NODE, server_port=0)])):
            for reverse in (False, True):
                with self.subTest(payload=failed_payload, reverse=reverse):
                    payloads = {URL: json.dumps([dict(NODE, password='changed')]), FAILED: failed_payload}
                    if reverse:
                        payloads = dict(reversed(list(payloads.items())))
                    state = self.run_main(payloads, seed['after'])
                    nodes = {n['.name']: n for n in state['sections']}
                    self.assertEqual(nodes[section_id(URL, 'shared')]['password'], 'changed')
                    self.assertEqual(nodes[section_id(FAILED, 'shared')],
                                     next(n for n in seed['sections'] if n['.name'] == section_id(FAILED, 'shared')))
                    self.assertIn('RELOAD', state['stderr'])
                    self.assertEqual(state['returncode'], 3, state['stderr'])
                    self.assertIn('Partial subscription update applied; returning partial-failure status 3.', state['stderr'])
                    self.assertIn('Failed to fully update subscriptions: 1 subscription(s) failed.', state['stderr'])
                    self.assertNotIn('Successfully updated subscriptions.', state['stderr'])

    def test_native_partial_exit_three_requires_committed_changes_and_reload_success(self):
        complete = json.dumps([NODE])
        seed = self.run_main({URL: complete, FAILED: complete})
        self.assertEqual(seed['returncode'], 0, seed['stderr'])
        for payloads, reload_ok in (({URL: complete, FAILED: None}, True),
                                   ({URL: None, FAILED: None}, True),
                                   ({URL: json.dumps([dict(NODE, password='changed')]), FAILED: None}, False)):
            with self.subTest(payloads=payloads, reload_ok=reload_ok):
                state = self.run_main(payloads, seed['after'], reload_ok=reload_ok)
                self.assertEqual(state['returncode'], 1, state['stderr'])
                self.assertNotIn('Successfully updated subscriptions.', state['stderr'])
                if reload_ok:
                    self.assertEqual(state['after'], seed['after'])
                    self.assertFalse(any(c[0] in ('set', 'delete', 'commit') for c in state['calls']))

    def test_production_entrypoint_preserves_partial_failure_exit(self):
        updater = (BASE / 'update_subscriptions.uc').read_text()
        tail = updater[updater.index('if (!isEmpty(subscription_urls))'):]
        for body, expected in (('return 3;', 3), ('return false;', 1), ('return;', 0),
                               ('die("fixture failure");', 1)):
            with self.subTest(body=body), tempfile.TemporaryDirectory(prefix='sub-entry-') as directory:
                script = Path(directory) / 'entry.uc'
                script.write_text('const subscription_urls=["fixture"];'
                                  'function isEmpty(v){return !length(v);}'
                                  'function log_error(...args){}'
                                  'function apply_updated_resources(){}'
                                  'function main(){' + body + '}\n' + tail)
                run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
                self.assertEqual(run.returncode, expected, run.stderr)

    def test_native_atomic_reject_write_fault_and_reload_output(self):
        complete = json.dumps([NODE])
        seed = self.run_main({URL: complete, OTHER: complete})
        self.assertEqual(seed['returncode'], 0, seed['stderr'])
        original = seed['after'].replace("option main_node 'nil'", "option main_node '%s'\n list main_urltest_nodes '%s'" % (section_id(URL, 'shared'), section_id(URL, 'shared')))
        changed = dict(NODE, password='changed')
        unknown = dict(NODE, remarks='unknown', server='new.example')
        invalid = dict(NODE, remarks='bad', server_port=0)
        results = [seed]
        for reverse in (False, True):
            payloads = {URL: json.dumps([changed, unknown, invalid]), OTHER: json.dumps([changed])}
            if reverse:
                payloads = dict(reversed(list(payloads.items())))
            state = self.run_main(payloads, original)
            self.assertEqual(state['returncode'], 1)
            self.assertEqual(state['after'], original)
            self.assertFalse(any(c[0] in ('set', 'delete', 'commit') for c in state['calls']))
            self.assertNotIn('RELOAD', state['stderr'])
            self.assertNotIn('Successfully updated subscriptions.', state['stderr'])
            results.append(state)
        for fault in [('set', 'homeproxy', section_id(URL, 'shared'), 'password'), ('commit', 'homeproxy')]:
            state = self.run_main({URL: json.dumps([changed]), OTHER: complete}, original, fault=fault)
            self.assertEqual(state['returncode'], 1)
            self.assertEqual(state['after'], original)
            self.assertNotIn('RELOAD', state['stderr'])
            self.assertNotIn('Successfully updated subscriptions.', state['stderr'])
            results.append(state)
        # The existing contract commits imported nodes, then reports reload
        # failure (runtime rollback belongs to the unchanged init transaction).
        state = self.run_main({URL: json.dumps([changed]), OTHER: complete}, original, reload_ok=False)
        self.assertEqual(state['returncode'], 1)
        self.assertNotEqual(state['after'], original)
        self.assertIn('RELOAD', state['stderr'])
        self.assertNotIn('Successfully updated subscriptions.', state['stderr'])
        results.append(state)
        evidence('native-failures', results)

    def test_native_formats_and_main_fallback(self):
        yaml = 'proxies:\n  - {name: shared, type: ss, server: proxy.example, port: 443, cipher: aes-128-gcm, password: secret}\n'
        link = 'ss://' + base64.b64encode(b'aes-128-gcm:secret').decode() + '@proxy.example:443#shared'
        results = []
        for payload in (json.dumps([NODE]), json.dumps({'servers': [NODE]}), yaml,
                        base64.b64encode(yaml.encode()).decode(), base64.b64encode(link.encode()).decode()):
            state = self.run_main({URL: payload}, EMPTY.replace("'nil'", "'missing'"))
            self.assertEqual(state['returncode'], 0, state['stderr'])
            self.assertEqual(state['config']['main_node'], section_id(URL, 'shared'))
            self.assertIn('Main node missing is unavailable; switching to node', state['stderr'])
            self.assertEqual(len(state['sections']), 1)
            self.assertEqual(state['sections'][0]['password'], 'secret')
            results.append(state)
        evidence('native-formats', results)


if __name__ == '__main__':
    unittest.main()
