'use strict';
// Real LuCI DOM, poll and RPC; deterministic clock and transport only.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const root = process.env.LUCI_RESOURCE_DIR;
if (!root) throw Error('Set LUCI_RESOURCE_DIR to upstream LuCI resources');
const j = new JSDOM('<!doctype html><body><div id="view"></div></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
const w = j.window;
const read = n => fs.readFileSync(path.join(root, n + '.js'), 'utf8');
w.eval(read('luci').replace('window.LuCI = LuCI;', 'window.LuCI = LuCI; window.__classes = classes; window.__env = env;'));
const mods = w.__classes, L = w.L = Object.create(w.LuCI.prototype);
Object.assign(w.__env, { resource: '/luci-static/resources', sessionid: 'fixture', pollinterval: 5 });
L.require = n => Promise.resolve(mods[n]); w._ = s => s; w.E = mods.dom.create.bind(mods.dom);
let now = 0, timers = new Map(), next = 0;
w.Date.now = () => now;
w.setInterval = fn => { timers.set(++next, fn); return next; };
w.clearInterval = id => timers.delete(id);
let fail = false, flowFail = false, held = false, release, calls = 0;
let value = 500000;
const status = () => ({ cpu_cur_freq: value, cpu_max_freq: 1200000, cpu_count: 2, cpu_governor: 'schedutil', npu_bound: true });
mods.request.post = async (url, req) => {
 const method = req.params[2]; calls++;
 if (held && method === 'getFlowOffload') await new Promise(r => { release = r; });
 const failure = (method === 'getStatus' && fail) || (method === 'getFlowOffload' && flowFail);
 const payload = method === 'getStatus' ? status() : method === 'getInfo' ? { soc_compat: 'airoha,test' } : { enabled: true };
 return { ok: true, status: 200, json: () => w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: failure ? [4] : [0, payload] })) };
};
function load(name) {
 const src = read(name), deps = [...src.matchAll(/'require ([^';]+)';/g)].map(m => m[1]);
 const C = w.Function(...deps.map(d => d.split(' as ')[1] || d.split('.').at(-1)), src)(...deps.map(d => mods[d.split(' as ')[0]]));
 mods[name] = typeof C === 'function' ? new C() : C;
}
load('rpc');
const src = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/status.js'), 'utf8');
const C = w.Function('view', 'rpc', 'poll', src)(mods.view.extend({ __init__() {} }), mods.rpc, mods.poll);
const app = new C();
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const points = () => [...w.document.querySelectorAll('.npu-chart-point')];
const segments = () => (w.document.querySelector('.npu-chart-line').getAttribute('d').match(/M/g) || []).length;
async function tick(ms = 5000) {
 now += ms;
 for (const fn of [...timers.values()]) fn();
 await app.pollFn(); await flush();
}
(async () => {
 try {
  const node = app.render(await app.load()); w.document.getElementById('view').append(node); await flush();
  assert.equal(points().length, 1, 'only initial real reading');
  assert.equal(points()[0].getAttribute('data-mhz'), '500');
  assert.equal(mods.poll.queue.length, 1); assert.equal(mods.poll.queue[0].i, 5);
  const before = calls; await app.pollFn(); assert.equal(calls, before, 'no immediate duplicate');
  await tick(4999); assert.equal(points().length, 1); await tick(1); assert.equal(points().length, 2);
  value = 800000; await tick(); assert.equal(points().at(-1).getAttribute('data-mhz'), '800'); assert.equal(segments(), 1);
  fail = true; await tick(); assert.equal(points().length, 3); assert.equal(w.document.querySelector('#npu-current').textContent, 'Unknown');
  fail = false; await tick(); assert.equal(segments(), 2, 'failure breaks path');
  flowFail = true; await tick(); assert.equal(points().at(-1).getAttribute('data-time'), String(now), 'flow failure does not discard CPU reading'); flowFail = false;
  value = Infinity; await tick(); assert.equal(w.document.querySelector('#npu-chart-value').textContent, 'Unknown'); value = 600000; await tick(); assert.equal(segments(), 3);
  await tick(15000); assert.equal(segments(), 4, 'missed intervals break path');
  for (let i = 0; i < 25; i++) await tick();
  assert.equal(points().length, 25); assert(points().every(p => +p.getAttribute('data-time') >= now - 120000));
  if (process.env.NPU_DOM_EXPORT) fs.writeFileSync(process.env.NPU_DOM_EXPORT, w.document.documentElement.outerHTML);
  held = true; fail = true; now += 5000; const pending = app.pollFn(); await flush(); const inFlight = calls;
  await tick(); assert.equal(calls, inFlight, 'rejected status cannot overlap pending flow');
  now += 121000; for (const fn of [...timers.values()]) fn(); assert.equal(points().length, 0, 'stalled RPC still expires history');
  node.remove(); await flush(); assert.equal(mods.poll.queue.length, 0); assert.equal(timers.size, 0);
  const old = node.innerHTML; release(); await pending; assert.equal(node.innerHTML, old, 'detached reply ignored');
  await app.pollFn(); assert.equal(calls, inFlight);
  held = false; fail = false;
  const again = app.render(await app.load()); w.document.body.append(again); await flush();
  w.dispatchEvent(new w.Event('pagehide')); assert.equal(mods.poll.queue.length, 0); assert.equal(timers.size, 0);
  console.log('PASS real LuCI DOM/RPC/poll: 5s sampling, 120s expiry, missing/invalid data gaps, stalled transport no overlap, detach/pagehide cleanup');
 } finally { w.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
