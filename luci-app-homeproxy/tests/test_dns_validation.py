import unittest
from client_generator_fixture import ClientGenerator

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

if __name__ == '__main__':
    unittest.main()
