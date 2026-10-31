"""The CLI cursor fixture must not invent native UCI object coercion."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

class UciFixtureTypes(unittest.TestCase):
    def test_object_values_return_native_null_without_modifying_storage(self):
        with tempfile.TemporaryDirectory(prefix='hp-uci-type-') as directory:
            root = Path(directory)
            for name in ('config','saved','override'):
                (root/name).mkdir()
            (root/'fault.json').write_text('null')
            config = root/'config/homeproxy'
            config.write_text("config node 'n1'\n option type 'shadowsocks'\n")
            original = config.read_bytes()
            run = subprocess.run(['python3', str(Path(__file__).with_name('subscription_uci_fixture.py')), str(root),
                                  json.dumps(['set','homeproxy','n1','shadowsocks_plugin_opts',{'mode':'websocket'}])],
                                 capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIsNone(json.loads(run.stdout))
            self.assertEqual(config.read_bytes(),original)
            self.assertEqual(list((root/'saved').iterdir()),[])

if __name__ == '__main__': unittest.main()
