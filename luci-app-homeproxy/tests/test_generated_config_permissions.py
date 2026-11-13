"""Native generator file permissions; private paths, no service/core/network."""
import json
import os
import resource
import signal
import stat
import subprocess
import unittest


from client_generator_fixture import ClientGenerator, SCRIPTS


class GeneratedConfigPermissions(unittest.TestCase):
    def generate_server(self, fixture):
        adapter = fixture.root / 'server-uci.uc'
        adapter.write_text('''export function cursor() { return {
 load:()=>true, get:()=>null,
 foreach:(c,t,cb)=>cb({'.name':'fixture',enabled:'1',type:'socks',port:'1080',password:'fixture-secret'})
}; };''')
        source = (SCRIPTS / 'generate_server.uc').read_text()
        source = source.replace("from 'uci'", 'from ' + json.dumps(str(adapter)))
        source = source.replace("from 'homeproxy'", 'from ' + json.dumps(str(fixture.root / 'homeproxy.uc')))
        script = fixture.root / 'server.uc'
        script.write_text(source)
        result = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_buffered_flush_failure_rejects_and_removes_partial_staging(self):
        for server in (False, True):
            with self.subTest(server=server), ClientGenerator() as fixture:
                if not server:
                    # A valid direct-only configuration fits in libc's 1 KiB
                    # buffer. A larger client writes during write(), not flush().
                    fixture.sections['config'].update(main_node='nil', routing_mode='global')
                    fixture.sections['infra'].update(ntp_server='nil', tun_name='t')
                    del fixture.sections['node1']
                self.generate_server(fixture) if server else fixture.generate()
                script = fixture.root / ('server.uc' if server else 'generate.uc')
                target = fixture.run / ('sing-box-s.json.new' if server else 'sing-box-c.json.new')
                # Use a short private relative runtime path, keeping production
                # serialization intact and avoiding long scratch-path overhead.
                helper = fixture.root / 'homeproxy.uc'
                helper.write_text(helper.read_text().replace(json.dumps(str(fixture.run)), "'run'"))
                result = subprocess.run(['ucode', str(script)], cwd=fixture.root,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                expected = target.read_bytes()
                self.assertGreater(len(expected), 128)
                self.assertLess(len(expected), 1024)
                json.loads(expected)
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
                target.unlink()
                def limit_file():
                    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
                    resource.setrlimit(resource.RLIMIT_FSIZE, (128, 128))
                result = subprocess.run(['ucode', str(script)], cwd=fixture.root, preexec_fn=limit_file,
                                        capture_output=True, text=True, timeout=15)
                # Both failures are real libc writes, not fs mocks or /dev/full.
                self.assertNotEqual(result.returncode, 0,
                                    f'{server=}: truncated to {target.stat().st_size if target.exists() else None}')
                self.assertFalse(target.exists(), 'partial .new must be unlinked')
                # The same fixture and generator still produce identical bytes
                # without the subprocess-only limit.
                result = subprocess.run(['ucode', str(script)], cwd=fixture.root,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(target.read_bytes(), expected)

    def test_new_and_existing_configs_are_private_with_umask_022(self):
        for server in (False, True):
            with self.subTest(server=server), ClientGenerator() as fixture:
                target = fixture.run / ('sing-box-s.json.new' if server else 'sing-box-c.json.new')
                for existing in (False, True):
                    if existing:
                        target.write_text('old')
                        target.chmod(0o644)
                    old = os.umask(0o022)
                    try:
                        self.generate_server(fixture) if server else fixture.generate()
                    finally:
                        os.umask(old)
                    self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
                    self.assertTrue(target.read_text())

    @unittest.skipUnless(os.geteuid() == 0, 'numeric UID access boundary requires root')
    def test_generated_credentials_deny_unrelated_uid_and_allow_runtime_owner(self):
        with ClientGenerator() as fixture:
            fixture.sections['node1']['password'] = 'fixture-secret'
            fixture.generate()
            fixture.root.chmod(0o755)
            target = fixture.run / 'sing-box-c.json.new'
            def can_read(uid):
                def drop():
                    os.setgroups([])
                    os.setgid(uid)
                    os.setuid(uid)
                result = subprocess.run(['python3', '-c',
                    'from pathlib import Path; Path("run/sing-box-c.json.new").read_text()'],
                    cwd=fixture.root, preexec_fn=drop, capture_output=True, text=True, timeout=10)
                return result.returncode == 0
            self.assertFalse(can_read(65534))
            os.chown(target, 5566, 5566)
            self.assertTrue(can_read(5566))
            self.assertFalse(can_read(65534))

    def test_preexisting_staging_symlink_never_overwrites_target(self):
        for server in (False, True):
            with self.subTest(server=server), ClientGenerator() as fixture:
                victim = fixture.root / 'unrelated'
                victim.write_text('untouched')
                target = fixture.run / ('sing-box-s.json.new' if server else 'sing-box-c.json.new')
                target.symlink_to(victim)
                self.generate_server(fixture) if server else fixture.generate()
                self.assertEqual(victim.read_text(), 'untouched')
                self.assertFalse(target.is_symlink())
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
