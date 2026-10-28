"""Standard-library audit of literal JS translations and package catalogs."""
import ast
from pathlib import Path
import re
import unittest

APP = Path(__file__).resolve().parents[1]
LITERAL = r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\""
TRANSLATE = re.compile(r"(?<![\w.])_\(\s*((?:" + LITERAL + r")(?:\s*\+\s*(?:" + LITERAL + r"))*)\s*\)")


def catalog(path):
    entries, entry, field = {}, {}, None
    for line in path.read_text().splitlines() + ['']:
        if line.startswith(('msgid ', 'msgstr ')):
            if line.startswith('msgid ') and entry.get('msgid'):
                if entry['msgid'] in entries:
                    raise AssertionError('duplicate message: ' + entry['msgid'])
                entries[entry['msgid']] = entry.get('msgstr', '')
                entry = {}
            field, value = line.split(' ', 1)
            entry[field] = ast.literal_eval(value)
        elif line.startswith('"') and field:
            entry[field] += ast.literal_eval(line)
        elif not line:
            if entry.get('msgid'):
                if entry['msgid'] in entries:
                    raise AssertionError('duplicate message: ' + entry['msgid'])
                entries[entry['msgid']] = entry.get('msgstr', '')
            entry, field = {}, None
    return entries


class Catalog(unittest.TestCase):
    def test_literal_translations_have_template_and_chinese(self):
        po = catalog(APP / 'po/zh_Hans/homeproxy.po')
        pot = catalog(APP / 'po/templates/homeproxy.pot')
        missing = []
        for path in (APP / 'htdocs').rglob('*.js'):
            for match in TRANSLATE.finditer(path.read_text()):
                message = ''.join(ast.literal_eval(s) for s in re.findall(LITERAL, match[1]))
                if message not in pot or not po.get(message):
                    missing.append((str(path.relative_to(APP)), message))
        self.assertEqual(missing, [])

    def test_chinese_placeholders_match(self):
        for message, translated in catalog(APP / 'po/zh_Hans/homeproxy.po').items():
            with self.subTest(message=message):
                self.assertTrue(translated)
                placeholders = r'%(?:[0-9]+\$)?[sdh]'
                self.assertEqual(sorted(re.findall(placeholders, message)),
                                 sorted(re.findall(placeholders, translated)))


if __name__ == '__main__':
    unittest.main()
