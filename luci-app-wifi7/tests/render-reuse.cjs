// Real LuCI DOM/RPC with fixture transport; polling cadence and data stay unchanged.
const assert = require('assert/strict');
const { boot } = require('./integration.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function radio() {
 const h = await boot();
 try {
  await h.poll();
  const badges = [...h.node.querySelectorAll('.wifi7-status-badge')];
  const children = badges.map(node => [...node.children]);
  const before = h.node.outerHTML;
  const records = [];
  const observer = new h.w.MutationObserver(batch => records.push(...batch));
  observer.observe(h.node, { subtree: true, childList: true, characterData: true, attributes: true });
  await h.poll();
  observer.disconnect();
  assert.equal(h.node.outerHTML, before, 'unchanged telemetry keeps identical markup');
  for (let i = 0; i < badges.length; i++) {
   assert.equal(badges[i].children[0], children[i][0], 'unchanged radio reuses the decorative arrow');
   assert.equal(badges[i].children[1], children[i][1], 'unchanged radio reuses the status label');
   assert.equal(badges[i].children[0].getAttribute('aria-hidden'), 'true');
  }
  assert.equal(records.length, 0, 'identical telemetry does not write the DOM');

  const post = h.mods.request.post;
  let fail = false, down = false;
  h.mods.request.post = async (url, req) => {
   const [, object, method] = req.params;
   if (fail && ['iwinfo', 'file', 'luci-rpc'].includes(object))
    return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: [6] })) };
   const response = await post(url, req);
   if (down && object === 'luci-rpc' && method === 'getWirelessDevices') {
    const body = response.json();
    Object.values(body.result[1]).forEach(r => r.up = false);
    return { ...response, json: () => body };
   }
   return response;
  };
  down = true; await h.poll();
  for (const node of badges) {
   assert.equal(node.textContent, '↓Disabled');
   assert.equal(node.className, 'wifi7-status-badge wifi7-badge-disabled');
  }
  fail = true; await h.poll();
  for (const node of badges) {
   assert.equal(node.textContent, '—Unknown');
   assert.equal(node.className, 'wifi7-status-badge');
  }
  assert([...h.node.querySelectorAll('.wifi7-card .wifi7-value')].every(n => n.textContent === '—'));
  fail = false; down = false; await h.poll();
  assert.equal(h.node.outerHTML, before, 'same data recovers all cleared readings');

  // An exception in telemetry processing takes the distinct catch/clear path.
  const parse = h.mods['wifi7.telemetry'].parse;
  h.mods['wifi7.telemetry'].parse = () => { throw Error('fixture processing failure'); };
  await h.poll();
  assert.equal(h.q('.wifi7-notice').textContent, 'Telemetry update failed');
  assert(badges.every(n => n.textContent === '—'));
  assert([...h.node.querySelectorAll('.wifi7-card .wifi7-value')].every(n => n.textContent === '—'));
  h.mods['wifi7.telemetry'].parse = parse;
  await h.poll();
  assert.equal(h.node.outerHTML, before, 'processing failure restores markup including ARIA');
  h.node.remove(); await tick();
  assert.equal(h.polls.size, 0);
  console.log('PASS radio reuse, zero same-value DOM mutations, up/down/unknown, RPC and processing failure/recovery, ARIA, detach');
 } finally { h.w.close(); }
}

