import json
import os
import re
import shlex
import shutil
import tempfile
import subprocess
import unittest
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
GEN = BASE / 'root/etc/homeproxy/scripts/generate_client.uc'


class Portability(unittest.TestCase):
    def test_dnsmasq_dependency(self):
        text = (BASE / 'Makefile').read_text()
        self.assertRegex(text, r'\+dnsmasq(?:\s|$)')
        self.assertNotIn('+dnsmasq-full', text)

    def dns(self, interfaces, mode='global'):
        src = GEN.read_text()
        block = src[src.index('let wan_dns'):src.index('const dns_port')]
        pre = 'const routing_mode = %s; const statuses = %s; const ubus = {call: function(o,m,a) { return m == "dump" ? {interface: statuses} : statuses[0]?.interface == "wan" ? statuses[0] : null; }};\n' % (json.dumps(mode), json.dumps(interfaces))
        out = subprocess.run(['ucode', '-e', pre + block + ' print( wan_dns );'], capture_output=True, text=True, check=True)
        return out.stdout

    def test_renamed_uplink_dns(self):
        self.assertEqual(self.dns([{'interface': 'uplink', 'up': True, 'route': [{'target': '0.0.0.0', 'mask': 0}], 'dns-server': ['192.0.2.53']}]), '192.0.2.53')

    def test_ipv6_uplink_dns(self):
        self.assertEqual(self.dns([{'interface': 'wan6', 'up': True, 'route': [{'target': '::', 'mask': 0}], 'dns-server': ['2001:db8::53']}]), '2001:db8::53')

    def test_lowest_metric_uplink_dns(self):
        statuses = [{'interface': name, 'metric': metric, 'up': True,
                     'route': [{'target': '0.0.0.0', 'mask': 0}], 'dns-server': [dns]}
                    for name, metric, dns in [('backup', 100, '192.0.2.2'), ('uplink', 10, '192.0.2.1')]]
        self.assertEqual(self.dns(statuses), '192.0.2.1')

    def test_policy_table_and_down_interface_ignored(self):
        statuses = [{'interface': 'vpn', 'up': True, 'route': [{'target': '0.0.0.0', 'mask': 0, 'table': 100}], 'dns-server': ['192.0.2.1']},
                    {'interface': 'uplink', 'up': False, 'route': [{'target': '0.0.0.0', 'mask': 0}], 'dns-server': ['192.0.2.2']}]
        self.assertEqual(self.dns(statuses), '9.9.9.9')

    def test_no_default_route_fallback(self):
        self.assertEqual(self.dns([{'interface': 'lan', 'up': True, 'route': [], 'dns-server': ['192.0.2.53']}]), '9.9.9.9')

    def test_default_stack_uses_core_capability_selection(self):
        src = GEN.read_text()
        block = src[src.index('const configured_stack') if 'const configured_stack' in src else src.index('const tcpip_stack'):src.index('const udp_timeout')]
        h = (BASE / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
        start = h.index('function removeBlankAttrs(')
        end = h.index('\n}', start) + 2
        cleanup = h[start:end]
        for configured, expected in [(None, None), ('mixed', None), ('system', 'system'), ('gvisor', 'gvisor')]:
            with self.subTest(configured=configured):
                pre = 'const uciconfig="homeproxy", ucimain="config"; const uci={get: () => %s}; ' % json.dumps(configured)
                result = subprocess.run(['ucode', '-e', pre + block + cleanup + 'printf("%J", removeBlankAttrs({type: "tun", stack: tcpip_stack}));'], capture_output=True, text=True, check=True)
                self.assertEqual(json.loads(result.stdout), {'type': 'tun', **({'stack': expected} if expected else {})})

    def test_interface_trigger_not_named_wan(self):
        # Native procd builds the JSON; native libubox serializes it. No ubus,
        # service or network operation is invoked. Same source input as reload tests.
        tree = Path(os.environ['OPENWRT_SOURCE'])
        procd = (tree / 'package/system/procd/files/procd.sh').read_text()
        jshn_bin = shutil.which('jshn')
        self.assertIsNotNone(jshn_bin, 'Install native libubox jshn')
        jshn = os.environ.get('JSHN_SH') or str(
            Path(jshn_bin or '').resolve().parents[1] / 'share/libubox/jshn.sh')
        names = ['_procd_open_trigger', '_procd_close_trigger',
                 '_procd_add_array_data', '_procd_add_raw_trigger',
                 '_procd_add_reload_trigger', '_procd_add_config_trigger',
                 '_procd_add_interface_trigger', '_procd_add_timeout']
        native = ''
        for name in names:
            start = procd.index(name + '() {')
            native += procd[start:procd.index('\n}', start) + 2] + '\n'
        native += '\n'.join(f'{name[1:]}() {{ {name} "$@"; }}' for name in names)
        src = (BASE / 'root/etc/init.d/homeproxy').read_text()
        block = src[src.index('service_triggers()'):]
        code = ('. ' + shlex.quote(jshn) + '\n' + native + '\n' + block +
                '\nCONF=homeproxy; PROCD_RELOAD_DELAY=1000; initscript=/etc/init.d/homeproxy; '
                'json_init; _procd_open_trigger; service_triggers; '
                '_procd_close_trigger; json_dump')
        out = subprocess.run(['busybox', 'ash', '-c', code],
                             capture_output=True, text=True, check=True)
        triggers = json.loads(out.stdout)['triggers']
        command = ['run_script', '/etc/init.d/homeproxy', 'reload']
        self.assertEqual(triggers, [
            ['config.change', ['if', ['eq', 'package', 'homeproxy'], command], 1000],
            ['interface.*', [command], 1000]])
        # In particular raw event data has no interface == wan/empty predicate.
        with tempfile.TemporaryDirectory(prefix='homeproxy-trigger-') as tmp:
            probe = str(Path(tmp) / 'match')
            subprocess.run([os.environ.get('CC', 'cc'), '-Wall', '-Werror',
                            str(BASE / 'tests/fixtures/procd-trigger-match.c'),
                            '-o', probe], check=True, capture_output=True)
            for pattern in (triggers[1][0], 'interface.*.up'):
                for event, expected in [('interface.update', '1'),
                                        ('interface.down', '1'),
                                        ('interface.up', '1'),
                                        ('network.interface', '0'),
                                        ('device.add', '0'), ('instance.update', '0')]:
                    with self.subTest(pattern=pattern, event=event):
                        out = subprocess.run([probe, event, pattern], check=True,
                                             capture_output=True, text=True)
                        self.assertEqual(out.stdout.strip(), expected)


if __name__ == '__main__':
    unittest.main()
