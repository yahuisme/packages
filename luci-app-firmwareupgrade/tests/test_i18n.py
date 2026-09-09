#!/usr/bin/env python3
import pathlib
import json
import re

root = pathlib.Path(__file__).resolve().parents[1]
source = root / 'htdocs/luci-static/resources/view/firmwareupgrade/index.js'

ids = set()
with open(source, 'r', encoding='utf-8') as f:
    for line in f:
        matches = re.findall(r"_\(\s*['\"]([^'\"]+)['\"]\s*\)", line)
        for m in matches:
            ids.add(m)

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
    metadata(json.loads(path.read_text()))

po_file = root / 'po/zh_Hans/firmwareupgrade.po'
po_ids = set()
with open(po_file, 'r', encoding='utf-8') as f:
    for match in re.finditer(r'msgid\s+"(.*)"', f.read()):
        m = match.group(1)
        if m:
            po_ids.add(m)

missing = ids - po_ids
if missing:
    print("Missing translations in PO:", missing)
    exit(1)

print(f"PASS: All {len(ids)} strings in JS & JSON metadata are fully covered in PO/POT dictionary.")
