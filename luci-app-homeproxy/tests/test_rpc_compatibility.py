"""Load the complete RPC module with real native fs/UCI, private helper only."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]


class RpcCompatibility(unittest.TestCase):
    def test_atomic_private_directories_are_unique_with_native_fs(self):
        runtime = os.environ.get('HP_COMPAT_UCODE', 'ucode')
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        helper = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
        quote = helper[helper.index('export function shellQuote'):helper.index('export function isBinary')].replace('export function', 'function')
        allocation = rpc[rpc.index('function makeTempDir'):rpc.index('function validDomainListId')]
        with tempfile.TemporaryDirectory(prefix='hp-native-stage-') as directory:
            root = Path(directory)
            script = root / 'case.uc'
            script.write_text("import { popen, lstat } from 'fs';\n" + quote + allocation +
                              'let result=[]; for(let i=0;i<20;i++) push(result, makeTempDir(' + json.dumps(str(root / 'stage.XXXXXX')) + ')); printf("%J",result);')
            run = subprocess.run([runtime, str(script)], text=True, capture_output=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            paths = json.loads(run.stdout)
            self.assertEqual(len(set(paths)), 20)
            for path in paths:
                self.assertEqual(Path(path).stat().st_mode & 0o777, 0o700)

    def test_complete_rpc_links_on_selected_openwrt_runtime(self):
        runtime = os.environ.get('HP_COMPAT_UCODE', 'ucode')
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        with tempfile.TemporaryDirectory(prefix='hp-rpc-link-') as directory:
            root = Path(directory)
            helper = root / 'helper.uc'
            http = root / 'http.uc'
            http.write_text('export function urldecode_params(v) { return {}; };')
            helper.write_text((APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
                              .replace("from 'luci.http'", 'from ' + json.dumps(str(http))))
            module = root / 'rpc.uc'
            module.write_text(rpc.replace("'/etc/homeproxy/scripts/homeproxy.uc'", json.dumps(str(helper)))
                              .replace("return { 'luci.homeproxy': methods };", 'print("linked\\n");'))
            run = subprocess.run([runtime, str(module)], text=True, capture_output=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(run.stdout, 'linked\n')


if __name__ == '__main__':
    unittest.main()
