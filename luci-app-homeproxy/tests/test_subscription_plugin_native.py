"""Subscription main against the real ucode UCI type boundary (private storage)."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import test_subscription_parsing as parser_fixture
from client_generator_fixture import ClientGenerator

BASE = Path(__file__).resolve().parents[1] / 'root/etc/homeproxy/scripts'


class NativePluginImport(unittest.TestCase):
    def run_import(self, plugin, options):
        helper = (BASE / 'homeproxy.uc').read_text()
        updater = (BASE / 'update_subscriptions.uc').read_text()
        payload = 'proxies:\n  - ' + json.dumps(dict(name='fixture', type='ss', server='proxy.example', port=443,
                            cipher='aes-128-gcm', password='fixture', plugin=plugin, **{'plugin-opts': options})) + '\n'
        with tempfile.TemporaryDirectory(prefix='hp-native-plugin-') as directory:
            root = Path(directory)
            for name in ('config', 'saved'):
                (root / name).mkdir()
            original = "config homeproxy 'config'\n option main_node 'nil'\n"
            config = root / 'config/homeproxy'
            config.write_text(original)
            source = "import { cursor } from 'uci'; import { md5 } from 'digest';\n"
            source += 'const uci=cursor(%s,%s); uci.load("homeproxy");\n' % (json.dumps(str(root/'config')), json.dumps(str(root/'saved')))
            source += 'const payload=' + json.dumps(payload) + ''', subscription_urls=['https://fixture.invalid/sub'];
const node_cache={},node_config_cache={},node_result=[],reconcile_group={};
const user_agent='fixture',update_proxy=null,allow_insecure='0',packet_encoding='xudp',resources_updated=false;
const uciconfig='homeproxy',ucinode='node',ucimain='config';
const filter_mode='disabled',filter_keywords=[];
function wGET(url){return payload;}
function reload_service(){return true;}
function apply_updated_resources(){return true;}
function log_error(...args){warn('update failure\\n');}
'''
            source += helper[helper.index('export function isEmpty'):helper.index('export function strToBool')].replace('export function','function')
            source += parser_fixture.PREAMBLE[parser_fixture.PREAMBLE.index('function validation'):]
            source += helper[helper.index('export function decodeBase64Str'):helper.index('/* String parser end */')].replace('export function','function')
            source += updater[updater.index('const invalid_filter_patterns'):updater.index('/* String helper end */')]
            source += updater[updater.index('function has_value'):]
            source += "\nuci.foreach('homeproxy','node',(n)=>printf('%J\\n',n));\n"
            script = root / 'case.uc'
            script.write_text(source)
            run = subprocess.run(['ucode', '-L', os.environ.get('UCODE_LIB_DIR','/opt/test-tools/ucode/build'), str(script)], capture_output=True, text=True, timeout=20)
            return run, config.read_text(), original

    def test_mihomo_plugin_objects_commit_as_native_uci_strings(self):
        for plugin, options, expected in (
            ('v2ray-plugin', {'mode':'websocket','tls':True,'host':'cdn.example','path':'/ws','mux':False}, 'mode=websocket;tls;host=cdn.example;path=/ws;mux=0'),
            ('v2ray-plugin', {'tls':False,'mux':True,'path':'/a;b=c\\d'}, 'mux=1;path=/a\\;b\\=c\\\\d'),
            ('simple-obfs', {'mode':'http','host':'cdn.example'}, 'obfs=http;obfs-host=cdn.example'),
            ('v2ray-plugin', 'tls;host=cdn.example', 'tls;host=cdn.example'),
        ):
            with self.subTest(plugin=plugin, options=options):
                run, committed, original = self.run_import(plugin, options)
                self.assertEqual(run.returncode, 0, run.stderr)
                nodes = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
                self.assertEqual(len(nodes), 1, run.stdout)
                self.assertEqual(nodes[0]['shadowsocks_plugin_opts'], expected)
                self.assertEqual(nodes[0]['shadowsocks_plugin'], 'obfs-local' if plugin == 'simple-obfs' else plugin)
                self.assertNotEqual(committed, original)
                with ClientGenerator() as generator:
                    generator.sections['node1'].update(nodes[0])
                    outbound = next(o for o in generator.generate()['outbounds'] if o['type'] == 'shadowsocks')
                    self.assertEqual(outbound['plugin_opts'], expected)
                    self.assertEqual(outbound['plugin'], 'obfs-local' if plugin == 'simple-obfs' else plugin)

    def test_unknown_or_nested_plugin_objects_fail_without_commit(self):
        for plugin, options in [('other', {'mode':'websocket'}), ('v2ray-plugin', {'unknown':'x'}), ('v2ray-plugin', {'host':{'nested':'x'}}), ('v2ray-plugin', {'skip-cert-verify':True}),
                                 ('v2ray-plugin', {'tls':'false'}), ('simple-obfs', {'mode':'websocket'}),
                                 ('v2ray-plugin', {'mode':'http'}), ('v2ray-plugin', {'mux':'invalid'})]:
            with self.subTest(plugin=plugin, options=options):
                run, committed, original = self.run_import(plugin, options)
                self.assertNotEqual(run.returncode, 0)
                self.assertEqual(committed, original)

if __name__ == '__main__':
    unittest.main()
