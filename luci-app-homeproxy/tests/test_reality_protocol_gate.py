"""Retained REALITY is active only for the editor's AnyTLS/VLESS owners.

Native ucode/fs/UCI use private paths. Complete client/server generators and the
production RPC probe-construction block run without a core, service or network.
Assertions inspect actual committed UCI and certificate/key bytes after switches.
"""
import json
import subprocess
import unittest

from client_generator_fixture import ClientGenerator, SCRIPTS
import test_mihomo_bandwidth as bandwidth


OWNERS = ('anytls', 'vless')
CLIENT_TLS = ('anytls', 'http', 'hysteria', 'hysteria2', 'shadowtls',
              'trojan', 'tuic', 'vless', 'vmess')
SERVER_TLS = ('anytls', 'http', 'hysteria', 'hysteria2', 'naive',
              'trojan', 'tuic', 'vless', 'vmess')
RETAINED = dict(tls_reality='1', tls_reality_private_key='retained-private-key',
                tls_reality_public_key='retained-public-key', tls_reality_short_id='1234',
                tls_reality_server_addr='handshake.example', tls_reality_server_port='443',
                tls_reality_max_time_difference='30')


class NativeReality:
    def __enter__(self):
        self.generator = ClientGenerator().__enter__()
        self.root = self.generator.root
        self.conf = self.root / 'config'
        self.saved = self.root / 'saved'
        self.conf.mkdir()
        self.saved.mkdir()
        self.config = self.conf / 'homeproxy'
        self.config.write_text('')
        self.cert = self.root / 'cert.pem'
        self.key = self.root / 'key.pem'
        self.cert.write_text('RETAINED CERTIFICATE FIXTURE\n')
        self.key.write_text('RETAINED PRIVATE KEY FIXTURE\n')
        self.key.chmod(0o600)
        data = self.generator.sections
        for name, section in data.items():
            section['.name'] = name
        data['node1'].update(RETAINED, type='vless', tls='1', password='fixture',
                             uuid='11111111-1111-4111-8111-111111111111',
                             tls_self_sign='1', tls_cert_path=str(self.cert))
        data['server'] = {'.type': 'homeproxy', 'log_level': 'warn'}
        data['listener'] = dict(data['node1'], **{'.type': 'server', '.name': 'listener',
                                                'enabled': '1', 'port': '15443',
                                                'tls_key_path': str(self.key)})
        self.uci('const data=' + json.dumps(data) + ''';
for(let sid,section in data){
 if(!uci.set('homeproxy',sid,section['.type']))die('section write');
 for(let key,value in section)if(substr(key,0,1)!=='.' && !uci.set('homeproxy',sid,key,value))die('option write');
}
if(!uci.commit('homeproxy'))die('seed commit');''')
        self.files = {p: (p.read_bytes(), p.stat().st_mode) for p in (self.cert, self.key)}
        return self

    def __exit__(self, *args):
        self.generator.__exit__(*args)

    def run(self, source):
        script = self.root / 'case.uc'
        script.write_text(source)
        run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=15)
        if run.returncode or run.stderr:
            raise AssertionError(run.stderr)
        return run.stdout

    def uci(self, code):
        return self.run("import {cursor} from 'uci';const uci=cursor(" +
                        json.dumps(str(self.conf)) + ',' + json.dumps(str(self.saved)) +
                        ");if(!uci.load('homeproxy'))die('load');\n" + code)

    def switch(self, protocol, *, tls='1', reality='1', acme='0'):
        self.uci('const updates=' + json.dumps(dict(type=protocol, tls=tls,
                                                   tls_reality=reality, tls_acme=acme)) + ''';
for(let sid in ['node1','listener'])for(let key,value in updates)
 if(!uci.set('homeproxy',sid,key,value))die('switch');
if(!uci.commit('homeproxy'))die('switch commit');''')

    def node(self):
        return json.loads(self.uci("print(sprintf('%J',uci.get_all('homeproxy','node1')));"))

    def generate(self, server=False):
        name = 'generate_server.uc' if server else 'generate_client.uc'
        source = (SCRIPTS / name).read_text()
        source = source.replace("from 'homeproxy'", 'from ' + json.dumps(str(self.root / 'homeproxy.uc')))
        source = source.replace('const uci = cursor();',
                                'const uci = cursor(' + json.dumps(str(self.conf)) + ',' + json.dumps(str(self.saved)) + ');')
        if not server:
            ubus = self.root / 'ubus.uc'
            ubus.write_text("export function connect(){return {call:()=>({interface:[]})};};\n")
            source = source.replace("from 'ubus'", 'from ' + json.dumps(str(ubus)))
        self.run(source)
        target = self.generator.run / ('sing-box-s.json.new' if server else 'sing-box-c.json.new')
        return json.loads(target.read_text())

    def assert_preserved(self, case, before):
        case.assertEqual(self.config.read_bytes(), before)
        case.assertEqual(json.loads(self.uci("print(sprintf('%J',uci.changes('homeproxy')));")), {})
        stored = json.loads(self.uci("print(sprintf('%J',uci.get_all('homeproxy','node1')));"))
        for key, value in RETAINED.items():
            if key != 'tls_reality':
                case.assertEqual(stored[key], value)
        for path, (content, mode) in self.files.items():
            case.assertEqual(path.read_bytes(), content)
            case.assertEqual(path.stat().st_mode, mode)


