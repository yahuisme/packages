"""Full real-ucode generator; platform UCI/ubus boundaries are private fixtures."""
import unittest
from client_generator_fixture import ClientGenerator


class TunBypass(unittest.TestCase):
    def test_forced_proxy_precedes_guarded_mainland_bypass(self):
        for ipv6 in ('0', '1'):
            with self.subTest(ipv6=ipv6), ClientGenerator() as f:
                f.sections['config']['ipv6_support'] = ipv6
                f.sections['control'].update(lan_proxy_ipv4_ips=['192.168.1.20'],
                    lan_proxy_mac_addrs=['02:00:00:00:00:20'],
                    wan_proxy_ipv4_ips=['1.2.3.0/24'], wan_proxy_ipv6_ips=['2001:db8::/32'])
                config = f.generate(domains={'proxy': 'proxy.example\n'})
                rules = config['route']['rules']
                mainland = next(i for i, r in enumerate(rules) if r.get('action') == 'bypass'
                    and r['rules'][0].get('rules') == [{'inbound': 'tun-in'}, {'rule_set': 'geoip-cn'}])
                forced = [r for r in rules[:mainland] if r.get('outbound') == 'main-out']
                self.assertEqual(len(forced), 3)
                self.assertIn({'rule_set': 'domain-proxy-suffix'}, forced[-1]['rules'])
                self.assertEqual(rules[mainland]['rules'][1]['invert'], True)

    def test_every_bypass_excludes_only_active_tun_networks(self):
        for ipv6 in ('0', '1'):
            for mode in ('global', 'bypass_mainland_china'):
                for listed in ('0', '1'):
                    with self.subTest(ipv6=ipv6, mode=mode, listed=listed), ClientGenerator() as f:
                        f.sections['config'].update(ipv6_support=ipv6, routing_mode=mode, routing_port='80,443')
                        f.sections['infra'].update(tun_addr4='172.22.0.1/30', tun_addr6='fd00:1234::1/126')
                        f.sections['control'].update(lan_whitelist_mode=listed,
                            lan_direct_ipv4_ips=['192.168.1.2'], lan_auto_proxy_ipv4_ips=['192.168.1.3'],
                            wan_direct_ipv4_ips=['198.51.100.0/24'], wan_direct_ipv6_ips=['2001:db8:1::/48'])
                        config = f.generate(domains={'direct': 'direct.example\n'})
                        tun = next(i for i in config['inbounds'] if i['type'] == 'tun')
                        bypasses = [r for r in config['route']['rules'] if r.get('action') == 'bypass']
                        self.assertTrue(bypasses)
                        for rule in bypasses:
                            self.assertEqual(rule.get('type'), 'logical')
                            self.assertEqual(rule.get('mode'), 'and')
                            self.assertEqual(rule['rules'][-1], {'source_ip_cidr': tun['address'], 'invert': True})
                        self.assertNotIn('route_exclude_address_set', tun)
                        for tag in ('geoip-cn', 'geosite-cn'):
                            expected = {'type': 'logical', 'mode': 'and', 'rules': [
                                {'inbound': 'tun-in'}, {'rule_set': tag}]}
                            self.assertEqual(any(r['rules'][0] == expected for r in bypasses), mode != 'global')


if __name__ == '__main__':
    unittest.main()
