"""Execute real generator/probe builders; no proxy, services or host writes."""
import json
import subprocess
import unittest

from client_generator_fixture import APP, ClientGenerator


class IPv6Policy(unittest.TestCase):
    def test_probe_strategy_obeys_actual_ipv6_switch(self):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        policy = rpc[rpc.index('const dns_strategy ='):rpc.index('const reserved_controller_port')]
        start = rpc.index('\t\t\t\tconst config = {', rpc.index('const buildProbeRuntime'))
        end = rpc.index('\n\t\t\t\treturn {', start)
        for switch, expected in [('0', 'ipv4_only'), (None, 'ipv4_only'),
                                 ('1', 'prefer_ipv6')]:
            with self.subTest(ipv6=switch), ClientGenerator() as fixture:
                config_path = fixture.root / 'probe.json'
                script = fixture.root / 'probe.uc'
                script.write_text("import {writefile} from 'fs'; "
                    "import {removeBlankAttrs,addECHDNS} from " +
                    json.dumps(str(fixture.root / 'homeproxy.uc')) + ';\n' +
                    'const hpuci={get:()=> ' + json.dumps(switch) + '};\n' + policy +
                    '\nconst entries=[],controller_port=19090,config_path=' +
                    json.dumps(str(config_path)) + ';\n' + rpc[start:end])
                subprocess.run(['ucode', str(script)], capture_output=True, text=True,
                               check=True, timeout=15)
                config = json.loads(config_path.read_text())
                self.assertEqual(config['dns']['strategy'], expected)
                self.assertEqual(config['route']['default_domain_resolver']['strategy'], expected)

    def test_bootstrap_candidates_keep_route_metric_and_family_policy(self):
        for enabled, expected in [('0', '192.0.2.20'), ('1', '2001:db8::10')]:
            with self.subTest(ipv6=enabled), ClientGenerator() as fixture:
                fixture.sections['config']['ipv6_support'] = enabled
                statuses = [
                    {'interface': 'policy', 'up': True, 'metric': 0,
                     'route': [{'target': '0.0.0.0', 'mask': 0, 'table': 100}],
                     'dns-server': ['192.0.2.1']},
                    {'interface': 'offline', 'up': False, 'metric': 1,
                     'route': [{'target': '0.0.0.0', 'mask': 0}],
                     'dns-server': ['192.0.2.2']},
                    {'interface': 'first', 'up': True, 'metric': 10,
                     'route': [{'target': '0.0.0.0', 'mask': 0}],
                     'dns-server': ['2001:db8::10']},
                    {'interface': 'second', 'up': True, 'metric': 20,
                     'route': [{'target': '0.0.0.0', 'mask': 0}],
                     'dns-server': ['192.0.2.20']},
                ]
                config = fixture.generate(ubus_data={'interface': statuses})
                server = next(s for s in config['dns']['servers'] if s['tag'] == 'default-dns')
                self.assertEqual(server['server'], expected)

    def test_disabled_ipv6_selects_ipv4_bootstrap_dns(self):
        for mode, fallback in [('global', '9.9.9.9'),
                               ('bypass_mainland_china', '223.5.5.5')]:
            for addresses, expected in [(['2001:db8::53', '192.0.2.53'], '192.0.2.53'),
                                        (['2001:db8::53'], fallback)]:
                with self.subTest(mode=mode, addresses=addresses), ClientGenerator() as fixture:
                    fixture.sections['config'].update(routing_mode=mode, ipv6_support='0')
                    config = fixture.generate(ubus_data={'interface': [{
                        'interface': 'uplink', 'up': True, 'dns-server': addresses,
                        'route': [{'target': '0.0.0.0', 'mask': 0}],
                    }]})
                    bootstrap = next(s for s in config['dns']['servers']
                                     if s['tag'] == 'default-dns')
                    self.assertEqual(bootstrap['server'], expected)
                    self.assertEqual(config['dns']['strategy'], 'ipv4_only')
                    tun = next(i for i in config['inbounds'] if i['type'] == 'tun')
                    self.assertEqual(tun['address'], ['172.19.0.1/30'])


if __name__ == '__main__':
    unittest.main()
