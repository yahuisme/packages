#!/usr/bin/env python3
import ast
import json
from pathlib import Path
import re
import unittest

P = Path(__file__).resolve().parents[1]
class Catalog(unittest.TestCase):
    def test_catalog_and_acl(self):
        js = (P / 'htdocs/luci-static/resources/view/airoha_npu/status.js').read_text()
        strings = set(re.findall(r"_\('([^']*)'\)", js))
        for path in [P / 'po/templates/luci-app-airoha-npu.pot', P / 'po/zh_Hans/luci-app-airoha-npu.po']:
            entries = re.findall(r'^msgid (".*")\nmsgstr (".*")$', path.read_text(), re.M)
            mapping = {json.loads(k):json.loads(v) for k,v in entries if json.loads(k)}
            self.assertEqual(strings, set(mapping))
            if path.suffix == '.po': self.assertTrue(all(mapping.values()))
        acl = json.loads((P / 'root/usr/share/rpcd/acl.d/luci-app-airoha-npu.json').read_text())['luci-app-airoha-npu']
        methods = set(re.findall(r"method: '([^']+)'", js))
        self.assertEqual(methods, set(acl['read']['ubus']['luci.airoha_npu'] + acl['write']['ubus']['luci.airoha_npu']))
        self.assertNotIn('file', acl['write'])
        makefile = (P / 'Makefile').read_text()
        self.assertNotIn('postinst', makefile)
        self.assertNotIn('sysctl', makefile)

if __name__ == '__main__': unittest.main()
