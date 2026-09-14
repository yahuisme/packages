"""Isolated BusyBox ash regression; OPENWRT_SOURCE must contain native rc/procd.
No daemon is started. UCI, ucode, JSON serialization and system commands are
platform boundaries; production init and native submission wrappers run intact.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]
BASE = Path(os.environ['OPENWRT_SOURCE'])
INIT = (APP / 'root/etc/init.d/homeproxy').read_text()
RC = (BASE / 'package/base-files/files/etc/rc.common').read_text()
PROCD = (BASE / 'package/system/procd/files/procd.sh').read_text()


def fn(source, name, indent=''):
    begin = source.index(indent + name + '() {')
    end = source.index('\n' + indent + '}', begin) + len(indent) + 2
    return source[begin:end] + '\n'


class Reload(unittest.TestCase):
    def run_case(self, fault='', mode='client'):
        with tempfile.TemporaryDirectory(prefix='homeproxy-reload-') as d:
            root = Path(d)
            run = root / 'run'
            run.mkdir()
            dns = root / 'dns/dnsmasq-homeproxy.d'
            dns.mkdir(parents=True)
            old = {run / 'sing-box-c.json': 'OLD CLIENT',
                   run / 'sing-box-s.json': 'OLD SERVER',
                   run / 'fw4_input.nft': 'OLD FIREWALL',
                   dns / 'redirect-dns.conf': 'OLD DNS',
                   dns.parent / 'dnsmasq-homeproxy.conf': 'OLD INCLUDE'}
            for path, text in old.items():
                path.write_text(text)
            logs = {run / 'sing-box-c.log': 'CLIENT HISTORY', run / 'sing-box-s.log': 'SERVER HISTORY'}
            for path, text in logs.items():
                path.write_text(text)
            inodes = {path: path.stat().st_ino for path in old}
            (root / 'bin').mkdir()
            ubus = root / 'bin/ubus'
            ubus.write_text('#!/bin/sh\nprintf "ubus:%s\\n" "$4" >> "$ROOT/events"\ncase "$FAULT" in ubus|restore-remove|restore-copy) exit 1;; esac\n')
            ubus.chmod(0o755)
            # Load every production function without executing its path discovery.
            code = INIT[INIT.index('log() {'):] + '\n'
            code = code.replace('/usr/libexec/homeproxy-runtime-init', 'runtime_init')
            code = code.replace('/etc/init.d/dnsmasq', 'dnsmasq')
            code += ''.join(fn(RC, n, '\t') for n in ['rc_procd', 'start', 'stop', 'reload'])
            code += ''.join(fn(PROCD, n) for n in ['_procd_call', '_procd_ubus_call', '_procd_close_service'])
            code += r'''
config_load() { :; }
config_get() {
 case "$2.$3" in
 config.main_node) if [ "$MODE" = server ] || [ "$MODE" = disabled ]; then eval "$1=nil"; else eval "$1=node"; fi;;
 config.routing_mode) eval "$1=bypass_mainland_china";;
 *) eval "$1=\"$4\"";; esac
}
config_get_bool() {
 case "$2.$3:$MODE" in server.enabled:server|server.enabled:both|config.dashboard_enabled:*) eval "$1=1";; *) eval "$1=0";; esac
}
sync_subscription_cron() { :; }
procd_lock() { :; }
procd_kill() { printf 'kill\n' >> "$ROOT/events"; }
procd_open_service() { INSTANCES=''; }
procd_open_instance() { INSTANCES="$INSTANCES $1"; }
procd_close_instance() { :; }
procd_set_param() { printf 'param:%s\n' "$*" >> "$ROOT/params"; }
procd_append_param() { procd_set_param "$@"; }
procd_close_service() { _procd_call _procd_close_service "$@"; }
_procd_open_trigger() { :; }
_procd_close_trigger() { :; }
service_triggers() { :; }
json_set_namespace() { [ -z "$2" ] || eval "$2=old"; return 0; }
json_close_object() { :; }
json_dump() { printf '%s' "$INSTANCES"; }
json_cleanup() { :; }
runtime_init() { [ "$FAULT" != runtime-init ]; }
ucode() {
 case "$*" in
 *cleanup_urltest*) [ "$FAULT" != cleanup ]; return $?;;
 *firewall_pre*) printf 'NEW FIREWALL' > "$RUN_DIR/fw4_input.nft"; [ "$FAULT" != firewall-pre ]; return $?;;
 *generate_client*) [ "$FAULT" != generate ] || return 1; printf 'NEW CLIENT' > "$RUN_DIR/sing-box-c.json.new";;
 *generate_server*) [ "$FAULT" != generate-server ] || return 1; printf 'NEW SERVER' > "$RUN_DIR/sing-box-s.json.new";; esac
}
check_stub() { [ "$FAULT" != check ]; }
sing-box() { printf 'fixture'; }
chown() { :; }
fw4() { printf 'fw4\n' >> "$ROOT/events"; if [ "$FAULT" = fw4 ] && [ ! -e "$ROOT/failed" ]; then touch "$ROOT/failed"; return 1; fi; }
dnsmasq() { printf 'dns\n' >> "$ROOT/events"; if [ "$FAULT" = dns ] && [ ! -e "$ROOT/failed" ]; then touch "$ROOT/failed"; return 1; fi; }
mkdir() { if [ "$FAULT" = dns-prepare ] && [ "$2" = "$DNSMASQ_DIR" ]; then return 1; fi; command mkdir "$@"; }
cp() { if [ "$FAULT" = restore-copy ] && [ "$3" = "$DNSMASQ_DIR" ]; then return 1; fi; command cp "$@"; }
rm() { if [ "$FAULT" = restore-remove ] && [ "$1" = -rf ] && [ "$2" = "$DNSMASQ_DIR" ]; then return 1; fi; command rm "$@"; }
mv() { if [ "$FAULT" = install ] && [ "$1" = -f ] && [ "$2" = "$RUN_DIR/sing-box-s.json.new" ]; then return 1; fi; command mv "$@"; }
'''
            code += f'\nROOT={root}\nRUN_DIR={run}\nDNSMASQ_DIR={dns}\n'
            code += f'HP_DIR={root}/hp\nDASHBOARD_DIR={root}/dashboard\n'
            code += 'LOG_PATH="$RUN_DIR/log"\nCACHE_DIR="$HP_DIR/cache"\nCACHE_PATH="$CACHE_DIR/cache.db"\n'
            code += 'mkdir -p "$DASHBOARD_DIR"; printf index > "$DASHBOARD_DIR/index.html"\n'
            code += 'CONF=homeproxy\nPROG=check_stub\ninitscript=/etc/init.d/homeproxy\nreload\nexit $?\n'
            script = root / 'test.sh'
            script.write_text(code)
            env = dict(os.environ, ROOT=d, FAULT=fault, MODE=mode,
                       PATH=str(root / 'bin') + ':' + os.environ['PATH'])
            result = subprocess.run(['busybox', 'ash', str(script)], env=env, capture_output=True, text=True)
            events = (root / 'events').read_text().splitlines() if (root / 'events').exists() else []
            self.assertEqual(result.stderr, '')
            if mode != 'disabled':
                for path, text in logs.items():
                    self.assertEqual(path.read_text(), text, (fault, path))
            self.assertNotIn('kill', events)
            if fault.startswith('restore-'):
                self.assertNotEqual(result.returncode, 0)
                backups = list(run.glob('.reload.*'))
                self.assertEqual(len(backups), 1)
                self.assertEqual((backups[0] / 'dnsmasq.d/redirect-dns.conf').read_text(), 'OLD DNS')
                self.assertFalse((dns / 'dnsmasq.d').exists())
                self.assertIn('restoration was incomplete', (run / 'log').read_text())
                return
            if fault:
                self.assertNotEqual(result.returncode, 0, (fault, events))
                for path, text in old.items():
                    self.assertTrue(path.exists(), (fault, path, events))
                    self.assertEqual(path.read_text(), text, (fault, path, events))
                    if fault in ('runtime-init', 'cleanup', 'generate', 'generate-server', 'check'):
                        self.assertEqual(path.stat().st_ino, inodes[path], (fault, path))
                if fault != 'ubus':
                    self.assertFalse(any(e.startswith('ubus:') for e in events), events)
            else:
                self.assertEqual(result.returncode, 0, events)
                submitted = [e for e in events if e.startswith('ubus:')]
                self.assertEqual(len(submitted), 1)
                for suffix, enabled in [('c', mode in ('client', 'both')), ('s', mode in ('server', 'both'))]:
                    self.assertEqual((run / f'sing-box-{suffix}.json').exists(), enabled)
                    self.assertEqual(f'sing-box-{suffix}' in submitted[0], enabled)
                if mode != 'disabled':
                    params = (root / 'params').read_text()
                    if mode != 'server':
                        for name in ['sing-box-c.json', 'geoip_cn.srs', 'geosite_cn.srs', 'dashboard.ver']:
                            self.assertIn(name, params)

    def test_preparation_retains_runtime(self):
        for fault in ['runtime-init', 'cleanup', 'generate', 'check', 'generate-server']:
            with self.subTest(fault=fault):
                self.run_case(fault, 'both')

    def test_application_retains_runtime(self):
        for fault in ['install', 'firewall-pre', 'fw4', 'dns-prepare', 'dns', 'ubus']:
            with self.subTest(fault=fault):
                self.run_case(fault, 'both')

    def test_success_and_disabled(self):
        for mode in ['client', 'server', 'both', 'disabled']:
            with self.subTest(mode=mode):
                self.run_case(mode=mode)

    def test_preexisting_logs_retained_on_success_and_failure(self):
        for fault in ['', 'generate', 'check', 'fw4', 'dns', 'ubus']:
            with self.subTest(fault=fault):
                # Logs are runtime state and must survive reload outcomes.
                self.run_case(fault, 'both')

    def test_failed_restore_retains_backup(self):
        for fault in ['restore-remove', 'restore-copy']:
            with self.subTest(fault=fault):
                self.run_case(fault, 'both')

    def test_disabled_dns_failure(self):
        self.run_case('dns', 'disabled')


if __name__ == '__main__':
    unittest.main()
