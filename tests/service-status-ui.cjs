// Real LuCI rpc.js and complete views; only the request transport is isolated.
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const assert = require('assert/strict');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');
const watchdog = setTimeout(() => { console.error('service status test stalled'); process.exit(1); }, 15000);
(async () => {
 for (const translations of [{}, { 'Status unavailable': '状态读取失败', 'RUNNING': '运行中', 'NOT RUNNING': '未运行' }]) for (const name of ['client', 'server']) {
  const h = await pageBoot(name, translations);
  try {
   const post = h.mods.request.post;
   let result = [0, {}], failed = false;
   h.mods.request.post = async (url, req) => {
    if (req.params[1] !== 'service') return post(url, req);
    if (failed) throw Error('injected transport failure');
    return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result })) };
   };
   async function check(payload, expected, transport = false) {
    result = payload; failed = transport;
    await Promise.all(h.polls().map(f => f())); await tick();
    assert.equal(h.root().querySelector('#service_status strong').textContent, h.w._(expected), name + ': ' + JSON.stringify(payload));
   }
   const service = running => [0, { homeproxy: { instances: { ['sing-box-' + (name === 'client' ? 'c' : 's')]: { running } } } }];
   await check(service(true), 'RUNNING');
   await check(service(true), 'Status unavailable', true);
   for (const payload of [[6], [0, null], [0, []], [0, 'invalid']]) await check(payload, 'Status unavailable');
   for (const payload of [[0, {}], [0, { homeproxy: { instances: {} } }], service(false)]) await check(payload, 'NOT RUNNING');
   await check(service(true), 'RUNNING');
   console.log('PASS ' + name + ': running, transport/ubus/malformed failure, absent/stopped, recovery (10 cases)');
  } finally { h.w.close(); }
 }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
