"""Real generator NTP bootstrap contracts; no live NTP/upstream availability claim."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from client_generator_fixture import ClientGenerator


class NTPBootstrap(unittest.TestCase):
    def test_official_foreign_defaults_route_direct_in_both_modes(self):
        hosts = ['time.apple.com', 'time1.google.com', 'time.cloudflare.com',
                 'pool.ntp.org', '0.openwrt.pool.ntp.org', '1.openwrt.pool.ntp.org',
                 '2.openwrt.pool.ntp.org', '3.openwrt.pool.ntp.org']
        for mode in ('bypass_mainland_china', 'global'):
            with self.subTest(mode=mode), ClientGenerator() as fixture:
                fixture.sections['config'].update({
                    'routing_mode': mode, 'dns_server': 'https://cloudflare-dns.com/dns-query',
                    'china_dns_server': 'https://dns.alidns.com/dns-query',
                })
                fixture.sections['infra']['ntp_server'] = 'nil'
                config = fixture.generate(system_config={'ntp': {
                    '.type': 'timeserver', 'enabled': '1', 'server': hosts,
                }})
                self.assertEqual(config['dns']['rules'][:1], [{
                    'domain': hosts, 'action': 'route', 'server': 'default-dns',
                }])
                self.assertEqual(config['route']['rules'][0], {
                    'network': 'udp', 'port': [123], 'action': 'route', 'outbound': 'direct-out',
                })
                self.assertEqual(config['dns']['final'],
                                 'china-dns' if mode == 'bypass_mainland_china' else 'main-dns')
                self.assertIsNone(config.get('ntp'))
                self.assertEqual(fixture.sections['infra']['ntp_server'], 'nil')

    def test_udp_123_direct_route_is_first(self):
        with ClientGenerator() as fixture:
            self.assertEqual(fixture.generate()['route']['rules'][0], {
                'network': 'udp', 'port': [123], 'action': 'route', 'outbound': 'direct-out',
            })

    def test_enabled_dhcp_names_are_filtered_and_deduplicated(self):
        with ClientGenerator() as fixture:
            config = fixture.generate(
                system_config={'ntp': {
                    '.type': 'timeserver', 'enabled': '1', 'use_dhcp': '1',
                    'dhcp_interface': ['wan', 'wan6'], 'server': 'time.cloudflare.com',
                }},
                ubus_data={'interface': [
                    {'interface': 'wan', 'data': {'ntpserver': ['time.cloudflare.com', 'ntp.wan.example']}},
                    {'interface': 'wan6', 'data': {'ntpserver': 'ntp.v6.example'}},
                    {'interface': 'guest', 'data': {'ntpserver': 'ntp.guest.example'}},
                ]},
            )
            self.assertEqual(config['dns']['rules'][0]['domain'], [
                'time.cloudflare.com', 'ntp.wan.example', 'ntp.v6.example',
            ])

    def test_modes_ipv6_urltest_and_forced_proxy_precedence(self):
        for mode in ('global', 'bypass_mainland_china'):
            for ipv6 in ('0', '1'):
                for main in ('node1', 'urltest', 'nil'):
                    with self.subTest(mode=mode, ipv6=ipv6, main=main), ClientGenerator() as fixture:
                        fixture.sections['config'].update({
                            'routing_mode': mode, 'ipv6_support': ipv6, 'main_node': main,
                            'main_urltest_nodes': ['node1'],
                        })
                        fixture.sections['infra']['ntp_server'] = 'nil'
                        fixture.sections['control'].update({
                            'lan_whitelist_mode': '1',
                            'lan_proxy_ipv4_ips': ['192.168.1.2'],
                            'wan_proxy_ipv4_ips': ['192.0.2.0/24'],
                            'wan_proxy_ipv6_ips': ['2001:db8::/32'],
                        })
                        config = fixture.generate(system_config={'ntp': {
                            '.type': 'timeserver', 'server': 'time.cloudflare.com',
                        }}, domains={'proxy': 'time.cloudflare.com\n', 'direct': 'direct.example\n'})
                        rules = config['route']['rules']
                        if main == 'nil':
                            self.assertEqual(rules, [{'inbound': 'dns-in', 'action': 'hijack-dns'}])
                            self.assertEqual(config['dns']['rules'], [])
                        else:
                            self.assertEqual(rules[0], {
                                'network': 'udp', 'port': [123], 'action': 'route', 'outbound': 'direct-out',
                            })
                            self.assertEqual(config['dns']['rules'][0], {
                                'domain': ['time.cloudflare.com'], 'action': 'route', 'server': 'default-dns',
                            })
                            self.assertTrue(any(r.get('action') == 'sniff' for r in rules[1:]))
                            self.assertEqual(config['route']['final'], 'main-out')
                        self.assertNotIn('ntp', config)
                        self.assertEqual(config['dns'].get('strategy'), 'ipv4_only' if ipv6 == '0' else None)

    def test_names_are_normalized_exact_and_numeric_addresses_excluded(self):
        for servers in ([' TIME.CloudFlare.COM. ', 'time.cloudflare.com', '192.0.2.1',
                         '2001:db8::123', '', 'https://bad.example', 'bad/host', None],
                        ' TIME.CloudFlare.COM. '):
            with self.subTest(servers=servers), ClientGenerator() as fixture:
                system = {'other': {'.type': 'system', 'server': 'ignored.example'},
                          'ntp': {'.type': 'timeserver', 'server': servers, 'use_dhcp': '0'},
                          'off': {'.type': 'timeserver', 'enabled': '0', 'server': 'disabled.example'}}
                config = fixture.generate(system_config=system)
                self.assertEqual(config['dns']['rules'][0], {
                    'domain': ['time.cloudflare.com'], 'action': 'route', 'server': 'default-dns',
                })
                self.assertNotIn('domain_suffix', config['dns']['rules'][0])
        with ClientGenerator() as fixture:
            config = fixture.generate(system_config={'ntp': {
                '.type': 'timeserver', 'server': ['192.0.2.1', '2001:db8::123'],
            }})
            self.assertFalse(any('domain' in r for r in config['dns']['rules']))

    def test_dhcp_default_disabled_and_scalar_interface_filter(self):
        interfaces = {'interface': [
            {'interface': 'wan', 'data': {'ntpserver': 'ntp.wan.example'}},
            {'interface': 'guest', 'data': {'ntpserver': ['ntp.guest.example', '192.0.2.1']}},
        ]}
        for options, expected in [({}, ['ntp.guest.example', 'ntp.wan.example']),
                                  ({'use_dhcp': '0'}, []),
                                  ({'dhcp_interface': 'wan'}, ['ntp.wan.example']),
                                  ({'dhcp_interface': ['missing']}, []),
                                  ({'enabled': '0'}, [])]:
            with self.subTest(options=options), ClientGenerator() as fixture:
                config = fixture.generate(system_config={'ntp': {
                    '.type': 'timeserver', **options,
                }}, ubus_data=interfaces)
                rules = [r for r in config['dns']['rules'] if 'domain' in r]
                self.assertEqual(rules, [{'domain': expected, 'action': 'route', 'server': 'default-dns'}]
                                 if expected else [])

    def test_wan_udp_bootstrap_does_not_change_doh_or_builtin_ntp(self):
        with ClientGenerator() as fixture:
            fixture.sections['config'].update({
                'dns_server': 'https://cloudflare-dns.com/dns-query',
                'china_dns_server': 'https://dns.alidns.com/dns-query',
            })
            fixture.sections['infra']['ntp_server'] = 'nil'
            config = fixture.generate(system_config={'ntp': {
                '.type': 'timeserver', 'server': 'time.apple.com',
            }}, ubus_data={'interface': [{
                'interface': 'wan', 'up': True, 'dns-server': ['192.0.2.53'],
                'route': [{'target': '0.0.0.0', 'mask': 0}],
            }]})
            servers = {s['tag']: s for s in config['dns']['servers']}
            self.assertEqual(servers['default-dns'], {
                'tag': 'default-dns', 'type': 'udp', 'server': '192.0.2.53',
            })
            self.assertEqual(servers['main-dns']['type'], 'https')
            self.assertEqual(servers['main-dns']['detour'], 'main-out')
            self.assertEqual(servers['china-dns']['type'], 'https')
            self.assertNotIn('detour', servers['china-dns'])
            self.assertNotIn('ntp', config)
            fixture.sections['infra']['ntp_server'] = 'builtin.example'
            config = fixture.generate()
            self.assertEqual(config['ntp']['server'], 'builtin.example')
            self.assertEqual(config['ntp']['domain_resolver']['server'], 'default-dns')

    def test_whitespace_scalar_lists_match_sysntpd(self):
        with ClientGenerator() as fixture:
            config = fixture.generate(system_config={'ntp': {
                '.type': 'timeserver', 'server': 'time.apple.com time.cloudflare.com',
                'dhcp_interface': 'wan wan6',
            }}, ubus_data={'interface': [
                {'interface': 'wan', 'data': {'ntpserver': 'ntp.wan.example ntp.other.example'}},
                {'interface': 'wan6', 'data': {'ntpserver': ['ntp.v6.example']}},
                {'interface': 'guest', 'data': {'ntpserver': 'ignored.example'}},
            ]})
            self.assertEqual(config['dns']['rules'][0]['domain'], [
                'time.apple.com', 'time.cloudflare.com', 'ntp.wan.example',
                'ntp.other.example', 'ntp.v6.example',
            ])

    def test_absent_or_disabled_configuration_has_no_invented_hosts(self):
        for system in (None, {'ntp': {
                '.type': 'timeserver', 'enabled': '0', 'server': ['time.example.net'],
        }}):
            with self.subTest(system=system), ClientGenerator() as fixture:
                config = fixture.generate(system_config=system)
                self.assertFalse(any(r.get('server') == 'default-dns' and 'domain' in r
                                     for r in config['dns']['rules']))


class NTPBootstrapRuntime(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('NTP_RUNTIME_BINARY'),
                         'Set NTP_RUNTIME_BINARY to a verified prebuilt core')
    def test_proxy_failure_does_not_block_bootstrap(self):
        with tempfile.TemporaryDirectory(prefix='homeproxy-ntp-configs-') as directory:
            configs = Path(directory)
            for mode in ('global', 'bypass_mainland_china'):
                with ClientGenerator() as fixture:
                    fixture.sections['config'].update(
                        routing_mode=mode, dns_server='https://dns.cloudflare.com/dns-query',
                        china_dns_server='https://dns.alidns.com/dns-query')
                    fixture.sections['infra']['ntp_server'] = 'nil'
                    fixture.sections['control']['wan_proxy_ipv4_ips'] = ['127.0.0.1/32']
                    config = fixture.generate(system_config={'ntp': {
                        '.type': 'timeserver', 'server': ['time.apple.com', 'pool.ntp.org'],
                    }})
                    (configs / (mode + '.json')).write_text(json.dumps(config))
            worker = Path(__file__).with_name('ntp-bootstrap-runtime.py')
            result = subprocess.run([
                'unshare', '-n', sys.executable, str(worker), '--configs', str(configs),
                '--binary', os.environ['NTP_RUNTIME_BINARY'],
                '--parent-namespace', os.readlink('/proc/self/ns/net'),
            ], capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            evidence = json.loads(result.stdout)
            self.assertTrue(evidence['passed'])
            self.assertEqual(len(evidence['cases']), 2)
            self.assertTrue(all(all(row['checks'].values()) for row in evidence['cases']))


if __name__ == '__main__':
    unittest.main()
