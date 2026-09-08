#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
workflow = (root.parent / '.github/workflows/update-packages.yaml').read_text()
init = (root / 'root/etc/init.d/homeproxy').read_text()
acl = (root / 'root/usr/share/rpcd/acl.d/luci-app-homeproxy.json').read_text()
rpc = (root / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
caps = (root / 'root/etc/capabilities/homeproxy.json').read_text()
client = (root / 'htdocs/luci-static/resources/homeproxy.js').read_text()
resources = (root / 'root/etc/homeproxy/scripts/update_resources.sh').read_text()

assert 'set -eu' in workflow and 'set -o pipefail' in workflow
assert 'homeproxy_certificate-*' in acl
assert 'homeproxy_certificate.tmp' not in acl
assert 'homeproxy_certificate.tmp' not in rpc
assert "args: { filename: 'filename', temp: 'temp' }" in rpc
assert 'CAP_SYS_PTRACE' not in caps
assert "params: ['filename', 'temp']" in client
assert 'sing-box-c.json.old' in init and 'sing-box-s.json.old' in init
assert 'END { exit invalid }' in resources
print('PASS maintenance regression contracts')