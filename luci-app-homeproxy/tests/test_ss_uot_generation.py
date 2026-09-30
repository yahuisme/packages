import unittest
from pathlib import Path

from client_generator_fixture import ClientGenerator


class ShadowsocksUotGeneration(unittest.TestCase):
    def test_multiplex_suppresses_stale_uot(self):
        with ClientGenerator() as fixture:
            fixture.sections['node1'].update({
                'type': 'shadowsocks', 'shadowsocks_encrypt_method': 'aes-128-gcm',
                'password': 'fixture-only', 'udp_over_tcp': '1',
                'udp_over_tcp_version': '2', 'multiplex': '1',
            })
            config = fixture.generate()
            outbound = next(o for o in config['outbounds'] if o['type'] == 'shadowsocks')
            self.assertNotIn('udp_over_tcp', outbound)
            self.assertTrue(outbound['multiplex']['enabled'])

    def test_uot_and_multiplex_matrix(self):
        for uot in ('0', '1'):
            for mux in ('0', '1'):
                for version in ('1', '2'):
                    with self.subTest(uot=uot, mux=mux, version=version), ClientGenerator() as fixture:
                        fixture.sections['node1'].update({
                            'type': 'shadowsocks', 'shadowsocks_encrypt_method': 'aes-128-gcm',
                            'password': 'fixture-only', 'udp_over_tcp': uot,
                            'udp_over_tcp_version': version, 'multiplex': mux,
                        })
                        config = fixture.generate()
                        outbound = next(o for o in config['outbounds'] if o['type'] == 'shadowsocks')
                        self.assertEqual('multiplex' in outbound, mux == '1')
                        if uot == '1' and mux == '0':
                            self.assertEqual(outbound['udp_over_tcp'], {'enabled': True, 'version': int(version)})
                        else:
                            self.assertNotIn('udp_over_tcp', outbound)

    def test_shadowsocks_emits_udp_over_tcp_true_and_false(self):
        source = Path(__file__).parents[1] / 'root/etc/homeproxy/scripts/homeproxy.uc'
        text = source.read_text()
        start = text.index("case 'shadowsocks':")
        end = text.index("case 'shadowtls':", start)
        branch = text[start:end]
        self.assertIn("outbound.udp_over_tcp", branch)
        self.assertIn("enabled: true", branch)
        self.assertIn("udp_over_tcp_version", branch)
        self.assertIn(" : null", branch)

if __name__ == '__main__': unittest.main()
