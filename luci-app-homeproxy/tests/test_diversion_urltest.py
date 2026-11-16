"""Independent diversion URLTest groups through the complete native-ucode generator."""
import json
import unittest

from client_generator_fixture import ClientGenerator


class DiversionURLTest(unittest.TestCase):
    def configure(self, fixture, main='node1'):
        fixture.sections['config'].update(main_node=main, main_urltest_nodes=['node1'])
        fixture.sections['node2'] = {'.type': 'node', 'type': 'socks', 'address': '192.0.2.11',
                                     'port': '1080', 'label': 'Other node'}
        fixture.sections['route_test'] = {'.type': 'domain_route', 'enabled': '1', 'node': 'urltest',
                                         'urltest_nodes': ['node1', 'node2', 'node1', 'missing'],
                                         'domain_list': 'independent.test\n'}

    def test_independent_group_routes_dns_and_reuses_main_outbound(self):
        for mode in ('global', 'bypass_mainland_china'):
            for main in ('node1', 'urltest'):
                with self.subTest(mode=mode, main=main), ClientGenerator() as fixture:
                    self.configure(fixture, main)
                    fixture.sections['config']['routing_mode'] = mode
                    fixture.sections['route_test']['urltest_interrupt_exist_connections'] = '1'
                    config = fixture.generate()
                    group = next(o for o in config['outbounds'] if o['tag'] == 'domain-route_test-urltest')
                    self.assertEqual(group['type'], 'urltest')
                    self.assertEqual(group['interval'], '60s')
                    self.assertEqual(group['tolerance'], 60)
                    self.assertTrue(group['interrupt_exist_connections'])
                    self.assertEqual(group['outbounds'], ['main-out' if main == 'node1' else 'Fixture node', 'Other node'])
                    self.assertEqual(sum(o.get('server') == '192.0.2.10' for o in config['outbounds']), 1)
                    tags = [o['tag'] for o in config['outbounds']]
                    self.assertEqual(len(tags), len(set(tags)))
                    self.assertTrue(any(r.get('outbound') == group['tag'] for r in config['route']['rules']))
                    dns = next(s for s in config['dns']['servers'] if s['tag'] == 'domain-route_test-dns')
                    self.assertEqual(dns['detour'], group['tag'])
                    self.assertEqual(config['experimental']['clash_api']['external_controller'], '127.0.0.1:9090')
                    self.assertEqual('cache_file' in config['experimental'], mode == 'bypass_mainland_china')
                    if main == 'urltest':
                        self.assertEqual(next(o for o in config['outbounds'] if o['tag'] == 'main-out')['interval'], '120s')

    def test_group_tag_does_not_collide_with_operator_node_label(self):
        with ClientGenerator() as fixture:
            self.configure(fixture, 'urltest')
            fixture.sections['node2']['label'] = 'domain-route_test-urltest'
            config = fixture.generate()
            tags = [o['tag'] for o in config['outbounds']]
            self.assertEqual(len(tags), len(set(tags)))
            group = next(o for o in config['outbounds'] if o['tag'] == 'domain-route_test-urltest')
            self.assertIn('domain-route_test-urltest (2)', group['outbounds'])

    def test_native_subscription_refresh_prunes_only_unavailable_group_members(self):
        from test_subscription_reconcile import NativeSubscription, TCP, URL, GROUP, NODE
        original = f"""config config 'config'
 option main_node '{NODE}'
config node '{NODE}'
 option label 'keep'
 option grouphash '{GROUP}'
 option type 'trojan'
 option address 'proxy.example'
 option port '443'
 option password 'new'
 option tls '1'
config domain_route 'route_test'
 option enabled '0'
 option node 'urltest'
 list urltest_nodes '{NODE}'
 list urltest_nodes 'missing'
 list urltest_nodes '{NODE}'
"""
        result = NativeSubscription().run_native({URL: TCP}, original=original)
        self.assertEqual(result['result'].returncode, 0, result['result'].stderr)
        group = result['sections']['route_test']
        self.assertEqual(group['node'], 'urltest')
        self.assertEqual(group['enabled'], '0')
        self.assertEqual(group['urltest_nodes'], NODE)

    def test_disabled_group_retains_saved_selection_but_emits_no_urltest(self):
        with ClientGenerator() as fixture:
            self.configure(fixture)
            fixture.sections['route_test']['enabled'] = '0'
            original = json.dumps(fixture.sections, sort_keys=True)
            config = fixture.generate()
            self.assertFalse(any(o['type'] == 'urltest' for o in config['outbounds']))
            self.assertNotIn('clash_api', config.get('experimental', {}))
            self.assertEqual(json.dumps(fixture.sections, sort_keys=True), original)

    def test_empty_group_falls_back_to_main_without_invalid_selector(self):
        with ClientGenerator() as fixture:
            self.configure(fixture)
            fixture.sections['route_test']['urltest_nodes'] = ['missing']
            with self.assertRaisesRegex(AssertionError, 'Diversion URLTest group route_test has no available nodes; using the main node'):
                fixture.generate()
            config = json.loads((fixture.run / 'sing-box-c.json.new').read_text())
            self.assertFalse(any(o['type'] == 'urltest' for o in config['outbounds']))
            rule = next(r for r in config['route']['rules'] if r.get('rule_set') == 'domain-route_test-suffix')
            self.assertEqual(rule['outbound'], 'main-out')


if __name__ == '__main__':
    unittest.main()
