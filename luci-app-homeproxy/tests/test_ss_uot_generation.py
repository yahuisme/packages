import unittest
from pathlib import Path

class ShadowsocksUotGeneration(unittest.TestCase):
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
