#!/usr/bin/env python3
"""Check the candidate core against maintained native HomeProxy fixtures.

Requires prepared OpenWrt tools and root for private network namespaces. No
firmware build, host service, host network listener or external peer is used.
"""
import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SUITES = (
    'test_client_defaults.py',
    'test_client_routing.py',
    'test_dns_fallback.py',
    'test_ntp_bootstrap.py',
    'test_server_generation.py',
    'test_acme_dns01.py',
    'test_ipv6_policy.py',
    'test_retained_hysteria_obfs.py',
    'test_ss_uot_generation.py',
    'test_urltest_options.py',
    'test_tun_bypass.py',
    'test_diversion_urltest.py',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--version', required=True)
    parser.add_argument('--resources', type=Path, default=ROOT / 'luci-app-homeproxy/root/etc/homeproxy/resources')
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    resources = args.resources.resolve()
    if os.geteuid() != 0:
        # Preserve only the prepared runtime paths, not credentials or ambient
        # optional-test selectors. Do not fall back to the host network.
        command = ['sudo', '-n', 'env']
        for key in ('PATH', 'TMPDIR', 'UCODE_LIB_DIR', 'OPENWRT_SOURCE', 'REAL_UCI', 'UCI_BIN', 'PYTHONDONTWRITEBYTECODE'):
            if key in os.environ:
                command.append(key + '=' + os.environ[key])
        return subprocess.call([*command, sys.executable, str(Path(__file__).resolve()),
                                '--binary', str(binary), '--version', args.version, '--resources', str(resources)])
    actual = subprocess.check_output([str(binary), 'version'], text=True, timeout=10)
    if actual.splitlines()[0] != 'sing-box version ' + args.version:
        raise ValueError('Core compatibility binary version mismatch')
    # Both feed variants install this file. This verifies its schema against
    # the candidate, not the feature set or ABI of a separately built package.
    with tempfile.TemporaryDirectory(prefix='sing-box-default-') as workdir:
        subprocess.run([str(binary), 'check', '-D', workdir, '-c',
                        str(ROOT / 'sing-box/files/config.json')], check=True, timeout=15)
    os.environ.update(SING_BOX_CHECK=str(binary), DNS_RUNTIME_BINARY=str(binary),
                      NTP_RUNTIME_BINARY=str(binary), DNS_RUNTIME_VERSION=args.version,
                      HOMEPROXY_TEST_RESOURCES=str(resources))
    tests = ROOT / 'luci-app-homeproxy/tests'
    sys.path.insert(0, str(tests))
    suite = unittest.TestSuite()
    for name in SUITES:
        spec = importlib.util.spec_from_file_location(Path(name).stem, tests / name)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        selected = unittest.defaultTestLoader.loadTestsFromModule(module)
        if not selected.countTestCases():
            raise RuntimeError('No core compatibility cases: ' + name)
        suite.addTests(selected)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() and result.testsRun and not result.skipped else 1


if __name__ == '__main__':
    raise SystemExit(main())
