"""Real full ucode generator/migration; private JSON-backed UCI and ubus boundary.
No host UCI, router init, downloads or proxy process. All files self-clean.
"""
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]
SCRIPTS = APP / 'root/etc/homeproxy/scripts'


class Defaults(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hp-defaults-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.hp = self.base / 'hp'
        self.runtime = self.base / 'run'
        (self.hp / 'diversion').mkdir(parents=True)
        self.runtime.mkdir()
        self.state = self.base / 'state.json'
        (self.base / 'http.uc').write_text('export function urldecode_params(s) { return {}; }')
        # URLs have explicit schemes; no host validate_data may execute.
        validator = self.base / 'validate'
        validator.write_text('#!/bin/sh\n[ "$1" = hostname ] && { [ "$2" = dns.example ] || [ "$2" = china.example ]; }\n')
        validator.chmod(0o700)
        helper = (SCRIPTS / 'homeproxy.uc').read_text()
        helper = helper.replace("'/etc/homeproxy'", repr(str(self.hp)))
        helper = helper.replace("'/var/run/homeproxy'", repr(str(self.runtime)))
        helper = helper.replace("from 'luci.http'", f"from '{self.base}/http.uc'")
        helper = helper.replace('/sbin/validate_data', str(validator))
        (self.base / 'homeproxy.uc').write_text(helper)
        (self.base / 'ubus.uc').write_text('''export function connect() { return {
call: function(object, method, args) {
    assert(object === 'network.interface' && method === 'status' && args.interface === 'wan');
    return { 'dns-server': ['192.0.2.53'] };
}}; }''')
        (self.base / 'uci.uc').write_text('''import { readfile, writefile } from 'fs';
const path = STATE_PATH;
let data = json(readfile(path)), dirty = false;
function section(c, s) { assert(c === 'homeproxy'); return data[s]; }
export function cursor() { return {
load: function(c) { assert(c === 'homeproxy'); return true; },
get: function(c,s,o) { let v = section(c,s); return o == null ? v?.['.type'] : v?.[o]; },
get_all: function(c,s) { return section(c,s); },
foreach: function(c,t,cb) { assert(c === 'homeproxy'); for (let k,v in data) if (v['.type'] === t) cb(v); },
set: function(c,s,o,v) {
    assert(c === 'homeproxy');
    if (v == null) data[s] = { '.name':s, '.type':o };
    else { if (!data[s]) data[s] = { '.name':s, '.type':'homeproxy' }; data[s][o] = v; }
    dirty = true; return true;
},
delete: function(c,s,o) { assert(c === 'homeproxy'); delete data[s][o]; dirty = true; return true; },
changes: function(c) { return dirty ? { homeproxy:['fixture change'] } : {}; },
commit: function(c) {
    assert(c === 'homeproxy');
    let content = sprintf('%J', data);
    assert(writefile(path, content) === length(content)); dirty = false; return true;
}
}; }'''.replace('STATE_PATH', json.dumps(str(self.state))))

    def fixture(self, interval=None, tolerance=None, mode='bypass_mainland_china', ipv6='1'):
        sections: dict[str, dict] = {name: {'.name': name, '.type': 'homeproxy'} for name in
                    ['config', 'infra', 'control', 'diversion', 'tailscale', 'subscription', 'server']}
        sections['config'].update(main_node='urltest', main_urltest_nodes=['n1', 'n2'],
                                  routing_mode=mode, ipv6_support=ipv6,
                                  dns_server='https://dns.example/dns-query',
                                  china_dns_server='https://china.example/dns-query', tcpip_stack='mixed')
        sections['infra'].update(ntp_server='nil', udp_timeout='300', clash_api_port='9090')
        for key, value in [('main_urltest_interval', interval), ('main_urltest_tolerance', tolerance)]:
            if value is not None:
                sections['config'][key] = value
        for name in ['n1', 'n2']:
            sections[name] = {'.name': name, '.type': 'node', 'type': 'socks',
                              'address': '192.0.2.1', 'port': '1080', 'label': name}
        return sections

    def execute(self, filename, state):
        self.state.write_text(json.dumps(state))
        source = (SCRIPTS / filename).read_text()
        for module in ['homeproxy', 'uci', 'ubus']:
            source = source.replace(f"from '{module}'", f"from '{self.base}/{module}.uc'")
        script = self.base / filename
        script.write_text(source)
        cmd = ['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/usr/lib/ucode'), str(script)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        if filename == 'generate_client.uc':
            return json.loads((self.runtime / 'sing-box-c.json.new').read_text())
        return json.loads(self.state.read_text())

    def generate(self, state):
        return self.execute('generate_client.uc', state)

    def migrate(self, state):
        return self.execute('migrate_config.uc', state)

    def test_missing_generator_defaults(self):
        output = self.generate(self.fixture())
        main = next(x for x in output['outbounds'] if x['tag'] == 'main-out')
        self.assertEqual(main['interval'], '120s')
        self.assertEqual(main.get('tolerance'), 60)

    def test_explicit_and_zero_values_survive_generator_and_migration(self):
        for interval, tolerance in [('90', '50'), ('90', '0'), (None, None)]:
            with self.subTest(interval=interval, tolerance=tolerance):
                state = self.migrate(self.fixture(interval, tolerance))
                self.assertEqual(state['config']['main_urltest_interval'], interval or '120')
                self.assertEqual(state['config']['main_urltest_tolerance'], tolerance if tolerance is not None else '60')
                self.assertEqual(self.migrate(state), state)
                main = next(x for x in self.generate(state)['outbounds'] if x['tag'] == 'main-out')
                self.assertEqual(main['interval'], (interval or '120') + 's')
                self.assertEqual(main['tolerance'], int(tolerance) if tolerance is not None else 60)

    def test_zero_tolerance_is_emitted(self):
        output = self.generate(self.fixture('90', '0'))
        main = next(x for x in output['outbounds'] if x['tag'] == 'main-out')
        self.assertEqual(main.get('tolerance'), 0)

    def test_dns_redirect_cleanup_idempotent_dns_tun_unchanged(self):
        obsolete = ['dns_redirect', 'china_dns_port', 'redirect_port', 'tun_mark', 'tun_gso',
                    'tproxy_port', 'table_mark', 'self_mark', 'tproxy_mark', 'sniff_override', 'github_token']
        for mode in ['bypass_mainland_china', 'global']:
            for ipv6 in ['0', '1']:
                with self.subTest(mode=mode, ipv6=ipv6):
                    state = self.fixture('90', '50', mode, ipv6)
                    state['infra'].update({key: '1' for key in obsolete})
                    before = self.generate(state)
                    migrated = self.migrate(state)
                    self.assertFalse(set(obsolete) & migrated['infra'].keys())
                    self.assertEqual(self.migrate(migrated), migrated)
                    self.assertEqual(self.generate(migrated), before)
                    tun = next(x for x in before['inbounds'] if x['type'] == 'tun')
                    self.assertEqual(tun['dns_mode'], 'hijack')
                    self.assertTrue(tun['auto_route'])
                    self.assertTrue(tun['auto_redirect'])
                    self.assertEqual(len(tun['address']), 2 if ipv6 == '1' else 1)
                    self.assertEqual(before['route']['rules'][0], {'inbound': 'dns-in', 'action': 'hijack-dns'})
                    for redirect in [None, '0', '1']:
                        variant = copy.deepcopy(migrated)
                        if redirect is not None:
                            variant['infra']['dns_redirect'] = redirect
                        self.assertEqual(self.generate(variant), before)

    def test_packaged_defaults_and_main_placeholders(self):
        config = (APP / 'root/etc/config/homeproxy').read_text()
        self.assertNotIn('option dns_redirect', config)
        for name, value in [('interval', '120'), ('tolerance', '60')]:
            self.assertIn(f"option main_urltest_{name} '{value}'", config)
            source = (APP / 'htdocs/luci-static/resources/view/homeproxy/client.js').read_text()
            match = re.search(r"o = s.taboption\('routing', form.Value, 'main_urltest_" + name + r"'[\s\S]*?(?=\n\s*o =)", source)
            self.assertIsNotNone(match)
            assert match is not None
            self.assertIn(f"o.placeholder = '{value}';", match.group())


if __name__ == '__main__':
    unittest.main(verbosity=2)
