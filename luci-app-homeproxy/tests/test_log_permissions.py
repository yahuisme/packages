"""Root-controlled runtime parent, real uid 5566, ash cleaner and ucode RPC."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]


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
ucode() { case "$*" in *generate_client*) (umask 077; printf '{"client":"secret"}' > "$RUN_DIR/sing-box-c.json.new");; *generate_server*) (umask 077; printf '{"server":"secret"}' > "$RUN_DIR/sing-box-s.json.new");; esac; }
check_stub() { :; }
sing_box_stub() { printf fixture; }
fw4() { :; }
dnsmasq() { :; }
procd_open_instance() { :; }
procd_set_param() { :; }
procd_append_param() { :; }
procd_close_instance() { :; }
umask 022
_homeproxy_start_service
'''
        env = dict(os.environ, RUN_DIR=str(self.runtime), LOG_PATH=str(self.runtime / 'homeproxy.log'),
                   HP_DIR=str(self.root / 'hp'), CACHE_DIR=str(self.root / 'hp/cache'),
                   CACHE_PATH=str(self.root / 'hp/cache/cache.db'), DASHBOARD_DIR=str(self.root / 'hp/dashboard'),
                   DNSMASQ_DIR=str(self.root / 'dns/rules'), PROG='check_stub', CONF='homeproxy')
        result = subprocess.run(['busybox', 'ash', '-c', functions + shell], env=env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def clean_rpc(self, kind):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        body = rpc[rpc.index('\tlog_clean: {'):rpc.index('\n\tsingbox_generator: {')].rstrip().rstrip(',')
        script = self.root / 'clear.uc'
        script.write_text("import {lstat,writefile} from 'fs'; const RUN_DIR=" + json.dumps(str(self.runtime)) +
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
        cleaner = cleaner.replace('/var/run/$NAME', str(self.runtime))
        # Replace only the wait boundary: one actual loop, then exit.
        cleaner = cleaner.replace('sleep 180', 'count=$(( ${count:-0} + 1 )); [ "$count" -le 1 ] || exit 0')
        result = subprocess.run(['busybox', 'ash', '-c', cleaner], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
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
