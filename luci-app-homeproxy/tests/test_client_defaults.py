"""Client default cleanup: real ucode/ash, private paths, no services/builds.

Stable compatibility reviewed against SagerNet/sing-box v1.14.2:
constant/timeout.go (UDPTimeout = 5m), protocol/{mixed,tun}/inbound.go,
option/dns.go (plain bool fields), and its pinned sing-tun
v0.9.6-0.20260924001923-ddaa4ca25e3b tun.go DNSModeOrDefault (hijack).
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from client_generator_fixture import ClientGenerator

APP = Path(__file__).resolve().parents[1]
INIT = APP / 'root/etc/init.d/homeproxy'


class ClientDefaults(unittest.TestCase):
    def test_unused_dns_and_false_defaults_omitted(self):
        with ClientGenerator() as fixture:
            for mode in ('global', 'bypass_mainland_china'):
                with self.subTest(mode=mode):
                    fixture.sections['config']['routing_mode'] = mode
                    config = fixture.generate()
                    self.assertNotIn('system-dns', json.dumps(config))
                    self.assertNotIn('disable_cache', config['dns'])
                    self.assertNotIn('disable_expire', config['dns'])
                    self.assertTrue(config['dns']['reverse_mapping'])
                    self.assertEqual(config['dns']['strategy'], 'ipv4_only')

    def test_udp_default_omission_and_explicit_conversion(self):
        with ClientGenerator() as fixture:
            for option, expected in [('300', None), (None, None), ('', None),
                                     ('60', '60s'), ('301', '301s'), ('0', '0s'),
                                     ('0300', '0300s')]:
                with self.subTest(option=option):
                    if option is None:
                        fixture.sections['infra'].pop('udp_timeout', None)
                    else:
                        fixture.sections['infra']['udp_timeout'] = option
                    config = fixture.generate()
                    for inbound in config['inbounds']:
                        if inbound['type'] in ('mixed', 'tun'):
                            if expected is None:
                                self.assertNotIn('udp_timeout', inbound)
                            else:
                                self.assertEqual(inbound['udp_timeout'], expected)

    def test_dns_mode_default_and_local_ipv6_unchanged(self):
        with ClientGenerator() as fixture:
            for mode in ('global', 'bypass_mainland_china'):
                for ipv6 in ('0', '1'):
                    with self.subTest(mode=mode, ipv6=ipv6):
                        fixture.sections['config'].update({'routing_mode': mode, 'ipv6_support': ipv6})
                        config = fixture.generate()
                        tun = next(i for i in config['inbounds'] if i['type'] == 'tun')
                        self.assertNotIn('dns_mode', tun)
                        self.assertTrue(tun['auto_route'])
                        self.assertTrue(tun['auto_redirect'])
                        self.assertEqual(tun['address'], ['172.19.0.1/30'] +
                                         (['fdfe:dcba:9876::1/126'] if ipv6 == '1' else []))
                        self.assertEqual(config['dns'].get('strategy'),
                                         'ipv4_only' if ipv6 == '0' else None)
                        cache = config.get('experimental', {}).get('cache_file')
                        if mode == 'global':
                            self.assertIsNone(cache)
                        else:
                            self.assertTrue(cache['enabled'])
                            self.assertFalse(cache['store_dns'])

    def test_real_ash_submission_keeps_watchers_and_server_jail(self):
        source = INIT.read_text()
        blocks = []
        for instance in ('client', 'server'):
            block = source.split('# sing-box (' + instance + ')', 1)[1]
            blocks.append(block.split('procd_close_instance', 1)[0] + 'procd_close_instance\n')
        with tempfile.TemporaryDirectory(prefix='homeproxy-jail-defaults-') as tmp:
            root = Path(tmp)
            ujail = root / 'ujail'
            ujail.write_text('#!/bin/sh\nexit 99\n')
            ujail.chmod(0o755)
            for mode in ('global', 'bypass_mainland_china'):
                for ready in ('0', '1'):
                    with self.subTest(mode=mode, dashboard_ready=ready):
                        code = '''
procd_open_instance() { instance="$1"; }
procd_close_instance() { :; }
procd_set_param() { printf '%s:param:%s\\n' "$instance" "$*"; }
procd_append_param() { procd_set_param "$@"; }
procd_add_jail() { printf '%s:jail:%s\\n' "$instance" "$*"; }
procd_add_jail_mount() { printf '%s:mount:%s\\n' "$instance" "$*"; }
procd_add_jail_mount_rw() { printf '%s:mount-rw:%s\\n' "$instance" "$*"; }
uname() { printf '6.12.0\\n'; }
'''
                        code += '\n'.join(blocks).replace('/sbin/ujail', str(ujail))
                        env = dict(os.environ, RUN_DIR=str(root), HP_DIR=str(root),
                                   DASHBOARD_DIR=str(root / 'dashboard'),
                                   CACHE_PATH=str(root / 'cache.db'), PROG='not-executed',
                                   routing_mode=mode, dashboard_ready=ready)
                        result = subprocess.run(['busybox', 'ash', '-c', code], env=env,
                                                capture_output=True, text=True, check=True)
                        self.assertEqual(result.stderr, '')
                        self.assertNotIn('sing-box-c:jail:', result.stdout)
                        self.assertNotIn('sing-box-c:mount', result.stdout)
                        self.assertIn('sing-box-s:jail:sing-box-s log procfs', result.stdout)
                        self.assertIn('sing-box-s:mount-rw:' + str(root / 'certs') + '/', result.stdout)
                        self.assertEqual('dashboard.ver' in result.stdout, ready == '1')
                        self.assertEqual('geoip_cn.srs' in result.stdout, mode == 'bypass_mainland_china')

    def test_client_jail_removed_server_and_watchers_preserved(self):
        source = INIT.read_text()
        client = source.split('# sing-box (client)', 1)[1].split('procd_close_instance', 1)[0]
        self.assertNotIn('procd_add_jail', client)
        self.assertIn('local dashboard_enabled dashboard_ready=0', source)
        self.assertIn('dashboard_ready=1', source)
        self.assertIn('[ "$dashboard_ready" -ne 1 ] ||', client)
        self.assertIn('procd_append_param file "$DASHBOARD_DIR/dashboard.ver"', client)
        server = source.split('# sing-box (server)', 1)[1].split('procd_close_instance', 1)[0]
        self.assertIn('procd_add_jail "sing-box-s" log procfs', server)
        self.assertIn('procd_add_jail_mount_rw "$HP_DIR/certs/"', server)
        self.assertIn('case "$client_ready:$routing_mode" in\n\t"1:bypass_mainland_china")', source)


if __name__ == '__main__':
    unittest.main()
