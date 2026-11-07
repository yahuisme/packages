"""Retained hidden TLS fields must obey their enable switch.

Executes the full production generator with private platform boundaries; no core
or network is started and the retained certificate file is not deleted.
"""
import json
import subprocess
import unittest
from client_generator_fixture import APP, ClientGenerator


class RetainedTLS(unittest.TestCase):
    def test_certificate_path_obeys_switch_without_erasing_retained_value(self):
        for protocol in ('anytls', 'http', 'hysteria', 'hysteria2', 'shadowtls',
                         'trojan', 'tuic', 'vless', 'vmess'):
            for flag in (None, '', '0', '1'):
                with self.subTest(protocol=protocol, flag=flag), ClientGenerator() as fixture:
                    node = fixture.sections['node1']
                    certificate = fixture.hp / 'certs/client_ca.pem'
                    certificate.parent.mkdir()
                    certificate.write_text('RETAINED CERTIFICATE FIXTURE\n')
                    node.update(type=protocol, tls='1', tls_cert_path=str(certificate),
                                password='fixture', uuid='00000000-0000-4000-8000-000000000001')
                    if flag is not None:
                        node['tls_self_sign'] = flag
                    outbound = next(o for o in fixture.generate()['outbounds']
                                    if o.get('server') == node['address'])
                    if flag == '1':
                        self.assertEqual(outbound['tls']['certificate_path'], node['tls_cert_path'])
                    else:
                        self.assertNotIn('certificate_path', outbound['tls'])
                    self.assertEqual(node['tls_cert_path'], str(certificate))
                    self.assertEqual(certificate.read_text(), 'RETAINED CERTIFICATE FIXTURE\n')


    def test_latency_json_obeys_retained_certificate_switch(self):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        start = rpc.index('\t\t\t\tconst config = {', rpc.index('const buildProbeRuntime'))
        end = rpc.index('\n\t\t\t\treturn {', start)
        for flag in ('0', '1'):
            with self.subTest(flag=flag), ClientGenerator() as fixture:
                node = dict(fixture.sections['node1'], **{
                    '.name': 'node1', 'type': 'trojan', 'tls': '1', 'password': 'fixture',
                    'tls_self_sign': flag, 'tls_cert_path': '/retained/client_ca.pem'})
                path = fixture.root / 'latency.json'
                script = fixture.root / 'latency.uc'
                script.write_text("import {writefile} from 'fs'; import {renderOutbound, removeBlankAttrs, addECHDNS, shellQuote} from " +
                    json.dumps(str(fixture.root / 'homeproxy.uc')) + ';\n' +
                    'const nodes=' + json.dumps([node]) +
                    ',entries=map(nodes,(section)=>({endpoint:false,section,outbound:renderOutbound(section)}));\n' +
                    'const controller_port=19090,dns_strategy="ipv4_only",session_dir=' +
                    json.dumps(str(fixture.root)) + ',config_path=' + json.dumps(str(path)) + ';\n' + rpc[start:end])
                result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, '')
                outbound = next(o for o in json.loads(path.read_text())['outbounds'] if o['type'] == 'trojan')
                self.assertEqual('certificate_path' in outbound['tls'], flag == '1')


if __name__ == '__main__':
    unittest.main()
