"""Production generator RPC process/output faults, native ucode; no core/network."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]


def generate(kind, output, status=0, available=True):
    rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
    start = rpc.index('\tsingbox_generator:')
    block = rpc[start:rpc.index('\n\tsingbox_get_features:', start)]
    helper = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
    quote = helper[helper.index('export function shellQuote'):helper.index('export function isBinary')].replace('export function', 'function')
    source = "import { popen as native_popen } from 'fs';\n" + quote + '\nconst input = ' + json.dumps({'kind': kind, 'output': output, 'status': status, 'available': available}) + ''';
function popen(command) {
 if (!input.available) return null;
 // Only the core command is replaced; native pipe reads and close/wait status
 // still execute on the selected OpenWrt ucode/fs ABI.
 return native_popen('printf %s ' + shellQuote(input.output) + '; exit ' + input.status, 'r');
}
const methods = {''' + block + '''};
print(sprintf('%J', methods.singbox_generator.call({args:{type:input.kind,params:''}})));
'''
    with tempfile.TemporaryDirectory(prefix='hp-generator-rpc-') as directory:
        script = Path(directory) / 'case.uc'
        script.write_text(source)
        run = subprocess.run(['ucode', str(script)], text=True, capture_output=True, timeout=10)
        if run.returncode:
            raise AssertionError(run.stderr)
        return json.loads(run.stdout)


class GeneratorRpc(unittest.TestCase):
    def test_complete_keypairs_remain_supported(self):
        for kind in ('reality-keypair', 'wg-keypair', 'vapid-keypair'):
            with self.subTest(kind=kind):
                self.assertEqual(generate(kind, 'PrivateKey: PRIVATE\nPublicKey: PUBLIC'),
                                 {'result': {'private_key': 'PRIVATE', 'public_key': 'PUBLIC'}})
        self.assertEqual(generate('uuid', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
                         {'result': {'uuid': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}})
        ech = '-----BEGIN ECH CONFIGS-----\nQUJD\n-----END ECH CONFIGS-----\n-----BEGIN ECH KEYS-----\nREVG\n-----END ECH KEYS-----'
        result = generate('ech-keypair', ech)
        self.assertIn('-----END ECH CONFIGS-----', result['result']['ech_cfg'])
        self.assertIn('-----END ECH KEYS-----', result['result']['ech_key'])

    def test_failed_or_incomplete_generation_never_returns_a_success_object(self):
        for kind, output, status, available in (
            ('reality-keypair', 'PrivateKey: PRIVATE\nPublicKey: PUBLIC', 1, True),
            ('reality-keypair', '', 0, False),
            ('reality-keypair', '', 0, True),
            ('reality-keypair', 'PrivateKey: PRIVATE', 0, True),
            ('wg-keypair', 'PublicKey: PUBLIC', 0, True),
            ('uuid', '', 0, True),
            ('ech-keypair', '-----BEGIN ECH KEYS-----\nQUJD', 0, True),
            ('ech-keypair', '-----BEGIN ECH CONFIGS-----\nQUJD\n-----END ECH CONFIGS-----\n-----BEGIN ECH KEYS-----\nREVG', 0, True),
            ('ech-keypair', '-----BEGIN ECH CONFIGS-----\nQUJD\n-----BEGIN ECH KEYS-----\nREVG\n-----END ECH KEYS-----', 0, True),
        ):
            with self.subTest(kind=kind, status=status, available=available, output=output):
                result = generate(kind, output, status, available)
                self.assertIs(result.get('result'), False)
                self.assertTrue(result.get('error'))


if __name__ == '__main__':
    unittest.main()
