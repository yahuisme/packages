"""Root-controlled runtime parent, real uid 5566, ash cleaner and ucode RPC."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]
MODULE = APP / 'root/etc/homeproxy/scripts/runtime-files.uc'
IMPORT = 'import { logNames, readLog, cleanLog } from ' + json.dumps(str(MODULE)) + ';'


@unittest.skipUnless(os.geteuid() == 0, 'runtime owner boundary requires root')
class LogPermissions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hp-log-owner-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o755)
        self.runtime = self.root / 'run'
        self.runtime.mkdir()
        os.chown(self.runtime, 5566, 5566)
        self.victim = self.root / 'root-secret'
        self.victim.write_bytes(b'v' * 73728)
        self.victim.chmod(0o600)

    def without_stat(self, env):
        # The stock OpenWrt rootfs doesn't ship the BusyBox stat applet.
        bindir = self.root / 'bin'
        bindir.mkdir(exist_ok=True)
        stat = bindir / 'stat'
        stat.write_text('#!/bin/sh\nexit 127\n')
        stat.chmod(0o755)
        return dict(env, PATH=str(bindir) + ':' + env['PATH'])

    def service(self, code):
        def drop():
            os.setgroups([])
            os.setgid(5566)
            os.setuid(5566)
        return subprocess.run(['python3', '-c', code], cwd=self.root, preexec_fn=drop,
                              capture_output=True, text=True, timeout=10)

    def prepare(self):
        source = (APP / 'root/etc/init.d/homeproxy').read_text()
        # Execute the actual complete init setup. Platform/procd/network calls
        # are already bounded by the maintained reload fixture's contract.
        functions = source[source.index('log() {'):source.index('\nstop_service() {')]
        functions = functions.replace('/usr/libexec/homeproxy-runtime-init', 'runtime_init')
        functions = functions.replace('/etc/init.d/dnsmasq', 'dnsmasq')
        functions = functions.replace('sing-box version -n', 'sing_box_stub version -n')
        functions = functions.replace('sing-box:sing-box', '5566:5566')
        shell = '''
config_load() { :; }
config_get() { case "$2.$3" in config.main_node) eval "$1=node";; *) eval "$1=\\\"$4\\\"";; esac; }
config_get_bool() { case "$2.$3" in server.enabled) eval "$1=1";; *) eval "$1=0";; esac; }
runtime_init() { :; }
sync_subscription_cron() { :; }
dnsmasq_discover() { :; }
ucode() { case "$*" in *prepareFiles*) command ucode "$@";; *generate_client*) (umask 077; printf '{"client":"secret"}' > "$RUN_DIR/sing-box-c.json.new");; *generate_server*) (umask 077; printf '{"server":"secret"}' > "$RUN_DIR/sing-box-s.json.new");; esac; }
check_stub() { :; }
sing_box_stub() { printf fixture; }
fw4() { :; }
# Resolver activation is a platform boundary in this log ownership fixture.
dnsmasq_restart() { :; }
procd_open_instance() { :; }
procd_set_param() { :; }
procd_append_param() { :; }
procd_close_instance() { :; }
umask 022
homeproxy_prepare_runtime && mkdir -p "$RUN_DIR/.reload.pending" && _homeproxy_start_service
'''
        env = dict(os.environ, RUN_DIR=str(self.runtime), LOG_PATH=str(self.runtime / 'homeproxy.log'),
                   HP_DIR=str(self.root / 'hp'), CACHE_DIR=str(self.root / 'hp/cache'),
                   DASHBOARD_DIR=str(self.root / 'hp/dashboard'),
                   DNSMASQ_DIR=str(self.root / 'dns/dnsmasq-homeproxy.d'),
                   DNSMASQ_INCLUDE=str(self.root / 'dns/dnsmasq-homeproxy.conf'), HP_DNS_CHANGED='0',
                   HP_DNS_PREVIOUS=str(self.root / 'dns/dnsmasq-homeproxy.conf'), PROG='check_stub', CONF='homeproxy')
        result = subprocess.run(['busybox', 'ash', '-c', functions.replace('/etc/homeproxy/scripts/runtime-files.uc', str(MODULE)) + shell], env=self.without_stat(env),
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def read_rpc(self, kind, offset=None, cursor=None):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        body = rpc[rpc.index('\tlog_read: {'):rpc.index('\n\tlog_clean: {')].rstrip().rstrip(',')
        args = {'type': kind}
        if offset is not None:
            args['offset'] = offset
        if cursor is not None:
            args['cursor'] = cursor
        script = self.root / 'read.uc'
        script.write_text(IMPORT + 'const RUN_DIR=' + json.dumps(str(self.runtime)) +
                          ';const m={' + body + '};print(sprintf("%J",m.log_read.call({args:' + json.dumps(args) + '})));')
        result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        reply = json.loads(result.stdout)
        if 'data_b64' in reply:
            reply['data'] = base64.b64decode(reply['data_b64'])
        return reply

    def test_log_read_ships_only_new_bytes_and_resyncs_after_truncation(self):
        os.chown(self.runtime, 0, 0)
        log = self.runtime / 'homeproxy.log'
        log.write_bytes(b'first line\n' * 3)
        size = log.stat().st_size
        initial = self.read_rpc('homeproxy', 0)
        self.assertEqual((initial['status'], initial['reset'], initial['offset']), ('ok', True, size))
        self.assertEqual(initial['data'], b'first line\n' * 3)
        # A poll must not resend the prefix: only the appended bytes travel.
        with log.open('ab') as handle:
            handle.write(b'tail\n')
        appended = self.read_rpc('homeproxy', size, initial['cursor'])
        self.assertEqual((appended['data'], appended['offset'], appended['reset']), (b'tail\n', size + 5, False))
        # The cleaner truncates in place; a stale offset resyncs instead of skipping.
        log.write_bytes(b'new\n')
        shrunk = self.read_rpc('homeproxy', size + 5, appended['cursor'])
        self.assertEqual((shrunk['data'], shrunk['offset'], shrunk['reset']), (b'new\n', 4, True))

    def test_log_read_bounds_the_window_and_drops_a_partial_first_line(self):
        os.chown(self.runtime, 0, 0)
        log = self.runtime / 'sing-box-c.log'
        lines = b''.join(b'%06d payload\n' % index for index in range(20000))
        log.write_bytes(lines)
        size = len(lines)
        initial = self.read_rpc('sing-box-c', 0)
        self.assertEqual(initial['offset'], size, 'first read must start at the tail')
        stale = self.read_rpc('sing-box-c', size + 1)
        self.assertTrue(stale['reset'])
        self.assertEqual(stale['offset'], size)
        start = size - 65536
        self.assertNotEqual(lines[start - 1:start], b'\n', 'fixture window starts mid-line')
        boundary = lines.index(b'\n', start) + 1
        self.assertEqual(stale['data'], lines[boundary:], 'the partial first line is dropped')
        self.assertEqual(initial['data'], stale['data'])

    def test_cursor_detects_recreation_and_in_place_truncate_regrow(self):
        os.chown(self.runtime, 0, 0)
        log = self.runtime / 'homeproxy.log'
        log.write_bytes(b'original entry\n')
        initial = self.read_rpc('homeproxy', 0)
        log.write_bytes(b'different and longer entry\n')
        current = self.read_rpc('homeproxy', initial['offset'], initial['cursor'])
        self.assertTrue(current['reset'])
        self.assertEqual(current['data'], log.read_bytes())
        (self.runtime / 'replacement').write_bytes(log.read_bytes())
        (self.runtime / 'replacement').replace(log)
        recreated = self.read_rpc('homeproxy', current['offset'], current['cursor'])
        self.assertTrue(recreated['reset'], 'same bytes and size on a new inode')
        self.assertTrue(self.clean_rpc('homeproxy')['result'])
        log.write_bytes(recreated['data'])
        cleared = self.read_rpc('homeproxy', recreated['offset'], recreated['cursor'])
        self.assertTrue(cleared['reset'], 'an explicit clear resets even with an identical new prefix')
        self.assertEqual(cleared['data'], recreated['data'])

    def test_incremental_rpc_preserves_raw_utf8_across_chunk_boundary(self):
        os.chown(self.runtime, 0, 0)
        log = self.runtime / 'homeproxy.log'
        log.touch()
        cursor = self.read_rpc('homeproxy', 0)
        text = b'A' * 65535 + '中😀\n'.encode()
        log.write_bytes(text)
        first = self.read_rpc('homeproxy', cursor['offset'], cursor['cursor'])
        second = self.read_rpc('homeproxy', first['offset'], first['cursor'])
        self.assertFalse(first['reset'])
        self.assertFalse(second['reset'])
        self.assertEqual(first['data'], text[:65536])
        self.assertEqual(first['data'] + second['data'], text)

    def test_generation_publication_failure_keeps_marker_and_log(self):
        os.chown(self.runtime, 0, 0)
        log = self.runtime / 'homeproxy.log'
        log.write_bytes(b'preserve this entry\n')
        marker = log.with_suffix('.log.generation')
        marker.write_text('3')
        stage = marker.with_suffix('.generation.new')
        stage.mkdir()

        initial = self.read_rpc('homeproxy', 0)
        self.assertEqual(initial['status'], 'ok')
        self.assertEqual(self.clean_rpc('homeproxy'), {
            'result': False, 'error': 'failed to publish log generation',
        })
        self.assertEqual(marker.read_text(), '3')
        self.assertEqual(log.read_bytes(), initial['data'])

        # A file left by an interrupted publication is replaceable. The next
        # successful clear still preserves the append inode.
        stage.rmdir()
        stage.write_text('incomplete')
        stage.chmod(0o600)
        inode = log.stat().st_ino
        self.assertTrue(self.clean_rpc('homeproxy')['result'])
        self.assertEqual(marker.read_text(), '4')
        self.assertFalse(stage.exists())
        self.assertEqual((log.stat().st_size, log.stat().st_ino), (0, inode))

    def test_log_read_refuses_foreign_entries_and_unknown_sources(self):
        self.assertEqual(self.read_rpc('../root-secret')['error'], 'illegal type')
        # A service-writable parent could redirect the read outside the runtime.
        self.assertEqual(self.read_rpc('homeproxy')['error'], 'unsafe runtime directory')
        os.chown(self.runtime, 0, 0)
        self.assertEqual(self.read_rpc('homeproxy')['status'], 'missing')
        log = self.runtime / 'sing-box-s.log'
        log.symlink_to(self.victim)
        self.assertEqual(self.read_rpc('sing-box-s')['error'], 'unsafe log file')
        log.unlink()
        os.link(self.victim, log)
        self.assertEqual(self.read_rpc('sing-box-s')['error'], 'unsafe log file')
        self.assertEqual(self.victim.read_bytes(), b'v' * 73728)

    def clean_rpc(self, kind):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        body = rpc[rpc.index('\tlog_clean: {'):rpc.index('\n\tsingbox_generator: {')].rstrip().rstrip(',')
        script = self.root / 'clear.uc'
        script.write_text(IMPORT + 'const RUN_DIR=' + json.dumps(str(self.runtime)) +
                          ';const m={' + body + '};print(sprintf("%J",m.log_clean.call({args:{type:' + json.dumps(kind) + '}})));')
        result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_migration_closes_directory_replacement_and_retains_append_logs(self):
        for name in ('homeproxy', 'sing-box-c', 'sing-box-s'):
            (self.runtime / (name + '.log')).write_bytes(b'h' * 73728)
        inode = (self.runtime / 'sing-box-s.log').stat().st_ino
        # The server keeps its O_APPEND descriptor across preparation/clears.
        fd = os.open(self.runtime / 'sing-box-s.log', os.O_WRONLY | os.O_APPEND)
        self.addCleanup(os.close, fd)
        self.prepare()
        self.assertEqual((self.runtime.stat().st_uid, self.runtime.stat().st_mode & 0o777), (0, 0o755))
        self.assertEqual((self.runtime / 'sing-box-s.log').stat().st_ino, inode)
        for action in ("from pathlib import Path; Path('run/sing-box-s.log').unlink()",
                       "from pathlib import Path; Path('run/new').symlink_to('../root-secret')",
                       "from pathlib import Path; Path('run/sing-box-s.log').rename('run/moved')"):
            self.assertNotEqual(self.service(action).returncode, 0, action)
        self.assertEqual(self.service("from pathlib import Path; Path('run/sing-box-s.log').open('a').write('server append')").returncode, 0)
        self.assertEqual(self.service("from pathlib import Path; Path('run/sing-box-s.json').read_text()").returncode, 0)
        self.assertNotEqual(self.service("from pathlib import Path; Path('run/sing-box-c.json').read_text()").returncode, 0)
        self.assertEqual((self.root / 'hp/cache').stat().st_uid, 0)
        self.assertNotEqual(self.service("from pathlib import Path; Path('hp/cache/cache.db').open('w')").returncode, 0)
        cleaner = (APP / 'root/etc/homeproxy/scripts/clean_log.sh').read_text()
        self.assertIn('sleep 180', cleaner)
        cleaner = cleaner.replace('/var/run/homeproxy', str(self.runtime))
        cleaner = cleaner.replace('/etc/homeproxy/scripts/runtime-files.uc', str(MODULE))
        # Replace only the wait boundary: one actual loop, then exit.
        cleaner = cleaner.replace('sleep 180', 'count=$(( ${count:-0} + 1 )); [ "$count" -le 1 ] || exit 0')
        before_clear = self.read_rpc('sing-box-s', 0)
        server_bytes = (self.runtime / 'sing-box-s.log').read_bytes()
        result = subprocess.run(['busybox', 'ash', '-c', cleaner], env=self.without_stat(os.environ), capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        self.assertEqual((self.runtime / 'sing-box-s.log').stat().st_size, 0)
        os.write(fd, server_bytes)
        after_clear = self.read_rpc('sing-box-s', before_clear['offset'], before_clear['cursor'])
        self.assertTrue(after_clear['reset'], 'periodic clear resets even if the log regrows to identical bytes')
        self.assertTrue(self.clean_rpc('sing-box-s')['result'])
        for name in ('homeproxy', 'sing-box-c', 'sing-box-s'):
            self.assertEqual((self.runtime / (name + '.log')).stat().st_size, 0)
            self.assertTrue(self.clean_rpc(name)['result'])
        os.write(fd, b'after clear')
        self.assertEqual((self.runtime / 'sing-box-s.log').read_bytes(), b'after clear')
        self.assertEqual(self.victim.read_bytes(), b'v' * 73728)
        self.prepare()
        self.assertEqual((self.runtime / 'sing-box-s.log').stat().st_ino, inode)
        self.assertTrue((self.runtime / 'sing-box-s.log').read_bytes().startswith(b'after clear'))

    def test_upgrade_removes_planted_links_before_root_log_writes(self):
        cache = self.root / 'hp/cache'
        cache.mkdir(parents=True)
        os.chown(cache, 5566, 5566)
        (cache / 'cache.db').symlink_to(self.victim)
        for name in ('homeproxy', 'sing-box-c', 'sing-box-s'):
            result = self.service("from pathlib import Path; Path(" + repr('run/' + name + '.log') + ").symlink_to('../root-secret')")
            self.assertEqual(result.returncode, 0, result.stderr)
        self.prepare()
        self.assertEqual(self.victim.read_bytes(), b'v' * 73728)
        for name in ('homeproxy', 'sing-box-c', 'sing-box-s'):
            self.assertFalse((self.runtime / (name + '.log')).is_symlink())
            self.assertTrue(self.clean_rpc(name)['result'])
        self.assertEqual(self.victim.read_bytes(), b'v' * 73728)

    def test_cache_upgrade_keeps_regular_database_bytes(self):
        cache = self.root / 'hp/cache'
        cache.mkdir(parents=True)
        os.chown(cache, 5566, 5566)
        database = cache / 'cache.db'
        database.write_bytes(b'retained database')
        os.chown(database, 5566, 5566)
        self.prepare()
        self.assertEqual(database.read_bytes(), b'retained database')
        self.assertEqual((database.stat().st_uid, database.stat().st_mode & 0o777), (0, 0o600))

    def test_rpc_refuses_unprepared_parent_and_planted_links(self):
        log = self.runtime / 'sing-box-s.log'
        log.symlink_to(self.victim)
        self.assertEqual(self.clean_rpc('sing-box-s')['error'], 'unsafe runtime directory')
        os.chown(self.runtime, 0, 0)
        self.assertFalse(self.clean_rpc('sing-box-s')['result'])
        self.assertEqual(self.victim.read_bytes(), b'v' * 73728)
        log.unlink()
        os.link(self.victim, log)
        self.assertFalse(self.clean_rpc('sing-box-s')['result'])
        self.assertEqual(self.victim.read_bytes(), b'v' * 73728)
        self.assertFalse(self.clean_rpc('../root-secret')['result'])
        log.unlink()
        self.assertTrue(self.clean_rpc('sing-box-s')['result'], 'missing log remains a successful no-op')


if __name__ == '__main__':
    unittest.main()
