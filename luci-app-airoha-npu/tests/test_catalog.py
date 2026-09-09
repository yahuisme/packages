#!/usr/bin/env python3
import json
from pathlib import Path
import re
import unittest

P = Path(__file__).resolve().parents[1]

class Catalog(unittest.TestCase):
    def test_catalog_and_acl(self):
        strings = set()
        methods = set()
        for js_file in (P / 'htdocs/luci-static/resources/view/airoha_npu').glob('*.js'):
            js = js_file.read_text()
            strings.update(re.findall(r"_\('([^']*)'\)", js))
            methods.update(re.findall(r"method: '([^']+)'", js))

        # Add menu.d titles which are translated
        for json_path in (P / 'root/usr/share/luci/menu.d').rglob('*.json'):
            data = json.loads(json_path.read_text())
            for key, val in data.items():
                if isinstance(val, dict) and 'title' in val:
                    strings.add(val['title'])

        for path in [P / 'po/templates/luci-app-airoha-npu.pot', P / 'po/zh_Hans/luci-app-airoha-npu.po']:
            entries = re.findall(r'^msgid (".*")\nmsgstr (".*")$', path.read_text(), re.M)
            mapping = {json.loads(k): json.loads(v) for k, v in entries if json.loads(k)}
            self.assertEqual(strings, set(mapping))
            if path.suffix == '.po':
                self.assertTrue(all(mapping.values()))

        acl = json.loads((P / 'root/usr/share/rpcd/acl.d/luci-app-airoha-npu.json').read_text())['luci-app-airoha-npu']
        self.assertEqual(methods, set(acl['read']['ubus']['luci.airoha_npu'] + acl['write']['ubus']['luci.airoha_npu']))
        self.assertNotIn('file', acl['write'])
        makefile = (P / 'Makefile').read_text()
        self.assertNotIn('postinst', makefile)
        self.assertNotIn('sysctl', makefile)

if __name__ == '__main__':
    unittest.main()
