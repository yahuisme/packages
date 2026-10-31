"""Private ash worker/download boundary; no proxy, service or host paths."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

APP = Path(__file__).resolve().parents[1]

class SubscriptionJobs(unittest.TestCase):
    def test_async_update_survives_caller_and_exposes_busy_and_exit(self):
        with tempfile.TemporaryDirectory(prefix='hp-job-') as directory:
            root = Path(directory)
            run = root / 'run'
            run.mkdir()
            tools = root / 'bin'
            tools.mkdir()
            worker = tools / 'ucode'
            worker.write_text('#!/bin/sh\nprintf x >> "$FIXTURE_ROOT/executions"\nwhile [ ! -e "$FIXTURE_ROOT/release" ]; do sleep .02; done\nexit 7\n')
            worker.chmod(0o755)
            script = root / 'update.sh'
            script.write_text((APP/'root/etc/homeproxy/scripts/update_subscriptions.sh').read_text()
                              .replace('RUN_DIR="/var/run/homeproxy"', 'RUN_DIR="' + str(run) + '"')
                              .replace('/bin/sh "$0" --worker', 'busybox ash "$0" --worker'))
            script.chmod(0o755)
            env = dict(os.environ, PATH=str(tools)+':'+os.environ['PATH'], FIXTURE_ROOT=str(root))
            def call(*args):
                result = subprocess.run(['busybox','ash',str(script),*args], env=env, capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)
            self.assertEqual(call('--status')['state'], 'idle')
            self.assertEqual(call('--start')['state'], 'running')
            self.assertEqual(call('--status')['state'], 'running')
            self.assertEqual(call('--start')['state'], 'running')
            delay = float(os.environ.get('HP_JOB_HOLD_SECONDS', '0'))
            if delay:
                time.sleep(delay)
                self.assertEqual(call('--status')['state'], 'running')
            (root/'release').touch()
            deadline = time.monotonic()+3
            while True:
                status = call('--status')
                if status['state'] != 'running': break
                self.assertLess(time.monotonic(),deadline)
                time.sleep(.02)
            self.assertEqual(status, {'state':'done','code':7})
            self.assertEqual((root/'executions').read_text(), 'x')

if __name__ == '__main__': unittest.main()
