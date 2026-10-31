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
