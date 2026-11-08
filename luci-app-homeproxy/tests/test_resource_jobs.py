"""Wrapper fault boundaries with real flock, ash and ucode; no service/network."""
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

APP = Path(__file__).resolve().parents[1]
WRAPPER = APP/'root/etc/homeproxy/scripts/resource_job.sh'


class ResourceJobs(unittest.TestCase):
    def test_first_directory_creation_loser_rechecks_safe_winner(self):
        # Deterministically let another caller win the first mkdir. Run both
        # entrypoints up to their real lock boundary without downloading anything.
        for entry in ('resource_job.sh', 'update_resources.sh'):
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                run = root / 'run'
                resources = root / 'resources'
                source = (WRAPPER.parent / entry).read_text()
                hook = '''mkdir() {
 if [ "$1" = -m ]; then command busybox mkdir "$@"; return 1; fi
 command busybox mkdir "$@"
}
'''
                if entry == 'resource_job.sh':
                    source = source.replace('umask 077', hook + 'umask 077', 1)
                    args = ['status', 'unknown']
                    expected = 0
                else:
                    source = source.replace('JOB_DIR="${RUN_DIR}.resources"',
                        hook + 'flock() { return 1; }\nJOB_DIR="${RUN_DIR}.resources"', 1)
                    args = []
                    expected = 2  # Contended transaction lock, after directory validation.
                script = root / 'case.sh'
                script.write_text(source)
                result = subprocess.run(['busybox', 'ash', str(script), *args],
                    env=dict(os.environ, RUN_DIR=str(run), RESOURCES_DIR=str(resources)),
                    capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual(Path(str(run) + '.resources').stat().st_mode & 0o777, 0o700)

    def test_first_directory_creation_rejects_symlink_winner(self):
        for entry in ('resource_job.sh', 'update_resources.sh'):
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                target = root / 'foreign'
                target.mkdir(mode=0o755)
                source = (WRAPPER.parent / entry).read_text()
                hook = '''mkdir() {
 if [ "$1" = -m ]; then command busybox ln -s "$RACE_TARGET" "$3"; return 1; fi
 command busybox mkdir "$@"
}
'''
                marker = 'umask 077' if entry == 'resource_job.sh' else 'JOB_DIR="${RUN_DIR}.resources"'
                script = root / 'case.sh'
                script.write_text(source.replace(marker, hook + marker, 1))
                result = subprocess.run(['busybox', 'ash', str(script), 'status', 'unknown']
                    if entry == 'resource_job.sh' else ['busybox', 'ash', str(script)],
                    env=dict(os.environ, RUN_DIR=str(root / 'run'), RESOURCES_DIR=str(root / 'resources'),
                             RACE_TARGET=str(target)), capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(target.stat().st_mode & 0o777, 0o755)
                self.assertEqual(list(target.iterdir()), [])

    def test_wrapper_fail_closed_and_single_flight(self):
        for fixture in ['matching', 'missing', 'mismatch', 'killed']:
            with self.subTest(fixture=fixture), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                run = root/'run'; run.mkdir()
                scripts = root/'scripts'; scripts.mkdir()
                gate = root/'gate'; os.mkfifo(gate)
                (scripts/'update_resources.sh').write_text('''#!/bin/sh
printf 'ready\\n' > "$SCRIPTS_DIR/../ready"
read -r token < "$SCRIPTS_DIR/../gate"
case "$FIXTURE" in
matching) printf 'status=0\\ngeoip_cn=0\\n' > "$HOMEPROXY_RESOURCE_JOB_RESULT" ;;
mismatch) printf 'status=0\\napply_failed=1\\n' > "$HOMEPROXY_RESOURCE_JOB_RESULT"; exit 1 ;;
killed) kill -KILL $$ ;;
missing) : ;;
esac
''')
                env = dict(os.environ, RUN_DIR=str(run), SCRIPTS_DIR=str(scripts), FIXTURE=fixture)
                def call(*args):
                    p = subprocess.run(['busybox','ash',str(WRAPPER),*args], env=env,
                                       capture_output=True,text=True,timeout=3,check=True)
                    return dict(line.split('=',1) for line in p.stdout.splitlines())
                start = call('start','rules','geoip')
                self.assertEqual(start['state'], 'running')
                deadline = time.monotonic()+3
                while not (root/'ready').exists():
                    self.assertLess(time.monotonic(),deadline)
                    time.sleep(.01)
                self.assertEqual(call('status',start['job']), {'state':'running'})
                self.assertEqual(call('start','dashboard-update','all'), {'state':'busy','status':'2'})
                with (Path(str(run)+'.resources')/'update.lock').open('w') as lock:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with gate.open('w') as f:
                    f.write('continue\n')
                deadline = time.monotonic()+3
                while True:
                    result=call('status',start['job'])
                    if result['state']=='done':
                        break
                    self.assertLess(time.monotonic(),deadline)
                    time.sleep(.01)
                self.assertEqual(result['status'], '0' if fixture=='matching' else '1')
                self.assertNotIn('apply_failed', result)
                # Never let another job's complete result masquerade as this job.
                self.assertEqual(call('status','unknown'), {'state':'done','status':'1'})


if __name__ == '__main__':
    unittest.main()
