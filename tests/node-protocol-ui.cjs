// Native LuCI protocol/transport branches; private UCI RPC, no proxy/runtime.
const assert = require('assert/strict');
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const { walk, FEATURES } = require('./homeproxy-editor-parity.cjs');
const watchdog = setTimeout(() => { console.error('FAIL protocol paths stalled'); process.exit(1); }, 120000);
(async () => {
 for (const [name, sid] of [['node', 'n1'], ['server', 's1']]) {
  const h = await pageBoot(name);
  try {
   h.root().remove();
   h.w.document.querySelector('#view').append(await h.app.render(['homeproxy', FEATURES]));
   h.map = h.mods.dom.findClassInstance(h.root());
   const grid = walk(h.map).find(o => o.option === 'type' && o.section.sectiontype === name).section;
   const persisted = JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s => [s['.name'], s]))));
   const post = h.mods.request.post;
   h.mods.request.post = async (url, req) => {
    const [, object, method, p] = req.params;
    let value;
    if (object === 'uci' && method === 'get') value = { values: persisted };
    else if (object === 'uci' && method === 'set') { Object.assign(persisted[p.section], p.values); value = {}; }
    else if (object === 'uci' && method === 'delete') { for (const k of p.options || []) delete persisted[p.section][k]; value = {}; }
    else return post(url, req);
    return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: [0, value] })) };
   };
   await grid.renderMoreOptionsModal(sid);
   const modal = h.mods.dom.findClassInstance(grid.getActiveModalMap());
   const fields = walk(modal), field = key => fields.find(o => o.option === key);
   const set = (key, value) => { const o = field(key); assert(o, key); o.getUIElement(sid).setValue(value); o.triggerValidation(sid); modal.checkDepends(); };
   const seeds = {
    password: 'protocol-fixture', uuid: '11111111-1111-4111-8111-111111111111',
    hysteria_up_mbps: '20', hysteria_down_mbps: '30',
    wireguard_local_address: ['10.7.0.2/32'],
    wireguard_private_key: Buffer.alloc(32, 1).toString('base64'),
    wireguard_peer_public_key: Buffer.alloc(32, 2).toString('base64'),
    tls_cert_path: '/etc/homeproxy/certs/server_publickey.pem', tls_key_path: '/etc/homeproxy/certs/server_privatekey.pem',
    ws_host: 'retained.invalid', grpc_servicename: 'retained-grpc', ssh_priv_key_pp: 'retained-ssh'
   };
   for (const [key, value] of Object.entries(seeds)) if (field(key)) {
    h.mods.uci.set('homeproxy', sid, key, value); persisted[sid][key] = value;
   }
   await modal.load(); await modal.reset();
   const protocols = Array.from(field('type').keylist);
   for (const protocol of protocols) {
    set('type', protocol);
    for (const o of fields) if (o.isActive(sid)) o.triggerValidation(sid);
    await modal.save(null, true);
    assert.equal(persisted[sid].type, protocol);
    if (field('ssh_priv_key_pp') && protocol !== 'ssh') assert.equal(persisted[sid].ssh_priv_key_pp, 'retained-ssh');
    const special = { direct: 'address', anytls: 'anytls_idle_session_timeout', hysteria: 'hysteria_auth_type', hysteria2: 'hysteria_obfs_type', shadowsocks: 'shadowsocks_encrypt_method', shadowtls: 'shadowtls_version', socks: 'socks_version', ssh: 'ssh_priv_key_pp', tuic: 'tuic_congestion_control', vless: 'vless_flow', vmess: 'vmess_alterid', wireguard: 'wireguard_private_key' }[protocol];
    if (special && field(special)) assert.equal(field(special).isActive(sid), protocol !== 'direct', name + ' branch ' + protocol);
    assert.equal(field('ws_host').isActive(sid), false, 'inactive saved transport does not leak for ' + protocol);
    console.log('PASS ' + name + ' native protocol save ' + protocol);
   }
   set('type', 'vmess');
   for (const [transport, active] of [['grpc', 'grpc_servicename'], ['http', 'http_host'], ['httpupgrade', 'httpupgrade_host'], ['ws', 'ws_host'], ['quic', 'tls']]) {
    set('transport', transport);
    if (transport !== 'quic') set('tls', '0');
    assert(field(active).isActive(sid), name + ' activates ' + transport);
    if (active !== 'ws_host') assert(!field('ws_host').isActive(sid));
    for (const o of fields) if (o.isActive(sid)) o.triggerValidation(sid);
    await modal.save(null, true);
    assert.equal(persisted[sid].transport, transport);
    assert.equal(persisted[sid].ws_host, 'retained.invalid');
   }
   set('type', 'socks');
   await modal.save(null, true);
   h.mods.ui.hideModal(); await h.map.load(); await h.map.reset(); await grid.renderMoreOptionsModal(sid);
   const reopened = walk(h.mods.dom.findClassInstance(grid.getActiveModalMap()));
   assert.equal(reopened.find(o => o.option === 'ws_host').formvalue(sid), 'retained.invalid');
   console.log('PASS ' + name + ' native grpc/http/httpupgrade/ws/quic saves and inactive reload');
  } finally { h.w.close(); }
 }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
