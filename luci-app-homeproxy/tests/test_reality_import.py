"""REALITY import/render boundaries; native ucode, private fixtures, no core."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import test_subscription_parsing as parser_fixture
from test_subscription_parsing import BASE, PREAMBLE


LINK = ('vless://11111111-1111-4111-8111-111111111111@example.com:443'
        '?security=reality&pbk=fixture&sid=1234')


class RealityImport(unittest.TestCase):
    def test_subscription_defaults_only_active_reality_with_capability(self):
        parser = parser_fixture.SubscriptionParsing()
        for suffix in ('', '&fp='):
            with self.subTest(suffix=suffix):
                node = parser.parse('parse_uri(' + json.dumps(LINK + suffix) + ')')
                self.assertEqual(node['tls_utls'], 'chrome')
        proxy = dict(nodetype='mihomo', type='vless', name='reality', server='example.com',
                     port=443, uuid='11111111-1111-4111-8111-111111111111',
                     **{'reality-opts': {'public-key': 'fixture', 'short-id': '1234'}})
        node = parser.parse('parse_uri(' + json.dumps(proxy) + ')')
        self.assertEqual(node['tls_utls'], 'chrome')

    def test_subscription_rejects_disabled_or_unsupported_reality_per_node(self):
        parser = parser_fixture.SubscriptionParsing()
        for fingerprint in ('none', 'disable', 'disabled'):
            with self.subTest(fingerprint=fingerprint):
                self.assertIsNone(parser.parse('parse_uri(' + json.dumps(LINK + '&fp=' + fingerprint) + ')'))
                proxy = dict(nodetype='mihomo', type='vless', name='disabled', server='example.com',
                             port=443, uuid='fixture', **{'client-fingerprint': fingerprint,
                             'reality-opts': {'public-key': 'fixture'}})
                self.assertIsNone(parser.parse('parse_uri(' + json.dumps(proxy) + ')'))
        self.assertIsNone(parser.parse('parse_uri(' + json.dumps(LINK) + ')', with_utls=False))
        self.assertIsNone(parser.parse('parse_uri(' + json.dumps(proxy) + ')', with_utls=False))

    def test_imported_default_and_explicit_fingerprint_survive_complete_generation(self):
        from client_generator_fixture import ClientGenerator
        parser = parser_fixture.SubscriptionParsing()
        for suffix, expected in (('', 'chrome'), ('&fp=firefox', 'firefox')):
            with self.subTest(expected=expected), ClientGenerator() as fixture:
                node = parser.parse('parse_uri(' + json.dumps(LINK + suffix) + ')')
                fixture.sections['node1'].update(node)
                outbound = next(o for o in fixture.generate()['outbounds'] if o.get('server') == 'example.com')
                self.assertEqual(outbound['tls']['utls'], {'enabled': True, 'fingerprint': expected})
                self.assertTrue(outbound['tls']['reality']['enabled'])

    def test_helper_preserves_inactive_settings_and_rejects_only_active_owners(self):
        parser = parser_fixture.SubscriptionParsing()
        for protocol in ('anytls', 'vless', 'trojan', 'vmess', 'http', 'hysteria2', 'socks'):
            for tls, reality in (('0', '1'), ('1', '0'), ('1', '1')):
                node = dict(type=protocol, tls=tls, tls_reality=reality, tls_utls='')
                expression = '''(() => {
const node = %s, before = sprintf('%%J', node);
let value, error;
try { value = realityFingerprint(node, false); } catch (e) { error = e.message; }
return {value, error, preserved: before === sprintf('%%J', node)};
})()''' % json.dumps(node)
                with self.subTest(protocol=protocol, tls=tls, reality=reality):
                    result = parser.parse(expression)
                    self.assertTrue(result['preserved'])
                    if protocol in ('anytls', 'vless') and tls == reality == '1':
                        self.assertIn('uTLS support', result['error'])
                    else:
                        self.assertEqual(result['value'], '')
                        self.assertIsNone(result['error'])

    def test_invalid_reality_keeps_partial_feed_transaction_policy(self):
        import base64
        from test_subscription_reconcile import NativeSubscription
        fixture = NativeSubscription()
        payload = 'trojan://new@proxy.example:443#keep\n' + LINK + '&fp=none#invalid'
        result = fixture.run_native(base64.b64encode(payload.encode()).decode())
        self.assertEqual(result['result'].returncode, 3, result['result'].stderr)
        nodes = [n for n in result['sections'].values() if n.get('.type') == 'node']
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]['password'], 'new')
        self.assertNotIn('tls_reality', nodes[0])
        result = fixture.run_native(base64.b64encode(payload.encode()).decode(),
                                    original="config config 'config'\n option main_node 'nil'\n")
        self.assertNotEqual(result['result'].returncode, 0)
        self.assertEqual(result['before'], result['after'])


class RealityRender(unittest.TestCase):
    def render(self, node):
        helper = (BASE / 'homeproxy.uc').read_text()
        source = PREAMBLE[:PREAMBLE.index('function validation')]
        source += helper[helper.index('export function strToBool'):helper.index('export function validateHostname')].replace('export function', 'function')
        source += 'const node=' + json.dumps(node) + ';print(sprintf("%J",removeBlankAttrs(renderOutbound(node))));'
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'render.uc'
            script.write_text(source)
            return subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)

    def test_active_reality_rejects_manual_disable_instead_of_overriding_it(self):
        for protocol in ('anytls', 'vless'):
            for fingerprint in (None, '', 'none', 'disable', 'disabled'):
                with self.subTest(protocol=protocol, fingerprint=fingerprint):
                    node = dict(type=protocol, tls='1', tls_reality='1', tls_utls=fingerprint)
                    run = self.render(node)
                    self.assertNotEqual(run.returncode, 0, run.stdout)
                    self.assertIn('REALITY requires a uTLS fingerprint.', run.stderr)

    def test_inactive_retained_reality_does_not_change_tls_or_manual_disable(self):
        for protocol in ('anytls', 'vless', 'trojan', 'vmess', 'http', 'hysteria',
                         'hysteria2', 'shadowtls', 'tuic', 'socks', 'ssh', 'shadowsocks'):
            for tls, reality in (('0', '1'), ('1', '0'), ('1', '1')):
                if protocol in ('anytls', 'vless') and tls == reality == '1':
                    continue
                with self.subTest(protocol=protocol, tls=tls, reality=reality):
                    run = self.render(dict(type=protocol, tls=tls, tls_reality=reality, tls_utls=''))
                    self.assertEqual(run.returncode, 0, run.stderr)
                    outbound = json.loads(run.stdout)
                    self.assertNotIn('utls', outbound.get('tls', {}))
                    self.assertNotIn('reality', outbound.get('tls', {}))


if __name__ == '__main__':
    unittest.main()
