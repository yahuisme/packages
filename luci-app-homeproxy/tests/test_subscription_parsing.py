import json, subprocess, tempfile, unittest
from pathlib import Path
BASE = Path(__file__).resolve().parents[1] / 'root/etc/homeproxy/scripts'
PREAMBLE = "\nfunction isEmpty(v) { return v === null || v === '' || (type(v) in ['object', 'array'] && length(v) === 0); }\nfunction validation(t,v) { if (t === 'port') return int(v)>0 && int(v)<65536; if(t==='ip6addr') return false; return !!v; }\nfunction urldecode(v) { return type(v)==='string' ? replace(v, /%([0-9a-fA-F]{2})/g, (_, x)=>chr(int(x,16))) : null; }\nfunction urldecode_params(v) { let o={}; for(let p in split(v,'&')) { let kv=split(p,'=',2); o[urldecode(kv[0])]=urldecode(kv[1]); } return o; }\nconst sing_features={with_quic:true,with_utls:true};\nfunction log(...args) {}\nfunction log_missing_quic(...args) {}\nfunction parseECHConfig(v) { return {}; }\n"
class SubscriptionParsing(unittest.TestCase):
    def parse(self, expression):
        h=(BASE/'homeproxy.uc').read_text(); s=(BASE/'update_subscriptions.uc').read_text()
        source=PREAMBLE+h[h.index('export function decodeBase64Str'):h.index('/* String parser end */')].replace('export function','function')+'\n'+s[s.index('function has_value'):s.index('function main()')]
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test.uc'; p.write_text(source+'\nprint(sprintf("%J", '+expression+'));')
            r=subprocess.run(['ucode',str(p)],capture_output=True,text=True)
            self.assertEqual(r.returncode,0,r.stderr)
            return json.loads(r.stdout)
    def test_encoded_password(self):
        self.assertEqual(self.parse("parse_uri('trojan://p%40ss@example.com:443')")['password'],'p@ss')
    def test_missing_password(self):
        self.assertIsNone(self.parse("parse_uri('trojan://example.com:443')"))
    def test_ports(self):
        for proto in ('https','hy2','hysteria2'):
            for port in ('',':80',':8443'):
                with self.subTest(proto=proto,port=port):
                    n=self.parse("parse_uri('"+proto+"://secret@example.com"+port+"')")
                    self.assertEqual(n['port'],port[1:] or '443')
    def test_paths(self):
        for proto,cred in [('trojan','secret'),('vless','11111111-1111-4111-8111-111111111111')]:
            for transport,key in [('ws','ws_path'),('http','http_path'),('httpupgrade','http_path')]:
                uri=proto+'://'+cred+'@example.com:443?type='+transport+'&path=%2Fapi%3Ftoken%3Da%252Fb'
                self.assertEqual(self.parse('parse_uri('+json.dumps(uri)+')')[key],'/api?token=a%2Fb')
    def test_hosts_decode_once(self):
        for proto, cred in [('trojan', 'secret'), ('vless', '11111111-1111-4111-8111-111111111111')]:
            for transport, key in [('http', 'http_host'), ('httpupgrade', 'httpupgrade_host'), ('ws', 'ws_host')]:
                for encoded, expected in [('cdn%2Eexample.com', 'cdn.example.com'), ('cdn%252Eexample.com', 'cdn%2Eexample.com')]:
                    with self.subTest(proto=proto, transport=transport, encoded=encoded):
                        uri = f'{proto}://{cred}@example.com:443?type={transport}&host={encoded}'
                        value = self.parse('parse_uri('+json.dumps(uri)+')')[key]
                        self.assertEqual(value, [expected] if key == 'http_host' else expected)
    def test_password_decode_once(self):
        for proto in ('trojan', 'anytls', 'hy2'):
            with self.subTest(proto=proto):
                uri = f'{proto}://p%2540ss@example.com:443'
                self.assertEqual(self.parse('parse_uri('+json.dumps(uri)+')')['password'], 'p%40ss')
    def test_socks4a(self):
        self.assertEqual(self.parse("parse_uri('socks4a://example.com:1080')")['socks_version'],'4a')
    def test_yaml(self):
        block = '''proxies:
  - name: Block Trojan
    type: trojan
    server: example.com
    port: 443
    password: "p: ass # literal"
    network: ws
    ws-opts:
      path: /api
      headers:
        Host: cdn.example.com
'''
        nodes = self.parse('parse_mihomo_yaml('+json.dumps(block)+')')
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]['name'], 'Block Trojan')
        self.assertEqual(nodes[0]['password'], 'p: ass # literal')
        self.assertEqual(nodes[0]['ws-opts']['headers']['Host'], 'cdn.example.com')
        parsed = self.parse('parse_uri(parse_mihomo_yaml('+json.dumps(block)+')[0])')
        self.assertEqual(parsed['type'], 'trojan')
        self.assertEqual(parsed['ws_host'], 'cdn.example.com')

        flow = "proxies:\n  - {name: Flow Trojan, type: trojan, server: example.com, port: 443, password: pass, skip-cert-verify: true}\n"
        nodes = self.parse('parse_mihomo_yaml('+json.dumps(flow)+')')
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]['name'], 'Flow Trojan')
        self.assertIs(nodes[0]['skip-cert-verify'], True)

    def test_yaml_rejects_anchors_tags_and_multiline_scalars(self):
        for payload in (
            'proxies:\n  - &node {name: x, type: trojan, server: example.com, port: 443, password: p}\n',
            'proxies:\n  - name: !unsafe x\n    type: trojan\n',
            'proxies:\n  - name: x\n    type: trojan\n    password: |\n      secret\n',
        ):
            with self.subTest(payload=payload):
                self.assertIsNone(self.parse('parse_mihomo_yaml('+json.dumps(payload)+')'))

    def test_yaml_empty_flow_sequence_stays_empty(self):
        self.assertEqual(self.parse("yaml_scalar('[]')"), [])

    def test_yaml_empty_flow_mapping_is_rejected_as_proxy(self):
        payload = 'proxies:\n  - {}\n'
        self.assertIsNone(self.parse('parse_mihomo_yaml('+json.dumps(payload)+')'))

    def test_yaml_nested_block_sequence_is_parsed(self):
        payload = '''proxies:
  - name: sequence
    type: trojan
    server: example.com
    port: 443
    password: pass
    alpn:
      - h2
      - http/1.1
'''
        nodes = self.parse('parse_mihomo_yaml('+json.dumps(payload)+')')
        self.assertEqual(nodes[0]['alpn'], ['h2', 'http/1.1'])

    def test_yaml_boolean_before_comment_remains_boolean(self):
        payload = '''proxies:
  - name: boolean
    type: trojan
    server: example.com
    port: 443
    password: pass
    skip-cert-verify: true # intentional
'''
        nodes = self.parse('parse_mihomo_yaml('+json.dumps(payload)+')')
        self.assertIs(nodes[0]['skip-cert-verify'], True)
