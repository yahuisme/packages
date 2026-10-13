#!/usr/bin/env python3
"""Verify the payload against both immutable pre-migration Git snapshots."""

import os
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
        expected = set(COMMON) | {f"patches/{POWER}"}
        actual = {str(p.relative_to(ROOT)) for p in ROOT.rglob("*.patch")}
        self.assertEqual(actual, expected, "central payload inventory differs")
        power_bytes = {}
        for distro, (repo, revision) in REPOS.items():
            source_paths = subprocess.check_output(
                ["git", "-C", str(repo), "ls-tree", "-r", "--name-only", revision,
                 "user/default/patches", "user/default/tree"],
                text=True,
            ).splitlines()
            patches = {p.removeprefix("user/default/") for p in source_paths
                       if p.endswith(".patch")}
            self.assertEqual(patches, set(COMMON) | {f"patches/{POWER}"})
            for source in sorted(patches):
                with self.subTest(distro=distro, source=source):
                    original = subprocess.check_output(
                        ["git", "-C", str(repo), "show", f"{revision}:user/default/{source}"]
                    )
                    destination = source
                    if source == f"patches/{POWER}":
                        destination = f"patches/{POWER}"
                        power_bytes[distro] = original
                        if distro == "immortalwrt":
                            original = power_bytes["openwrt"]
                    if source == "patches/920-wifi-non-mlo-ap-txpower.patch":
                        self.assertEqual(original.count(REMOVED_920_HUNK), 1)
                        original = original.replace(REMOVED_920_HUNK, b"", 1)
                    self.assertEqual((ROOT / destination).read_bytes(), original,
                                     f"changed bytes: {distro}/{source}")
        self.assertNotEqual(power_bytes["openwrt"], power_bytes["immortalwrt"],
                             "pre-migration distro inputs are intentionally different")


if __name__ == "__main__":
    unittest.main(verbosity=2)
