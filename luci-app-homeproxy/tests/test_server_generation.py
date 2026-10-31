"""Complete production server generator; native ucode/fs, private UCI/paths.

Optional SING_BOX_CHECK validates outputs with a verified official core. No
listeners, remote peers, host service or certificate issuance are started.
"""
import json
import os
from pathlib import Path
import subprocess
import unittest

from client_generator_fixture import ClientGenerator, SCRIPTS


class ServerGeneration(unittest.TestCase):
    def test_protocols_and_transports(self):
        with ClientGenerator() as fixture:
            cert, key = fixture.root / 'cert.pem', fixture.root / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-keyout', str(key), '-out', str(cert), '-subj',
                            '/CN=fixture.invalid', '-days', '1'],
                           capture_output=True, check=True, timeout=15)
            protocols = ['anytls', 'http', 'hysteria', 'hysteria2', 'naive', 'mixed',
                         'shadowsocks', 'socks', 'trojan', 'tuic', 'vless', 'vmess']
            cases = [(protocol, '') for protocol in protocols]
            cases += [('vmess', transport) for transport in ['grpc', 'http', 'httpupgrade', 'ws', 'quic']]
            for protocol, transport in cases:
                with self.subTest(protocol=protocol, transport=transport):
                    server = {'.type': 'server', '.name': 'fixture', 'enabled': '1',
                              'type': protocol, 'address': '127.0.0.1', 'port': '15443',
                              'password': 'fixture-password',
                              'uuid': '11111111-1111-4111-8111-111111111111',
                              'hysteria_up_mbps': '20', 'hysteria_down_mbps': '30',
                              'shadowsocks_encrypt_method': 'aes-128-gcm', 'tls': '1',
                              'tls_cert_path': str(cert), 'tls_key_path': str(key),
                              'transport': transport, 'grpc_servicename': 'fixture',
                              'http_path': '/fixture', 'ws_path': '/fixture'}
                    data = {'server': {'.type': 'homeproxy', 'log_level': 'warn'}, 'fixture': server}
                    uci = fixture.root / 'server-uci.uc'
                    uci.write_text('const data=' + json.dumps(data) + ''';
export function cursor() { return {
    load: () => true,
    get: (c, s, o) => o ? data[s]?.[o] : data[s]?.['.type'],
    foreach: (c, t, cb) => { for (let k, v in data) if (v['.type'] === t) cb(v); }
}; };
''')
                    source = (SCRIPTS / 'generate_server.uc').read_text()
                    source = source.replace("from 'uci'", 'from ' + json.dumps(str(uci)))
                    source = source.replace("from 'homeproxy'", 'from ' + json.dumps(str(fixture.root / 'homeproxy.uc')))
                    script = fixture.root / 'server.uc'
                    script.write_text(source)
                    result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stderr, '')
                    target = fixture.run / 'sing-box-s.json.new'
                    config = json.loads(target.read_text())
                    self.assertEqual(len(config['inbounds']), 1)
                    inbound = config['inbounds'][0]
                    self.assertEqual(inbound['type'], protocol)
                    self.assertEqual(inbound['listen_port'], 15443)
                    if transport:
                        self.assertEqual(inbound['transport']['type'], transport)
                    if os.environ.get('SING_BOX_CHECK'):
                        subprocess.run([os.environ['SING_BOX_CHECK'], 'check', '-c', str(target)],
                                       capture_output=True, text=True, check=True, timeout=15)


if __name__ == '__main__':
    unittest.main()
