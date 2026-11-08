"""Production firewall generator in real ucode/fs, with private UCI/path input."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


APP = Path(__file__).resolve().parents[1]


class FirewallValidation(unittest.TestCase):
    def test_inactive_network_selector_cannot_block_udp_protocols(self):
        source = (APP / 'root/etc/homeproxy/scripts/firewall_pre.uc').read_text()
        for protocol in ('hysteria', 'hysteria2', 'tuic', 'trojan', 'vless', 'vmess', 'anytls'):
            with self.subTest(protocol=protocol), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                data = {'.name': 'server1', 'type': protocol, 'port': '443',
                        'enabled': '1', 'firewall': '1', 'network': 'tcp'}
                script = root / 'firewall.uc'
                script.write_text(source.replace("import { cursor } from 'uci';", '''
function cursor() { return {load:()=>true, foreach:(c,t,cb)=>cb(''' +
                    json.dumps(data) + ''')}; }
''').replace("import { RUN_DIR } from 'homeproxy';",
                    'const RUN_DIR=' + json.dumps(str(root)) + ';'))
                result = subprocess.run(['ucode', str(script)], capture_output=True, text=True,
                    timeout=10, env=dict(os.environ, HOMEPROXY_SERVER_READY='1'))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('meta l4proto { tcp, udp } th dport 443',
                              (root / 'fw4_input.nft').read_text())

    def test_persisted_server_values_are_validated_before_publication(self):
        source = (APP / 'root/etc/homeproxy/scripts/firewall_pre.uc').read_text()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / 'firewall.uc'
            target = root / 'fw4_input.nft'
            for changes, valid in [({}, True), ({'network': 'tcp'}, True),
                                   ({'type': 'naive', 'network': 'udp'}, True),
                                   ({'network': 'udp'}, True), ({'port': '1'}, True),
                                   ({'port': '65535'}, True), ({'port': '0'}, False),
                                   ({'port': '65536'}, False),
                                   ({'port': '9999999999999999999999999999'}, False),
                                   ({'port': '443; drop'}, False),
                                   ({'network': 'tcp counter drop'}, False),
                                   ({'.name': 'bad"name'}, False)]:
                with self.subTest(changes=changes):
                    data = {'.name': 'server1', 'type': 'shadowsocks', 'port': '443', 'enabled': '1',
                            'firewall': '1', **changes}
                    program = source.replace("import { cursor } from 'uci';", '''
function cursor() { return {load:function(){}, foreach:function(c,t,cb){cb(''' +
                                             json.dumps(data) + ''');}}; }
''').replace("import { RUN_DIR } from 'homeproxy';",
             'const RUN_DIR=' + json.dumps(str(root)) + ';')
                    script.write_text(program)
                    target.write_text('OLD RULES')
                    result = subprocess.run(['ucode', str(script)], capture_output=True,
                                            text=True, timeout=10,
                                            env=dict(os.environ, HOMEPROXY_SERVER_READY='1'))
                    self.assertEqual(result.returncode, 0 if valid else 1, result.stderr)
                    if valid:
                        self.assertIn('th dport ' + data['port'], target.read_text())
                        self.assertIn('meta l4proto ' + (data.get('network') or '{ tcp, udp }'),
                                      target.read_text())
                    else:
                        self.assertEqual(target.read_text(), 'OLD RULES')


if __name__ == '__main__':
    unittest.main()