async function mloRuntime() {
 const h = await boot();
 try {
  const sid = h.mods.uci.add('wireless', 'wifi-iface', 'mlo0');
  for (const [key, value] of Object.entries({ mlo: '1', device: ['radio0', 'radio1'], mode: 'ap', encryption: 'none', ssid: 'Reuse fixture' }))
   h.mods.uci.set('wireless', sid, key, value);
  await h.tab(2); await h.poll();
  const overview = h.q('[data-mlo-overview-section]');
  const before = overview.outerHTML;
  const create = h.w.document.createElement;
  let discarded = 0;
  h.w.document.createElement = function(...args) {
   if (/at overview \(/.test(new Error().stack)) discarded++;
   return create.apply(this, args);
  };
  await h.poll();
  assert.equal(h.q('[data-mlo-overview-section]'), overview);
  assert.equal(overview.outerHTML, before);
  assert.equal(discarded, 0, 'runtime refresh must not build and discard configuration DOM');
  console.log('PASS MLO polling does not render configuration DOM');
 } finally { h.w.close(); }
}

async function mloSummary() {
 const h = await boot();
 try {
  await h.tab(2); await h.poll();
  const mapNode = h.q('.mlo-map');
  const map = h.mods.dom.findClassInstance(mapNode);
  let summary = h.q('[data-mlo-summary-status]');
  const before = summary.outerHTML;
  const records = [];
  const observer = new h.w.MutationObserver(batch => records.push(...batch));
  observer.observe(summary, { subtree: true, childList: true, attributes: true, characterData: true });
  await h.poll();
  observer.disconnect();
  assert.equal(h.q('[data-mlo-summary-status]'), summary, 'polling reuses MLO summary');
  assert.equal(summary.outerHTML, before);
  assert.equal(records.length, 0, 'unchanged summary has no DOM writes');
  const detached = summary;
  await map.reset();
  summary = h.q('[data-mlo-summary-status]');
  assert.notEqual(summary, detached, 'native reset replaces the summary');
  assert.equal(summary.outerHTML, before);
  const sid = h.mods.uci.add('wireless', 'wifi-iface', 'mlo0');
  h.mods.uci.set('wireless', sid, 'mlo', '1');
  h.mods.uci.set('wireless', sid, 'device', ['radio0']);
  await h.poll();
  assert.equal(h.q('[data-mlo-summary-status]'), summary);
  assert.equal(summary.querySelector('strong').textContent, '1');
  assert.equal(summary.querySelector('small').textContent, '1 incomplete');
  assert.equal(detached.outerHTML, before, 'polling never writes the reset-away summary');
  h.mods.uci.set('wireless', sid, 'device', ['radio0', 'radio1']);
  await h.poll();
  assert.equal(summary.querySelector('small').textContent, '0 incomplete');
  h.mods.uci.remove('wireless', sid);
  await h.poll();
  assert.equal(summary.outerHTML, before, 'empty summary recovers Pending addition');
  const post = h.mods.request.post;
  let fail = true, heldResolve;
  h.mods.request.post = async (url, req) => {
   if (req.params[1] === 'luci-rpc') {
    if (fail) return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: [6] })) };
    if (heldResolve === null) await new Promise(resolve => { heldResolve = resolve; });
   }
   return post(url, req);
  };
  await h.poll();
  assert.match(summary.textContent, /UnavailableRuntime status unavailable/);
  fail = false; await h.poll();
  assert.equal(summary.outerHTML, before);
  heldResolve = null;
  const pending = h.poll(); await tick();
  assert.equal(typeof heldResolve, 'function');
  await map.reset();
  const replaced = h.q('[data-mlo-summary-status]');
  assert.notEqual(replaced, summary);
  heldResolve(); await pending;
  assert.equal(h.q('[data-mlo-summary-status]'), replaced, 'held refresh binds reset replacement');
  assert.equal(replaced.outerHTML, before);
  heldResolve = null;
  const detachedPending = h.poll(); await tick();
  const last = h.node.outerHTML;
  h.node.remove(); await tick();
  assert.equal(h.polls.size, 0);
  heldResolve(); await detachedPending;
  assert.equal(h.node.outerHTML, last, 'detached replies do not write');
  console.log('PASS summary reuse, unchanged mutations, empty/incomplete/valid, reset/held reset, unknown/recovery and held detach');
 } finally { h.w.close(); }
}

const run = { radio, 'mlo-runtime': mloRuntime, 'mlo-summary': mloSummary }[process.argv[2] || 'radio'];
run().catch(error => { console.error(error); process.exitCode = 1; });
