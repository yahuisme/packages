"""Keep optional runtime modules out of the installed dependency closure."""
from pathlib import Path
import re
import unittest

APP = Path(__file__).resolve().parents[1]


class PackageDependencies(unittest.TestCase):
    def test_unused_math_module_is_not_required(self):
        recipe = (APP / 'Makefile').read_text()
        self.assertNotIn('+ucode-mod-math', recipe)
        for path in (APP / 'root').rglob('*'):
            if path.is_file() and path.suffix == '.uc':
                self.assertIsNone(re.search(r"\b(?:import|require)\b[^;\n]*['\"]math['\"]", path.read_text()), str(path))


if __name__ == '__main__':
    unittest.main()
