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
if (process.env.NPU_ZH) {
 const add = w.document.addEventListener.bind(w.document);
 w.document.addEventListener = (type, ...args) => { if (type !== 'DOMContentLoaded') add(type, ...args); };
 w.eval(read('cbi')); w.document.addEventListener = add; require('./l10n')(w);
}
let now = 0, timers = new Map(), next = 0;
w.Date.now = () => now;
w.setInterval = fn => { timers.set(++next, fn); return next; };
w.clearInterval = id => timers.delete(id);
let fail = false, flowFail = false, held = false, release, statusHeld = false, releaseStatus, calls = 0;
const methodCalls = [];
let value = 500000;
const status = () => ({ cpu_cur_freq: value, cpu_max_freq: 1200000, cpu_count: 2, cpu_governor: 'schedutil', npu_bound: true });
mods.request.post = async (url, req, options) => {
 const method = req.params[2];
 if (method === 'getStatus') { assert.equal(options.nobatch, true, 'CPU request bypasses unrelated RPC batches'); if (statusHeld) await new Promise(r => { releaseStatus = r; }); }
 calls++; methodCalls.push({ method, time: now });
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
async function tick(ms = 3000) {
 now += ms;
 for (const fn of [...timers.values()]) fn();
 await app.pollFn(); await flush();
}
(async () => {
 try {
  if (process.env.NPU_ZH) assert.equal(w._('Max limit:'), '上限:');
  let node = app.render(await app.load()); w.document.getElementById('view').append(node); await flush();
  assert.equal(node.querySelector(':scope > h2').textContent, w._('Airoha SoC Status'));
  assert.equal(points().length, 1, 'only initial real reading');
  assert.equal(points()[0].getAttribute('data-mhz'), '500');
  assert.equal(mods.poll.queue.length, 1);
  // Drive the actual LuCI scheduler: a tick arriving 1 ms early must not
  // postpone the next real sample by another five seconds.
  mods.poll.tick = 0;
  const start = now;
  for (let i = 0; i <= 7; i++) {
   now = start + (i ? i * 1000 - 1 : 0);
   mods.poll.step(); await flush();
  }
  assert.equal(points().length, 3, 'scheduler jitter retains normal sample cadence');
  assert.equal(segments(), 1, 'healthy jittered samples stay connected');
  assert.equal(methodCalls.filter(c => c.method === 'getStatus').length, 3);
  assert.equal(methodCalls.filter(c => c.method === 'getFlowOffload').length, 2, 'flow is not accelerated to CPU cadence');
  // A held firewall request must not block the independent CPU sampler.
  held = true; now += 6000; mods.poll.step(); await flush();
  const heldCalls = methodCalls.filter(c => c.method === 'getFlowOffload').length;
  const cpuCalls = methodCalls.filter(c => c.method === 'getStatus').length;
  for (let i = 0; i < 9; i++) { now += 1000; mods.poll.step(); await flush(); }
  assert.equal(methodCalls.filter(c => c.method === 'getStatus').length, cpuCalls + 3, 'held flow must not starve CPU');
  assert.equal(methodCalls.filter(c => c.method === 'getFlowOffload').length, heldCalls, 'flow remains single flight');
  assert.equal(points().at(-1).dataset.time, String(now), 'CPU still records actual replies');
  held = false; release(); await flush();
  const beforeSlow = points().length;
  statusHeld = true; now += 3000; mods.poll.step(); await flush();
  for (let i=0;i<8;i++) { now+=1000; mods.poll.step(); await flush(); }
  assert.equal(points().length,beforeSlow,'slow CPU creates no replacement samples');
  statusHeld=false; releaseStatus(); await flush();
  assert.equal(points().length,beforeSlow+1,'slow CPU publishes only its actual reply');
  assert(segments()>1,'slow CPU still breaks a genuine long gap');
  now = 0;
  const reset = app.render(await app.load()); node.replaceWith(reset); await flush();
  // Keep the remaining lifecycle assertions attached to the current root.
  node = reset;
  const svg = node.querySelector('svg');
  for (const width of [240, 360, 600, 960]) {
   Object.defineProperty(svg, 'clientWidth', { configurable: true, value: width });
   for (const fn of timers.values()) fn();
   assert.equal(svg.viewBox.baseVal ? svg.viewBox.baseVal.width : +svg.getAttribute('viewBox').split(' ')[2], width);
   const labels = [...svg.querySelectorAll('text')];
   assert.deepEqual(labels.filter(n => /^\d+$/.test(n.textContent)).map(n => n.textContent), ['0', '200', '400', '600', '800', '1000', '1200']);
   const times = labels.filter(n => / s$/.test(n.textContent));
   assert.equal(times.length, width < 480 ? 5 : width < 800 ? 7 : 9, 'responsive time ticks');
   assert.equal(svg.querySelectorAll('.npu-chart-grid').length, 7 + times.length);
  }
  const lineStyle = w.getComputedStyle(node.querySelector('.npu-chart-line'));
  assert.equal(lineStyle.stroke, '#22a06b');
  assert.equal(lineStyle.strokeWidth, '1.5');
  assert.equal(node.querySelector('.npu-chart-line').getAttribute('vector-effect'), 'non-scaling-stroke');
  assert(+w.getComputedStyle(node.querySelector('.npu-chart-grid')).opacity <= 0.15, 'subtle grid');
  assert.equal(points()[0].getAttribute('r'), '2', 'isolated real sample stays visible');
  const before = calls; await app.pollFn(); assert.equal(calls, before, 'no immediate duplicate');
  await tick(2999); assert.equal(points().length, 1); await tick(1); assert.equal(points().length, 2);
  value = 800000; await tick(); assert.equal(points().at(-1).getAttribute('data-mhz'), '800'); assert.equal(segments(), 1);
  assert.match(node.querySelector('.npu-chart-line').getAttribute('d'), / H .* V /, 'normal readings use previous-value steps');
  assert(points().every(p => p.getAttribute('r') === '1'), 'connected samples are restrained');
  const actualSamples = points().map(p => [p.dataset.time, p.dataset.mhz]);
  now += 1000; for (const fn of timers.values()) fn();
  assert.deepEqual(points().map(p => [p.dataset.time, p.dataset.mhz]), actualSamples, 'redraw never fabricates samples');
  assert.match(node.querySelector('.npu-chart-line').getAttribute('d'), / H 944$/, 'brief latest-value hold');
  now += 3001; for (const fn of timers.values()) fn();
  assert(!/ H 944$/.test(node.querySelector('.npu-chart-line').getAttribute('d')), 'hold expires after 3s');
  now -= 4001;
  fail = true; await tick(); assert.equal(points().length, 3); assert.equal(w.document.querySelector('#npu-current').textContent, w._('Unknown'));
  assert(!/ H 944$/.test(node.querySelector('.npu-chart-line').getAttribute('d')), 'RPC failure stops display hold');
  fail = false; await tick(); assert.equal(segments(), 2, 'failure breaks path');
  assert.equal((node.querySelector('.npu-chart-area').getAttribute('d').match(/Z/g) || []).length, 2, 'area closes separately across null');
  flowFail = true; await tick(); await tick(); assert.equal(points().at(-1).getAttribute('data-time'), String(now), 'flow failure does not discard CPU reading'); assert.equal(node.querySelector('#npu-offload').textContent, w._('Unknown')); flowFail = false;
  value = Infinity; await tick(); assert.equal(w.document.querySelector('#npu-chart-value').textContent, w._('Unknown')); value = 600000; await tick(); assert.equal(segments(), 3);
  await tick(15000); assert.equal(segments(), 4, 'missed intervals break path');
  assert.equal((node.querySelector('.npu-chart-area').getAttribute('d').match(/Z/g) || []).length, 4, 'area respects missing intervals');
  for (let i = 0; i < 41; i++) { value = [600000, 800000, 1000000, 800000][Math.floor(i / 6) % 4]; await tick(); }
  assert.equal(points().length, 41); assert(points().every(p => +p.getAttribute('data-time') >= now - 120000));
  if (process.env.NPU_DOM_EXPORT) fs.writeFileSync(process.env.NPU_DOM_EXPORT, w.document.documentElement.outerHTML);
  held = true; fail = true; now += 6000; const pending = app.pollFn(); await flush(); const inFlight = calls;
  await tick(); assert.equal(calls, inFlight + 1, 'status retries independently while flow stays pending');
  now += 121000; for (const fn of [...timers.values()]) fn(); assert.equal(points().length, 0, 'stalled RPC still expires history');
  assert.equal(node.querySelector('.npu-chart-area').getAttribute('d'), '', 'outage expires filled history');
  assert.equal(node.querySelector('#npu-summary-freq .npu-card-value').textContent, w._('Unknown'));
  const beforeDetach = calls; node.remove(); await flush(); assert.equal(mods.poll.queue.length, 0); assert.equal(timers.size, 0);
  const old = node.innerHTML; release(); await pending; assert.equal(node.innerHTML, old, 'detached reply ignored');
  await app.pollFn(); assert.equal(calls, beforeDetach);
  held = false; fail = false;
  const again = app.render(await app.load()); w.document.body.append(again); await flush();
  w.dispatchEvent(new w.Event('pagehide')); assert.equal(mods.poll.queue.length, 0); assert.equal(timers.size, 0);
  console.log('PASS real LuCI DOM/RPC/poll: 3s sampling, 120s expiry, missing/invalid data gaps, stalled transport no overlap, detach/pagehide cleanup');
 } finally { w.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
