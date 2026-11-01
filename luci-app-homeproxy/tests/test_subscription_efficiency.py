"""Source-driven ucode work counts with complete before/after output oracles.

No network/core/services. Optional HP_SUBSCRIPTION_OPT_EVIDENCE retains evidence;
it never changes assertions or test selection. Native UCI cases live separately.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_subscription_parsing import BASE, PREAMBLE


def evidence(name, data):
    directory = os.environ.get('HP_SUBSCRIPTION_OPT_EVIDENCE')
    if directory:
        target = Path(directory) / (name + '.json')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, indent=2, ensure_ascii=False))


class SubscriptionEfficiency(unittest.TestCase):
    def run_ucode(self, name, source):
        with tempfile.TemporaryDirectory(prefix='subscription-work-') as root:
            script = Path(root) / 'probe.uc'
            script.write_text(source)
            result = subprocess.run(['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/opt/test-tools/ucode/build'), str(script)],
                                    capture_output=True, text=True, encoding='latin1', timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        data = json.loads(result.stdout)
        evidence(name, {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'data': data, 'source': source})
        return data

    def test_json_once_preserves_formats_and_fallbacks(self):
        helper = (BASE / 'homeproxy.uc').read_text()
        updater = (BASE / 'update_subscriptions.uc').read_text()
        start = updater.index('\t\t\tlet nodes;')
        end = updater.index('\n\t\t\tlet count =', start)
        current = updater[start:end]
        # The old parse branch is an output oracle, never a performance bypass.
        old = '''let nodes;
try {
 nodes = json(res).servers || json(res);
 if (nodes[0].server && nodes[0].method)
  map(nodes, (_, i) => nodes[i].nodetype = 'sip008');
} catch(e) {
 nodes = parse_mihomo_yaml(res);
 if (isEmpty(nodes)) {
  nodes = decodeBase64Str(res);
  const decoded_nodes = parse_mihomo_yaml(nodes);
  if (!isEmpty(decoded_nodes)) nodes = decoded_nodes;
  else nodes = nodes ? split(trim(replace(nodes, / /g, '_')), '\\n') : [];
 }
}
'''
        yaml = 'proxies:\n  - {name: yaml, type: trojan, server: example.com, port: 443, password: secret}\n'
        sip = {'server': 'example.com', 'server_port': 443, 'method': 'aes-128-gcm', 'password': 'secret'}
        cases = [json.dumps([sip]), json.dumps({'servers': [sip]}), json.dumps({'servers': None}),
                 json.dumps({'servers': False}), '{}', 'null', '[]', 'not-json', yaml,
                 base64.b64encode(yaml.encode()).decode(),
                 base64.b64encode(b'trojan://secret@example.com:443#base64').decode()]
        source = PREAMBLE + helper[helper.index('export function decodeBase64Str'):helper.index('/* String parser end */')].replace('export function', 'function')
        source += updater[updater.index('function has_value'):updater.index('function connection_key')]
        source += '\nlet parses=0; function countedJson(s){parses++;return json(s);}\n'
        for name, body in [('oldParse', old), ('currentParse', current)]:
            source += 'function ' + name + '(res){parses=0;' + body.replace('json(res)', 'countedJson(res)') + ';return {nodes,parses};}\n'
        source += 'let results=[];for(let res in ' + json.dumps(cases) + ')push(results,{input:res,before:oldParse(res),after:currentParse(res)});print(sprintf("%J",results));'
        results = self.run_ucode('json-once', source)
        for row in results:
            with self.subTest(input=row['input']):
                self.assertEqual(row['before']['nodes'], row['after']['nodes'])
                self.assertEqual(row['after']['parses'], 1)
        self.assertEqual(results[0]['before']['parses'], 2)

    def test_cleaner_preserves_values_without_discarded_map_arrays(self):
        helper = (BASE / 'homeproxy.uc').read_text()
        cleaner = helper[helper.index('export function removeBlankAttrs'):helper.index('export function validateHostname')].replace('export function', 'function')
        # Frozen pre-change semantic oracle, including the packet_encoding exception.
        old = '''function original(res) {
 let content;
 if(type(res)==='object') {
  content={}; map(keys(res),(k)=>{
   if(type(res[k]) in ['array','object']) content[k]=original(res[k]);
   else if(res[k]!==null && (res[k]!=='' || (k==='packet_encoding' && res.type in ['vless','vmess']))) content[k]=res[k];
  });
 } else if(type(res)==='array') {
  content=[];map(res,(k)=>{
   if(type(k) in ['array','object']) push(content,original(k));
   else if(k!==null && k!=='') push(content,k);
  });
 } else return res;
 return content;
}
'''
        samples = [None, False, 0, '', {}, [], {'type': 'vless', 'packet_encoding': '',
                   'empty': None, 'array': [None, '', 0, False, {}, [], {'gone': '', 'keep': 'x'}]},
                   {'type': 'vmess', 'packet_encoding': ''}, {'type': 'socks', 'packet_encoding': ''},
                   {'outbounds': [dict(type='socks', tag='n'+str(i), server='192.0.2.1',
                     server_port=1080, tls={'enabled': False, 'server_name': None}, nullfield=None)
                     for i in range(256)]}]
        source = '''let calls=0,slots=0;
function countedMap(a,cb){calls++;slots+=length(a);return map(a,cb);}
''' + old.replace('map(', 'countedMap(') + cleaner.replace('map(', 'countedMap(')
        source += 'let results=[];for(let input in ' + json.dumps(samples) + ''') {
 calls=0;slots=0;const before=original(input),oldCalls=calls,oldSlots=slots;
 calls=0;slots=0;const after=removeBlankAttrs(input);
 push(results,{input,before,after,oldCalls,oldSlots,newCalls:calls,newSlots:slots});
}print(sprintf('%J',results));'''
        results = self.run_ucode('cleaner', source)
        for row in results:
            self.assertEqual(row['before'], row['after'])
            self.assertEqual(row['newCalls'], 0)
            self.assertEqual(row['newSlots'], 0)
        self.assertEqual(results[6]['after']['array'], [0, False, {}, [], {'keep': 'x'}])
        self.assertEqual(results[-1]['oldCalls'], 514)
        self.assertEqual(results[-1]['oldSlots'], 2305)

    def test_complete_index_skip_retains_claims_and_group_local_identity(self):
        updater = (BASE / 'update_subscriptions.uc').read_text()
        common = updater[updater.index('function has_value'):updater.index('function normalize_list')]
        key = updater[updater.index('function connection_key'):updater.index('function main()')]
        phase = updater[updater.index('\tconst existing_ids ='):updater.index('\n\t/* Abort before commit')]
        phase = phase.replace('return false;', 'rejected = true;')
        start = phase.index('\tfor (let node in node_result) {')
        end = phase.index('\n\t/* Current label identity', start)
        old_loop = '''\tfor (let node in node_result) {
 const key=connection_key(node),label_key=node.grouphash+':'+node.label;
 incoming_connections[key]=(incoming_connections[key]||0)+1;
 incoming_labels[label_key]=(incoming_labels[label_key]||0)+1;
 if(reconcile_group[node.grouphash]!==true) node_cache[node.grouphash]={};
 else claimed[node.__section_id]=true;
 }'''
        source = "function isEmpty(v){return v===null || v==='' || (type(v) in ['object','array'] && !length(v));}\n"
        source += common + key.replace('function connection_key(', 'function original_key(')
        source += '''let calls=0; function connection_key(n){calls++;return original_key(n);}
function log(s){} function apply_updated_resources(){}
'''
        for name, body in [('oldPhase', phase[:start] + old_loop + phase[end:]), ('currentPhase', phase)]:
            source += 'function ' + name + '''(scenario) {
 const uciconfig='homeproxy',ucinode='node';let rejected=false;
 const node_result=[],existing=[],node_cache={complete:{}},reconcile_group={complete:true};
 for(let i=0;i<256;i++) {
  const n={grouphash:'complete',label:'N'+i,__section_id:'n'+i,type:'socks',address:'192.0.2.1',port:'1080'};
  push(node_result,n);node_cache.complete[n.__section_id]=n;
 }
 if(scenario!=='complete') {
  reconcile_group.partial=false;node_cache.partial={};
  push(existing,{'.name':'p1',grouphash:'partial',label:'old',type:'socks',address:'192.0.2.1',port:'1080'});
  push(node_result,{grouphash:'partial',label:'renamed',__section_id:'new',type:'socks',address:'192.0.2.1',port:'1080'});
  if(scenario==='claimed') {
   existing[0]['.name']='n0';
  } else if(scenario==='ambiguous') {
   push(existing,{...existing[0],'.name':'p2'});
  } else if(scenario==='label-first') {
   push(node_result,{...node_result[-1],label:'old',address:'192.0.2.99',__section_id:'p1'});
  }
 }
 const uci={foreach:function(c,t,cb){for(let n in existing)cb(n);}};
 calls=0;
''' + body + '''
 return {calls,nodes:node_result,cache:node_cache,claimed,rejected};
}
'''
        source += '''let results=[];
for(let scenario in ['complete','mixed','claimed','ambiguous','label-first'])
 push(results,{scenario,before:oldPhase(scenario),after:currentPhase(scenario)});
const a={grouphash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',label:'same',type:'socks',port:1080};
const b={...a,grouphash:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'};
print(sprintf('%J',{results,crossGroupKeys:[connection_key(a),connection_key(b)]}));'''
        data = self.run_ucode('incoming-index', source)
        self.assertNotEqual(*data['crossGroupKeys'])
        for row in data['results']:
            for field in ('nodes', 'cache', 'claimed', 'rejected'):
                self.assertEqual(row['before'][field], row['after'][field], row['scenario'])
            self.assertEqual(row['before']['calls'] - row['after']['calls'], 256)
        self.assertEqual(data['results'][0]['after']['calls'], 0)
        self.assertEqual(data['results'][1]['after']['nodes'][-1]['__section_id'], 'p1')
        # A complete group's claimed ID cannot be stolen, even by a contrived
        # preexisting partial section with that ID (hash collisions/manual UCI).
        self.assertNotIn('__identity_matched', data['results'][2]['after']['nodes'][-1])
        self.assertEqual(data['results'][4]['after']['nodes'][-1]['__section_id'], 'p1')
        self.assertNotIn('__identity_matched', data['results'][4]['after']['nodes'][-2])

    def test_helper_alone_retains_main_and_urltest_fallbacks(self):
        helper = (BASE / 'homeproxy.uc').read_text()
        updater = (BASE / 'update_subscriptions.uc').read_text()
        definitions = helper[helper.index('export function isEmpty'):helper.index('export function strToBool')].replace('export function', 'function')
        start = updater.index('\treconcileUrltestNodes(writer, uciconfig, (message) => log(message));')
        tail = updater[start:updater.index('\tconst config_changed =', start)]
        old_tail = '''reconcileUrltestNodes(writer,uciconfig,(message)=>log(message));
const current_main_node=uci.get(uciconfig,ucimain,'main_node')||'nil';
if(current_main_node!=='nil' && current_main_node!=='urltest' && uci.get(uciconfig,current_main_node)!==ucinode) {
 const first_server=uci.get_first(uciconfig,ucinode);
 writer.set(uciconfig,ucimain,'main_node',first_server||'nil');
 if(first_server) log('Main node is gone, switching to the first node.');
 else log('No available node, disabling the client.');
}
'''
        source = definitions
        for name, body in [('before', old_tail), ('after', tail)]:
            source += 'function ' + name + '''(input) {
 let state={main_node:input.main,main_urltest_nodes:input.list||[]},calls=[],logs=[],tailReads=0;
 const uciconfig='homeproxy',ucimain='config',ucinode='node';
 const uci={get:function(c,s,o){tailReads++;return o?state[o]:(s in input.nodes?'node':null);},
 get_first:()=>input.nodes[0],set:function(c,s,o,v){push(calls,['set',s,o,v]);state[o]=v;return true;},
 delete:function(c,s,o){push(calls,['delete',s,o]);delete state[o];return true;}};
 const writer={...uci,get:function(...a){return uci.get(...a);}};
 function log(s){push(logs,s);}
 function countedHelper(...a){const result=reconcileUrltestNodes(...a);tailReads=0;return result;}
''' + body.replace('reconcileUrltestNodes(', 'countedHelper(') + '''
 return {state,calls,logs,tailReads};
}
'''
        source += '''let results=[];
for(let input in [{main:'gone',nodes:['n1']},{main:'gone',nodes:[]},
 {main:'urltest',nodes:['n1'],list:['gone']},{main:'urltest',nodes:[],list:['gone']},
 {main:'urltest',nodes:['n1'],list:['n1','gone','n1']},
 {main:'n1',nodes:['n1']},{main:'nil',nodes:['n1']},{main:'same',nodes:['n1']},
 {main:'',nodes:['n1']},{nodes:['n1']}])
 push(results,{input,before:before(input),after:after(input)});
print(sprintf('%J',results));'''
        results = self.run_ucode('fallback', source)
        for row in results:
            for field in ('state', 'calls', 'logs'):
                self.assertEqual(row['before'][field], row['after'][field], row['input'])
            self.assertEqual(row['after']['tailReads'], 0)
        self.assertEqual(results[0]['after']['state']['main_node'], 'n1')
        self.assertEqual(results[1]['after']['state']['main_node'], 'nil')
        self.assertEqual(results[4]['after']['state']['main_urltest_nodes'], ['n1'])


if __name__ == '__main__':
    unittest.main()
