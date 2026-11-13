"""Real default UCI delta/override isolation in a disposable OpenWrt rootfs.

The ordinary runner reports the privileged prerequisite as UNVERIFIED; the
explicit sudo CI gate supplies the verified rootfs and must run every case.
"""
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.geteuid() == 0 and os.environ.get('OPENWRT_ROOTFS'),
                     'requires root and verified OPENWRT_ROOTFS (privileged CI gate)')
class RuntimeInitNative(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hp-runtime-rootfs-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        with tarfile.open(os.environ['OPENWRT_ROOTFS']) as archive:
            archive.extractall(self.root, filter='fully_trusted')
        for directory in ('etc/config', 'usr/libexec', 'tmp', 'var/run/homeproxy', 'var/run/uci', 'dev'):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        # The minimal upstream image omits some BusyBox applet links.
        for applet in ('mktemp', 'mkdir', 'rm', 'date'):
            path = self.root / 'bin' / applet
            if not path.exists():
                path.symlink_to('busybox')
        null = self.root / 'dev/null'
        if not null.exists():
            null.touch()  # Bind the real null device inside the child namespace.
        self.config = self.root / 'etc/config/homeproxy'
        self.config.write_bytes((APP / 'root/etc/config/homeproxy').read_bytes())
        self.script = self.root / 'usr/libexec/homeproxy-runtime-init'
        self.script.write_bytes((APP / 'root/usr/libexec/homeproxy-runtime-init').read_bytes())
        self.script.chmod(0o755)
        for name, content in (
                ('usr/bin/sing-box', '#!/bin/sh\nprintf 1.14.4\n'),
                ('usr/libexec/homeproxy-random-port',
                 '#!/bin/sh\n[ ! -f /tmp/fail-random ] || exit 1\n'
                 '[ "$1" != 22000 ] && printf 22000 || printf 23000\n')):
            path = self.root / name
            path.write_text(content)
            path.chmod(0o755)

    def run_native(self, *args, readonly=False):
        # No path substitutions: libuci sees the actual defaults inside chroot.
        prepare = 'mount --bind /dev/null "$1/dev/null"; '
        if readonly:
            prepare += ('mount --bind "$1/etc/config" "$1/etc/config"; '
                        'mount -o remount,bind,ro "$1/etc/config"; '
                        'echo reached-native-commit >&2; ')
        result = subprocess.run(['unshare', '--mount', '--net', '--fork',
                                 '/bin/sh', '-ec',
                                 prepare + 'shift; exec chroot "$@"',
                                 'hp-rootfs', str(self.root), str(self.root), *args],
                                env=dict(os.environ, PATH='/usr/sbin:/usr/bin:/sbin:/bin', TMPDIR='/tmp'),
                                capture_output=True, text=True, timeout=15)
        return result

    def seed_external(self, override=False):
        result = self.run_native('/sbin/uci', 'set', 'homeproxy.config.log_level=debug')
        self.assertEqual(result.returncode, 0, result.stderr)
        # Also try to influence fields that runtime-init itself initializes.
        for assignment in ('homeproxy.config.dashboard_port=24000',
                           'homeproxy.config.dashboard_port_initialized=1'):
            result = self.run_native('/sbin/uci', 'set', assignment)
            self.assertEqual(result.returncode, 0, result.stderr)
        if override:
            (self.root / 'var/run/uci/homeproxy').write_text(
                "config homeproxy 'config'\n option log_level 'override-draft'\n"
                " option dashboard_port '25000'\n option dashboard_port_initialized '1'\n"
                "config infra 'infra'\n option clash_api_port '26000'\n"
                " option clash_api_port_initialized '1'\n")
        paths = [self.root / 'tmp/.uci/homeproxy']
        if override:
            paths.append(self.root / 'var/run/uci/homeproxy')
        return {path: path.read_bytes() for path in paths}

    def assert_external_unchanged(self, external):
        for path, before in external.items():
            self.assertEqual(path.read_bytes(), before, str(path))
        self.assertEqual(list((self.root / 'tmp').glob('homeproxy-runtime.*')), [])

    def test_default_draft_and_override_stay_private_success_and_repeat_noop(self):
        for override in (False, True):
            with self.subTest(override=override):
                # Restore only this test's own private persistent fixture.
                self.config.write_bytes((APP / 'root/etc/config/homeproxy').read_bytes())
                external = self.seed_external(override)
                result = self.run_native('/usr/libexec/homeproxy-runtime-init')
                self.assertEqual(result.returncode, 0, result.stderr)
                committed = self.config.read_text()
                self.assertNotIn("option log_level 'debug'", committed)
                self.assertNotIn('override-draft', committed)
                self.assertIn("option clash_api_port '22000'", committed)
                self.assertIn("option dashboard_port '23000'", committed)
                self.assertIn("option clash_api_port_initialized '1'", committed)
                self.assertIn("option dashboard_port_initialized '1'", committed)
                self.assert_external_unchanged(external)
                first = self.config.read_bytes(), self.config.stat().st_mtime_ns
                result = self.run_native('/usr/libexec/homeproxy-runtime-init')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((self.config.read_bytes(), self.config.stat().st_mtime_ns), first)
                self.assert_external_unchanged(external)

    def test_missing_section_set_failure_keeps_persistent_and_external_bytes(self):
        self.config.write_text("config homeproxy 'config'\n option dashboard_port '9095'\n")
        external = self.seed_external(True)
        before = self.config.read_bytes()
        result = self.run_native('/usr/libexec/homeproxy-runtime-init')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.config.read_bytes(), before)
        self.assert_external_unchanged(external)

    def test_readonly_commit_failure_keeps_persistent_and_external_bytes(self):
        external = self.seed_external(True)
        before = self.config.read_bytes()
        result = self.run_native('/usr/libexec/homeproxy-runtime-init', readonly=True)
        self.assertIn('reached-native-commit', result.stderr)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.config.read_bytes(), before)
        self.assert_external_unchanged(external)

    def test_random_failure_keeps_persistent_and_external_bytes(self):
        external = self.seed_external(True)
        before = self.config.read_bytes()
        (self.root / 'tmp/fail-random').touch()
        result = self.run_native('/usr/libexec/homeproxy-runtime-init')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.config.read_bytes(), before)
        self.assert_external_unchanged(external)


if __name__ == '__main__':
    unittest.main()
