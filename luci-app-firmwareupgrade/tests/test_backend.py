#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
BACKEND = PACKAGE / 'root/usr/libexec/rpcd/luci.firmwareupgrade'

class FirmwareUpgradeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_backend_list(self):
        out = subprocess.check_output(['sh', str(BACKEND), 'list']).decode()
        data = json.loads(out)
        self.assertIn('getSystemInfo', data)
        self.assertIn('checkUpdate', data)
        self.assertIn('getStatus', data)
        self.assertIn('startUpgrade', data)
        self.assertIn('cancelUpgrade', data)
        self.assertIn('saveSettings', data)

    def test_awk_matching_w1700k(self):
        tsv_content = (
            "1\topenwrt-airoha-an7581-gemtek_w1700k-ubi-squashfs-sysupgrade.itb\t17474367\tsha256:65b426eb\thttps://example.com/ubi2.itb\n"
            "2\topenwrt-airoha-an7581-gemtek_w1700k-ubi2-oc-squashfs-sysupgrade.itb\t17474367\tsha256:abcd1234\thttps://example.com/ubi2-oc.itb\n"
        )
        tsv_path = self.root / 'assets.tsv'
        tsv_path.write_text(tsv_content)

        out_ubi2 = subprocess.check_output([
            'sh', str(BACKEND), 'test_match', str(tsv_path), 'gemtek,w1700k', 'ubi2'
        ]).decode().strip()
        self.assertTrue(out_ubi2.startswith('openwrt-airoha-an7581-gemtek_w1700k-ubi-squashfs-sysupgrade.itb'))

        out_oc = subprocess.check_output([
            'sh', str(BACKEND), 'test_match', str(tsv_path), 'gemtek,w1700k', 'ubi2-oc'
        ]).decode().strip()
        self.assertTrue(out_oc.startswith('openwrt-airoha-an7581-gemtek_w1700k-ubi2-oc-squashfs-sysupgrade.itb'))

    def test_awk_matching_mx4200(self):
        tsv_content = (
            "1\timmortalwrt-qualcommax-ipq807x-linksys_mx4200v1-squashfs-factory.bin\t40000000\tsha256:1111\thttps://example.com/v1-fact.bin\n"
            "2\timmortalwrt-qualcommax-ipq807x-linksys_mx4200v1-squashfs-sysupgrade.bin\t38000000\tsha256:2222\thttps://example.com/v1-sys.bin\n"
            "3\timmortalwrt-qualcommax-ipq807x-linksys_mx4200v2-squashfs-factory.bin\t40000000\tsha256:3333\thttps://example.com/v2-fact.bin\n"
            "4\timmortalwrt-qualcommax-ipq807x-linksys_mx4200v2-squashfs-sysupgrade.bin\t38000000\tsha256:4444\thttps://example.com/v2-sys.bin\n"
        )
        tsv_path = self.root / 'mx_assets.tsv'
        tsv_path.write_text(tsv_content)

        out_v1 = subprocess.check_output([
            'sh', str(BACKEND), 'test_match', str(tsv_path), 'linksys,mx4200-v1', 'v1'
        ]).decode().strip()
        self.assertTrue(out_v1.startswith('immortalwrt-qualcommax-ipq807x-linksys_mx4200v1-squashfs-sysupgrade.bin'))

        out_v2 = subprocess.check_output([
            'sh', str(BACKEND), 'test_match', str(tsv_path), 'linksys,mx4200-v2', 'v2'
        ]).decode().strip()
        self.assertTrue(out_v2.startswith('immortalwrt-qualcommax-ipq807x-linksys_mx4200v2-squashfs-sysupgrade.bin'))

if __name__ == '__main__':
    unittest.main()
