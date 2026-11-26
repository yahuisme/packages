"""Expand canonical luci.mk's package metadata without building any package."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PackageMetadata(unittest.TestCase):
    def test_luci_expands_maintainer_and_readme_version(self):
        luci = Path(os.environ['LUCI_RESOURCE_DIR']).resolve().parents[4]
        native = luci / 'luci.mk'
        self.assertTrue(native.is_file(), 'pinned LuCI checkout with luci.mk required')
        rows = dict(re.findall(r'^\| `([^`]+)` \| `([^`]+)` \|', (ROOT / 'README.md').read_text(), re.M))
        recipes = sorted(ROOT.glob('luci-app-*/Makefile'))
        self.assertTrue(recipes)
        with tempfile.TemporaryDirectory() as td:
            fixture = Path(td)
            (fixture / 'feeds').mkdir()
            (fixture / 'feeds/luci').symlink_to(luci, target_is_directory=True)
            (fixture / 'rules.mk').write_text('')
            (fixture / 'package.mk').write_text('''define BuildPackage
$(info BEGIN $(1))
$(info $(Package/$(1)))
$(info END $(1))
endef
''')
            for recipe in recipes:
                with self.subTest(recipe=recipe.parent.name):
                    output = subprocess.check_output(['make', '--no-print-directory', '-s', '-C', str(recipe.parent),
                        '-f', 'Makefile', '-f', '-', 'metadata', f'TOPDIR={td}', f'INCLUDE_DIR={td}',
                        'DUMP=1'], input='metadata: ; @:\n', text=True, timeout=10)
                    name = recipe.parent.name
                    metadata = output.split('BEGIN ' + name + '\n', 1)[1].split('END ' + name + '\n', 1)[0]
                    fields = dict(re.findall(r'^\s*(\w+):=([^\n]+)$', metadata, re.M))
                    self.assertEqual(fields['MAINTAINER'], 'yahuisme <40222380+yahuisme@users.noreply.github.com>')
                    self.assertEqual(fields['VERSION'], rows[name])
