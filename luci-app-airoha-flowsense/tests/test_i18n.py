"""Catalog coverage/syntax regression. Supports both polib and fallback pure-python parser."""
import json
import os
import pathlib
import re
import subprocess
import unittest

root = pathlib.Path(__file__).resolve().parents[1]


def parse_po_pure(path):
    text = pathlib.Path(path).read_text(encoding='utf-8')
    entries = {}
    current_id = None
    current_str = None
    is_fuzzy = False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('#,') and 'fuzzy' in line:
            is_fuzzy = True
        elif line.startswith('msgid '):
            if current_id is not None:
                entries[current_id] = {'msgstr': current_str, 'fuzzy': is_fuzzy}
            current_id = line[6:].strip('"')
            current_str = ''
            is_fuzzy = False
        elif line.startswith('msgstr '):
            current_str = line[7:].strip('"')
        elif line.startswith('"') and current_str is not None:
            current_str += line.strip('"')
    if current_id is not None:
        entries[current_id] = {'msgstr': current_str, 'fuzzy': is_fuzzy}
    return entries


class I18nCoverageTest(unittest.TestCase):
    def test_catalog_coverage_and_syntax(self):
        source = (root / 'htdocs/luci-static/resources/view/airoha_flowsense/status.js').read_text(encoding='utf-8')
        ids = set(re.findall(r'''_\(\s*['"]([^'"]+)['"]\s*\)''', source))

        for path in (root / 'root/usr/share').rglob('*.json'):
            def metadata(node):
                if isinstance(node, dict):
                    for key, value in node.items():
                        if key in ('title', 'description') and isinstance(value, str):
                            ids.add(value)
                        metadata(value)
                elif isinstance(node, list):
                    for value in node:
                        metadata(value)
            metadata(json.loads(path.read_text(encoding='utf-8')))

        po_path = root / 'po/zh_Hans/luci-app-airoha-flowsense.po'
        pot_path = root / 'po/templates/luci-app-airoha-flowsense.pot'

        po_data = parse_po_pure(po_path)
        pot_data = parse_po_pure(pot_path)

        po_active = set(po_data.keys())
        pot_active = set(pot_data.keys())

        # 所有源码和元数据中的字串必须被收录
        missing_po = ids - po_active
        self.assertFalse(missing_po, f"Missing strings in PO: {missing_po}")

        # 不能有模糊翻译
        fuzzy_po = [k for k, v in po_data.items() if v.get('fuzzy')]
        self.assertFalse(fuzzy_po, f"Fuzzy translations in PO: {fuzzy_po}")

        # 翻译不得为空
        empty_po = [k for k, v in po_data.items() if k and not v.get('msgstr')]
        self.assertFalse(empty_po, f"Empty translations in PO: {empty_po}")

        # 验证核心词条翻译
        self.assertEqual(po_data.get('Total Port Receive Rate', {}).get('msgstr'), '网口接收总速率')
        self.assertEqual(po_data.get('Total Port Transmit Rate', {}).get('msgstr'), '网口发送总速率')

        # PO与POT应保持同步
        self.assertEqual(po_active, pot_active)
        self.assertEqual(po_active - {''}, ids, 'No stale catalog strings')
        for catalog in (po_path, pot_path):
            subprocess.run(['msgfmt', '--check', '-o', os.devnull, str(catalog)], check=True)

        # 不含陈旧废弃词条
        deprecated = {'Total Download', 'Total Upload', 'PPE engine inactive', 'Probe inactive'}
        self.assertFalse(deprecated & po_active)


if __name__ == '__main__':
    unittest.main()
