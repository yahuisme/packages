"""Run the production YAML subset in real ucode, without updater side effects."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'root/etc/homeproxy/scripts/update_subscriptions.uc'


class SubscriptionYAML(unittest.TestCase):
    def parse(self, text):
        source = SOURCE.read_text()
        # Extract pure parser helpers only: no UCI, network, service or filesystem calls.
        source = source[source.index('function yaml_split_flow('):source.index('function main()')]
        preamble = "function isEmpty(v) { return v === null || v === ''; }\nfunction log(...args) {}\n"
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'yaml.uc'
            script.write_text(preamble + source + '\nprint(sprintf("%J", parse_mihomo_yaml(' + json.dumps(text) + ')));')
            result = subprocess.run([os.environ.get('UCODE', 'ucode'), str(script)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_quoted_hashes(self):
        for scalar, expected in [('"p # literal"', 'p # literal'), ("'p # literal'", 'p # literal'), ("'it''s # literal'", "it's # literal")]:
            for comment in ('', ' # trailing'):
                with self.subTest(scalar=scalar, comment=comment):
                    self.assertEqual(self.parse('proxies:\n  - password: ' + scalar + comment + '\n'), [{'password': expected, 'nodetype': 'mihomo'}])

    def test_sequence_boundary(self):
        for indent in ('', '  '):
            for tail in ('mode: rule\n', 'proxy-groups:\n  - name: group\n    type: select\n', 'rules:\n  - MATCH,DIRECT\n'):
                with self.subTest(indent=indent, tail=tail):
                    payload = 'proxies:\n' + indent + '- name: one\n' + indent + '  type: trojan\n' + indent + '- name: two\n' + indent + '  type: ss\n' + tail
                    self.assertEqual(self.parse(payload), [{'name': 'one', 'type': 'trojan', 'nodetype': 'mihomo'}, {'name': 'two', 'type': 'ss', 'nodetype': 'mihomo'}])

    def test_block_comments_and_plain_hashes(self):
        payload = '''# ignored
proxies: # header
- name: don't # tail
  password: pass#literal # tail
  tls: false # tail
  port: 443 # tail
  ws-opts: # nested map
    path: /x#y # tail
  alpn: # nested sequence
    - "h2 # literal" # tail
    - http/1.1 # tail
  extra: {Host: cdn.example} # flow mapping
  empty: [] # flow sequence
mode: rule
'''
        self.assertEqual(self.parse(payload), [{'name': "don't", 'password': 'pass#literal', 'tls': False, 'port': 443, 'ws-opts': {'path': '/x#y'}, 'alpn': ['h2 # literal', 'http/1.1'], 'extra': {'Host': 'cdn.example'}, 'empty': [], 'nodetype': 'mihomo'}])

    def test_escaped_quotes_and_backslashes(self):
        for value in ['p " # literal', 'p \\', 'p \\\\']:
            for flow in (False, True):
                with self.subTest(value=value, flow=flow):
                    item = 'password: ' + json.dumps(value)
                    if flow:
                        item = '{' + item + ', name: next}'
                    expected = {'password': value, 'nodetype': 'mihomo'}
                    if flow:
                        expected['name'] = 'next'
                    self.assertEqual(self.parse('proxies:\n- ' + item + ' # tail\n'), [expected])

    def test_json_flow_mapping_and_top_level_boundary(self):
        item = {'name': 'JSON # literal', 'password': 'p # literal', 'alpn': ['h2', 'http/1.1']}
        for indent in ('', '  '):
            with self.subTest(indent=indent):
                payload = 'proxies:\n' + indent + '- ' + json.dumps(item) + ' # tail\nproxy-groups:\n  - {name: not-a-node, type: select}\n'
                self.assertEqual(self.parse(payload), [{**item, 'nodetype': 'mihomo'}])

    def test_flow_comments(self):
        payload = '''proxies: # header
- {name: "flow # literal", password: 'p # literal', port: 443, tls: true, alpn: [h2, "http/1.1"], ws-opts: {path: /x#y, headers: {Host: cdn.example}}} # tail
mode: rule
'''
        self.assertEqual(self.parse(payload), [{'name': 'flow # literal', 'password': 'p # literal', 'port': 443, 'tls': True, 'alpn': ['h2', 'http/1.1'], 'ws-opts': {'path': '/x#y', 'headers': {'Host': 'cdn.example'}}, 'nodetype': 'mihomo'}])


if __name__ == '__main__':
    unittest.main()
