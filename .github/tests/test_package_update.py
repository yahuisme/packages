"""Host updater gates: follow official stable releases, never prereleases."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/update-homeproxy.py'

class Gates(unittest.TestCase):
    def test_stable_release(self):
        self.assertTrue(SCRIPT.is_file(), 'independent updater missing')
        spec = importlib.util.spec_from_file_location('updater', SCRIPT)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        release = {'tag_name': 'v1.14.0', 'draft': False, 'prerelease': False}
        self.assertEqual(module.stable_version(release), '1.14.0')
        for tag in ['v1.15.0-beta.1', '1.14.0', 'v1.14.0-extra']:
            with self.assertRaises(ValueError):
                module.stable_version(dict(release, tag_name=tag))
        for field in ['draft', 'prerelease']:
            with self.assertRaises(ValueError):
                module.stable_version(dict(release, **{field: True}))
        self.assertEqual(module.stable_version(dict(release, tag_name='v1.15.0')), '1.15.0')

if __name__ == '__main__':
    unittest.main()
