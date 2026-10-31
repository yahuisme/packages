"""Keep both CI architectures bound to reviewed official runtime packages."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/setup-test-tools.py'
spec = importlib.util.spec_from_file_location('setup_tools', SCRIPT)
assert spec and spec.loader
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class DigestPackage(unittest.TestCase):
    def test_reviewed_digest_packages(self):
        for machine, arch, digest in (
            ('aarch64', 'aarch64_generic', '7a36ffcfa4110e6884b2abdc25e693df0f69dca0a4b745287120fd6a2b10dd25'),
            ('x86_64', 'x86_64', 'f7ef2659ff2606e63cffa820878992c7795ffe572be9d03a29f88a600b0ae5c4'),
        ):
            with self.subTest(machine=machine):
                url, expected = setup.digest_package(machine)
                self.assertEqual(url, f'https://downloads.openwrt.org/releases/24.10.4/packages/{arch}/base/'
                                 f'ucode-mod-digest_2025.07.18~3f64c808-r2_{arch}.ipk')
                self.assertEqual(expected, digest)

    def test_unknown_architecture_fails_closed(self):
        with self.assertRaises(ValueError):
            setup.digest_package('unsupported')


if __name__ == '__main__':
    unittest.main()
