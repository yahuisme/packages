"""Real private ash/flock/UID boundary; only the slow ucode worker is a fixture."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

APP = Path(__file__).resolve().parents[1]
SCRIPT = APP / 'root/etc/homeproxy/scripts/update_subscriptions.sh'


class SubscriptionJobs(unittest.TestCase):
    def setUp(self):
        self.private = tempfile.TemporaryDirectory(prefix='hp-job-')
        self.addCleanup(self.private.cleanup)
        self.root = Path(self.private.name)
        self.root.chmod(0o755)
        self.run_dir = self.root / 'run'
        self.run_dir.mkdir()
        self.job = Path(str(self.run_dir) + '.subscriptions')
        self.tools = self.root / 'bin'
        self.tools.mkdir()
        busybox = shutil.which('busybox')
        assert busybox is not None, 'load both test-tool environments'
        for name in ('mkdir', 'mv', 'rm', 'cat', 'date', 'sleep'):
            (self.tools / name).symlink_to(busybox)
        self.real_ucode = shutil.which('ucode')
        assert self.real_ucode is not None, 'load both test-tool environments'
        self.worker('#!/bin/sh\nexit 7\n')
        self.script = self.root / 'update.sh'
        self.script.write_text(SCRIPT.read_text()
                               .replace('RUN_DIR="/var/run/homeproxy"', 'RUN_DIR="' + str(self.run_dir) + '"')
                               .replace('/bin/sh "$0" --worker', 'busybox ash "$0" --worker'))
        self.env = dict(os.environ, PATH=str(self.tools)+':'+os.environ['PATH'],
                        FIXTURE_ROOT=str(self.root), REAL_UCODE=self.real_ucode)

    def worker(self, source):
        path = self.tools / 'ucode'
        path.write_text(source.replace('#!/bin/sh\n', '#!/bin/sh\n'
                                       '[ "$1" != -l ] || exec "$REAL_UCODE" "$@"\n', 1))
        path.chmod(0o755)

    def call(self, *args):
        return subprocess.run(['busybox', 'ash', str(self.script), *args],
                              env=self.env, capture_output=True, text=True, timeout=3)

    def task(self, *args):
        result = self.call(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def service(self, source):
        # Relative paths from inherited cwd avoid requiring access through /root.
        self.assertEqual(os.geteuid(), 0, 'private UID tests require root and setpriv')
        return subprocess.run(
            ['setpriv', '--reuid=65534', '--regid=65534', '--clear-groups',
             'busybox', 'ash', '-c', source], cwd=self.root,
            capture_output=True, text=True, timeout=3)

    def test_private_uid_symlink_cannot_overwrite_root_target(self):
        self.run_dir.chmod(0o777)
        target = self.root / 'victim'
        target.write_text('unchanged\n')
        attack = self.service('ln -s ../victim run/update_subscriptions.result.new')
        self.assertEqual(attack.returncode, 0, attack.stderr)
        self.assertEqual(self.call().returncode, 7)
        self.assertEqual(target.read_text(), 'unchanged\n')

    def test_private_uid_cannot_forge_success_or_replace_control_lock(self):
        self.run_dir.chmod(0o777)
        self.assertEqual(self.task('--status'), {'state': 'idle'})
        attack = self.service(
            'printf "0\\n" > run/update_subscriptions.result; '
            'rm -f run/update_subscriptions.lock; : > run/update_subscriptions.lock')
        self.assertEqual(attack.returncode, 0, attack.stderr)
        self.assertEqual(self.task('--status'), {'state': 'idle'})
        for command in ('printf "0\\n" > run.subscriptions/update_subscriptions.result',
                        'rm -f run.subscriptions/update_subscriptions.lock',
                        'ln -s ../victim run.subscriptions/update_subscriptions.result.new'):
            with self.subTest(command=command):
                self.assertNotEqual(self.service(command).returncode, 0)
        self.assertEqual(self.job.stat().st_uid, 0)
        self.assertEqual(self.job.stat().st_mode & 0o7777, 0o700)

    def test_rejects_unsafe_control_directory_before_worker(self):
        self.worker('#!/bin/sh\ntouch "$FIXTURE_ROOT/executed"\n')
        for kind in ('symlink', 'foreign-owner', 'writable', 'searchable', 'file'):
            with self.subTest(kind=kind):
                if kind == 'symlink':
                    target = self.root / 'target'
                    target.mkdir(mode=0o700)
                    self.job.symlink_to(target, target_is_directory=True)
                elif kind == 'file':
                    self.job.write_text('keep')
                else:
                    self.job.mkdir(mode=0o700)
                    if kind == 'foreign-owner':
                        os.chown(self.job, 65534, 65534)
                    else:
                        self.job.chmod(0o777 if kind == 'writable' else 0o755)
                before = self.job.lstat()
                try:
                    for args in ((), ('--start',), ('--status',), ('--worker',)):
                        self.assertNotEqual(self.call(*args).returncode, 0)
                    self.assertFalse((self.root / 'executed').exists())
                    after = self.job.lstat()
                    self.assertEqual((after.st_uid, after.st_mode), (before.st_uid, before.st_mode))
                finally:
                    if self.job.is_symlink() or self.job.is_file():
                        self.job.unlink()
                    else:
                        self.job.rmdir()

    def test_first_directory_creation_loser_rechecks_safe_winner(self):
        # Simulate another caller winning mkdir after the shell's -d check.
        source = self.script.read_text()
        start = source.index('umask 077')
        source = source[:start] + '''mkdir() {
 if [ "$1" = -m ]; then command busybox mkdir "$@"; return 1; fi
 command busybox mkdir "$@"
}
''' + source[start:]
        self.script.write_text(source)
        self.assertEqual(self.task('--status'), {'state': 'idle'})
        self.assertEqual(self.job.stat().st_mode & 0o7777, 0o700)

    def test_atomic_publication_does_not_follow_preexisting_new_symlink(self):
        self.task('--status')
        target = self.root / 'victim'
        target.write_text('unchanged\n')
        (self.job / 'update_subscriptions.result.new').symlink_to(target)
        self.assertEqual(self.call().returncode, 7)
        self.assertEqual(target.read_text(), 'unchanged\n')
        result = self.job / 'update_subscriptions.result'
        self.assertFalse(result.is_symlink())
        self.assertEqual(result.stat().st_mode & 0o7777, 0o600)
        self.assertEqual(self.task('--status'), {'state': 'done', 'code': 7})
        self.assertFalse((self.job / 'update_subscriptions.result.new').exists())

    def test_publication_failure_never_reports_success(self):
        self.worker('#!/bin/sh\nexit 0\n')
        self.task('--status')
        # A nonempty directory forces checked cleanup/publication to fail.
        stage = self.job / 'update_subscriptions.result.new'
        stage.mkdir()
        (stage / 'keep').touch()
        self.assertNotEqual(self.call().returncode, 0)
        self.assertEqual(self.task('--status'), {'state': 'idle'})
        self.assertTrue((stage / 'keep').exists())

    def test_rename_failure_never_reports_success(self):
        self.worker('#!/bin/sh\nexit 0\n')
        self.task('--status')
        rename = self.tools / 'mv'
        rename.unlink()
        rename.write_text('#!/bin/sh\nexit 1\n')
        rename.chmod(0o755)
        self.assertNotEqual(self.call().returncode, 0)
        self.assertEqual(self.task('--status'), {'state': 'idle'})

    def test_direct_worker_without_inherited_fd_is_rejected(self):
        self.worker('#!/bin/sh\ntouch "$FIXTURE_ROOT/executed"\n')
        self.assertNotEqual(self.call('--worker').returncode, 0)
        self.assertFalse((self.root / 'executed').exists())

    def test_sync_success_and_failure_publish_exact_exit(self):
        for code in (0, 3, 7):
            with self.subTest(code=code):
                self.worker('#!/bin/sh\nexit %d\n' % code)
                self.assertEqual(self.call().returncode, code)
                self.assertEqual(self.task('--status'), {'state': 'done', 'code': code})

    def test_async_update_survives_caller_and_exposes_busy_and_exit(self):
        self.run_dir.chmod(0o777)
        self.worker('#!/bin/sh\nprintf x >> "$FIXTURE_ROOT/executions"\n'
                    'while [ ! -e "$FIXTURE_ROOT/release" ]; do sleep .02; done\nexit 7\n')
        # Always unblock detached children before deleting their fixture.
        self.addCleanup(lambda: (self.root / 'release').touch())
        self.assertEqual(self.task('--status')['state'], 'idle')
        self.assertEqual(self.task('--start')['state'], 'running')
        attack = self.service('rm -f run/update_subscriptions.lock; '
                              ': > run/update_subscriptions.lock; '
                              'printf "0\\n" > run/update_subscriptions.result')
        self.assertEqual(attack.returncode, 0, attack.stderr)
        self.assertEqual(self.task('--status')['state'], 'running')
        self.assertEqual(self.task('--start')['state'], 'running')
        self.assertEqual(self.call().returncode, 2)
        delay = float(os.environ.get('HP_JOB_HOLD_SECONDS', '0'))
        if delay:
            time.sleep(delay)
            self.assertEqual(self.task('--status')['state'], 'running')
        (self.root / 'release').touch()
        deadline = time.monotonic()+3
        while True:
            status = self.task('--status')
            if status['state'] != 'running':
                break
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.02)
        self.assertEqual(status, {'state': 'done', 'code': 7})
        self.assertEqual((self.root / 'executions').read_text(), 'x')


if __name__ == '__main__':
    unittest.main()
