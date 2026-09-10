"""Real ucode + filesystem; private UCI fixture, no router services/network.
Fault injection wraps only the selected fs operation, retaining real fs otherwise.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]
SCRIPTS = APP / 'root/etc/homeproxy/scripts'

class Migration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hp-migration-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.hp = self.base/'hp'
        (self.hp/'resources/diversion').mkdir(parents=True)
        (self.hp/'diversion').mkdir()
        (self.base/'http.uc').write_text('export function urldecode_params(s) { return {}; }')
        helper = (SCRIPTS/'homeproxy.uc').read_text().replace("'/etc/homeproxy'", repr(str(self.hp))).replace("from 'luci.http'", f"from '{self.base}/http.uc'")
        (self.base/'homeproxy.uc').write_text(helper)
        # Execute the full migration script; no UCI domain_route references exist.
        (self.base/'uci.uc').write_text('export function cursor() { return { load:function(){return true;}, get:function(){return null;}, set:function(){return true;}, delete:function(){return true;}, foreach:function(){}, changes:function(){return {};}, commit:function(){return true;} }; }')
        self.source = (SCRIPTS/'migrate_config.uc').read_text()
        for mod in ['uci', 'homeproxy']:
            self.source = self.source.replace(f"from '{mod}'", f"from '{self.base}/{mod}.uc'")
        self.put('resources/geoip_cn.srs', 'SRS sentinel')
        self.put('resources/geoip_cn.ver', 'immutable sentinel')

    def put(self, path, value):
        p = self.hp/path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(value)

    def run_migration(self, fail=None):
        source = self.source
        if fail:
            # Deliberately fail real operation boundary, never bypass migration logic.
            exports = ['glob', 'mkdir', 'readfile', 'rename', 'rmdir', 'stat', 'unlink', 'writefile']
            wrapper = "import * as fs from 'fs';\n"
            for name in exports:
                args = 'a, b' if name in ['rename', 'writefile'] else 'a'
                condition = 'false'
                if name == fail:
                    condition = "index(a, '/diversion/direct.txt') >= 0" if name in ['writefile', 'readfile'] else "index(a, 'direct') >= 0"
                action = "fs.writefile(a, 'partial'); return 1;" if name == 'writefile' else 'return null;'
                wrapper += f'export function {name}({args}) {{ if ({condition}) {{ {action} }} return fs.{name}({args}); }}\n'
            (self.base/'fs.uc').write_text(wrapper)
            source = source.replace("from 'fs'", f"from '{self.base}/fs.uc'")
        (self.base/'migrate.uc').write_text(source)
        command = ['ucode']
        if os.environ.get('UCODE_LIB_DIR'):
            command += ['-L', os.environ['UCODE_LIB_DIR']]
        p = subprocess.run(command + [str(self.base/'migrate.uc')], capture_output=True, text=True, timeout=20)
        self.assertEqual((self.hp/'resources/geoip_cn.srs').read_text(), 'SRS sentinel')
        self.assertEqual((self.hp/'resources/geoip_cn.ver').read_text(), 'immutable sentinel')
        return p

    def snapshot(self):
        return {str(p.relative_to(self.hp)): p.read_bytes() for p in self.hp.rglob('*') if p.is_file()}

    def test_merge_orphans_and_idempotence(self):
        for old, new in [('direct_list', 'direct'), ('proxy_list', 'proxy')]:
            self.put(f'resources/{old}.txt', 'OLD.example\r\nshared.example\n')
            self.put(f'diversion/{new}.txt', 'new.example\n.SHARED.example.\n')
        self.put('resources/diversion/orphan.txt', 'orphan-old.example\nshared.example\n')
        self.put('diversion/orphan.txt', 'orphan-new.example\nshared.example\n')
        self.put('resources/diversion/disabled.txt', 'disabled.example\n')
        self.put('resources/diversion/notes.keep', 'not a domain list')
        self.put('diversion/new-only.txt', 'keep bytes\n')
        p = self.run_migration(); self.assertEqual(p.returncode, 0, p.stderr)
        for name in ['direct', 'proxy']:
            self.assertEqual((self.hp/f'diversion/{name}.txt').read_text(), 'new.example\nshared.example\nold.example\n')
        self.assertEqual((self.hp/'diversion/orphan.txt').read_text(), 'orphan-new.example\nshared.example\norphan-old.example\n')
        self.assertEqual((self.hp/'diversion/disabled.txt').read_text(), 'disabled.example\n')
        self.assertFalse(list((self.hp/'resources').rglob('*.txt')))
        before = self.snapshot(); p = self.run_migration()
        self.assertEqual(p.returncode, 0, p.stderr); self.assertEqual(self.snapshot(), before)

    def test_old_only_move_keeps_exact_bytes(self):
        self.put('resources/direct_list.txt', 'Original.EXAMPLE\r\nOriginal.EXAMPLE\r\n')
        p = self.run_migration(); self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual((self.hp/'diversion/direct.txt').read_bytes(), b'Original.EXAMPLE\r\nOriginal.EXAMPLE\r\n')
        self.assertFalse((self.hp/'resources/diversion').exists())

    def test_empty_and_new_only(self):
        self.put('resources/direct_list.txt', '')
        self.put('diversion/proxy.txt', 'new.example\n')
        p = self.run_migration(); self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual((self.hp/'diversion/direct.txt').read_text(), '')
        self.assertEqual((self.hp/'diversion/proxy.txt').read_text(), 'new.example\n')

    def test_read_write_rename_failure_keeps_both_and_retry(self):
        for operation in ['readfile', 'writefile', 'rename']:
            with self.subTest(operation=operation):
                self.put('resources/direct_list.txt', 'old.example\n')
                self.put('diversion/direct.txt', 'new.example\n')
                before = self.snapshot(); p = self.run_migration(operation)
                self.assertNotEqual(p.returncode, 0)
                self.assertEqual(self.snapshot(), before)
                p = self.run_migration(); self.assertEqual(p.returncode, 0, p.stderr)
                self.assertEqual((self.hp/'diversion/direct.txt').read_text(), 'new.example\nold.example\n')

    def test_unlink_failure_retains_source_and_merged_target(self):
        self.put('resources/direct_list.txt', 'old.example\n')
        self.put('diversion/direct.txt', 'new.example\n')
        p = self.run_migration('unlink'); self.assertNotEqual(p.returncode, 0)
        self.assertEqual((self.hp/'resources/direct_list.txt').read_text(), 'old.example\n')
        self.assertEqual((self.hp/'diversion/direct.txt').read_text(), 'new.example\nold.example\n')
        p = self.run_migration(); self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual((self.hp/'diversion/direct.txt').read_text(), 'new.example\nold.example\n')
        self.assertFalse((self.hp/'resources/direct_list.txt').exists())

    def test_rpc_read_write_remove_final_paths(self):
        (self.hp/'diversion').rmdir()
        validator = self.base/'validate'
        validator.write_text('#!/bin/sh\nexit 0\n')
        validator.chmod(0o755)
        helper = self.base/'homeproxy.uc'
        helper.write_text(helper.read_text().replace('/sbin/validate_data', str(validator)))
        source = (APP/'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        source = source.replace("from 'uci'", f"from '{self.base}/uci.uc'")
        source = source.replace("from '/etc/homeproxy/scripts/homeproxy.uc'", f"from '{helper}'")
        source = source.replace("return { 'luci.homeproxy': methods };", '''
let result = methods.domainlist_write.call({args:{lists:{direct:'direct.example',proxy:'proxy.example',custom:'custom.example'}, routing_mode:'bypass_mainland_china'}});
assert(result.result, sprintf('%J', result));
for (let id in ['direct', 'proxy', 'custom'])
    assert(methods.domainlist_read.call({args:{id}}).content === id + '.example\\n');
assert(methods.domainlist_remove.call({args:{id:'custom'}}).result);
assert(methods.domainlist_read.call({args:{id:'custom'}}).content === null);
assert(!methods.domainlist_remove.call({args:{id:'direct'}}).result);
assert(!methods.domainlist_write.call({args:{lists:{'../escape':'bad'},routing_mode:'global'}}).result);
''')
        # Keep the ucode newline escape literal inside the generated source.
        source = source.replace("+ '.example\n'", "+ '.example\\n'")
        script = self.base/'rpc.uc'; script.write_text(source)
        cmd = ['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/usr/lib/ucode'), str(script)]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual((self.hp/'diversion/direct.txt').read_text(), 'direct.example\n')
        self.assertEqual((self.hp/'diversion/proxy.txt').read_text(), 'proxy.example\n')
        self.assertFalse(list((self.hp/'resources').rglob('*.txt')))

    def test_move_failure_keeps_source(self):
        self.put('resources/direct_list.txt', 'old.example\n')
        before = self.snapshot(); p = self.run_migration('rename')
        self.assertNotEqual(p.returncode, 0); self.assertEqual(self.snapshot(), before)

    def test_directory_creation_failure_keeps_source(self):
        (self.hp/'diversion').rmdir()
        self.put('resources/direct_list.txt', 'old.example\n')
        # Real filesystem ENOTDIR rather than an injected failure.
        self.put('diversion', 'obstruction')
        before = self.snapshot(); p = self.run_migration()
        self.assertNotEqual(p.returncode, 0); self.assertEqual(self.snapshot(), before)

if __name__ == '__main__':
    unittest.main(verbosity=2)
