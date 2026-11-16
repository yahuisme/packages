// Compile only tracked production sources, never user/share-link input.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const helper = fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/homeproxy.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/view/homeproxy/node.js'), 'utf8');
const hp = new Function('_', 'return ({' + helper.slice(helper.indexOf('\tdecodeBase64Str(str)'), helper.indexOf('\tgetBuiltinFeatures()')) + '});')(s => s);
const parse = new Function('hp', '_', source.slice(source.indexOf('function normalizeHysteriaHoppingPort'), source.indexOf('const NODE_LATENCY_ROW_STATES')) + ';return parseShareLink;')(hp, s => s);
const link = 'vless://11111111-1111-4111-8111-111111111111@example.com:443?security=reality&pbk=fixture&sid=1234';
for (const suffix of ['', '&fp='])
 assert.equal(parse(link + suffix, {with_utls: true}).tls_utls, 'chrome', 'REALITY import must enable a usable default fingerprint');
assert.equal(parse(link + '&fp=firefox', {with_utls: true}).tls_utls, 'firefox');
for (const fingerprint of ['none', 'disable', 'disabled'])
 assert.throws(() => parse(link + '&fp=' + fingerprint, {with_utls: true}), /REALITY requires a uTLS fingerprint/);
assert.throws(() => parse(link, {with_utls: false}), /REALITY requires sing-box uTLS support/);
assert.throws(() => parse(link, {}), /REALITY requires sing-box uTLS support/);
for (const protocol of ['anytls', 'vless']) {
 const node = {type: protocol, tls: '1', tls_reality: '1', tls_utls: ''};
 const before = JSON.stringify(node);
 assert.equal(hp.realityFingerprint(node, true), 'chrome');
 assert.equal(JSON.stringify(node), before, 'validation must not mutate retained UCI');
 assert.throws(() => hp.realityFingerprint(node, false), /REALITY requires sing-box uTLS support/);
}
for (const type of ['trojan', 'vmess', 'http', 'hysteria2', 'socks']) {
 const node = {type, tls: '1', tls_reality: '1', tls_utls: ''};
 assert.equal(hp.realityFingerprint(node, false), '', 'hidden retained REALITY is inactive for other protocols');
}
for (const node of [{type: 'vless', tls: '0', tls_reality: '1'}, {type: 'anytls', tls: '1', tls_reality: '0'}])
 assert.equal(hp.realityFingerprint(node, false), undefined);
assert.equal(parse(link.replace('security=reality', 'security=tls'), {with_utls: false}).tls_utls, null);
assert.equal(parse('anytls://secret@example.com:443?fp=none', {with_utls: true}).tls_utls, null);
console.log('PASS: REALITY defaults, disable/capability rejection and inactive protocol preservation');
