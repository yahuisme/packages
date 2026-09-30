"""Real ucode/full-generator regression; platform boundaries are fixtures."""
import unittest

from client_generator_fixture import ClientGenerator


class ClientRouting(unittest.TestCase):
    def test_list_mode_has_normal_path_direct_fallback(self):
        with ClientGenerator() as fixture:
            fixture.sections['control'].update({
                'lan_whitelist_mode': '1',
                'lan_auto_proxy_ipv4_ips': ['192.168.1.10'],
                'lan_proxy_mac_addrs': ['02:00:00:00:00:11'],
            })
            config = fixture.generate()
            rules = config['route']['rules']
            bypass = next(r for r in rules if r.get('action') == 'bypass')
            expected = {**bypass, 'action': 'route', 'outbound': 'direct-out'}
            sniff_index = rules.index({'action': 'sniff'})
            self.assertEqual(rules[sniff_index + 1], expected)
            self.assertEqual(expected['rules'][0], {'inbound': 'tun-in'})
            self.assertTrue(expected['rules'][1]['invert'])
            self.assertEqual(config['route']['final'], 'main-out')

    def test_rule_proxy_list_keeps_mainland_fast_path(self):
        with ClientGenerator() as fixture:
            fixture.sections['control'].update({
                'lan_whitelist_mode': '1',
                'lan_auto_proxy_ipv4_ips': ['192.168.1.10'],
                'lan_auto_proxy_mac_addrs': ['02:00:00:00:00:10'],
            })
            config = fixture.generate()
            tun = next(i for i in config['inbounds'] if i['type'] == 'tun')
            self.assertEqual(tun.get('route_exclude_address_set'), ['geoip-cn'])

    def test_list_fallback_matches_ip_mac_and_empty_lists(self):
        cases = [({}, {'inbound': 'tun-in'}),
                 ({'lan_auto_proxy_ipv4_ips': ['192.168.1.10']}, {
                     'type': 'logical', 'mode': 'and', 'rules': [
                         {'inbound': 'tun-in'},
                         {'source_ip_cidr': ['192.168.1.10/32'], 'invert': True}]}),
                 ({'lan_proxy_mac_addrs': ['02:00:00:00:00:11']}, {
                     'type': 'logical', 'mode': 'and', 'rules': [
                         {'inbound': 'tun-in'},
                         {'source_mac_address': ['02:00:00:00:00:11'], 'invert': True}]})]
        for options, match in cases:
            with self.subTest(options=options), ClientGenerator() as fixture:
                fixture.sections['control'].update({'lan_whitelist_mode': '1', **options})
                rules = fixture.generate()['route']['rules']
                self.assertIn({**match, 'action': 'bypass'}, rules)
                self.assertEqual(rules[rules.index({'action': 'sniff'}) + 1], {
                    **match, 'action': 'route', 'outbound': 'direct-out'})

    def test_non_list_modes_do_not_gain_unlisted_fallback(self):
        for mode, flag in [('global', '1'), ('bypass_mainland_china', '0')]:
            with self.subTest(mode=mode), ClientGenerator() as fixture:
                fixture.sections['config']['routing_mode'] = mode
                fixture.sections['control']['lan_whitelist_mode'] = flag
                rules = fixture.generate()['route']['rules']
                self.assertEqual(rules[rules.index({'action': 'sniff'}) + 1], {
                    'ip_is_private': True, 'action': 'route', 'outbound': 'direct-out'})

    def test_forced_proxy_targets_still_disable_fast_path(self):
        for option, value in [('lan_proxy_ipv4_ips', '192.168.1.20'),
                              ('lan_proxy_mac_addrs', '02:00:00:00:00:20'),
                              ('wan_proxy_ipv4_ips', '1.2.3.0/24'),
                              ('wan_proxy_ipv6_ips', '2001:db8::/32')]:
            with self.subTest(option=option), ClientGenerator() as fixture:
                fixture.sections['control'].update({'lan_whitelist_mode': '1', option: [value]})
                config = fixture.generate()
                tun = next(i for i in config['inbounds'] if i['type'] == 'tun')
                self.assertNotIn('route_exclude_address_set', tun)
        with ClientGenerator() as fixture:
            config = fixture.generate(domains={'proxy': 'example.com\n'})
            tun = next(i for i in config['inbounds'] if i['type'] == 'tun')
            self.assertNotIn('route_exclude_address_set', tun)

    def test_existing_ipv6_and_cache_policy_preserved(self):
        for mode in ('global', 'bypass_mainland_china'):
            for ipv6 in ('0', '1'):
                for main in ('node1', 'urltest'):
                    with self.subTest(mode=mode, ipv6=ipv6, main=main), ClientGenerator() as fixture:
                        fixture.sections['config'].update({
                            'routing_mode': mode, 'ipv6_support': ipv6, 'main_node': main,
                            'main_urltest_nodes': ['node1']})
                        config = fixture.generate()
                        tun = next(i for i in config['inbounds'] if i['type'] == 'tun')
                        self.assertEqual(tun['address'], ['172.19.0.1/30'] + (
                            ['fdfe:dcba:9876::1/126'] if ipv6 == '1' else []))
                        self.assertEqual(config['dns'].get('strategy'), 'ipv4_only' if ipv6 == '0' else None)
                        experimental = config.get('experimental', {})
                        self.assertEqual('cache_file' in experimental, mode == 'bypass_mainland_china')
                        self.assertEqual('clash_api' in experimental, main == 'urltest')


if __name__ == '__main__':
    unittest.main()
