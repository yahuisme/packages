"""Complete production generator in real ucode; private UCI/ubus/platform fixtures.

Does not start a proxy or touch host configuration. Only platform modules, paths
and validate_data are adapted; route/DNS/outbound generation is unmodified.
"""
import copy
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
from typing import Any

APP = Path(__file__).resolve().parents[1]
SCRIPTS = APP / 'root/etc/homeproxy/scripts'


class ClientGenerator:
    def __enter__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='homeproxy-generator-')
        self.root = Path(self.temp.name)
        self.hp = self.root / 'homeproxy'
        self.run = self.root / 'run'
        for path in (self.hp / 'diversion', self.hp / 'resources', self.run):
            path.mkdir(parents=True, exist_ok=True)
        for path in (APP / 'root/etc/homeproxy/resources').glob('*.srs'):
            (self.hp / 'resources' / path.name).write_bytes(path.read_bytes())
        validator = self.root / 'validate'
        validator.write_text('''#!/usr/bin/python3
import ipaddress, sys
kind, value = sys.argv[1:]
try:
    if kind == 'ip6addr':
        assert ipaddress.ip_address(value).version == 6
    elif kind == 'ip4addr':
        assert ipaddress.ip_address(value).version == 4
    elif kind == 'port':
        assert 0 < int(value) < 65536
    else:
        raise ValueError('Unexpected validation type: ' + kind)
except (ValueError, AssertionError):
    sys.exit(1)
''')
        validator.chmod(0o755)
        helper = (SCRIPTS / 'homeproxy.uc').read_text()
        helper = helper.replace("'/etc/homeproxy'", json.dumps(str(self.hp)))
        helper = helper.replace("'/var/run/homeproxy'", json.dumps(str(self.run)))
        helper = helper.replace('/sbin/validate_data', shlex.quote(str(validator)))
        (self.root / 'homeproxy.uc').write_text(helper)
        # The cases use DNS URLs without query parameters; fail on unexpected use.
        (self.root / 'luci').mkdir()
        (self.root / 'luci/http.uc').write_text(
            "export function urldecode_params(v) { die('Unexpected query decoder use'); }\n")
        (self.root / 'ubus.uc').write_text('''export function connect() {
    return { call: function() { return { interface: [] }; } };
}
''')
        self.sections: dict[str, dict[str, Any]] = {
            'config': {'.type': 'homeproxy', 'main_node': 'node1',
                       'routing_mode': 'bypass_mainland_china', 'ipv6_support': '0',
                       'dns_server': 'tcp://1.1.1.1', 'china_dns_server': 'udp://223.5.5.5'},
            'control': {'.type': 'control'},
            'infra': {'.type': 'infra', 'clash_api_port': '9090', 'udp_timeout': '300'},
            'node1': {'.type': 'node', 'type': 'socks', 'address': '192.0.2.10',
                      'port': '1080', 'label': 'Fixture node'},
        }
        return self

    def __exit__(self, *args):
        self.temp.cleanup()

    def generate(self, sections=None, domains=None):
        data = copy.deepcopy(self.sections if sections is None else sections)
        for name, section in data.items():
            section['.name'] = name
        for path in (self.hp / 'diversion').glob('*.txt'):
            path.unlink()
        for name, text in (domains or {}).items():
            (self.hp / 'diversion' / (name + '.txt')).write_text(text)
        (self.root / 'uci.uc').write_text('const data = ' + json.dumps(data) + ''';
export function cursor() { return {
    load: function() { return true; },
    get: function(c, s, o) { return o ? data[s]?.[o] : data[s]?.['.type']; },
    get_all: function(c, s) { return data[s]; },
    foreach: function(c, t, cb) {
        for (let name, value in data) if (value['.type'] === t) cb(value);
    }
}; }
''')
        script = self.root / 'generate.uc'
        script.write_text((SCRIPTS / 'generate_client.uc').read_text())
        proc = subprocess.run(['ucode', '-L', str(self.root), '-L',
                               os.environ.get('UCODE_LIB_DIR', '/opt/test-tools/ucode/build'),
                               str(script)], capture_output=True, text=True, timeout=15)
        if proc.returncode:
            raise AssertionError(proc.stderr)
        if proc.stderr:
            raise AssertionError('Unexpected generator warning: ' + proc.stderr)
        config = json.loads((self.run / 'sing-box-c.json.new').read_text())
        binary = os.environ.get('SING_BOX_CHECK')
        if binary:
            subprocess.run([binary, 'check', '-c', str(self.run / 'sing-box-c.json.new')],
                           capture_output=True, text=True, check=True, timeout=15)
        return config
