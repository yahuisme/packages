import unittest
from client_generator_fixture import ClientGenerator
import test_subscription_parsing as subscriptions


class AnyTlsGeneration(unittest.TestCase):
    def test_anytls_utls_defaults_disable_and_capability_survive_generation(self):
        parser = subscriptions.SubscriptionParsing()
        for source in ('uri', 'mihomo', 'manual'):
            for fingerprint in (None, 'none', 'disable', 'disabled', 'firefox'):
                for capability in (False, True):
                    with self.subTest(source=source, fingerprint=fingerprint, capability=capability), ClientGenerator() as f:
                        if source == 'uri':
                            query = '' if fingerprint is None else '?fp=' + fingerprint
                            node = parser.parse('parse_uri("anytls://secret@example.com:443' + query + '")', with_utls=capability)
                        elif source == 'mihomo':
                            import json
                            proxy = dict(type='anytls', name='test', server='example.com', port=443, password='secret')
                            if fingerprint is not None:
                                proxy['client-fingerprint'] = fingerprint
                            node = parser.parse('parse_mihomo_proxy(' + json.dumps(proxy) + ')', with_utls=capability)
                        else:
                            node = dict(type='anytls', address='example.com', port='443', password='secret', tls='1')
                            if fingerprint is not None and capability:
                                node['tls_utls'] = '' if fingerprint in ('none', 'disable', 'disabled') else fingerprint
                        f.sections['node1'].update(node)
                        outbound = next(o for o in f.generate()['outbounds'] if o['type'] == 'anytls')
                        expected = (fingerprint or 'chrome') if capability and source != 'manual' else (fingerprint if capability else None)
                        if expected and expected not in ('none', 'disable', 'disabled'):
                            self.assertEqual(outbound['tls']['utls'], {'enabled': True, 'fingerprint': expected})
                        else:
                            self.assertNotIn('utls', outbound['tls'])

if __name__ == '__main__':
    unittest.main()
