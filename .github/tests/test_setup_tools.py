"""Keep both CI architectures bound to reviewed official runtime packages."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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

    def test_cached_download_is_hashed_once_and_bad_bytes_are_not_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'
            target = Path(directory) / 'target'
            source.write_bytes(b'expected fixture')
            digest = hashlib.sha256(b'expected fixture').hexdigest()
            setup.download(source.as_uri(), digest, target)
            with patch.object(setup, 'file_sha256', wraps=setup.file_sha256) as hash_file:
                setup.download(source.as_uri(), digest, target)
                hash_file.assert_called_once_with(target)
            source.write_bytes(b'wrong fixture')
            target.write_bytes(b'corrupt cache')
            with self.assertRaisesRegex(RuntimeError, 'SHA256 mismatch'):
                setup.download(source.as_uri(), digest, target)


if __name__ == '__main__':
    unittest.main()
