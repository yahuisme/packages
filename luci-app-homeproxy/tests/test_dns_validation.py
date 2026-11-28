import json
import subprocess
import unittest
from client_generator_fixture import APP, ClientGenerator

class DnsValidation(unittest.TestCase):
    def test_persisted_dns_urls_fail_closed_before_publication(self):
        for field in ('dns_server', 'china_dns_server'):
            for value in ('ftp://dns.example.com', 'https://user:secret@dns.example.com/dns-query',
                          'udp://@1.1.1.1', 'https://dns.example.com/dns-query#fragment',
                          'tcp://1.1.1.1/path', 'tls://dns.example.com?ignored=yes'):
                with self.subTest(field=field, value=value), ClientGenerator() as f:
                    f.sections['config'][field] = value
                    with self.assertRaisesRegex(AssertionError, 'Invalid DNS server address'):
                        f.generate()
                    self.assertFalse((f.run / 'sing-box-c.json.new').exists())

    def test_supported_transports_generate(self):
        for scheme in ('udp','tcp','tls','quic','https','h3'):
            with self.subTest(scheme=scheme), ClientGenerator() as f:
                f.sections['config']['dns_server'] = scheme + '://1.1.1.1' + ('/dns-query' if scheme in ('https','h3') else '')
                config = f.generate()
                self.assertTrue(any(s['type'] == scheme for s in config['dns']['servers']))

    def test_http_dns_preserves_explicit_root_without_setting_a_path_for_bare_urls(self):
        for field, tag in (('dns_server', 'main-dns'), ('china_dns_server', 'china-dns')):
            for scheme in ('https', 'h3'):
                for suffix, expected in (('', None), ('/', '/'), ('/resolver', '/resolver')):
                    with self.subTest(field=field, scheme=scheme, suffix=suffix), ClientGenerator() as f:
                        f.sections['config'][field] = f'{scheme}://dns.example.com{suffix}'
                        server = next(s for s in f.generate()['dns']['servers'] if s['tag'] == tag)
                        self.assertEqual(server['type'], scheme)
                        self.assertEqual(server['server'], 'dns.example.com')
                        self.assertEqual(server.get('path'), expected)

    def test_ech_dns_preserves_path_presence_for_client_and_probe(self):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        start = rpc.index('\t\t\t\tconst config = {', rpc.index('const buildProbeRuntime'))
        end = rpc.index('\n\t\t\t\treturn {', start)
        for suffix, expected in (('/resolver', '/resolver'), ('/', '/'), ('', None)):
            with self.subTest(suffix=suffix), ClientGenerator() as f:
                node = f.sections['node1']
                node.update(type='vless', uuid='11111111-1111-4111-8111-111111111111',
                            tls='1', tls_ech='1', tls_sni='ech.example',
                            tls_ech_query_server='https://dns.example.com' + suffix)
                config = f.generate()
                script = f.root / 'probe.uc'
                target = f.root / 'probe.json'
                script.write_text("import {writefile} from 'fs';\n"
                    "import {removeBlankAttrs,renderOutbound,addECHDNS} from " +
                    json.dumps(str(f.root / 'homeproxy.uc')) + ';\n' +
                    'const section=' + json.dumps(node) + ';\n' +
                    'const entries=[{ section, outbound: renderOutbound(section) }], ' +
                    'controller_port=19090, dns_strategy="ipv4_only", config_path=' +
                    json.dumps(str(target)) + ';\n' + rpc[start:end])
                run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=15)
                self.assertEqual(run.returncode, 0, run.stderr)
                for surface, generated in (('client', config), ('probe', json.loads(target.read_text()))):
                    with self.subTest(surface=surface):
                        server = next(s for s in generated['dns']['servers'] if s['tag'].startswith('ech-dns-'))
                        self.assertEqual(server['type'], 'https')
                        self.assertEqual(server['server'], 'dns.example.com')
                        self.assertEqual(server.get('path'), expected)

if __name__ == '__main__':
    unittest.main()
