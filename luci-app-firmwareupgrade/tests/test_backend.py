#!/usr/bin/env python3
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
BACKEND = PACKAGE / 'root/usr/libexec/rpcd/luci.firmwareupgrade'
WORKER = PACKAGE / 'root/usr/libexec/firmwareupgrade-worker'


class FirmwareUpgradeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def run_backend(self, *args):
        return subprocess.check_output(['sh', str(BACKEND), *args], text=True).strip()

    def test_backend_list_exposes_only_supported_methods(self):
        data = json.loads(self.run_backend('list'))
        self.assertEqual(set(data), {'getSystemInfo', 'checkUpdate', 'getStatus', 'startUpgrade', 'saveSettings'})
        self.assertEqual(set(data['startUpgrade']), {'keep_config'})
        self.assertEqual(set(data['saveSettings']), {'repository', 'token', 'keep_config'})

    def test_asset_matching_requires_exact_known_device_and_variant(self):
        assets = self.root / 'assets.tsv'
        assets.write_text(
            '1\topenwrt-airoha-an7581-gemtek_w1700k-ubi-squashfs-sysupgrade.itb\t17474367\tsha256:' + 'a' * 64 + '\thttps://example.com/ubi2.itb\n'
            '2\topenwrt-airoha-an7581-gemtek_w1700k-ubi2-oc-squashfs-sysupgrade.itb\t17474367\tsha256:' + 'b' * 64 + '\thttps://example.com/ubi2-oc.itb\n'
            '3\timmortalwrt-qualcommax-ipq807x-linksys_mx4200v1-squashfs-sysupgrade.bin\t38000000\tsha256:' + 'c' * 64 + '\thttps://example.com/v1.bin\n'
        )
        self.assertIn('w1700k-ubi-squashfs', self.run_backend('test_match', str(assets), 'gemtek,w1700k', 'ubi2'))
        self.assertIn('w1700k-ubi2-oc', self.run_backend('test_match', str(assets), 'gemtek,w1700k', 'ubi2-oc'))
        self.assertIn('mx4200v1', self.run_backend('test_match', str(assets), 'linksys,mx4200-v1', 'v1'))
        self.assertEqual(self.run_backend('test_match', str(assets), 'unknown,device', ''), '')

    def test_rejects_unsafe_values_before_worker_starts(self):
        stub_dir = self.root / 'bin'
        stub_dir.mkdir()
        jsonfilter = stub_dir / 'jsonfilter'
        jsonfilter.write_text('#!/bin/sh\ncase "$*" in *keep_config*) printf 0;; esac\n')
        jsonfilter.chmod(0o755)
        environment = {'PATH': f'{stub_dir}:{Path("/usr/bin")}'}
        for payload in ({'download_url': 'https://attacker.invalid/image'}, {'asset_name': '../outside'}):
            with self.subTest(payload=payload):
                result = subprocess.check_output(
                    ['sh', str(BACKEND), 'test_start'], input=json.dumps(payload), text=True, env=environment
                )
                self.assertFalse(json.loads(result)['success'])
                self.assertIn('Invalid upgrade request', json.loads(result)['error'])

        result = subprocess.check_output(['sh', str(BACKEND), 'test_start'], input='{}', text=True, env=environment)
        self.assertFalse(json.loads(result)['success'])
        self.assertIn('Invalid upgrade request', json.loads(result)['error'])

    def test_worker_rejects_missing_or_invalid_checksum_before_sysupgrade(self):
        for sha256 in ('', 'not-a-hash'):
            with self.subTest(sha256=sha256):
                result = subprocess.check_output(
                    ['sh', str(WORKER), 'test_validate', 'https://example.com/image.bin', 'image.bin', sha256, '0', '123'],
                    text=True,
                )
                self.assertNotEqual(result.strip(), 'ok')

    def test_worker_rejects_path_traversal_and_invalid_size(self):
        cases = [
            ('https://example.com/image.bin', '../image.bin', 'a' * 64, '0', '123'),
            ('https://example.com/image.bin', 'image.bin', 'a' * 64, '2', '123'),
            ('https://example.com/image.bin', 'image.bin', 'a' * 64, '0', 'bad'),
        ]
        for args in cases:
            with self.subTest(args=args):
                result = subprocess.check_output(['sh', str(WORKER), 'test_validate', *args], text=True)
                self.assertNotEqual(result.strip(), 'ok')

    def test_source_uses_strict_integrity_and_private_runtime_paths(self):
        worker = WORKER.read_text()
        backend = BACKEND.read_text()
        self.assertIn('umask 077', worker)
        self.assertIn('mktemp -d /tmp/firmwareupgrade.XXXXXX', worker)
        self.assertIn('ACTUAL_SHA256=$(sha256sum', worker)
        self.assertIn('[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] ||', worker)
        self.assertNotIn('killall -9', backend)
        self.assertNotIn('Authorization: Bearer ***', backend)
        self.assertIn('validate_settings', backend)

    def test_removed_proxy_has_no_remaining_runtime_or_i18n_surface(self):
        package_text = '\n'.join(
            path.read_text()
            for path in PACKAGE.rglob('*')
            if path.is_file() and 'tests' not in path.parts
        )
        self.assertNotIn('cancelUpgrade', package_text)
        self.assertNotIn('proxy', package_text.lower())

    def test_candidate_download_url_is_revalidated_before_worker_launch(self):
        backend = BACKEND.read_text()
        start = backend[backend.index('start_upgrade()'):backend.index('save_settings()')]
        self.assertIn('valid_url "$url"', start)
        self.assertIn('rm -f "$CANDIDATE_FILE"', start)
        self.assertIn("IFS=\"$(printf '\t')\"", backend)

    def test_upgrade_start_uses_an_atomic_lock(self):
        backend = BACKEND.read_text()
        start = backend[backend.index('start_upgrade()'):backend.index('save_settings()')]
        self.assertIn('LOCK_DIR=', backend)
        self.assertIn('mkdir "$LOCK_DIR"', start)
        self.assertIn('rmdir "$LOCK_DIR"', start)
        self.assertLess(start.index('mkdir "$LOCK_DIR"'), start.index('rm -f "$CANDIDATE_FILE"'))


if __name__ == '__main__':
    unittest.main()
