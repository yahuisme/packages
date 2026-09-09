#!/usr/bin/env python3
"""Check complete, synchronized Chinese localization without gettext deps."""
import ast
import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def catalog(path):
    entries = {}
    key = None
    value = ''
    mode = None
    for line in path.read_text().splitlines() + ['msgid ""']:
        if line.startswith('msgid '):
            if key is not None:
                if key in entries:
                    raise ValueError('Duplicate msgid: ' + key)
                entries[key] = value
            key, value, mode = ast.literal_eval(line[6:]), '', 'id'
        elif line.startswith('msgstr '):
            value, mode = ast.literal_eval(line[7:]), 'str'
        elif line.startswith('"'):
            if mode == 'id':
                key += ast.literal_eval(line)
            elif mode == 'str':
                value += ast.literal_eval(line)
    entries.pop('', None)
    return entries


class CatalogTest(unittest.TestCase):
    def test_catalog_matches_source(self):
        source = '\n'.join(p.read_text() for p in (APP / 'htdocs').rglob('*.js'))
        strings = {ast.literal_eval(m.group(1)) for m in re.finditer(
            r'''_\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\)''', source)}
        for path in (APP / 'root/usr/share/luci/menu.d').glob('*.json'):
            strings.update(v['title'] for v in json.loads(path.read_text()).values())
        for path in (APP / 'root/usr/share/rpcd/acl.d').glob('*.json'):
            strings.update(v['description'] for v in json.loads(path.read_text()).values())
        # Native LuCI _() normalizes whitespace; preserve the exact source entry
        # and its runtime lookup alias for descriptions containing double spaces.
        strings.update(re.sub(r'\s+', ' ', s).strip() for s in list(strings))
        po = catalog(APP / 'po/zh_Hans/wifi7.po')
        pot = catalog(APP / 'po/templates/wifi7.pot')
        self.assertEqual(set(po), strings)
        self.assertEqual(set(pot), strings)
        self.assertTrue(all(v.strip() for v in po.values()))
        technical_names = {'BSSID', 'MLO', 'OWE', 'SSID', 'WPA2-PSK',
                           'WPA3-SAE', 'Wi-Fi MLO', 'WiFi 7'}
        self.assertEqual({k for k, v in po.items() if k == v}, technical_names)
        for key, value in po.items():
            self.assertEqual(re.findall(r'%[sdh]', key), re.findall(r'%[sdh]', value))
        self.assertTrue(all(k == k.strip() for k in strings))


if __name__ == '__main__':
    unittest.main()
