const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const root = path.join(__dirname, '..');
const node = fs.readFileSync(path.join(root, 'luci-app-homeproxy/htdocs/luci-static/resources/view/homeproxy/node.js'), 'utf8');
const pot = fs.readFileSync(path.join(root, 'luci-app-homeproxy/po/templates/homeproxy.pot'), 'utf8');
const po = fs.readFileSync(path.join(root, 'luci-app-homeproxy/po/zh_Hans/homeproxy.po'), 'utf8');
const fullMessage = 'Supports AnyTLS, HTTP(S), Hysteria, Hysteria2, Shadowsocks, SOCKS4/4A/5, Trojan, TUIC, VLESS and VMess share links.';
const basicMessage = 'Supports AnyTLS, HTTP(S), Shadowsocks, SOCKS4/4A/5, Trojan, VLESS and VMess share links.';
const source = node.slice(node.indexOf('function normalizeHysteriaHoppingPort'), node.indexOf('const NODE_LATENCY_ROW_STATES'));
const api = new Function('hp', '_', source + ';return { parseShareLink, getShareLinkDescription };')({}, s => s);

assert.equal(api.getShareLinkDescription({ with_quic: true }), fullMessage);
assert.equal(api.getShareLinkDescription({ with_quic: false }), basicMessage);
for (const [link, quicOnly] of [
	['anytls://secret@example.com', false], ['https://example.com', false],
	['socks4a://example.com', false], ['hysteria2://secret@example.com', true],
	['tuic://id:secret@example.com', true]
]) {
	assert(api.parseShareLink(link, { with_quic: true }), `${link} must match the full description`);
	assert.equal(!!api.parseShareLink(link, { with_quic: false }), !quicOnly, `${link} capability gating`);
}
for (const message of [ fullMessage, basicMessage ]) {
	assert(node.includes(`_('${message}')`), 'share-link modal description must be a translatable parser-derived variant');
	assert(pot.includes(`msgid "${message}"`), 'POT must contain each capability-specific description');
	assert(po.includes(`msgid "${message}"`), 'zh_Hans catalog must contain each capability-specific description');
}
console.log('PASS share-link descriptions match parser capability and with_quic gating');
