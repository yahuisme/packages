'use strict';
// Real LuCI RPC, DOM, UI and form; only HTTP transport/page bootstrap isolated.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const resources = process.env.LUCI_RESOURCE_DIR;
if (!resources) throw Error('Set LUCI_RESOURCE_DIR to trusted upstream LuCI resources');
const j = new JSDOM('<div id="maincontent"><div id="view"></div></div>', {
 url: 'http://router.invalid/', runScripts: 'outside-only'
});
const w = j.window;
w._ = s => s; w.N_ = (n, a, b) => n === 1 ? a : b;
const read = n => fs.readFileSync(path.join(resources, n + '.js'), 'utf8');
const add = w.document.addEventListener.bind(w.document);
w.document.addEventListener = (type, ...args) => { if (type !== 'DOMContentLoaded') add(type, ...args); };
w.eval(read('cbi')); w.document.addEventListener = add;
w.eval(read('luci').replace('window.LuCI = LuCI;', 'window.LuCI = LuCI; window.mods = classes; window.environment = env;'));
const mods = w.mods, L = w.L = Object.create(w.LuCI.prototype);
Object.assign(w.environment, { resource: '/resources', scriptname: '/cgi-bin/luci', sessionid: 'fixture' });
L.require = n => Promise.resolve(mods[n]); L.hasViewPermission = () => true;
w.E = mods.dom.create.bind(mods.dom);
mods.uci = { load: async () => {}, loadPackage: async () => {}, get: () => null }; mods.fs = {};
function load(n) {
 const text = read(n), deps = [...text.matchAll(/'require ([^';]+)';/g)].map(m => m[1]);
 const C = w.Function(...deps.map(d => d.split(' as ')[1] || d.split('.').at(-1)), text)(...deps.map(d => mods[d.split(' as ')[0]]));
 return mods[n] = typeof C === 'function' ? new C() : C;
}
let reply = [0, { success: true, candidate_id: 'a'.repeat(32), tag_name: 'v1' }], transportError;
const requests = [];
mods.request.post = async (url, req, options) => {
 requests.push({ req, options });
 if (transportError) throw new w.Error(transportError);
 return { ok: true, json: () => w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: reply })) };
};
load('rpc'); load('validation'); load('ui'); load('form');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/firmwareupgrade/index.js'), 'utf8');
const C = w.Function('rpc', 'view', 'ui', 'poll', source)(mods.rpc, mods.view.extend({ __init__() {} }), mods.ui, mods.poll);
const app = new C();
// LuCI.raise logs expected RPC errors before throwing; retain them for assertions.
const rpcLogs = []; w.console.debug = (...args) => rpcLogs.push(args);
const acl = JSON.parse(fs.readFileSync(path.join(__dirname, '../root/usr/share/rpcd/acl.d/luci-app-firmwareupgrade.json')));
const menu = JSON.parse(fs.readFileSync(path.join(__dirname, '../root/usr/share/luci/menu.d/luci-app-firmwareupgrade.json')));
assert.deepEqual(menu['admin/system/firmwareupgrade'].depends.acl, ['luci-app-firmwareupgrade']);
assert.ok(acl['luci-app-firmwareupgrade'].read.ubus['luci.firmwareupgrade'].includes('checkUpdate'));
const settle = () => new Promise(r => setImmediate(r));
(async () => {
 const root = app.render({ repository: 'owner/repo' }); w.document.getElementById('view').append(root);
 const button = [...root.querySelectorAll('button')].find(n => n.textContent === 'Check update');
 const notice = root.querySelector('[style="display:none"]');
 async function click() { button.click(); await settle(); await settle(); assert.equal(button.disabled, false); }
 await click(); assert.equal(root.querySelector('#fwup-latest').textContent, 'v1');
 assert.equal(requests.at(-1).options.timeout, 20000, 'real RPC default is 20 seconds');
 assert.equal(requests.at(-1).req.params[2], 'checkUpdate');
 for (const [published_at, expected] of [
  ['2026-09-09T18:00:55Z', '2026-09-10 02:00:55'],
  ['2026-09-09T16:00:00Z', '2026-09-10 00:00:00'],
  ['2026-12-31T23:59:59Z', '2027-01-01 07:59:59'],
  ['2026-09-10T02:00:55+08:00', '2026-09-10 02:00:55'],
  ['invalid', '—'], ['', '—'], [null, '—'], [undefined, '—']
 ]) {
  reply = [0, { success: true, candidate_id: 'a'.repeat(32), tag_name: 'v1', published_at }];
  await click();
  assert.equal(root.querySelector('#fwup-release-date').textContent, expected);
 }
 assert.equal(root.querySelector('#fwup-release-date').title, 'Asia/Shanghai (UTC+08:00)');
 reply = [0, { success: true, candidate_id: 'a'.repeat(32), tag_name: 'v1', body: 'RELEASE_BODY_MUST_NOT_RENDER', asset_name: 'sysupgrade.itb', asset_size: 1048576, sha256: 'c'.repeat(64) }];
 await click();
 assert.equal(root.querySelector('#fwup-notes'), null);
 assert.ok(!root.textContent.includes('RELEASE_BODY_MUST_NOT_RENDER'));
 assert.ok(root.textContent.includes('Release details'));
 for (const text of ['sysupgrade.itb', '1.0 MiB', 'c'.repeat(64), 'Keep settings', 'Upgrade firmware']) assert.ok(root.querySelector('#fwup-detail').textContent.includes(text));
 assert.equal(root.querySelector('#fwup-detail input[type="checkbox"]').checked, root.querySelector('#fwup-keep').checked, 'preserve the current retention choice');
 assert.ok(!requests.some(r => r.req.params[2] === 'startUpgrade'), 'checking never starts an upgrade');
 // The view uses E buttons, not form.Button; also verify the real form signature.
 const map = new mods.form.JSONMap({ test: {} });
 const section = map.section(mods.form.NamedSection, 'test');
 const option = section.option(mods.form.Button, 'probe', 'Probe');
 let received;
 option.onclick = (ev, sid) => { received = [ev.type, sid]; };
 const formNode = await map.render(); root.append(formNode);
 formNode.querySelector('button').click(); await settle();
 assert.deepEqual(received, ['click', 'test']);
 for (const [code, text] of [[6, 'Permission denied'], [7, 'Request timeout'], [4, 'Resource not found']]) {
  reply = [code]; await click();
  assert.ok(notice.textContent.includes(text), `ubus ${code} diagnostic was swallowed: ${notice.textContent}`);
  assert.ok(notice.textContent.includes('luci.firmwareupgrade/checkUpdate'));
  assert.equal(root.querySelector('#fwup-detail').textContent, '');
  assert.equal(root.querySelector('#fwup-latest').textContent, 'Not checked');
 }
 for (const text of ['XHR request timed out', '<img src=x onerror=alert(1)>']) {
  transportError = text; await click();
  assert.ok(notice.textContent.includes(text), 'transport error must remain visible');
  assert.equal(notice.querySelector('img'), null, 'diagnostics must be text, not HTML');
 }
 transportError = null; reply = [0, { success: false, error: 'release fixture failure' }];
 await click(); assert.equal(notice.textContent, 'release fixture failure');
 reply = [0, { success: true, candidate_id: 'b'.repeat(32), tag_name: 'v2' }];
 await click(); assert.equal(root.querySelector('#fwup-latest').textContent, 'v2');
 assert.equal(rpcLogs.length, 3, 'real LuCI.raise handled all expected ubus failures');
 console.log('PASS real LuCI RPC 20s default, actual UI/form clicks, ubus/transport diagnostics, text-only errors and retry');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => w.close());
