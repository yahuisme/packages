"""Isolated real BusyBox/jshn/UCI tests; every kernel/service path is redirected."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get('OPENWRT_TOOLS', '/root/.local/opt/openwrt-audit-tools'))


class AccelerationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)
        for p in ('proc/sys/net/bridge', 'sys/class/net/br-lan/bridge', 'sys/kernel/debug/ppe',
                  'etc/sysctl.d', 'etc/config', 'var/run', 'tmp', 'bin', 'delta', 'override'):
            (self.d / p).mkdir(parents=True, exist_ok=True)
        # Exercise embedded applets, not GNU host utilities hidden in PATH.
        busybox = shutil.which('busybox')
        assert busybox, 'BusyBox is required'
        self.busybox = busybox
        for applet in subprocess.check_output([self.busybox, '--list'], text=True).splitlines():
            (self.d / 'bin' / applet).symlink_to(self.busybox)
        self.keys = ['call-iptables', 'call-ip6tables', 'call-arptables', 'filter-vlan-tagged',
                     'filter-pppoe-tagged', 'pass-vlan-input-dev']
        for k in self.keys:
            self.knob(k).write_text('1\n')
        (self.d / 'sys/class/net/br-lan/bridge/vlan_filtering').write_text('1\n')
        self.config = self.d / 'etc/config/firewall'
        self.config.write_text("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '1'\n")
        self.conf('11-br-netfilter.conf').write_text(''.join('net.bridge.bridge-nf-' + k + '=0\n' for k in self.keys[:3]))
        self.conf('12-apmode-offload.conf').write_text(''.join('net.bridge.bridge-nf-' + k + '=1\n' for k in self.keys[:3] + ['pass-vlan-input-dev']))
        self.conf('14-vlan-offload.conf').write_text('net.bridge.bridge-nf-filter-vlan-tagged=1\n')
        self.conf('15-pppoe-offload.conf').write_text('net.bridge.bridge-nf-filter-pppoe-tagged=1\n')
        self.hw = self.d / 'hardware'
        self.hw.write_text('1')
        self.script('uci', '#!/bin/sh\ncase "$*" in *" -c "*|-c*) exec ' + str(TOOLS / 'bin/uci') + ' "$@";; esac\nexec ' + str(TOOLS / 'bin/uci') + ' -c ' + str(self.d / 'etc/config') + ' -C ' + str(self.d / 'override') + ' -t ' + str(self.d / 'delta') + ' "$@"\n')
        self.script('nft', '#!/usr/bin/python3\nimport json,os\nfrom pathlib import Path\nif os.getenv("NFT_FAIL"): exit(1)\nprint(json.dumps({"nftables":[{"flowtable":{"family":"inet","table":"fw4","name":"ft","flags":["offload"] if Path("' + str(self.hw) + '").read_text()=="1" else []}}]}))\n')
        self.script('restart', '#!/bin/sh\nprintf restart >> "' + str(self.d / 'restarts') + '"\nif [ "$RESTART_FAIL" = 1 ] && [ ! -e "' + str(self.d / 'failed') + '" ]; then touch "' + str(self.d / 'failed') + '"; exit 1; fi\n[ "$STALE_HW" != 1 ] || exit 0\nuci -q get firewall.@defaults[0].flow_offloading_hw > "' + str(self.hw) + '"\n# strip newline for fixture\ntr -d "\\n" < "' + str(self.hw) + '" > "' + str(self.hw) + '.new"; mv "' + str(self.hw) + '.new" "' + str(self.hw) + '"\n')
        self.env = dict(os.environ, LD_LIBRARY_PATH=str(TOOLS / 'lib'), PATH=str(self.d / 'bin') + ':' + str(TOOLS / 'bin'))
        # Rewrite runtime paths once, before injecting fixture executable paths.
        import re
        source = (ROOT / 'root/usr/libexec/flowsense-acceleration.sh').read_text()
        source = source.replace('/usr/share/libubox/jshn.sh', str(TOOLS / 'share/libubox/jshn.sh'))
        source = source.replace('/etc/init.d/firewall restart', 'fixture_restart')
        source = re.sub(r'/(?:proc|sys|etc|var|tmp)/', lambda m: str(self.d) + m[0], source)
        source = source.replace('fixture_restart', str(self.d / 'bin/restart'))
        rpc = (ROOT / 'root/usr/libexec/rpcd/luci.airoha_flowsense').read_text()
        rpc = rpc.replace('/usr/libexec/flowsense-common.sh', str(ROOT / 'root/usr/libexec/flowsense-common.sh'))
        rpc = rpc.replace('/usr/libexec/flowsense-acceleration.sh', str(self.d / 'acc.sh'))
        (self.d / 'acc.sh').write_text(source)
        (self.d / 'rpc').write_text(rpc)

    def script(self, name, body):
        p = self.d / 'bin' / name
        p.unlink(missing_ok=True)  # Never overwrite the BusyBox symlink target.
        p.write_text(body)
        p.chmod(0o755)

    def knob(self, name):
        return self.d / 'proc/sys/net/bridge' / ('bridge-nf-' + name)

    def conf(self, name):
        return self.d / 'etc/sysctl.d' / name

    def call(self, method='getAcceleration', payload=None, **env):
        # uhttpd injects the authenticated session into the ubus arguments;
        # rpcd plugin.c forwards the complete object to stdin, without a newline.
        request = dict(payload or {}, ubus_rpc_session='0123456789abcdef0123456789abcdef')
        p = subprocess.run([self.busybox, 'ash', str(self.d / 'rpc'), 'call', method],
                           input=json.dumps(request), text=True, capture_output=True,
                           env=dict(self.env, **env), timeout=15)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)

    def save(self, **values):
        return self.call('setAcceleration', dict(dict.fromkeys(('hardware', 'vlan', 'pppoe', 'ap'), -1), **values))

    def snapshot(self):
        return {str(p.relative_to(self.d)): p.read_bytes() for base in ('etc', 'proc')
                for p in (self.d / base).rglob('*') if p.is_file()}

    def bridge_service(self):
        # Model the upstream contract: reload publishes an include, while its
        # background firewall reload is NOT a completion barrier. The explicit
        # firewall restart must consume the newly published include.
        service = self.d / 'etc/init.d/bridge-hw-offload'
        service.parent.mkdir(parents=True, exist_ok=True)
        self.rules = self.d / 'bridge-rules'
        self.rules.write_text(self.hw.read_text())
        self.events = self.d / 'service-events'
        service.write_text('''#!/bin/sh
[ "$1" = reload ] || exit 1
printf 'bridge\\n' >> "EVENTS"
if [ "$BRIDGE_FAIL" = always ]; then exit 1; fi
if [ "$BRIDGE_FAIL" = once ] && [ ! -e "RULES.failed" ]; then
    touch "RULES.failed"; exit 1
fi
uci -q get firewall.@defaults[0].flow_offloading_hw | tr -d '\\n' > "RULES"
'''.replace('EVENTS', str(self.events)).replace('RULES', str(self.rules)))
        service.chmod(0o755)
        self.script('restart', '''#!/bin/sh
printf 'firewall\\n' >> "EVENTS"
if [ "$RESTART_FAIL" = 1 ] && [ ! -e "RULES.restart-failed" ]; then
    touch "RULES.restart-failed"; exit 1
fi
cp "RULES" "HARDWARE"
'''.replace('EVENTS', str(self.events)).replace('RULES', str(self.rules)).replace('HARDWARE', str(self.hw)))

    def test_bridge_include_is_regenerated_before_firewall_both_directions(self):
        self.bridge_service()
        for value in (0, 1):
            self.assertEqual(self.save(hardware=value), {'success': True})
            self.assertEqual(self.rules.read_text(), str(value))
            self.assertIs(self.call()['hardware']['enabled'], bool(value))
            self.assertIs(self.call()['hardware']['configured'], bool(value))
        self.assertEqual(self.events.read_text().splitlines(),
                         ['bridge', 'firewall', 'bridge', 'firewall'])

    def test_bridge_reload_failure_is_not_success_and_recovery_runs(self):
        self.bridge_service()
        before = self.snapshot()
        for mode, error in (('once', 'apply'), ('always', 'rollback')):
            with self.subTest(mode=mode):
                self.events.unlink(missing_ok=True)
                result = self.call('setAcceleration', dict(hardware=0, vlan=-1, pppoe=-1, ap=-1),
                                   BRIDGE_FAIL=mode)
                self.assertEqual(result, {'success': False, 'error': error})
                self.assertEqual(self.snapshot(), before)
                self.assertEqual(self.rules.read_text(), '1')
                self.assertEqual(self.hw.read_text(), '1')
                self.assertEqual(self.events.read_text().splitlines(),
                                 ['bridge', 'firewall', 'bridge', 'firewall'])

    def test_bridge_include_restored_after_firewall_failure(self):
        self.bridge_service()
        before = self.snapshot()
        result = self.call('setAcceleration', dict(hardware=0, vlan=-1, pppoe=-1, ap=-1),
                           RESTART_FAIL='1')
        self.assertEqual(result, {'success': False, 'error': 'apply'})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.rules.read_text(), '1')
        self.assertEqual(self.hw.read_text(), '1')
        self.assertEqual(self.events.read_text().splitlines(),
                         ['bridge', 'firewall', 'bridge', 'firewall'])

    def test_bridge_service_not_called_for_noop_or_sysctl_only(self):
        self.bridge_service()
        self.assertEqual(self.save(hardware=1), {'success': True})
        self.assertEqual(self.save(pppoe=0), {'success': True})
        self.assertFalse(self.events.exists())

    def test_w1700k_bridge_family_readback(self):
        self.script('nft', '#!/usr/bin/python3\nimport json,os,sys\nfrom pathlib import Path\nassert sys.argv[1:] == ["-j","list","flowtables"]\nif os.getenv("NFT_FAIL"): exit(1)\nprint(json.dumps({"nftables":[{"flowtable":{"family":"bridge","table":"fw4","name":"br_offload","flags":["offload"] if Path("' + str(self.hw) + '").read_text()=="1" else []}}]}))\n')
        self.assertTrue(self.call()['hardware']['enabled'])
        for value in (0, 1):
            self.assertEqual(self.save(hardware=value), {'success': True})
            self.assertIs(self.call()['hardware']['enabled'], bool(value))
        self.assertIsNone(self.call(NFT_FAIL='1')['hardware']['enabled'])

    def test_real_w1700k_nft_json_omits_flags(self):
        fixture = ROOT / 'tests/fixtures/w1700k-nft-1.1.6-flowtables.json'
        script = '''#!/usr/bin/python3
import os,sys
from pathlib import Path
a=sys.argv[1:]
if a == ['-j','list','flowtables']:
    print(Path(FIXTURE).read_text())
else:
    assert a in (['list','flowtable','inet','fw4','ft'], ['list','flowtable','bridge','fw4','br_offload'])
    if os.getenv('TEXT_FAIL'): exit(1)
    print('table %s fw4 {' % a[2])
    print(' flowtable %s {' % a[4])
    print('  hook ingress priority filter;')
    if Path(HARDWARE).read_text() == '1': print('  flags offload;')
    print(' }')
    print('}')
'''
        self.script('nft', script.replace('FIXTURE', repr(str(fixture))).replace('HARDWARE', repr(str(self.hw))))
        self.assertTrue(self.call()['hardware']['enabled'])
        for value in (0, 1):
            self.assertEqual(self.save(hardware=value), {'success': True})
            self.assertIs(self.call()['hardware']['enabled'], bool(value))
        self.assertIsNone(self.call(TEXT_FAIL='1')['hardware']['enabled'])

    def test_hardware_ruleset_scope(self):
        for entries, expected in [([], False),
                ([{'family': 'bridge', 'table': 'other', 'flags': ['offload']}], False),
                ([{'family': 'inet', 'table': 'fw4', 'flags': []},
                  {'family': 'bridge', 'table': 'fw4', 'flags': ['offload']}], True)]:
            data = json.dumps({'nftables': [{'flowtable': e} for e in entries]})
            self.script('nft', "#!/bin/sh\nprintf '%s' '" + data + "'\n")
            self.assertIs(self.call()['hardware']['enabled'], expected)

    def test_read_and_both_directions(self):
        self.assertEqual(self.call(), {k: dict(supported=True, enabled=True, configured=True)
                                      for k in ('hardware', 'vlan', 'pppoe', 'ap')})
        for v in (0, 1):
            self.assertEqual(self.save(hardware=v, vlan=v, pppoe=v, ap=v), {'success': True})
            for state in self.call().values():
                self.assertIs(state['enabled'], bool(v))
                self.assertIs(state['configured'], bool(v))
        self.assertEqual(subprocess.check_output([str(self.d / 'bin/uci'), 'changes', 'firewall'], env=self.env), b'')

    def write_stamps(self):
        return {str(p.relative_to(self.d)): p.stat().st_mtime_ns
                for base in ('etc', 'proc') for p in (self.d / base).rglob('*') if p.is_file()}

    def test_full_payload_noop_has_no_writes_or_restart(self):
        before, stamps = self.snapshot(), self.write_stamps()
        self.assertEqual(self.save(hardware=1, vlan=1, pppoe=1, ap=1), {'success': True})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.write_stamps(), stamps)
        self.assertFalse((self.d / 'restarts').exists())

    def test_full_payload_vlan_only_does_not_restart_or_rewrite_others(self):
        self.assertTrue(self.save(ap=0)['success'])
        for value in (0, 1):
            stamps = self.write_stamps()
            self.assertEqual(self.save(hardware=1, vlan=value, pppoe=1, ap=0), {'success': True})
            changed = {p for p, stamp in self.write_stamps().items() if stamps.get(p) != stamp}
            self.assertEqual(changed, {'etc/sysctl.d/14-vlan-offload.conf',
                                       'proc/sys/net/bridge/bridge-nf-filter-vlan-tagged'})
            self.assertFalse((self.d / 'restarts').exists())
            self.assertIs(self.call()['vlan']['configured'], bool(value))
            self.assertIs(self.call()['vlan']['enabled'], bool(value))

    def test_staged_offload_is_not_committed_and_noop_still_rejects_pending(self):
        before = self.snapshot()
        uci = str(self.d / 'bin/uci')
        subprocess.check_call([uci, 'set', 'firewall.@defaults[0].flow_offloading_hw=0'], env=self.env)
        staged = subprocess.check_output([uci, 'changes', 'firewall'], env=self.env)
        self.assertEqual(subprocess.check_output([uci, 'get', 'firewall.@defaults[0].flow_offloading_hw'], env=self.env), b'0\n')
        self.assertIs(self.call()['hardware']['configured'], True)
        self.assertEqual(self.save(hardware=1, vlan=1, pppoe=1, ap=1),
                         {'success': False, 'error': 'pending_changes'})
        self.assertEqual(subprocess.check_output([uci, 'changes', 'firewall'], env=self.env), staged)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.d / 'restarts').exists())

    def test_committed_getter_ignores_uci_override(self):
        before = self.config.read_bytes()
        (self.d / 'override/firewall').write_text("config defaults\n option flow_offloading '0'\n option flow_offloading_hw '0'\n")
        self.assertEqual(subprocess.check_output([str(self.d / 'bin/uci'), 'get',
                         'firewall.@defaults[0].flow_offloading_hw'], env=self.env), b'0\n')
        self.assertIs(self.call()['hardware']['configured'], True)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(list((self.d / 'tmp').iterdir()), [])

    def test_vlan_enable_preserves_explicit_ap_off(self):
        # AP is off solely because VLAN is off, although its other knobs are on.
        self.knob('filter-vlan-tagged').write_text('0\n')
        self.conf('14-vlan-offload.conf').write_text('net.bridge.bridge-nf-filter-vlan-tagged=0\n')
        self.assertIs(self.call()['ap']['enabled'], False)
        self.assertEqual(self.save(hardware=1, vlan=1, pppoe=1, ap=0), {'success': True})
        self.assertIs(self.call()['ap']['enabled'], False)
        self.assertIs(self.call()['ap']['configured'], False)
        self.assertIs(self.call()['vlan']['enabled'], True)
        self.assertFalse((self.d / 'restarts').exists())

    def test_matching_runtime_still_repairs_persistence(self):
        self.config.write_text("config defaults\n option flow_offloading '0'\n option flow_offloading_hw '0'\n")
        self.conf('15-pppoe-offload.conf').write_text('net.bridge.bridge-nf-filter-pppoe-tagged=0\n')
        self.assertEqual(self.save(hardware=1, pppoe=1), {'success': True})
        self.assertTrue((self.d / 'restarts').exists())
        self.assertIs(self.call()['hardware']['configured'], True)
        self.assertIs(self.call()['pppoe']['configured'], True)

    def test_matching_persistence_still_repairs_runtime(self):
        self.hw.write_text('0')
        self.knob('filter-pppoe-tagged').write_text('0\n')
        self.assertEqual(self.save(hardware=1, pppoe=1), {'success': True})
        self.assertTrue((self.d / 'restarts').exists())
        self.assertIs(self.call()['hardware']['enabled'], True)
        self.assertIs(self.call()['pppoe']['enabled'], True)

    def test_validation_before_writes(self):
        before = self.snapshot()
        for value in ('1', True, None, 2, -2, 1.0, {}, []):
            self.assertEqual(self.save(pppoe=value)['error'], 'invalid')
            self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.call('setAcceleration', {'hardware': 1})['error'], 'invalid')

    def test_ap_vlan_conflicts_and_independence(self):
        before = self.snapshot()
        self.assertEqual(self.save(vlan=0)['error'], 'ap_requires_vlan')
        self.assertEqual(self.save(vlan=0, ap=1)['error'], 'ap_requires_vlan')
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(self.save(ap=0)['success'])
        self.assertTrue(self.call()['vlan']['enabled'])
        self.assertTrue(self.save(vlan=0)['success'])
        self.assertEqual(self.save(ap=1)['error'], 'ap_requires_vlan')
        self.assertTrue(self.save(ap=1, vlan=1)['success'])

    def test_missing_files_defaults_unknown_runtime(self):
        for f in ('12-apmode-offload.conf', '14-vlan-offload.conf', '15-pppoe-offload.conf'):
            self.conf(f).unlink()
        state = self.call()
        for k in ('ap', 'vlan', 'pppoe'):
            self.assertTrue(state[k]['supported'])
            self.assertFalse(state[k]['configured'])
        self.assertTrue(self.save(ap=1, vlan=1, pppoe=1)['success'])
        self.knob('filter-pppoe-tagged').unlink()
        self.assertFalse(self.call()['pppoe']['supported'])
        self.assertIsNone(self.call()['pppoe']['enabled'])
        before = self.snapshot()
        self.assertEqual(self.save(hardware=0, pppoe=0)['error'], 'unsupported')
        self.assertEqual(self.snapshot(), before)
        self.assertIsNone(self.call(NFT_FAIL='1')['hardware']['enabled'])

    def test_pending_uci_untouched(self):
        subprocess.check_call([str(self.d / 'bin/uci'), 'set', 'firewall.@defaults[0].input=DROP'], env=self.env)
        staged = subprocess.check_output([str(self.d / 'bin/uci'), 'changes', 'firewall'], env=self.env)
        before = self.snapshot()
        self.assertEqual(self.save(hardware=0, vlan=0, ap=0)['error'], 'pending_changes')
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(subprocess.check_output([str(self.d / 'bin/uci'), 'changes', 'firewall'], env=self.env), staged)
        self.assertFalse((self.d / 'restarts').exists())

    def test_restart_and_runtime_readback_rollback(self):
        before = self.snapshot()
        for env in ({'RESTART_FAIL': '1'}, {'STALE_HW': '1'}):
            result = self.call('setAcceleration', dict(hardware=0, vlan=0, pppoe=0, ap=0), **env)
            self.assertEqual(result, {'success': False, 'error': 'apply'})
            self.assertEqual(self.snapshot(), before)
            self.assertTrue(self.call()['hardware']['enabled'])

    def test_persistence_override_rejected_and_rolled_back(self):
        self.conf('99-custom.conf').write_text('net.bridge.bridge-nf-filter-pppoe-tagged=1\n')
        before = self.snapshot()
        self.assertEqual(self.save(pppoe=0), {'success': False, 'error': 'apply'})
        self.assertEqual(self.snapshot(), before)

    def test_write_failure_rolls_back_files_and_sysctls(self):
        before = self.snapshot()
        source = (self.d / 'acc.sh').read_text()
        source = source.replace('acc_put() {', '''acc_put() {
            if [ "$1:$2" = filter-pppoe-tagged:0 ] && [ ! -e "$tmp/injected" ]; then
                touch "$tmp/injected"; return 1
            fi
        ''')
        (self.d / 'acc.sh').write_text(source)
        self.assertEqual(self.save(hardware=0, vlan=0, pppoe=0, ap=0), {'success': False, 'error': 'apply'})
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(self.call()['hardware']['enabled'])

    def test_persistence_write_failure(self):
        before = self.snapshot()
        cp = shutil.which('cp')
        assert cp
        marker = self.d / 'copy-failed'
        self.script('cp', '#!/bin/sh\ncase "$*" in *"/new/15-pppoe-offload.conf"*) '
                    '[ -e "' + str(marker) + '" ] || { touch "' + str(marker) + '"; exit 1; };; esac\nexec ' + cp + ' "$@"\n')
        self.assertEqual(self.save(hardware=0, vlan=0, pppoe=0, ap=0), {'success': False, 'error': 'apply'})
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(marker.exists())

    def test_private_uci_failure_and_failed_rollback(self):
        before = self.snapshot()
        source = (self.d / 'acc.sh').read_text()
        (self.d / 'acc.sh').write_text(source.replace('acc_private() {', 'acc_private() { return 1;'))
        self.assertEqual(self.save(hardware=0), {'success': False, 'error': 'apply'})
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.d / 'restarts').exists())
        (self.d / 'acc.sh').write_text(source)
        self.script('restart', '#!/bin/sh\nexit 1\n')
        self.assertEqual(self.save(hardware=0), {'success': False, 'error': 'rollback'})
        self.assertEqual(self.snapshot(), before)

    def test_absent_original_files_restored(self):
        self.conf('15-pppoe-offload.conf').unlink()
        self.conf('99-custom.conf').write_text('net.bridge.bridge-nf-filter-pppoe-tagged=1\n')
        before = self.snapshot()
        self.assertEqual(self.save(pppoe=0), {'success': False, 'error': 'apply'})
        self.assertEqual(self.snapshot(), before)

    def test_busy_malformed_nft_and_empty_ppe(self):
        (self.d / 'var/run/flowsense-acceleration.lock').mkdir()
        self.assertEqual(self.save(hardware=0)['error'], 'busy')
        self.assertTrue(self.call()['hardware']['enabled'])  # no PPE entries required
        self.script('nft', '#!/bin/sh\nprintf "{}"\n')
        self.assertIsNone(self.call()['hardware']['enabled'])

    def test_non_vlan_ap_does_not_disable_vlan(self):
        (self.d / 'sys/class/net/br-lan/bridge/vlan_filtering').write_text('0\n')
        for v in (0, 1):
            self.assertTrue(self.save(ap=v)['success'])
            self.assertTrue(self.call()['vlan']['enabled'])
            self.assertIs(self.call()['ap']['enabled'], bool(v))

    def test_browser_payload_from_hardware_off_bridge_on(self):
        # This is a controlled fixture, not evidence of the screenshot's
        # device state. Exercise each edit with the full browser payload.
        self.config.write_text("config defaults\n option flow_offloading '0'\n option flow_offloading_hw '0'\n")
        self.hw.write_text('0')
        baseline = dict(hardware=0, vlan=1, pppoe=1, ap=1)
        for edits in (dict(hardware=1), dict(pppoe=0), dict(ap=0), dict(vlan=0, ap=0)):
            with self.subTest(edits=edits):
                requested = dict(baseline, **edits)
                self.assertEqual(self.save(**requested), {'success': True})
                state = self.call()
                for key, value in requested.items():
                    self.assertIs(state[key]['enabled'], bool(value))
                    self.assertIs(state[key]['configured'], bool(value))
                self.assertEqual(self.save(**baseline), {'success': True})
        self.assertEqual(subprocess.check_output([str(self.d / 'bin/uci'), 'changes', 'firewall'], env=self.env), b'')

    def test_each_acceleration_key_is_independent(self):
        baseline = dict(hardware=0, vlan=1, pppoe=1, ap=0)
        self.config.write_text("config defaults\n option flow_offloading '0'\n option flow_offloading_hw '0'\n")
        self.hw.write_text('0')
        for key in baseline:
            with self.subTest(key=key):
                requested = dict(baseline)
                requested[key] = 1 - requested[key]
                self.assertEqual(self.save(**requested), {'success': True})
                state = self.call()
                self.assertIs(state[key]['configured'], bool(requested[key]))
                for other in baseline:
                    self.assertIs(state[other]['configured'], bool(requested[other]))

    def test_unknown_settings_rejected_and_direct_call_works(self):
        before, stamps = self.snapshot(), self.write_stamps()
        for extra in ({'unexpected': 1}, {'hardware_extra': 1}):
            self.assertEqual(self.save(**extra), {'success': False, 'error': 'invalid'})
            self.assertEqual(self.snapshot(), before)
            self.assertEqual(self.write_stamps(), stamps)
        self.assertFalse((self.d / 'restarts').exists())
        # Direct local ubus callers do not carry HTTP session metadata.
        payload = dict.fromkeys(('hardware', 'vlan', 'pppoe', 'ap'), 0)
        result = subprocess.run([self.busybox, 'ash', str(self.d / 'rpc'), 'call', 'setAcceleration'],
                                input=json.dumps(payload), text=True, capture_output=True,
                                env=self.env, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'success': True})
        for state in self.call().values():
            self.assertIs(state['enabled'], False)
            self.assertIs(state['configured'], False)

    def test_acl_and_discovery(self):
        acl = json.loads((ROOT / 'root/usr/share/rpcd/acl.d/luci-app-airoha-flowsense.json').read_text())['luci-app-airoha-flowsense']
        self.assertIn('getAcceleration', acl['read']['ubus']['luci.airoha_flowsense'])
        self.assertIn('setAcceleration', acl['write']['ubus']['luci.airoha_flowsense'])
        methods = json.loads(subprocess.check_output([self.busybox, 'ash', str(self.d / 'rpc'), 'list'], env=self.env))
        self.assertEqual(methods['setAcceleration'], dict.fromkeys(('hardware', 'vlan', 'pppoe', 'ap'), 'int'))


if __name__ == '__main__':
    unittest.main()
