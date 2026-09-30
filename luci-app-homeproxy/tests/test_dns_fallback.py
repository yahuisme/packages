"""Real ucode full-generator DNS regressions and optional isolated core tests.

Run with /opt/test-tools/env.sh sourced. DNS_RUNTIME_BINARY must point to an
already verified official sing-box 1.14.2 prebuilt executable; the runtime test
creates and verifies its own loopback-only network namespace before starting it.
No firmware, compiler, host services, or host network configuration is used.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

from client_generator_fixture import ClientGenerator


def dns_config(mode='bypass_mainland_china', ipv6=False, enabled=True):
    with ClientGenerator() as fixture:
        fixture.sections['config'].update(
            routing_mode=mode, ipv6_support='1' if ipv6 else '0',
            main_node='node1' if enabled else 'nil',
            dns_server='udp://127.0.0.1:15301', china_dns_server='udp://127.0.0.1:15302')
        return fixture.generate(domains={'direct': 'direct.test\n', 'proxy': 'proxy.test\n'})['dns']


class DNSFallbackGeneration(unittest.TestCase):
    def test_mainland_fallback_is_final_with_bounded_evaluation(self):
        dns = dns_config()
        with self.subTest('final fallback'):
            self.assertEqual(dns['final'], 'china-dns')
        with self.subTest('bounded evaluation'):
            evaluate = [rule for rule in dns['rules'] if rule['action'] == 'evaluate']
            self.assertEqual(evaluate, [{'action': 'evaluate', 'server': 'main-dns', 'timeout': '3s'}])
        with self.subTest('no redundant terminal route'):
            self.assertEqual(dns['rules'][-1], {'match_response': True, 'action': 'respond'})
        self.assertEqual(dns['rules'][-2], {'rule_set': 'geoip-cn', 'match_response': True,
                                         'action': 'route', 'server': 'china-dns'})

    def test_explicit_domain_routes_precede_mainland_evaluation(self):
        dns = dns_config()
        self.assertEqual(dns['rules'][:3], [
            {'rule_set': 'domain-direct-suffix', 'action': 'route', 'server': 'china-dns'},
            {'rule_set': 'domain-proxy-suffix', 'action': 'route', 'server': 'main-dns'},
            {'rule_set': 'geosite-cn', 'action': 'route', 'server': 'china-dns'},
        ])

    def test_global_keeps_main_final_without_evaluation(self):
        dns = dns_config('global')
        self.assertEqual(dns['final'], 'main-dns')
        self.assertEqual(dns['rules'], [
            {'rule_set': 'domain-direct-suffix', 'action': 'route', 'server': 'default-dns'}])
        self.assertNotIn('china-dns', [server['tag'] for server in dns['servers']])

    def test_disabled_main_has_no_dangling_final(self):
        for mode in ('global', 'bypass_mainland_china'):
            with self.subTest(mode=mode):
                dns = dns_config(mode, enabled=False)
                self.assertNotIn('final', dns)
                self.assertEqual(dns['rules'], [])

    def test_ipv4_tun_dns_and_existing_cache_policy_survive(self):
        for mode in ('global', 'bypass_mainland_china'):
            for ipv6 in ('0', '1'):
                with self.subTest(mode=mode, ipv6=ipv6), ClientGenerator() as fixture:
                    fixture.sections['config'].update(routing_mode=mode, ipv6_support=ipv6)
                    config = fixture.generate()
                    dns = config['dns']
                    self.assertEqual(dns.get('strategy'), 'ipv4_only' if ipv6 == '0' else None)
                    for server in dns['servers']:
                        if 'domain_resolver' in server:
                            self.assertEqual(server['domain_resolver'].get('strategy'), dns.get('strategy'))
                    self.assertFalse(dns.get('disable_cache', False))
                    self.assertFalse(dns.get('disable_expire', False))
                    tun = next(inbound for inbound in config['inbounds'] if inbound['type'] == 'tun')
                    self.assertEqual(tun['address'], ['172.19.0.1/30'] +
                                     (['fdfe:dcba:9876::1/126'] if ipv6 == '1' else []))
                    cache = config.get('experimental', {}).get('cache_file')
                    if mode == 'bypass_mainland_china':
                        self.assertTrue(cache['enabled'])
                        self.assertFalse(cache['store_dns'])
                        self.assertEqual(cache['path'], str(fixture.hp / 'cache/cache.db'))
                    else:
                        self.assertIsNone(cache)


class DNSFallbackRuntime(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('DNS_RUNTIME_BINARY'), 'Set DNS_RUNTIME_BINARY to verified official 1.14.2 binary')
    def test_real_sing_box_in_private_loopback_namespace(self):
        worker = Path(__file__).with_name('dns_runtime_fixture.py')
        parent = os.readlink('/proc/self/ns/net')
        result = subprocess.run(['unshare', '--net', sys.executable, str(worker),
                                 os.environ['DNS_RUNTIME_BINARY'], parent],
                                capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = json.loads(result.stdout)
        self.assertNotEqual(evidence['namespace'], parent)
        self.assertEqual(evidence['interfaces'], ['lo'])
        self.assertEqual(len(evidence['cases']), 17)
        print('\nIsolated sing-box DNS evidence: ' + json.dumps(evidence, sort_keys=True))


if __name__ == '__main__':
    unittest.main()
