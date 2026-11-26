"""Execute real generator/probe builders; no proxy, services or host writes."""
import base64
import json
import os
import struct
import subprocess
import unittest

from client_generator_fixture import APP, ClientGenerator

# Structurally valid ECHConfigList (X25519/HKDF-SHA256/AES-128-GCM).
# Only parsing/schema is tested, never an ECH handshake or private key.
_ech = b'\x01\x00\x20' + struct.pack('!H', 32) + bytes(range(32)) + b'\x00\x04\x00\x01\x00\x01\x00\x0dcover.example\x00\x00'
_ech = b'\xfe\x0d' + struct.pack('!H', len(_ech)) + _ech
ECH_PEM = ['-----BEGIN ECH CONFIGS-----', base64.b64encode(struct.pack('!H', len(_ech)) + _ech).decode(), '-----END ECH CONFIGS-----']


class IPv6Policy(unittest.TestCase):
    def test_explicit_dns_literals_obey_active_family_policy(self):
        for field, tag in [('dns_server', 'main-dns'), ('china_dns_server', 'china-dns')]:
            for address in ('2001:db8::53', '[2001:db8::53]', 'udp://[2001:db8::53]:5353',
                            'https://[2001:db8::53]/dns-query', 'tcp://192.0.2.53', 'https://dns.example/dns-query'):
                ipv6 = '2001:db8' in address
                for switch in ('0', '1'):
                    with self.subTest(field=field, address=address, switch=switch), ClientGenerator() as f:
                        f.sections['config'].update(ipv6_support=switch, **{field: address})
                        before = json.dumps(f.sections, sort_keys=True)
                        if switch == '0' and ipv6:
                            with self.assertRaisesRegex(AssertionError, 'IPv6 DNS server requires IPv6 support'):
                                f.generate()
                            self.assertFalse((f.run / 'sing-box-c.json.new').exists())
                        else:
                            config = f.generate()
                            server = next(s for s in config['dns']['servers'] if s['tag'] == tag)
                            self.assertEqual(server['server'], '2001:db8::53' if ipv6 else
                                             ('dns.example' if 'dns.example' in address else '192.0.2.53'))
                        self.assertEqual(json.dumps(f.sections, sort_keys=True), before)
        # Hidden China DNS in global mode and both DNS fields without a main
        # node are inactive settings, not grounds to reject an otherwise valid config.
        for options in ({'routing_mode': 'global', 'china_dns_server': 'udp://[2001:db8::53]'},
                        {'main_node': 'nil', 'dns_server': 'tcp://[2001:db8::53]',
                         'china_dns_server': 'udp://[2001:db8::53]'}):
            with self.subTest(inactive=options), ClientGenerator() as f:
                f.sections['config'].update(options)
                self.assertFalse(any('2001:db8' in s.get('server', '') for s in f.generate()['dns']['servers']))

    def test_ech_dns_literals_match_client_and_probe_family_policy(self):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        start = rpc.index('\t\t\t\tconst config = {', rpc.index('const buildProbeRuntime'))
        end = rpc.index('\n\t\t\t\treturn {', start)
        for switch in ('0', '1'):
            for address in ('udp://[2001:db8::54]:5353', 'https://[2001:db8::54]/dns-query',
                            'udp://192.0.2.54', 'https://dns.example/dns-query'):
                for inactive in ('', 'tls', 'tls_ech', 'tls_ech_config', 'tls_ech_config_path', 'unused-node', 'no-tls-protocol'):
                    with self.subTest(switch=switch, address=address, inactive=inactive), ClientGenerator() as f:
                        f.sections['config']['ipv6_support'] = switch
                        node = f.sections['node1']
                        node.update(type='vless', uuid='11111111-1111-4111-8111-111111111111', tls='1',
                                    tls_sni='ech.example', tls_ech='1', tls_ech_query_server=address)
                        if inactive in ('tls', 'tls_ech'):
                            node[inactive] = '0'
                        elif inactive == 'tls_ech_config':
                            node[inactive] = ECH_PEM
                        elif inactive == 'tls_ech_config_path':
                            node[inactive] = str(f.root / 'retained-ech.pem')
                            (f.root / 'retained-ech.pem').write_text('\n'.join(ECH_PEM) + '\n')
                        if inactive == 'unused-node':
                            f.sections['config']['main_node'] = 'nil'
                        if inactive == 'no-tls-protocol':
                            node.update(type='socks', socks_version='5')
                        before = json.dumps(f.sections, sort_keys=True)
                        rejected = switch == '0' and '2001:db8' in address and not inactive
                        if rejected:
                            with self.assertRaisesRegex(AssertionError, 'IPv6 DNS server requires IPv6 support'):
                                f.generate()
                        else:
                            config = f.generate()
                            servers = [s for s in config['dns']['servers'] if s['tag'].startswith('ech-dns-')]
                            self.assertEqual(len(servers), 0 if inactive else 1)
                            if servers:
                                self.assertNotIn('[', servers[0]['server'])
                        self.assertEqual(json.dumps(f.sections, sort_keys=True), before)
                        # Execute production latency config try/catch and file write;
                        # no session allocator, core or controller process runs.
                        target = f.root / 'probe.json'
                        script = f.root / 'probe-family.uc'
                        script.write_text("import {writefile} from 'fs';import {removeBlankAttrs,renderOutbound,addECHDNS,shellQuote} from " +
                            json.dumps(str(f.root / 'homeproxy.uc')) + ';\nconst entries=' +
                            ('[]' if inactive == 'unused-node' else '[{section:' + json.dumps(node) + '}]') +
                            ',controller_port=19090,dns_strategy=' + json.dumps('prefer_ipv6' if switch == '1' else 'ipv4_only') +
                            ',session_dir=' + json.dumps(str(f.root / 'unused-session')) + ',config_path=' + json.dumps(str(target)) + ';\n' +
                            'for (let e in entries) e.outbound = renderOutbound(e.section);\n' +
                            'function build(){' + rpc[start:end] + '\nreturn null;}print(sprintf("%J",build()));')
                        run = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=15)
                        self.assertEqual(run.returncode, 0, run.stderr)
                        if rejected:
                            self.assertIn('IPv6 DNS server requires IPv6 support', json.loads(run.stdout)['error'])
                            self.assertFalse(target.exists())
                        else:
                            self.assertIsNone(json.loads(run.stdout))
                            probe = json.loads(target.read_text())
                            servers = [s for s in probe['dns']['servers'] if s['tag'].startswith('ech-dns-')]
                            self.assertEqual(len(servers), 0 if inactive else 1)
                            if servers:
                                self.assertNotIn('[', servers[0]['server'])
                            if os.environ.get('SING_BOX_CHECK'):
                                checked = subprocess.run([os.environ['SING_BOX_CHECK'], 'check', '-c', str(target)],
                                                         capture_output=True, text=True, timeout=15)
                                self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)

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
