"""Full RPC method + real ucode/fs, with private UCI/hostname fixtures.

Only the selected staging write is fault-injected; positive short counts are
returned by an actual partial fs.writefile(). No router or host service is used.
"""
import json
import os
from pathlib import Path
import subprocess
import unittest

import test_list_migration as migration


class DomainListWrite(unittest.TestCase):
    def setUp(self):
        self.fixture = migration.Migration()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.base = self.fixture.base
        self.hp = self.fixture.hp
        validator = self.base / 'validate'
        validator.write_text('#!/bin/sh\nexit 0\n')
        validator.chmod(0o700)
        helper = self.base / 'homeproxy.uc'
        helper.write_text(helper.read_text().replace('/sbin/validate_data', str(validator)))
        self.source = (migration.APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        self.source = self.source.replace("from 'uci'", f"from '{self.base}/uci.uc'")
        self.source = self.source.replace(
            "from '/etc/homeproxy/scripts/homeproxy.uc'", f"from '{helper}'")

    def run_write(self, lists, fault=None, fail_at=1):
        wrapper = "import * as fs from 'fs';\n"
        for name in ['lstat', 'open', 'popen', 'readfile', 'rename', 'unlink']:
            wrapper += f'export const {name} = fs.{name};\n'
        # Trace only staging writes so later-write faults prove earlier staging
        # really succeeded, independently of object key ordering.
        wrapper += f'''
let writes = [], fault = {json.dumps(fault)};
export function writefile(path, content) {{
    if (match(path, /\\.txt\\.new$/)) {{
        push(writes, path);
        fs.writefile({json.dumps(str(self.base / 'writes.json'))}, sprintf('%J', writes));
        if (fault != null && length(writes) === {fail_at}) {{
            if (fault === 'null') {{
                fs.writefile(path, 'partial');
                return null;
            }}
            return fs.writefile(path, substr(content, 0, fault === 'zero' ? 0 : 3));
        }}
    }}
    return fs.writefile(path, content);
}}
'''
        (self.base / 'writefs.uc').write_text(wrapper)
        source = self.source.replace("from 'fs'", f"from '{self.base}/writefs.uc'")
        request = {'args': {'lists': lists, 'routing_mode': 'bypass_mainland_china'}}
        entry = "return { 'luci.homeproxy': methods };"
        self.assertEqual(source.count(entry), 1)
        source = source.replace(entry,
            f"print(sprintf('%J', methods.domainlist_write.call({json.dumps(request)})));\n")
        script = self.base / 'rpc.uc'
        script.write_text(source)
        command = ['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/usr/lib/ucode'), str(script)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def assert_no_staging(self):
        self.assertEqual(list((self.hp / 'diversion').glob('*.new')), [])

    def test_failed_write_preserves_files_cleans_staging_and_retries(self):
        for fault in ['short', 'zero', 'null']:
            for fail_at in [1, 2, 3]:
                with self.subTest(fault=fault, fail_at=fail_at):
                    lists = {name: f'new-{name}.example' for name in ['direct', 'proxy', 'custom']}
                    for name in lists:
                        self.fixture.put(f'diversion/{name}.txt', f'Old-{name}.EXAMPLE\r\n')
                    before = self.fixture.snapshot()
                    response = self.run_write(lists, fault, fail_at)
                    self.assertIs(response.get('result'), False, response)
                    self.assertEqual(response.get('error'), 'failed to write domain list')
                    self.assertEqual(len(json.loads((self.base / 'writes.json').read_text())), fail_at)
                    self.assert_no_staging()
                    self.assertEqual(self.fixture.snapshot(), before)
                    self.assertEqual(self.run_write(lists), {'result': True})
                    for name, content in lists.items():
                        self.assertEqual((self.hp / f'diversion/{name}.txt').read_bytes(),
                                         (content + '\n').encode())
                    self.assert_no_staging()

    def test_normalized_and_empty_writes(self):
        self.fixture.put('diversion/direct.txt', 'old.example\n')
        self.fixture.put('diversion/proxy.txt', 'old-proxy.example\n')
        self.assertEqual(self.run_write({'direct': ' NEW.example\r\nnew.example\n', 'proxy': ''}),
                         {'result': True})
        self.assertEqual((self.hp / 'diversion/direct.txt').read_bytes(), b'new.example\n')
        self.assertEqual((self.hp / 'diversion/proxy.txt').read_bytes(), b'')
        self.assert_no_staging()

    def test_null_is_not_success_for_empty_content(self):
        self.fixture.put('diversion/direct.txt', 'old.example\n')
        before = self.fixture.snapshot()
        self.assertIs(self.run_write({'direct': ''}, 'null').get('result'), False)
        self.assert_no_staging()
        self.assertEqual(self.fixture.snapshot(), before)
        self.assertEqual(self.run_write({'direct': ''}), {'result': True})
        self.assertEqual((self.hp / 'diversion/direct.txt').read_bytes(), b'')


if __name__ == '__main__':
    unittest.main(verbosity=2)
