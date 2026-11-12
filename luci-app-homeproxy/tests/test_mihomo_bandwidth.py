"""Mihomo integer-rate grammar -> native UCI -> complete client/probe consumers.

Source contract: MetaCubeX/mihomo 0455d0d28c4526937380505153e65a843d8612e8
common/utils/mbps.go and adapter/outbound/hysteria{,2}.go. Decimal *prefixes*
are base 1000; fractional coefficients (e.g. 0.5 Mbps) are not supported.
All files/UCI are private, download/service boundaries are fixtures; no core runs.
"""
import json
import subprocess
import unittest

from client_generator_fixture import APP, ClientGenerator
import test_subscription_parsing as parsing
import test_subscription_efficiency_native as native


def proxy(protocol, **rates):
    return dict(nodetype='mihomo', type=protocol, name='bandwidth',
                server='proxy.example', port=443, password='fixture',
                **{'auth-str': 'fixture'}, **rates)


def latency_config(fixture, nodes):
    rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
    start = rpc.index('\t\t\t\tconst config = {', rpc.index('const buildProbeRuntime'))
    end = rpc.index('\n\t\t\t\treturn {', start)
    target = fixture.root / 'latency.json'
    script = fixture.root / 'latency.uc'
    script.write_text("import {writefile} from 'fs'; import {renderOutbound, removeBlankAttrs, addECHDNS, shellQuote} from " +
                      json.dumps(str(fixture.root / 'homeproxy.uc')) + ';\nconst nodes=' + json.dumps(nodes) +
                      ',entries=map(nodes,(section)=>({endpoint:false,section,outbound:renderOutbound(section)}));\n' +
                      'const controller_port=19090,dns_strategy="ipv4_only",session_dir=' +
                      json.dumps(str(fixture.root)) + ',config_path=' + json.dumps(str(target)) + ';\n' + rpc[start:end])
    run = subprocess.run(['ucode', str(script)], text=True, capture_output=True, timeout=15)
    if run.returncode or run.stderr:
        raise AssertionError(run.stderr)
    return json.loads(target.read_text())


