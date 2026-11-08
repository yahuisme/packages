"""Disabled HY2 obfuscation must ignore, not erase, retained passwords.

Full client/server generation and the production latency config builder execute
with native ucode/fs. Only private UCI/platform paths are adapted; no proxy runs.
"""
import json
import os
import subprocess
import unittest

from client_generator_fixture import APP, SCRIPTS, ClientGenerator


class RetainedHysteriaObfs(unittest.TestCase):
    def test_all_consumers_obey_hysteria2_obfs_selector(self):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        start = rpc.index('\t\t\t\tconst config = {', rpc.index('const buildProbeRuntime'))
        end = rpc.index('\n\t\t\t\treturn {', start)
        for protocol in ('hysteria', 'hysteria2'):
            for selector in (None, '', 'salamander', 'gecko'):
                with self.subTest(protocol=protocol, selector=selector), ClientGenerator() as f:
                    node = f.sections['node1']
                    node.update(type=protocol, tls='1', password='fixture-password',
                                hysteria_obfs_password='retained-obfs-secret',
                                hysteria_auth_type='string', hysteria_auth_payload='fixture-auth',
                                hysteria_up_mbps='20', hysteria_down_mbps='30')
                    if selector is not None:
                        node['hysteria_obfs_type'] = selector
                    client = next(o for o in f.generate()['outbounds'] if o.get('server'))
                    server = dict(node, **{'.type': 'server', '.name': 'fixture', 'enabled': '1'})
                    adapter = f.root / 'server-uci.uc'
                    adapter.write_text('const cfg=' + json.dumps(server) + ''';
export function cursor() { return {
 load:()=>true, get:()=>null, foreach:(c,t,cb)=>cb(cfg)
}; };
''')
                    script = f.root / 'server.uc'
                    script.write_text((SCRIPTS / 'generate_server.uc').read_text()
                        .replace("from 'uci'", 'from ' + json.dumps(str(adapter)))
                        .replace("from 'homeproxy'", 'from ' + json.dumps(str(f.root / 'homeproxy.uc'))))
                    result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
                    self.assertEqual((result.returncode, result.stderr), (0, ''))
                    inbound = json.loads((f.run / 'sing-box-s.json.new').read_text())['inbounds'][0]
                    latency = f.root / 'latency.json'
                    script.write_text("import {writefile} from 'fs'; import {renderOutbound, removeBlankAttrs, addECHDNS, shellQuote} from " +
                        json.dumps(str(f.root / 'homeproxy.uc')) + ';\nconst section=' + json.dumps(node) +
                        ',entries=[{section,outbound:renderOutbound(section)}],controller_port=19090,dns_strategy="ipv4_only",session_dir=' +
                        json.dumps(str(f.root)) + ',config_path=' + json.dumps(str(latency)) + ';\n' + rpc[start:end])
                    result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
                    self.assertEqual((result.returncode, result.stderr), (0, ''))
                    probe = next(o for o in json.loads(latency.read_text())['outbounds'] if o.get('server'))
                    expected = ('retained-obfs-secret' if protocol == 'hysteria' else
                                {'type': selector, 'password': 'retained-obfs-secret'} if selector else None)
                    for value in (client, inbound, probe):
                        self.assertEqual(value.get('obfs'), expected)
                    # Re-run both full generators with native libuci persistence.
                    # Disabling the selector must not delete its saved password.
                    confdir, savedir = f.root / 'config', f.root / 'saved'
                    confdir.mkdir(); savedir.mkdir()
                    persisted = confdir / 'homeproxy'
                    persisted.write_text("config homeproxy 'server'\n" + ''.join(
                        "config %s '%s'\n" % (values['.type'], name) + ''.join(
                            " option %s '%s'\n" % (key, value)
                            for key, value in values.items() if not key.startswith('.'))
                        for name, values in [*f.sections.items(), ('fixture', server)]))
                    before = persisted.read_bytes()
                    native = f.root / 'native-uci.uc'
                    native.write_text("import {cursor as native_cursor} from 'uci';\n" +
                        'export function cursor() { return native_cursor(' +
                        json.dumps(str(confdir)) + ',' + json.dumps(str(savedir)) + '); };\n')
                    for generator, output, key in [('generate_client.uc', 'sing-box-c.json.new', 'outbounds'),
                                                   ('generate_server.uc', 'sing-box-s.json.new', 'inbounds')]:
                        script.write_text((SCRIPTS / generator).read_text()
                            .replace("from 'uci'", 'from ' + json.dumps(str(native)))
                            .replace("from 'ubus'", 'from ' + json.dumps(str(f.root / 'ubus.uc')))
                            .replace("from 'homeproxy'", 'from ' + json.dumps(str(f.root / 'homeproxy.uc'))))
                        result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
                        self.assertEqual((result.returncode, result.stderr), (0, ''))
                        item = next(o for o in json.loads((f.run / output).read_text())[key]
                                    if o.get('type') == protocol)
                        self.assertEqual(item.get('obfs'), expected)
                    self.assertEqual(persisted.read_bytes(), before)
                    self.assertIn(b"option hysteria_obfs_password 'retained-obfs-secret'", before)
                    # Client and latency use a valid TLS client config. Server PEM setup
                    # remains covered separately by test_server_generation.
                    if os.environ.get('SING_BOX_CHECK'):
                        for path in (f.run / 'sing-box-c.json.new', latency):
                            checked = subprocess.run([os.environ['SING_BOX_CHECK'], 'check', '-c', str(path)],
                                                     capture_output=True, text=True, timeout=15)
                            self.assertEqual(checked.returncode, 0, checked.stderr)


if __name__ == '__main__':
    unittest.main()