class RealityProtocolGate(unittest.TestCase):
    def test_server_protocol_switch_ignores_hidden_reality_without_replacing_certificates(self):
        with NativeReality() as fixture:
            # Start/end with an owner, preserving the same native UCI fields.
            for protocol in (*OWNERS, *(p for p in SERVER_TLS if p not in OWNERS), 'mixed', 'socks', 'shadowsocks', 'vless'):
                for tls in ('1', '0'):
                    with self.subTest(protocol=protocol, tls=tls):
                        fixture.switch(protocol, tls=tls)
                        before = fixture.config.read_bytes()
                        inbound = fixture.generate(server=True)['inbounds'][0]
                        if tls == '0' or protocol not in SERVER_TLS:
                            self.assertNotIn('tls', inbound)
                        elif protocol in OWNERS:
                            self.assertTrue(inbound['tls']['reality']['enabled'])
                            self.assertEqual(inbound['tls']['reality']['private_key'], RETAINED['tls_reality_private_key'])
                            self.assertNotIn('certificate_path', inbound['tls'])
                            self.assertNotIn('key_path', inbound['tls'])
                        else:
                            self.assertNotIn('reality', inbound['tls'])
                            self.assertEqual(inbound['tls']['certificate_path'], str(fixture.cert))
                            self.assertEqual(inbound['tls']['key_path'], str(fixture.key))
                        fixture.assert_preserved(self, before)

    def test_client_and_latency_protocol_switch_agree_and_preserve_private_uci(self):
        with NativeReality() as fixture:
            for protocol in (*OWNERS, *(p for p in CLIENT_TLS if p not in OWNERS), 'socks', 'shadowsocks', 'ssh', 'vless'):
                for tls in ('1', '0'):
                    with self.subTest(protocol=protocol, tls=tls):
                        fixture.switch(protocol, tls=tls)
                        before = fixture.config.read_bytes()
                        normal = next(o for o in fixture.generate()['outbounds'] if o.get('server') == '192.0.2.10')
                        probe = next(o for o in bandwidth.latency_config(fixture.generator, [fixture.node()])['outbounds']
                                     if o.get('server') == '192.0.2.10')
                        self.assertEqual(normal.get('tls'), probe.get('tls'))
                        for outbound in (normal, probe):
                            if tls == '0' or protocol not in CLIENT_TLS:
                                self.assertNotIn('tls', outbound)
                            else:
                                self.assertEqual(outbound['tls']['certificate_path'], str(fixture.cert))
                                self.assertEqual('reality' in outbound['tls'], protocol in OWNERS)
                                if protocol in OWNERS:
                                    self.assertEqual(outbound['tls']['reality']['public_key'], RETAINED['tls_reality_public_key'])
                        fixture.assert_preserved(self, before)

    def test_owner_disable_and_acme_priority_stay_explicit(self):
        with NativeReality() as fixture:
            for protocol in OWNERS:
                for acme in ('0', '1'):
                    for reality in ('0', '1'):
                        with self.subTest(protocol=protocol, acme=acme, reality=reality):
                            fixture.switch(protocol, acme=acme, reality=reality)
                            before = fixture.config.read_bytes()
                            tls = fixture.generate(server=True)['inbounds'][0]['tls']
                            self.assertEqual('reality' in tls, reality == '1' and acme == '0')
                            self.assertEqual('certificate_provider' in tls, acme == '1')
                            self.assertEqual('certificate_path' in tls, acme == '0' and reality == '0')
                            self.assertEqual('key_path' in tls, acme == '0' and reality == '0')
                            normal = next(o for o in fixture.generate()['outbounds'] if o.get('server') == '192.0.2.10')
                            probe = next(o for o in bandwidth.latency_config(fixture.generator, [fixture.node()])['outbounds']
                                         if o.get('server') == '192.0.2.10')
                            self.assertEqual(normal['tls'], probe['tls'])
                            self.assertEqual('reality' in normal['tls'], reality == '1')
                            fixture.assert_preserved(self, before)


if __name__ == '__main__':
    unittest.main()
