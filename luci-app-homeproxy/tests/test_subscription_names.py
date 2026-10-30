"""Group display names must not change subscription fetch or node identities."""
import unittest
from urllib.parse import quote
import test_subscription_reconcile as fixture


class SubscriptionNames(unittest.TestCase):
    def test_rename_keeps_committed_nodes_and_selections(self):
        helper = fixture.NativeSubscription()
        original = f"""config config 'config'
 option main_node '{fixture.NODE}'
 list main_urltest_nodes '{fixture.NODE}'
config node '{fixture.NODE}'
 option label 'keep'
 option grouphash '{fixture.GROUP}'
 option type 'trojan'
 option address 'proxy.example'
 option port '443'
 option password 'new'
 option tls '1'
config domain_route 'route_selected'
 option enabled '1'
 option node '{fixture.NODE}'
"""
        for name in ('自建香港', '改名 🚀 # % <b>仅文本</b>', ''):
            with self.subTest(name=name):
                url = fixture.URL + ('#' + quote(name, safe='') if name else '')
                # The private downloader returns data only for the original URL.
                result = helper.run_native({fixture.URL: fixture.TCP}, original=original, urls=[url])
                self.assertEqual(result['result'].returncode, 0, result['result'].stderr)
                nodes = {key: value for key, value in result['sections'].items() if value.get('.type') == 'node'}
                self.assertEqual(set(nodes), {fixture.NODE})
                self.assertEqual(nodes[fixture.NODE]['grouphash'], fixture.GROUP)
                self.assertEqual(result['sections']['config']['main_node'], fixture.NODE)
                self.assertEqual(result['sections']['config']['main_urltest_nodes'], fixture.NODE)
                self.assertEqual(result['sections']['route_selected']['node'], fixture.NODE)
                original = result['after']


if __name__ == '__main__':
    unittest.main()
