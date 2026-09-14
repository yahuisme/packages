const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/homeproxy/node.js'), 'utf8');
const parse = new Function('hp', '_', src.slice(src.indexOf('function normalizeHysteriaHoppingPort'), src.indexOf('const NODE_LATENCY_ROW_STATES')) + ';return parseShareLink;')({}, s => s);
const features = {with_quic: true};
for (const scheme of ['https', 'hy2', 'hysteria2']) {
  for (const port of ['', ':80', ':443', ':8443']) {
    const n = parse(`${scheme}://secret@example.com${port}/#test`, features);
    assert.equal(n.port, port.slice(1) || '443');
    assert.equal(n.label, 'test');
  }
}
for (const scheme of ['trojan','vless']) {
 const credential = scheme === 'trojan' ? 'p%40ss' : '11111111-1111-4111-8111-111111111111';
 for (const transport of ['ws','httpupgrade']) {
  const n = parse(`${scheme}://${credential}@example.com:443?type=${transport}&path=%2Ffoo%252Fbar%25`, features);
  assert.equal(n[transport === 'ws' ? 'ws_path' : 'http_path'], '/foo%2Fbar%');
  if(scheme === 'trojan') assert.equal(n.password,'p@ss');
 }
}
console.log('PASS: share-link ports, labels, encoded passwords and single-decode paths');
