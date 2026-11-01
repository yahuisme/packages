"""Complete client/server generators and RPC latency config serialization.

Compare the production cleaner with a frozen pre-loop implementation; helper
imports, generator statements and RPC config construction stay source-driven.
Private platform modules/paths only; no core, service or network is invoked.
"""
import json
import subprocess
import unittest

from client_generator_fixture import APP, ClientGenerator, SCRIPTS
from test_subscription_efficiency import evidence

OLD_CLEANER = '''export function removeBlankAttrs(res) {
 let content;
 if(type(res)==='object') {
  content={}; map(keys(res),(k)=>{
   if(type(res[k]) in ['array','object']) content[k]=removeBlankAttrs(res[k]);
   else if(res[k]!==null && (res[k]!=='' || (k==='packet_encoding' && res.type in ['vless','vmess']))) content[k]=res[k];
  });
 } else if(type(res)==='array') {
  content=[];map(res,(k)=>{
   if(type(k) in ['array','object']) push(content,removeBlankAttrs(k));
   else if(k!==null && k!=='') push(content,k);
  });
 } else return res;
 return content;
};
'''


class SubscriptionHelperConsumers(unittest.TestCase):
    def test_complete_generators_and_latency_json_match_legacy_cleaner(self):
        records = []
        with ClientGenerator() as fixture:
            helper_path = fixture.root / 'homeproxy.uc'
            current = helper_path.read_text()
            start = current.index('export function removeBlankAttrs')
            end = current.index('export function validateHostname', start)
            legacy = current[:start] + OLD_CLEANER + current[end:]
            def compare(name, run):
                helper_path.write_text(legacy)
                before = run()
                helper_path.write_text(current)
                after = run()
                self.assertEqual(before, after, name)
                records.append({'consumer': name, 'before': before, 'after': after})

            for protocol in ('socks', 'shadowsocks', 'trojan', 'vless', 'vmess', 'hysteria2', 'tuic'):
                node = fixture.sections['node1']
                node.update(type=protocol, password='fixture-secret', uuid='11111111-1111-4111-8111-111111111111',
                            shadowsocks_encrypt_method='aes-128-gcm', tls='1', packet_encoding='none',
                            transport='ws', ws_path='/fixture', tls_sni='proxy.example')
                compare('client-' + protocol, lambda: (fixture.generate(), (fixture.run / 'sing-box-c.json.new').read_text()))

            server_uci = fixture.root / 'server-uci.uc'
            source = (SCRIPTS / 'generate_server.uc').read_text()
            source = source.replace("from 'uci'", 'from ' + json.dumps(str(server_uci)))
            source = source.replace("from 'homeproxy'", 'from ' + json.dumps(str(helper_path)))
            script = fixture.root / 'server.uc'
            script.write_text(source)
            for protocol in ('anytls', 'http', 'hysteria', 'hysteria2', 'naive', 'mixed', 'shadowsocks', 'socks', 'trojan', 'tuic', 'vless', 'vmess'):
                data = {'server': {'.type': 'homeproxy', 'log_level': 'warn'},
                        'fixture': {'.type': 'server', '.name': 'fixture', 'enabled': '1',
                                    'type': protocol, 'address': '127.0.0.1', 'port': '15443',
                                    'password': 'fixture-secret', 'uuid': '11111111-1111-4111-8111-111111111111',
                                    'shadowsocks_encrypt_method': 'aes-128-gcm', 'tls': '0',
                                    'hysteria_up_mbps': '20', 'hysteria_down_mbps': '30', 'packet_encoding': 'none'}}
                server_uci.write_text('const data=' + json.dumps(data) + ''';
export function cursor(){return {load:()=>true,get:(c,s,o)=>o?data[s]?.[o]:data[s]?.['.type'],
 foreach:function(c,t,cb){for(let k,v in data)if(v['.type']===t)cb(v);}};};''')
                def server():
                    run = subprocess.run(['ucode', str(script)], text=True, capture_output=True, timeout=15)
                    self.assertEqual(run.returncode, 0, run.stderr)
                    self.assertEqual(run.stderr, '')
                    return (fixture.run / 'sing-box-s.json.new').read_text()
                compare('server-' + protocol, server)

            rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
            start = rpc.index('\t\t\t\tconst config = {', rpc.index('const buildProbeRuntime'))
            end = rpc.index('\n\t\t\t\treturn {', start)
            # Execute the actual config construction/entry loop/writefile; path
            # allocation/controller process launching are outside this boundary.
            config_body = rpc[start:end]
            rpc_script = fixture.root / 'latency-config.uc'
            for strategy in ('ipv4_only', 'prefer_ipv6'):
                nodes = [dict(fixture.sections['node1'], **{'.name': 'vless', 'type': 'vless', 'packet_encoding': 'none'}),
                         dict(fixture.sections['node1'], **{'.name': 'trojan', 'type': 'trojan'})]
                rpc_script.write_text("import {writefile} from 'fs';import {removeBlankAttrs,renderOutbound,addECHDNS,shellQuote} from " + json.dumps(str(helper_path)) + ';\n' +
                    'const nodes=' + json.dumps(nodes) + ",entries=map(nodes,(section)=>({endpoint:false,section,outbound:renderOutbound(section)}));\n" +
                    'const controller_port=19090,dns_strategy=' + json.dumps(strategy) + ',session_dir=' + json.dumps(str(fixture.root)) + ',config_path=' + json.dumps(str(fixture.root / 'latency.json')) + ';\n' + config_body)
                def latency():
                    run = subprocess.run(['ucode', str(rpc_script)], text=True, capture_output=True, timeout=15)
                    self.assertEqual(run.returncode, 0, run.stderr)
                    self.assertEqual(run.stderr, '')
                    return (fixture.root / 'latency.json').read_text()
                compare('rpc-latency-' + strategy, latency)
        evidence('consumers', records)


if __name__ == '__main__':
    unittest.main()
