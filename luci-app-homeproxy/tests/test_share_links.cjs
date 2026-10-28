const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/homeproxy/node.js'), 'utf8');
const helper = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/homeproxy.js'), 'utf8');
// Compile only tracked repository helper source, never share-link input.
const hp = new Function('return ({' + helper.slice(helper.indexOf('\tdecodeBase64Str(str)'), helper.indexOf('\tgetBuiltinFeatures()')) + '});')();
const parse = new Function('hp', '_', src.slice(src.indexOf('function normalizeHysteriaHoppingPort'), src.indexOf('const NODE_LATENCY_ROW_STATES')) + ';return parseShareLink;')(hp, s => s);
const features = {with_quic: true};
for (const scheme of ['https', 'hy2', 'hysteria2']) {
  for (const port of ['', ':80', ':443', ':8443']) {
    const n = parse(`${scheme}://secret@example.com${port}/#test`, features);
    assert.equal(n.port, port.slice(1) || '443');
    assert.equal(n.label, 'test');
  }
}
for (const [scheme, version] of [['socks4a', '4a'], ['socks4', '4'], ['socks5', '5'], ['SOCKS4a', '4a'], ['SOCKS4', '4'], ['SOCKS5', '5']]) {
 const n = parse(`${scheme}://user:pass@example.com:1080`, features);
 assert.equal(n.socks_version, version);
 assert.equal(n.username, 'user');
 assert.equal(n.password, 'pass');
}
for (const scheme of ['trojan','vless']) {
 const credential = scheme === 'trojan' ? 'p%40ss' : '11111111-1111-4111-8111-111111111111';
 for (const transport of ['ws','httpupgrade']) {
  const n = parse(`${scheme}://${credential}@example.com:443?type=${transport}&path=%2Ffoo%252Fbar%25`, features);
  assert.equal(n[transport === 'ws' ? 'ws_path' : 'http_path'], '/foo%2Fbar%');
  if(scheme === 'trojan') assert.equal(n.password,'p@ss');
 }
}
for (const scheme of ['trojan', 'vless']) {
 const ech = 'AP+A'; // Binary bytes must not be interpreted as UTF-8 text.
 const credential = scheme === 'trojan' ? 'secret' : '11111111-1111-4111-8111-111111111111';
 const n = parse(`${scheme}://${credential}@example.com:443?security=tls&ech=${encodeURIComponent(ech)}`, features);
 assert.equal(n.tls_ech, '1');
 assert.deepEqual(n.tls_ech_config, ['-----BEGIN ECH CONFIGS-----', ech, '-----END ECH CONFIGS-----']);
}
for (const scheme of ['trojan', 'vless']) {
 const credential = scheme === 'trojan' ? 'secret' : '11111111-1111-4111-8111-111111111111';
 for (const server of ['udp://resolver.example:5353', 'https://resolver.example/dns-query?token=a%2Fb']) {
  for (const value of [server, encodeURIComponent(server)]) {
   const n = parse(`${scheme}://${credential}@example.com:443?security=tls&ech=${value}`, features);
   assert.equal(n.tls_ech_query_server, value === server ? decodeURIComponent(server) : server, 'nested URL must survive the scheme split and decode exactly once');
  }
 }
}
console.log('PASS: share-link ports, labels, encoded passwords, single-decode paths and binary/query ECH');
