#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
firewall = (root / 'root/etc/homeproxy/scripts/firewall_post.ut').read_text()
generator = (root / 'root/etc/homeproxy/scripts/generate_client.uc').read_text()
updater = (root / 'root/etc/homeproxy/scripts/update_resources.sh').read_text()

assert "readfile(resources_dir + '/china_ip4.txt')" in firewall
assert "readfile(resources_dir + '/china_ip6.txt')" in firewall
assert 'fast_bypass_mainland' in firewall
assert "path: HP_DIR + '/resources/geoip_cn.srs'" in generator
assert "path: HP_DIR + '/resources/geosite_cn.srs'" in generator
assert 'geoip_cn.srs' in updater and 'geosite_cn.srs' in updater
print('PASS SRS ruleset migration contracts')
