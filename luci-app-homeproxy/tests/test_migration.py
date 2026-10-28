"""Complete upgrade migration with private native ucode/libuci and filesystem.

Requires the checksum-pinned OpenWrt runtime from the repository test setup.
No host UCI, defaults, services, compiler or network is used.
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
    def migrate(self, original, fault=''):
        with tempfile.TemporaryDirectory(prefix='hp-migrate-') as directory:
            root = Path(directory)
            for part in ('config', 'saved', 'hp', 'hp/resources'):
                (root / part).mkdir()
            config = root / 'config/homeproxy'
            config.write_text(original)
            source = (SCRIPTS / 'migrate_config.uc').read_text()
            source = source.replace("import { cursor } from 'uci';", "import { cursor as native_cursor } from 'uci';")
            # Only the cursor location/fault boundary is substituted. The
            # migration's checks, ordering, native libuci and commit remain real.
            source = source.replace("import { HP_DIR, domainListPath, isEmpty, normalizeDomainList } from 'homeproxy';", '')
            helper = (SCRIPTS / 'homeproxy.uc').read_text()
            helper = helper[helper.index('export function isEmpty'):helper.index('export function splitDomainList')].replace('export function', 'function')
            preamble = 'const HP_DIR=' + json.dumps(str(root / 'hp')) + ';\n' + helper
            preamble += '''
const native = native_cursor(ARGV[0], ARGV[1]);
let commits = 0;
function cursor() {
 return {
  load: (...args) => ARGV[2] === 'load' ? null : native.load(...args),
  get: (...args) => native.get(...args),
  foreach: (...args) => native.foreach(...args),
  changes: (...args) => native.changes(...args),
  commit: (...args) => { commits++; return native.commit(...args); },
  set: (...args) => ARGV[2] === 'set' || (ARGV[2] === 'migrated-set' && args[2] === 'hysteria_stream_receive_window') ? null : native.set(...args),
  delete: (...args) => ARGV[2] === 'delete' ? null : native.delete(...args)
 };
}
'''
            # Keep imports before declarations for both supported ucode runtimes.
            split = source.index('/* Move user lists')
            source = source[:split] + preamble + source[split:]
            source += "\nprint(sprintf('%J', { commits }));\n"
            script = root / 'migration.uc'
            script.write_text(source)
            result = subprocess.run(['ucode', '-L', os.environ['UCODE_LIB_DIR'], str(script),
                                     str(root / 'config'), str(root / 'saved'), fault],
                                    capture_output=True, text=True, timeout=10)
            return result, config.read_text()

    @staticmethod
    def legacy():
        return """config homeproxy 'infra'
 option common_port '22,53,80,143,443,465,587,853,873,993,995,5222,8080,8443,9418'
config homeproxy 'config'
 option routing_mode 'global'
config homeproxy 'routing'
 option tcpip_stack 'system'
config homeproxy 'control'
config homeproxy 'subscription'
config homeproxy 'server'
config node 'legacy'
 option type 'hysteria'
 option hysteria_recv_window_conn '4096'
"""

    def test_failed_set_preserves_committed_legacy_options(self):
        for fault in ('set', 'migrated-set'):
            with self.subTest(fault=fault):
                result, after = self.migrate(self.legacy(), fault)
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self.assertEqual(after, self.legacy())

    def test_failed_delete_preserves_committed_legacy_options(self):
        result, after = self.migrate(self.legacy(), 'delete')
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertEqual(after, self.legacy())

    def test_failed_load_never_creates_replacement_config(self):
        result, after = self.migrate(self.legacy(), 'load')
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertEqual(after, self.legacy())

    def test_success_moves_options_and_repeat_is_noop(self):
        result, after = self.migrate(self.legacy())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['commits'], 1)
        self.assertIn("option tcpip_stack 'system'", after)
        self.assertIn("option hysteria_stream_receive_window '4096'", after)
        self.assertNotIn('hysteria_recv_window_conn', after)
        result, repeated = self.migrate(after)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['commits'], 0)
        self.assertEqual(repeated, after)


if __name__ == '__main__':
    unittest.main()
