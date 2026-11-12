#!/usr/bin/env python3
"""Verify the payload against both immutable pre-migration Git snapshots."""

import os
import tempfile
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
REPOS = {
    "openwrt": (
        Path(os.environ.get("W1700K_OPENWRT_REPO", ROOT.parents[1] / "w1700k-openwrt")),
        "b527db7ab1f918f0467056c50c332cafe31df7c8",
    ),
    "immortalwrt": (
        Path(os.environ.get("W1700K_IMMORTALWRT_REPO", ROOT.parents[1] / "w1700k-immortalwrt")),
        "b61b737b26b06b1be1085f356c761cb516aa618e",
    ),
}
COMMON = (
    "patches/002-w1700k-cpufreq-resources.patch",
    "patches/920-wifi-non-mlo-ap-txpower.patch",
    "patches/998-single-wiphy.patch",
    "tree/package/kernel/mt76/patches/911-mt76-mt7996-refresh-power-limits-on-txpower-changes.patch",
    "tree/package/network/utils/iwinfo/patches/999-fix-txpower-list.patch",
    "tree/target/linux/airoha/patches-6.18/745-net-pcs-airoha-extend-manual-rx-calib-to-E2-silicon.patch",
    "tree/target/linux/airoha/patches-6.18/746-net-dsa-mt7530-pre-deassert-phy-reset-gpios-before-mdio-scan.patch",
    "tree/target/linux/airoha/patches-6.18/940-pmdomain-airoha-cpu-pll-fallback.patch",
)
POWER = "610-w1700k-power-30.patch"
ADDED = {
    "tree/package/kernel/mt76/patches/912-mt76-mt7996-use-mcu-station-statistics.patch",
    "tree/package/kernel/mt76/patches/913-mt76-mt7996-clean-up-truncated-txfree.patch",
    "tree/package/kernel/mt76/patches/914-mt76-mt7996-free-rro-drop-buffers.patch",
    "tree/package/network/utils/iwinfo/patches/998-fix-multi-radio-scan.patch",
    "tree/package/network/services/hostapd/patches/mtk-0015-hostapd-mtk-6G-band-does-not-require-DFS.patch",
    "tree/package/system/procd/patches/001-watchdog-clamp-default-to-device-limit.patch",
}
REMOVED_920_HUNK = (
    b"@@ -95,7 +95,7 @@\n"
    b" \t\trxantenna: config.rxantenna\n"
    b" \t});\n"
    b" \n"
    b"-\tif (config.txpower)\n"
    b"+\tif (config.txpower != null)\n"
    b" \t\tconfig.txpower = 'fixed ' + config.txpower + '00';\n"
    b" \telse\n"
    b" \t\tconfig.txpower = 'auto';\n"
)


class MigrationIntegrity(unittest.TestCase):
    def test_exact_inventory_and_snapshot_bytes(self):
        expected = set(COMMON) | {f"patches/{POWER}"} | ADDED
        actual = {str(p.relative_to(ROOT)) for folder in ('patches', 'tree')
                  for p in (ROOT / folder).rglob("*.patch")}
        self.assertEqual(actual, expected, "central payload inventory differs")
        power_bytes = {}
        for distro, (repo, revision) in REPOS.items():
            # Retired distro repositories need not exist after the approved merge.
            # The initial centralization commit retains its verified migration bytes.
            migrated = not repo.is_dir()
            if migrated:
                repo = ROOT.parent
                revision = '14cc379984cc45cf10c6ce228fb44944bfa4f6af'
                prefix = 'w1700k-patches/'
            else:
                prefix = 'user/default/'
            source_paths = subprocess.check_output(
                ["git", "-C", str(repo), "ls-tree", "-r", "--name-only", revision,
                 prefix + "patches", prefix + "tree"],
                text=True,
            ).splitlines()
            patches = {p.removeprefix(prefix) for p in source_paths
                       if p.endswith(".patch")}
            if migrated:
                patches.add(f"patches/{POWER}")
            self.assertEqual(patches, set(COMMON) | {f"patches/{POWER}"})
            for source in sorted(patches):
                with self.subTest(distro=distro, source=source):
                    original_path = prefix + source
                    if migrated and source == f"patches/{POWER}":
                        original_path = f"w1700k-patches/{distro}/{POWER}"
                    original = subprocess.check_output(
                        ["git", "-C", str(repo), "show", f"{revision}:{original_path}"]
                    )
                    destination = source
                    if source == f"patches/{POWER}":
                        destination = f"patches/{POWER}"
                        power_bytes[distro] = original
                        if distro == "immortalwrt":
                            original = power_bytes["openwrt"]
                    if source == "patches/920-wifi-non-mlo-ap-txpower.patch":
                        if not migrated:
                            self.assertEqual(original.count(REMOVED_920_HUNK), 1)
                            original = original.replace(REMOVED_920_HUNK, b"", 1)
                        old_context = b"@@ -745,7 +745,8 @@\n {\n"
                        self.assertEqual(original.count(old_context), 1)
                        original = original.replace(old_context, b"@@ -745,5 +745,6 @@\n", 1)
                        old_tail = b" \tswitch (radio_reload_class(old_config.radio, config.radio)) {\n"
                        self.assertEqual(original.count(old_tail), 1)
                        original = original.replace(old_tail, b"", 1)
                    if source == "patches/998-single-wiphy.patch":
                        old = b"if (ifname) {"
                        new = b"if (n.isUp() && ifname && ifname != n.getID()) {"
                        self.assertEqual(original.count(old), 1)
                        original = original.replace(old, new, 1)
                        # Only the reviewed local-frequency/cache delta is permitted.
                        with tempfile.TemporaryDirectory() as tmp:
                            target = Path(tmp) / 'w1700k-patches' / source
                            target.parent.mkdir(parents=True)
                            target.write_bytes(original)
                            delta = ROOT / 'tests/fixtures/channel-local-info.diff.fixture'
                            result = subprocess.run(['patch', '-p1', '--batch', '--fuzz=0',
                                                     '-i', str(delta)], cwd=tmp,
                                                    capture_output=True, text=True)
                            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                            original = target.read_bytes()
                    self.assertEqual((ROOT / destination).read_bytes(), original,
                                     f"changed bytes: {distro}/{source}")
        self.assertNotEqual(power_bytes["openwrt"], power_bytes["immortalwrt"],
                             "pre-migration distro inputs are intentionally different")


if __name__ == "__main__":
    unittest.main(verbosity=2)