class MihomoBandwidth(unittest.TestCase):
    def parse(self, protocol, **rates):
        return parsing.SubscriptionParsing().parse('parse_uri(' + json.dumps(proxy(protocol, **rates)) + ')')

    def test_integer_units_are_converted_without_losing_scale_or_byte_semantics(self):
        rates = [(50, '50'), ('50', '50'), ('50 Mbps', '50'), ('1Gbps', '1000'),
                 ('1 Gbps', '1000'), ('125 MBps', '1000'), ('125000000 Bps', '1000'),
                 ('1000 Kbps', '1'), ('125 KBps', '1'), ('1000000 bps', '1'),
                 ('1 Tbps', '1000000'), ('1 TBps', '8000000'), ('1\tMbps', '1'),
                 ('1\nMbps', '1'), ('1\rMbps', '1'), ('1\fMbps', '1'), ('+50', '50')]
        for protocol in ('hysteria', 'hysteria2'):
            for rate, expected in rates:
                with self.subTest(protocol=protocol, rate=rate):
                    node = self.parse(protocol, up=rate, down=rate)
                    self.assertIsNotNone(node)
                    self.assertEqual(node['hysteria_up_mbps'], expected)
                    self.assertEqual(node['hysteria_down_mbps'], expected)

    def test_unrepresentable_or_unsupported_explicit_rates_reject_whole_node(self):
        invalid = ['500 Kbps', '1 bps', '0.5 Mbps', 0.5, '1.5 Gbps', '1e3',
                   '1 mbps', '1 Mbit/s', 'garbage 50 Mbps', '50 Mbps trailing',
                   '-1', '-1 Mbps', 'nil', True, {}, [], '2147483648',
                   '2147483648 Mbps', '2147483648 MBps', '999999999999999999999999',
                   '9223372036854775807 Tbps', 1e30]
        for protocol in ('hysteria', 'hysteria2'):
            for direction in ('up', 'down'):
                for rate in invalid:
                    with self.subTest(protocol=protocol, direction=direction, rate=rate):
                        self.assertIsNone(self.parse(protocol, **(dict(up='50', down='50') | {direction: rate})))

    def test_inclusive_target_integer_bounds_and_exact_divisibility(self):
        for protocol in ('hysteria', 'hysteria2'):
            for rate in ('2147483647', 2147483647, '2147483647 Mbps', '2147483647000 Kbps',
                         '268435455875000 Bps'):
                with self.subTest(protocol=protocol, rate=rate):
                    self.assertEqual(self.parse(protocol, up=rate, down=rate)['hysteria_up_mbps'], '2147483647')
            for rate in ('2147483647001 Kbps', '268435455875001 Bps'):
                with self.subTest(protocol=protocol, rate=rate):
                    self.assertIsNone(self.parse(protocol, up=rate, down=rate))

    def test_hysteria_requires_positive_rates_while_hysteria2_zero_means_automatic(self):
        for rate in (None, '', 0, '0', '0 Mbps'):
            with self.subTest(rate=rate):
                self.assertIsNone(self.parse('hysteria', up=rate, down='50'))
                self.assertIsNone(self.parse('hysteria', up='50', down=rate))
                self.assertIsNotNone(self.parse('hysteria2', up=rate, down=rate))
        self.assertIsNone(self.parse('hysteria'))
        self.assertIsNotNone(self.parse('hysteria2'))

    def test_native_refresh_persists_correct_rates_and_both_consumers_agree(self):
        fixture = native.NativeSubscriptionEfficiency()
        for protocol in ('hysteria', 'hysteria2'):
            with self.subTest(protocol=protocol):
                payload = 'proxies:\n  - ' + json.dumps(proxy(protocol, up='1 Gbps', down='125 MBps')) + '\n'
                state = fixture.run_main({native.URL: payload})
                self.assertEqual(state['returncode'], 0, state['stderr'])
                self.assertEqual(len(state['sections']), 1)
                node = state['sections'][0]
                self.assertEqual(node['hysteria_up_mbps'], '1000')
                self.assertEqual(node['hysteria_down_mbps'], '1000')
                self.assertIn("option hysteria_up_mbps '1000'", state['after'])
                repeat = fixture.run_main({native.URL: payload}, state['after'])
                self.assertEqual(repeat['returncode'], 0, repeat['stderr'])
                self.assertEqual(repeat['after'], state['after'])
                self.assertFalse(any(c[0] in ('set', 'delete', 'commit') for c in repeat['calls']))
                with ClientGenerator() as generator:
                    generator.sections['node1'].update(node)
                    normal = next(o for o in generator.generate()['outbounds'] if o['type'] == protocol)
                    probe = next(o for o in latency_config(generator, [node])['outbounds'] if o['type'] == protocol)
                    for outbound in (normal, probe):
                        self.assertEqual(outbound['up_mbps'], 1000)
                        self.assertEqual(outbound['down_mbps'], 1000)

    def test_invalid_refresh_preserves_native_committed_values_and_selections(self):
        fixture = native.NativeSubscriptionEfficiency()
        for protocol in ('hysteria', 'hysteria2'):
            good = 'proxies:\n  - ' + json.dumps(proxy(protocol, up='50', down='100')) + '\n'
            seed = fixture.run_main({native.URL: good})
            self.assertEqual(seed['returncode'], 0, seed['stderr'])
            sid = seed['sections'][0]['.name']
            selected = seed['after'].replace("option main_node 'nil'", "option main_node '" + sid + "'")
            for rate in ('500 Kbps', '0.5 Mbps', '2147483648 Mbps'):
                with self.subTest(protocol=protocol, rate=rate):
                    bad = 'proxies:\n  - ' + json.dumps(proxy(protocol, up=rate, down='100')) + '\n'
                    state = fixture.run_main({native.URL: bad}, selected)
                    self.assertEqual(state['returncode'], 1, state['stderr'])
                    self.assertEqual(state['after'], selected)
                    self.assertEqual(state['config']['main_node'], sid)
                    self.assertFalse(any(c[0] in ('set', 'delete', 'commit') for c in state['calls']))

    def test_hysteria2_automatic_rates_stay_omitted_in_both_consumers(self):
        for rate in (None, '', 0, '0 Mbps'):
            with self.subTest(rate=rate), ClientGenerator() as generator:
                node = self.parse('hysteria2', up=rate, down=rate)
                generator.sections['node1'].update(node)
                normal = next(o for o in generator.generate()['outbounds'] if o['type'] == 'hysteria2')
                probe = next(o for o in latency_config(generator, [node])['outbounds'] if o['type'] == 'hysteria2')
                for outbound in (normal, probe):
                    self.assertNotIn('up_mbps', outbound)
                    self.assertNotIn('down_mbps', outbound)


if __name__ == '__main__':
    unittest.main()
