#!/usr/bin/env python3
"""Isolated RPC tests. UCI_BIN and JSONFILTER_BIN select host-built tools."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager

PACKAGE = Path(__file__).resolve().parents[1]
BACKEND = PACKAGE / 'root/usr/libexec/rpcd/luci.airoha_npu'

# Frozen pre-optimization escaper: it stays the oracle for every published string.
LEGACY_QUOTE = r"""	printf '%s' "$1" | awk 'BEGIN { for(j=1;j<32;j++) esc[sprintf("%c",j)]=sprintf("\\u%04x",j); printf "\"" } { if (NR>1) printf "\\n"; for(i=1;i<=length;i++) { c=substr($0,i,1); if(c=="\"" || c=="\\") printf "\\%s",c; else if(c=="\r") printf "\\r"; else if(c in esc) printf "%s",esc[c]; else printf "%s",c } } END { printf "\"" }'"""

UCI_PATH = os.environ.get('UCI_BIN') or shutil.which('uci')
JSONFILTER_PATH = os.environ.get('JSONFILTER_BIN') or shutil.which('jsonfilter')

JSONFILTER_SCRIPT = '''#!/usr/bin/env python3
import json, sys
s = None
target = None
mode = 'e'
it = iter(sys.argv[1:])
for arg in it:
    if arg == '-s': s = next(it)
    elif arg == '-t': mode = 't'; target = next(it)
    elif arg == '-e': mode = 'e'; target = next(it)
if s is None:
    s = sys.stdin.read()
try:
    data = json.loads(s)
    key = target.replace('@.', '')
    if not isinstance(data, dict) or key not in data:
        sys.exit(1)
    val = data[key]
    if mode == 't':
        if isinstance(val, str): print('string')
        elif isinstance(val, int) and not isinstance(val, bool): print('int')
        elif isinstance(val, float): print('double')
        elif isinstance(val, bool): print('boolean')
        elif val is None: print('null')
        elif isinstance(val, list): print('array')
        else: print('object')
    else:
        if val is not None:
            if isinstance(val, (dict, list)): sys.exit(1)
            print(val)
        else:
            sys.exit(1)
except Exception:
    sys.exit(1)
'''

UCI_SCRIPT = r'''#!/usr/bin/env python3
import sys
from pathlib import Path
import re

args = sys.argv[1:]
config_dir = None
delta_dir = None
it = iter(args)
clean_args = []
for arg in it:
    if arg == '-q': pass
    elif arg == '-c': config_dir = Path(next(it))
    elif arg in ('-P', '-C', '-t'): next(it)
    else: clean_args.append(arg)

if not clean_args:
    sys.exit(0)

cmd = clean_args[0]
if config_dir is None:
    raise RuntimeError('Fixture UCI requires a private config directory')
firewall_file = config_dir / 'firewall'

def read_firewall():
    if not firewall_file.exists(): return {}
    content = firewall_file.read_text()
    res = {}
    cur_sec = None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith('config defaults'):
            cur_sec = 'defaults'
            res[cur_sec] = {}
        elif line.startswith('option') and cur_sec:
            parts = line.split(None, 2)
            if len(parts) == 3:
                key = parts[1]
                val = parts[2].strip("'\"")
                res[cur_sec][key] = val
    return res

if cmd == 'show':
    data = read_firewall()
    if 'defaults' not in data: sys.exit(1)
    print('firewall.@defaults[0]=defaults')
    for key, value in data['defaults'].items():
        print("firewall.@defaults[0].%s='%s'" % (key, value))
    sys.exit(0)

if cmd == 'get':
    target = clean_args[1]
    data = read_firewall()
    if target == 'firewall.@defaults[0]':
        if 'defaults' in data:
            print('defaults')
            sys.exit(0)
        sys.exit(1)
    elif target.startswith('firewall.@defaults[0].'):
        key = target.split('.', 2)[2]
        val = data.get('defaults', {}).get(key)
        if val is not None:
            print(val)
            sys.exit(0)
        sys.exit(1)
    sys.exit(1)

# This adapter intentionally cannot mutate configuration.
sys.exit(1)
'''

class Backend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.policy = self.root / 'sys/devices/system/cpu/cpufreq/policy0'
        self.policy.mkdir(parents=True)
        (self.root / 'var/lock').mkdir(parents=True)

        tool_bin = self.root / 'bin'
        tool_bin.mkdir(parents=True)
        
        jsonfilter_bin = JSONFILTER_PATH
        if not jsonfilter_bin:
            jf = tool_bin / 'jsonfilter'
            jf.write_text(JSONFILTER_SCRIPT)
            jf.chmod(0o755)
            jsonfilter_bin = str(jf)

        uci_bin = UCI_PATH
        if not uci_bin:
            ub = tool_bin / 'uci'
            ub.write_text(UCI_SCRIPT)
            ub.chmod(0o755)
            uci_bin = str(ub)

        self.env = dict(os.environ, NPU_ROOT=str(self.root),
                        NPU_JSONFILTER=jsonfilter_bin,
                        NPU_UCI=uci_bin)
        for name, value in {'scaling_available_governors': 'performance powersave schedutil',
                            'scaling_governor': 'schedutil',
                            'scaling_available_frequencies': '500000 1200000 1400000',
                            'scaling_min_freq': '500000', 'scaling_max_freq': '1200000',
                            'scaling_cur_freq': '500000'}.items():
            (self.policy / name).write_text(value + '\n')

    def call(self, method, args=None):
        return json.loads(subprocess.check_output(['busybox', 'ash', str(BACKEND), 'call', method],
                         input=json.dumps(args or {}).encode(), env=self.env, timeout=5))

    def assert_lock_available(self):
        # Probe the persistent inode, not its presence: unlinking a held lock can
        # create two independently locked inodes and defeat mutual exclusion.
        lock = self.root / 'var/lock/luci-airoha-npu.lock'
        self.assertTrue(lock.is_file())
        result = subprocess.run(['flock', '-n', str(lock), 'true'], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)

    @contextmanager
    def held_lock(self):
        lock = self.root / 'var/lock/luci-airoha-npu.lock'
        with subprocess.Popen(['busybox', 'ash', '-c',
                'exec 9>> "$1"; flock -n 9 || exit; printf "held\\n"; read -r done',
                'lock-holder', str(lock)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True) as holder:
            try:
                assert holder.stdout is not None
                self.assertEqual(holder.stdout.readline(), 'held\n')
                yield lock
            finally:
                holder.communicate('\n', timeout=5)
                self.assertEqual(holder.returncode, 0)

    def wait_exited(self, pid):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status = Path('/proc') / str(pid) / 'status'
            try:
                state = status.read_text()
            except FileNotFoundError:
                return
            if re.search(r'^State:\s+Z', state, re.M):
                return
            time.sleep(.01)
        self.fail('owned fixture process did not exit: %s' % pid)

    @contextmanager
    def held_settings(self, inherited_child=False):
        # Gate the real jsonfilter boundary after acquisition. The wrapper
        # reports the actual ash owner via PPID; no production lock is mocked.
        wrapper = self.root / 'jsonfilter-gate'
        owner = self.root / 'lock-owner'
        child = self.root / 'lock-child'
        release = self.root / 'release-lock-child'
        busybox = shutil.which('busybox')
        self.assertIsNotNone(busybox)
        assert busybox is not None
        wrapper.write_text('#!' + busybox + ' ash\n'
                           'printf "%s\\n" "$PPID" > "$NPU_ROOT/lock-owner"\n'
                           'printf "%s\\n" "$$" > "$NPU_ROOT/lock-child"\n'
                           + ('while [ ! -f "$NPU_ROOT/release-lock-child" ]; do sleep 0.01; done\n'
                              if inherited_child else 'kill -STOP "$PPID"\n')
                           + 'exec "$REAL_JSONFILTER" "$@"\n')
        wrapper.chmod(0o700)
        env = dict(self.env, NPU_JSONFILTER=str(wrapper), REAL_JSONFILTER=self.env['NPU_JSONFILTER'])
        with subprocess.Popen(['busybox', 'ash', str(BACKEND), 'call', 'saveSettings'],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=env, text=True) as request:
            assert request.stdin is not None
            request.stdin.write(json.dumps(dict(governor='performance', freq='1400000')))
            request.stdin.close()
            request.stdin = None
            owner_pid = None
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if owner.exists():
                        text = owner.read_text().strip()
                        if text.isdigit():
                            owner_pid = int(text)
                            state = Path('/proc') / str(owner_pid) / 'status'
                            if inherited_child and child.exists() and child.read_text().strip().isdigit():
                                break
                            if not inherited_child and state.exists() and re.search(
                                    r'^State:\s+T', state.read_text(), re.M):
                                break
                    if request.poll() is not None:
                        self.fail('settings exited before reaching the held native-tool boundary')
                    time.sleep(.01)
                else:
                    self.fail('settings did not reach the held native-tool boundary')
                if not inherited_child:
                    # The SIGKILL release case has no surviving child holder;
                    # the separate inheritance case deliberately keeps one.
                    self.wait_exited(int(child.read_text()))
                yield owner_pid, request
            finally:
                if owner_pid:
                    try:
                        os.kill(owner_pid, 9)
                    except ProcessLookupError:
                        pass
                release.touch()
                request.communicate(timeout=5)
                if child.exists() and child.read_text().strip().isdigit():
                    self.wait_exited(int(child.read_text()))

    def test_settings_lock_declares_dependency(self):
        makefile = (PACKAGE / 'Makefile').read_text()
        depends = re.search(r'^LUCI_DEPENDS:=(.*)$', makefile, re.M)
        self.assertIsNotNone(depends)
        assert depends is not None
        self.assertIn('+flock', depends.group(1).split())

    def test_settings_lock_sigkill_releases_without_cleanup(self):
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        with self.held_settings() as (owner, request):
            for method in ('getSettings', 'saveSettings', 'applySettings'):
                self.assertEqual(self.call(method, dict(governor='powersave', freq='500000')),
                                 dict(error='busy'))
            self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
            self.assertFalse((self.root / 'etc/airoha-npu/pending.json').exists())
            os.kill(owner, 9)
            request.communicate(timeout=5)
            # No rmdir, PID probe or reboot: a fresh RPC must recover itself.
            self.assertEqual(self.call('getSettings'), dict(result='ok', pending=None))
            self.assert_lock_available()
        payload = dict(governor='powersave', freq='500000')
        self.assertEqual(self.call('saveSettings', payload), dict(result='ok'))
        self.assertEqual(self.call('applySettings', dict(expected=json.dumps(payload))), dict(result='ok'))

    def test_settings_lock_inherited_fd_blocks_until_child_exits(self):
        with self.held_settings(inherited_child=True) as (owner, request):
            os.kill(owner, 9)
            self.wait_exited(owner)
            # The native child still owns the inherited open-file description.
            for method in ('getSettings', 'saveSettings', 'applySettings'):
                self.assertEqual(self.call(method), dict(error='busy'))
            (self.root / 'release-lock-child').touch()
            request.communicate(timeout=5)
            # The jsonfilter stdout pipe belonged to the dead owner's command
            # substitution, not Popen; wait for the actual last fd holder.
            self.wait_exited(int((self.root / 'lock-child').read_text()))
            self.assertEqual(self.call('getSettings'), dict(result='ok', pending=None))
            self.assert_lock_available()

    def test_settings_lock_contention_preserves_inode_and_state(self):
        payload = dict(governor='performance', freq='1400000')
        self.assertEqual(self.call('saveSettings', payload), dict(result='ok'))
        pending = self.root / 'etc/airoha-npu/pending.json'
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        saved = (pending.read_bytes(), pending.stat().st_mtime_ns)
        with self.held_lock() as lock:
            identity = (lock.stat().st_dev, lock.stat().st_ino)
            for method in ('getSettings', 'saveSettings', 'applySettings'):
                self.assertEqual(self.call(method, dict(governor='powersave', freq='500000')),
                                 dict(error='busy'))
                self.assertEqual((lock.stat().st_dev, lock.stat().st_ino), identity)
                # A failed contender must not replace or unlock the held inode.
                contender = subprocess.run(['flock', '-n', str(lock), 'true'], timeout=5)
                self.assertEqual(contender.returncode, 1)
                self.assertEqual((pending.read_bytes(), pending.stat().st_mtime_ns), saved)
                self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        for method, args in [('getSettings', {}), ('saveSettings', payload),
                             ('applySettings', dict(expected=json.dumps(payload)))]:
            self.assertEqual(self.call(method, args)['result'], 'ok')
            self.assertEqual((lock.stat().st_dev, lock.stat().st_ino), identity)
            self.assert_lock_available()

    def test_settings_lock_ignores_legacy_directory_without_removing_it(self):
        legacy = self.root / 'var/lock/luci-airoha-npu'
        legacy.mkdir()
        marker = legacy / 'legacy-owner'
        marker.write_text('do not reap by PID or unlink an old owner')
        identity = legacy.stat().st_ino
        payload = dict(governor='performance', freq='1400000')
        self.assertEqual(self.call('getSettings'), dict(result='ok', pending=None))
        self.assertEqual(self.call('saveSettings', payload), dict(result='ok'))
        self.assertEqual(self.call('applySettings', dict(expected=json.dumps(payload))), dict(result='ok'))
        self.assertEqual(legacy.stat().st_ino, identity)
        self.assertEqual(marker.read_text(), 'do not reap by PID or unlink an old owner')
        self.assert_lock_available()

    def test_settings_lock_fail_closed_and_retry(self):
        payload = dict(governor='performance', freq='1400000')
        self.assertEqual(self.call('saveSettings', payload), dict(result='ok'))
        pending = self.root / 'etc/airoha-npu/pending.json'
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        saved = (pending.read_bytes(), pending.stat().st_mtime_ns)
        original_path = self.env['PATH']
        private_bin = self.root / 'no-flock-bin'
        private_bin.mkdir()
        # Only acquisition dependencies are reachable. flock is intentionally
        # absent, while cat/mkdir and the native BusyBox shell remain usable.
        for name in ('busybox', 'cat', 'mkdir'):
            path = shutil.which(name)
            self.assertIsNotNone(path)
            assert path is not None
            (private_bin / name).symlink_to(path)
        self.env['PATH'] = str(private_bin)
        cases = ['missing', 'failure', 'bad-path', 'directory']
        lock = self.root / 'var/lock/luci-airoha-npu.lock'
        for failure in cases:
            with self.subTest(failure=failure):
                if failure == 'failure':
                    (private_bin / 'flock').write_text('#!/bin/sh\nexit 73\n')
                    (private_bin / 'flock').chmod(0o700)
                elif failure == 'bad-path':
                    self.env['PATH'] = original_path
                    lock.unlink()
                    lock.symlink_to('/dev/null/lock')
                elif failure == 'directory':
                    lock.unlink()
                    lock.mkdir()
                for method in ('getSettings', 'saveSettings', 'applySettings'):
                    self.assertEqual(self.call(method, payload), dict(error='busy'))
                    self.assertEqual((pending.read_bytes(), pending.stat().st_mtime_ns), saved)
                    self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        lock.rmdir()
        self.assertEqual(self.call('getSettings')['pending'], payload)
        self.assertEqual(self.call('saveSettings', payload), dict(result='ok'))
        self.assertEqual(self.call('applySettings', dict(expected=json.dumps(payload))), dict(result='ok'))
        self.assert_lock_available()

    def test_status_builtin_reads_preserve_complete_file_values(self):
        # Compare byte-for-byte with the original cat-based getter, including
        # legacy multiline online output; do not silently normalize malformed data.
        oracle = self.root / 'cat-oracle'
        source = BACKEND.read_text()
        prefix, getter = source.split('get_status() {', 1)
        getter, suffix = getter.split('get_info() {', 1)
        # Legacy field reads were one cat inside a command substitution, and the
        # published text always went through the awk escaper.
        legacy = ('legacy_word() { word=$(cat "$1" 2>/dev/null); }\n'
                  'legacy_status_text() { status_text=$(cat "$1" 2>/dev/null); }\n'
                  'legacy_quote() {\n' + LEGACY_QUOTE + '\n}\n')
        oracle.write_text(prefix + legacy + 'get_status() {' +
                          getter.replace('read_status_text', 'legacy_status_text')
                                .replace('quote', 'legacy_quote')
                                .replace('read_word', 'legacy_word') +
                          'get_info() {' + suffix)
        paths = [self.policy / ('scaling_' + name) for name in
                 ('cur_freq', 'max_freq', 'min_freq', 'governor')]
        paths += [self.root / 'sys/kernel/debug/clk/npu/clk_rate',
                  self.root / 'sys/devices/system/cpu/online']
        for p in paths:
            p.parent.mkdir(parents=True, exist_ok=True)
        values = [None, b'', b'500000', b'500000\n', b'500000\n\n',
                  b'500000\n600000', b'\n500000\n', b'0-1\n4-5\n',
                  b' schedutil\t\\test\r\nmore\n', b'bad"\\\x01\tend']
        for content in values:
            with self.subTest(content=content):
                for p in paths:
                    if p.exists(): p.unlink()
                    if content is not None: p.write_bytes(content)
                def run(script):
                    return subprocess.run(['busybox', 'ash', '-x', str(script), 'call', 'getStatus'],
                                          input=b'{}', env=self.env, capture_output=True, check=True)
                expected, actual = run(oracle), run(BACKEND)
                self.assertEqual(actual.stdout, expected.stdout)
                # One cat still consumes RPC stdin; none may read status files.
                cats = re.findall(rb'^\++ cat(?: |$)', actual.stderr, re.M)
                self.assertEqual(len(cats), 1, 'six status file reads must use shell builtins')

    def test_cpu_online_count_matches_previous_awk(self):
        # Freeze the per-poll awk pass this replaced; the shell path must agree
        # on every single-line value read_word can hand it.
        source = BACKEND.read_text()
        counter = source[source.index('cpu_count() {'):source.index('get_status() {')]
        awk = ("printf '%s\\n' \"$1\" | awk '/^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$/ "
               "{ n=split($0,a,\",\"); for(i=1;i<=n;i++) { k=split(a[i],b,\"-\"); "
               "if(k==2 && b[2]<b[1]) exit; count+=k==2?b[2]-b[1]+1:1 } print count; ok=1 } "
               "END { if(!ok) print \"null\" }'")
        shell = counter + '\nprintf "%s" "$(cpu_count "$1")"\n'
        status_src = source[source.index('get_status() {'):source.index('get_info() {')]
        self.assertNotRegex(status_src, r'\$\(\s*read_word\b',
                            'status fields must be read in place, not captured')
        self.assertNotIn('awk', counter, 'the per-poll counter must not spawn awk')
        for value in ['', '0', '0-3', '0-1,4,6-7', '4-4', '5-3', '01', '0-01', ',', ',,',
                      '0,', ',0', '0,,1', '3,,4', '-', '0-', '-1', '0--1', '0-1-2', '1,2,3',
                      'a', '0 1', ' 0-1', '999', '0-0', '7-9', '0-9,10-19']:
            with self.subTest(value=value):
                expected = subprocess.run(['busybox', 'ash', '-c', awk, 'x', value],
                                          capture_output=True, text=True, timeout=10).stdout.strip()
                actual = subprocess.run(['busybox', 'ash', '-c', shell, 'x', value],
                                        capture_output=True, text=True, timeout=10).stdout.strip()
                self.assertEqual(actual, expected)

    def test_status_poll_spawns_no_child_process(self):
        # Everything get_status publishes is now read and escaped in this shell;
        # a 3 s poll must not fork for a governor string either.
        source = BACKEND.read_text()
        status = source[source.index('get_status() {'):source.index('get_info() {')]
        self.assertNotIn('$(', status, 'status fields must stay in this shell')
        self.assertNotIn('`', status, 'status fields must stay in this shell')
        self.assertIn('read_status_text', status)
        quote = source[source.index('quote() {'):source.index('number() {')]
        # The unescaped fast path must return before the awk pipeline.
        self.assertLess(quote.index('printf \'"%s"\''), quote.index('awk'),
                        'plain strings must not reach the escaper child')

    def test_quote_fast_path_matches_previous_awk(self):
        # Freeze the awk escaper the fast path bypasses; the two must agree on
        # every byte a policy file or sysfs attribute can hand over.
        source = BACKEND.read_text()
        quote = source[source.index('quote() {'):source.index('number() {')]
        (self.root / 'quote-new').write_text(quote + '\nquote "$1"\n')
        (self.root / 'quote-old').write_text(
            'legacy_quote() {\n' + LEGACY_QUOTE + '\n}\nlegacy_quote "$1"\n')
        values = ['', 'schedutil', '300000 500000 2200000', 'perf-x_y.z:1/2,3', ' lead',
                  'trail ', 'a"b', 'a\\b', 'tab\there', 'line\nbreak', '\n', 'a\rb',
                  '\x01', '\x1f', '\x7f', '中文', '`cmd`', '$(cmd)', '*', '?', '[a]', '~']
        for value in values:
            with self.subTest(value=value):
                def run(script):
                    return subprocess.run(['busybox', 'ash', str(self.root / script), value],
                                          capture_output=True, timeout=10).stdout
                self.assertEqual(run('quote-new'), run('quote-old'))

    def test_bound_flow_count(self):
        bind = self.root / 'sys/kernel/debug/ppe/bind'
        self.assertIsNone(self.call('getPpeStatus')['bound_entries'])
        bind.parent.mkdir(parents=True)
        for content, expected in [('', 0),
                ('00000 BND IPv4 5T orig=fixture packets=1 bytes=80\n'
                 '08000 BND L2B eth=fixture packets=0 bytes=0\n', 2),
                ('00001 BND IPv6 5T orig=fixture', 1),
                ('00001 UNB IPv4 5T\n', None),
                ('unrecognized output\n', None)]:
            bind.write_text(content)
            self.assertEqual(self.call('getPpeStatus')['bound_entries'], expected)
        bind.unlink(); bind.mkdir()
        self.assertIsNone(self.call('getPpeStatus')['bound_entries'])

    def test_cpu_validation(self):
        payload = {'governor': 'performance', 'freq': '1400000'}
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        for field, values in {
                'governor': ['.*', '-e', 'performance powersave', 'sched', '', None, ['performance']],
                'freq': ['0500000', '500000.0', '5e5', '+500000', '500000\n', '50000', 500000, None]
        }.items():
            for bad in values:
                self.assertEqual(self.call('saveSettings', dict(payload, **{field: bad})), {'error': 'invalid'})
                self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        self.assertEqual(self.call('saveSettings', payload), {'result': 'ok'})
        self.assertEqual(self.call('applySettings'), {'result': 'ok'})
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'performance')
        self.assertEqual((self.policy / 'scaling_max_freq').read_text().strip(), '1400000')
        self.assertEqual((self.policy / 'scaling_min_freq').read_text().strip(), '500000')
        self.assertEqual(self.call('getStatus')['cpu_cur_freq'], 500000)

    def test_unavailable_readback_preserves_other_field(self):
        self.assertEqual(self.call('saveSettings', {'governor': 'performance', 'freq': '1400000'}), {'result': 'ok'})
        target = self.policy / 'scaling_max_freq'
        target.unlink()
        target.symlink_to('/dev/null')
        self.assertEqual(self.call('applySettings'), {'error': 'unavailable'})
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'schedutil')

    def test_removed_setters_cannot_mutate_cpu(self):
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        for method in ('setGovernor', 'setMaxFreq'):
            self.assertEqual(self.call(method, {'governor': 'performance', 'freq': '1400000'}), {'error': 'unsupported'})
            self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        self.assertFalse((self.root / 'etc/airoha-npu').exists())

    def test_read_only_flow_status(self):
        config = self.root / 'etc/config'
        config.mkdir(parents=True)
        firewall = config / 'firewall'
        (self.root / 'tmp').mkdir()
        self.assertIsNone(self.call('getFlowOffload')['enabled'])
        for sw, hw, expected in [('1', '1', True), ('1', '0', False),
                                 ('0', '1', False), ('0', '0', False),
                                 ('invalid', '1', None)]:
            original = f"config defaults\n\toption flow_offloading '{sw}'\n\toption flow_offloading_hw '{hw}'\n"
            firewall.write_text(original)
            self.assertIs(self.call('getFlowOffload')['enabled'], expected)
            self.assertEqual(self.call('setFlowOffload', {'enabled': '1'})['error'], 'unsupported')
            self.assertEqual(firewall.read_text(), original)

    @unittest.skipUnless(UCI_PATH, 'requires real UCI (set UCI_BIN)')
    def test_committed_flow_ignores_staging_and_overrides(self):
        config = self.root / 'etc/config'
        config.mkdir(parents=True)
        (self.root / 'tmp').mkdir()
        stage, override = self.root / 'staged', self.root / 'override'
        stage.mkdir(); override.mkdir()
        firewall = config / 'firewall'
        wrapper = self.root / 'uci-private'
        # Explicit isolation from the backend must not inherit wrapper -t paths.
        wrapper.write_text('#!/bin/sh\ncase " $* " in *" -C "*) exec "$REAL_UCI" "$@";; esac\n'
                           'exec "$REAL_UCI" -C "$TEST_OVERRIDE" -t "$TEST_STAGE" "$@"\n')
        wrapper.chmod(0o700)
        self.env.update(NPU_UCI=str(wrapper), REAL_UCI=str(UCI_PATH),
                        TEST_OVERRIDE=str(override), TEST_STAGE=str(stage))
        def uci(*args):
            return subprocess.check_output([str(UCI_PATH), '-c', str(config), '-C', str(override),
                                            '-t', str(stage), *args], env=self.env, text=True)
        for committed, staged in [('1', '0'), ('0', '1')]:
            with self.subTest(committed=committed):
                firewall.write_text("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '%s'\n" % committed)
                before = (firewall.read_bytes(), firewall.stat().st_mtime_ns)
                uci('set', 'firewall.@defaults[0].flow_offloading_hw=' + staged)
                delta = uci('changes', 'firewall')
                self.assertIn("flow_offloading_hw='%s'" % staged, delta)
                self.assertIs(self.call('getFlowOffload')['enabled'], committed == '1')
                self.assertEqual(uci('changes', 'firewall'), delta)
                self.assertEqual((firewall.read_bytes(), firewall.stat().st_mtime_ns), before)
                uci('revert', 'firewall')
                (override / 'firewall').write_text("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '%s'\n" % staged)
                self.assertIs(self.call('getFlowOffload')['enabled'], committed == '1')
                (override / 'firewall').unlink()
        self.assertEqual(list((self.root / 'tmp').iterdir()), [])

    @unittest.skipUnless(UCI_PATH, 'requires real UCI (set UCI_BIN)')
    def test_flow_read_failures_and_defaults(self):
        config = self.root / 'etc/config'
        config.mkdir(parents=True)
        (self.root / 'tmp').mkdir()
        firewall = config / 'firewall'
        original = "config defaults\n option flow_offloading '1'\n option flow_offloading_hw '1'\n"
        firewall.write_text(original)
        wrapper = self.root / 'uci-failure'
        wrapper.write_text('#!/bin/sh\ncase " $* " in *"$FAIL_READ"*) exit 1;; esac\nexec "$REAL_UCI" "$@"\n')
        wrapper.chmod(0o700)
        self.env.update(NPU_UCI=str(wrapper), REAL_UCI=str(UCI_PATH))
        before = (firewall.read_bytes(), firewall.stat().st_mtime_ns)
        for target in ['get firewall.@defaults[0].flow_offloading ',
                       'get firewall.@defaults[0].flow_offloading_hw ',
                       'get firewall.@defaults[0] ', 'show firewall.@defaults[0] ']:
            with self.subTest(failure=target):
                self.env['FAIL_READ'] = target
                self.assertIsNone(self.call('getFlowOffload')['enabled'])
                self.assertEqual((firewall.read_bytes(), firewall.stat().st_mtime_ns), before)
        self.env['NPU_UCI'] = str(UCI_PATH)
        # Real UCI drops empty option values, so these are also absent/default-off.
        for content, expected in [("config defaults\n", False),
                                 ("config defaults\n option flow_offloading '1'\n", False),
                                 ("config defaults\n option flow_offloading_hw '1'\n", False),
                                 ("config defaults\n option flow_offloading '11'\n", None),
                                 ("config defaults\n option flow_offloading ''\n", False),
                                 ("config rule\n", None), ("config defaults\n option broken '\n", None)]:
            with self.subTest(content=content):
                firewall.write_text(content)
                self.assertIs(self.call('getFlowOffload')['enabled'], expected)
        self.assertEqual(list((self.root / 'tmp').iterdir()), [])
        (self.root / 'tmp').rmdir()
        self.assertIsNone(self.call('getFlowOffload')['enabled'])

    def test_official_without_cpufreq(self):
        for path in self.policy.iterdir():
            path.unlink()
        self.policy.rmdir()
        status = self.call('getStatus')
        self.assertIsNone(status['cpu_cur_freq'])
        self.assertIsNone(status['cpu_max_freq'])
        self.assertEqual(status['cpu_governor'], '')
        info = self.call('getInfo')
        self.assertEqual(info['governors'], '')
        self.assertEqual(info['frequencies'], '')
        self.assertEqual(self.call('getSettings'), {'result': 'ok', 'pending': None})
        payload = {'governor': 'performance', 'freq': '1400000'}
        self.assertEqual(self.call('saveSettings', payload), {'error': 'invalid'})
        self.assertEqual(self.call('applySettings'), {'error': 'unavailable'})
        self.assertFalse(self.policy.exists())
        self.assertFalse((self.root / 'etc/airoha-npu/pending.json').exists())

    def test_info_and_missing(self):
        dt = self.root / 'proc/device-tree'
        dt.mkdir(parents=True)
        (dt / 'compatible').write_bytes(b'example,board\0airoha,test\0')
        (self.root / 'sys/devices/system/cpu/online').write_text('0-1,4,6-7\n')
        self.assertEqual(self.call('getInfo').get('soc_compat'), 'example,board, airoha,test')
        status = self.call('getStatus')
        self.assertEqual(status['cpu_count'], 5)
        self.assertIsNone(status['npu_clock'])
        self.assertIsNone(status['npu_bound'])

        drivers = self.root / 'sys/bus/platform/drivers/airoha-npu'
        drivers.mkdir(parents=True)
        (drivers / '1e900000.npu').symlink_to(self.policy)
        self.assertTrue(self.call('getStatus')['npu_bound'])
        firmware = dt / 'soc/npu@1e900000'
        firmware.mkdir(parents=True)
        (firmware / 'firmware-name').write_bytes(b'airoha/rv32.bin\0')
        self.assertEqual(self.call('getInfo')['firmware_file'], '/lib/firmware/airoha/rv32.bin')
        self.assertEqual(self.call('getInfo')['firmware_file_version'], '')
        (dt / 'compatible').write_bytes(b'quote"\\\x01test\tend\0')
        self.assertEqual(self.call('getInfo')['soc_compat'], 'quote"\\\x01test\tend')

    def test_apply_expected_snapshot_rejects_another_sessions_save(self):
        original = dict(governor='performance', freq='1400000')
        replacement = dict(governor='powersave', freq='500000')
        self.assertEqual(self.call('saveSettings', original), dict(result='ok'))
        self.assertEqual(self.call('saveSettings', replacement), dict(result='ok'))
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        self.assertEqual(self.call('applySettings', dict(expected=json.dumps(original))), dict(error='busy'))
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        self.assertEqual(self.call('getSettings')['pending'], replacement)
        for invalid in (None, False, 0, [], {}, '', 'null', '{broken', json.dumps(dict(governor='powersave'))):
            with self.subTest(expected=invalid):
                self.assertEqual(self.call('applySettings', dict(expected=invalid)), dict(error='invalid'))
                self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        self.assertEqual(self.call('applySettings', dict(expected=json.dumps(replacement))), dict(result='ok'))
        self.assertEqual(self.call('getStatus')['cpu_governor'], 'powersave')
        self.assertEqual(self.call('getSettings')['pending'], replacement)

    def test_settings_staging(self):
        payload = {'governor': 'performance', 'freq': '1400000', 'ubus_rpc_session': 'fixture'}
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()}
        self.assertIsNone(self.call('getSettings')['pending'])
        self.assertEqual(self.call('saveSettings', payload), {'result': 'ok'})
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.policy.iterdir()})
        pending = self.root / 'etc/airoha-npu/pending.json'
        self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
        self.assertEqual(pending.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.call('getSettings')['pending'], {'governor': 'performance', 'freq': '1400000'})
        self.assertEqual(self.call('applySettings'), {'result': 'ok'})
        self.assertEqual(self.call('getStatus')['cpu_governor'], 'performance')
        self.assertEqual(self.call('getStatus')['cpu_max_freq'], 1400000)
        # Saved baseline remains durable after Apply; neither read nor reboot auto-applies it.
        self.assertEqual(self.call('getSettings')['pending'], json.loads(pending.read_text()))
        for gov, freq in [('schedutil', '1400000'), ('schedutil', '1200000'), ('performance', '500000')]:
            self.assertEqual(self.call('saveSettings', {'governor': gov, 'freq': freq}), {'result': 'ok'})
            self.assertEqual(self.call('applySettings'), {'result': 'ok'})
            self.assertEqual(self.call('getStatus')['cpu_governor'], gov)
            self.assertEqual(self.call('getStatus')['cpu_max_freq'], int(freq))
        original = pending.read_bytes()
        for changes in [{'governor': 'bad'}, {'freq': '500000\n'}, {'freq': 500000}, {'governor': None}]:
            self.assertEqual(self.call('saveSettings', dict(payload, **changes))['error'], 'invalid')
            self.assertEqual(pending.read_bytes(), original)
        with self.held_lock():
            for method in ('getSettings', 'applySettings', 'saveSettings'):
                self.assertEqual(self.call(method, payload), {'error': 'busy'})
        self.assert_lock_available()
        pending.unlink(); pending.mkdir()
        self.assertEqual(self.call('saveSettings', payload)['error'], 'storage')
        pending.rmdir(); pending.write_text('{broken')
        self.assertEqual(self.call('getSettings')['error'], 'invalid')
        self.assertEqual(self.call('applySettings')['error'], 'invalid')
        pending.unlink(); pending.symlink_to(self.policy / 'scaling_governor')
        for method in ['getSettings', 'saveSettings', 'applySettings']:
            self.assertEqual(self.call(method, payload)['error'], 'storage')

    def test_cpufreq_bounded_forward_and_rollback_convergence(self):
        # CPUFreq QoS sysfs stores queue work; regular files model the backing
        # request, and only read_value models the independently visible policy.
        payload = dict(governor='performance', freq='1400000')
        self.assertEqual(self.call('saveSettings', payload), dict(result='ok'))
        source = BACKEND.read_text()
        needle = 'read_value() { cat "$1" 2>/dev/null; }'
        self.assertEqual(source.count(needle), 1)
        replacement = '''read_value() {
    case "$1" in */scaling_max_freq)
        current=$(cat "$1")
        n=$(cat "$ROOT/read-count" 2>/dev/null); n=$((${n:-0} + 1))
        printf '%s\\n' "$n" > "$ROOT/read-count"
        printf '%s\\n' "$current" >> "$ROOT/read-trace"
        if [ "$current" = 1400000 ]; then
            touch "$ROOT/forward-seen"
            f=$(cat "$ROOT/forward-count" 2>/dev/null); f=$((${f:-0} + 1))
            printf '%s\\n' "$f" > "$ROOT/forward-count"
            if [ "$MODE" != delayed ] || [ "$f" -le 2 ]; then printf '1200000\\n'; return; fi
        elif [ "$MODE" = rollback-delayed ] && [ -e "$ROOT/forward-seen" ]; then
            r=$(cat "$ROOT/rollback-count" 2>/dev/null); r=$((${r:-0} + 1))
            printf '%s\\n' "$r" > "$ROOT/rollback-count"
            if [ "$r" -le 2 ]; then printf '1400000\\n'; return; fi
        fi;;
    esac
    cat "$1" 2>/dev/null
}'''
        rpc = self.root / 'async-rpc'
        import time
        for mode, expected in [('delayed', dict(result='ok')), ('never', dict(error='write_failed')),
                               ('rollback-delayed', dict(error='write_failed')), ('write-failed', dict(error='write_failed'))]:
            with self.subTest(mode=mode):
                for name in ('read-count', 'read-trace', 'forward-count', 'rollback-count', 'forward-seen'):
                    (self.root / name).unlink(missing_ok=True)
                (self.policy / 'scaling_max_freq').write_text('1200000\n')
                (self.policy / 'scaling_governor').write_text('schedutil\n')
                current_source = source.replace(needle, replacement)
                if mode == 'write-failed':
                    write = 'printf \'%s\\n\' "$freq" > "$POLICY/scaling_max_freq"'
                    self.assertEqual(current_source.count(write), 1)
                    # Real BusyBox printf/ENOSPC; keep rollback's private file writable.
                    current_source = current_source.replace(write, 'printf \'%s\\n\' "$freq" > /dev/full')
                rpc.write_text(current_source)
                start = time.monotonic()
                result = subprocess.run(['busybox', 'ash', str(rpc), 'call', 'applySettings'], input='{}',
                                        text=True, capture_output=True, env=dict(self.env, MODE=mode), timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), expected)
                self.assertLess(time.monotonic() - start, 3, 'bounded request, no persistent worker')
                count = int((self.root / 'read-count').read_text())
                self.assertLessEqual(count, 13, 'one snapshot + at most six reads per direction')
                if mode == 'delayed': self.assertEqual(int((self.root / 'forward-count').read_text()), 3)
                if mode in ('never', 'rollback-delayed'):
                    self.assertEqual(int((self.root / 'forward-count').read_text()), 6, 'timeout exhausts exactly the bounded forward reads')
                    self.assertGreaterEqual(time.monotonic() - start, .25, 'failed convergence must actually wait')
                if mode == 'rollback-delayed': self.assertEqual(int((self.root / 'rollback-count').read_text()), 3)
                if mode == 'write-failed': self.assertFalse((self.root / 'forward-seen').exists(), 'failed write is not retried or treated as convergence')
                self.assertEqual((self.policy / 'scaling_max_freq').read_text().strip(), '1400000' if mode == 'delayed' else '1200000')
                self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'performance' if mode == 'delayed' else 'schedutil')
                self.assertEqual(self.call('getSettings')['pending'], payload)
                self.assert_lock_available()

    def test_settings_rollback(self):
        payload = {'governor': 'performance', 'freq': '1400000'}
        self.assertEqual(self.call('saveSettings', payload), {'result': 'ok'})
        copied = self.root / 'rpc'
        copied.write_text(BACKEND.read_text().replace(
            'read_value() { cat "$1" 2>/dev/null; }',
            'read_value() { case "$1" in */scaling_max_freq) printf "1200000\\n";; *) cat "$1" 2>/dev/null;; esac; }'))
        def apply():
            return json.loads(subprocess.check_output(['busybox', 'ash', str(copied), 'call', 'applySettings'], input=b'{}', env=self.env))
        self.assertEqual(apply()['error'], 'write_failed')
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'schedutil')
        self.assertEqual((self.policy / 'scaling_max_freq').read_text().strip(), '1200000')
        self.assertEqual(self.call('getSettings')['pending'], payload)
        target = self.policy / 'scaling_max_freq'
        target.unlink(); target.symlink_to('/dev/full')
        self.assertEqual(apply()['error'], 'rollback_failed')
        self.assertEqual((self.policy / 'scaling_governor').read_text().strip(), 'schedutil')
        target.unlink(); target.write_text('1200000\n')
        self.assertEqual(self.call('applySettings'), {'result': 'ok'})

    def test_surface(self):
        source = BACKEND.read_text()
        for forbidden in ('devmem', 'setOverclock', 'getPpeEntries', 'modprobe', 'bridge-nf-', '_run_with_deadline'):
            self.assertNotIn(forbidden, source)
        methods = json.loads(subprocess.check_output(['sh', str(BACKEND), 'list']))
        self.assertEqual(set(methods), {'getStatus', 'getInfo', 'getFlowOffload', 'getPpeStatus', 'getSettings', 'saveSettings', 'applySettings'})

if __name__ == '__main__':
    unittest.main()
