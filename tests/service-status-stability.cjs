// Full HomeProxy views + native LuCI/jsdom; RPC transport only is a fixture.
// HP_STATUS_ALLOW_REBUILD=1 records a pre-optimization baseline without the
// no-rebuild assertion. HP_STATUS_EVIDENCE writes replayable DOM/RPC evidence.
const assert = require('assert/strict');
const fs = require('fs');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');
const watchdog = setTimeout(() => { console.error('status stability stalled'); process.exit(1); }, 30000);
const report = [];
const performanceFailures = [];
(async () => {
 for (const name of ['client', 'server']) for (const readonly of [false, true]) {
  const h = await pageBoot(name);
  try {
   // Use the native readonly Map render, not a substituted status callback.
   h.map.readonly = readonly;
   await h.map.reset(); await tick();
   let running = true, fail = false;
   let current = { mode: 'urltest', active: { id: 'external', label: 'Stable node', type: 'socks' } };
   h.setHandler((obj, method) => {
    if (fail && (obj === 'service' || method === 'current_node_get')) return Promise.reject(Error('private transport failure'));
    if (obj === 'service' && running === null) return [];
    if (obj === 'service') return { homeproxy: { instances: { 'sing-box-c': { running }, 'sing-box-s': { running } } } };
    if (method === 'current_node_get') return current;
   });
   let writes = 0, mutations = 0;
   const content = h.mods.dom.content;
   h.mods.dom.content = function(el, ...args) {
    if (el.id === 'service_status') writes++;
    return content.call(this, el, ...args);
   };
   const status = () => h.root().querySelector('#service_status');
   let observer;
   function observe() {
    observer?.disconnect();
    observer = new h.w.MutationObserver(records => { mutations += records.length; });
    observer.observe(status(), { childList: true, subtree: true });
   }
   const pollCalls = [];
   async function poll() {
    const start = h.calls.length;
    await Promise.all(h.polls().map(f => f())); await tick();
    pollCalls.push(h.calls.slice(start));
   }
   const snapshots = [], stable = [];
   function snapshot(label) {
    const el = status();
    assert.equal(el.getAttribute('role'), 'status');
    assert.equal(el.getAttribute('aria-live'), 'polite');
    assert.equal(el.getAttribute('aria-atomic'), 'true');
    snapshots.push({ label, html: el.outerHTML, text: el.textContent });
   }
   async function repeat(label, count = 3) {
    const el = status(), descendants = [...el.querySelectorAll('*')], children = [...el.childNodes];
    const html = el.outerHTML, before = writes, beforeMutations = mutations;
    const start = h.calls.length;
    for (let i = 0; i < count; i++) { await poll(); assert.equal(el.outerHTML, html, label + ': final DOM'); }
    const calls = h.calls.slice(start);
    const expected = Array.from({length: count}, () => name === 'client' ? ['service/list', 'luci.homeproxy/current_node_get', 'luci.homeproxy/tailscale_status'] : ['service/list']).flat();
    assert.deepEqual(calls.map(c => c.obj + '/' + c.method), expected, label + ': unchanged RPC sequence');
    const sameNodes = children.every((n, i) => n === el.childNodes[i]) && descendants.every((n, i) => n === el.querySelectorAll('*')[i]);
    const result = { label, rounds: count, writes: writes - before, mutations: mutations - beforeMutations, sameNodes, calls };
    stable.push(result);
    if (result.writes || result.mutations || !sameNodes) performanceFailures.push(name + '/' + readonly + '/' + label + ': ' + JSON.stringify({writes:result.writes, mutations:result.mutations, sameNodes}));
   }
   observe(); await poll(); snapshot('running');
   assert.equal(status().querySelector('strong').textContent, 'RUNNING');
   await repeat('running', 20);
   const initialHTML = status().outerHTML;
   fail = true; await poll(); snapshot('failure');
   assert.equal(status().querySelector('strong').textContent, 'Status unavailable');
   await repeat('failure');
   fail = false; await poll(); snapshot('recovery-same-node');
   assert.equal(status().outerHTML, initialHTML, 'same node recovery restores original complete DOM');
   await repeat('recovery');
   running = null; await poll(); snapshot('unknown');
   assert.equal(status().querySelector('strong').textContent, 'Status unavailable');
   await repeat('unknown');
   running = false; await poll(); snapshot('stopped');
   assert.equal(status().querySelector('strong').textContent, 'NOT RUNNING');
   await repeat('stopped');
   running = true;
   const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>&"\' 节点';
   current = { mode: 'urltest', active: { id: 'external', label: evil, type: 'socks' } };
   await poll(); snapshot('malicious-label');
   assert.equal(status().querySelectorAll('img,script').length, 0);
   if (name === 'client') assert(status().textContent.includes('URLTest: ' + evil), 'label stays literal text');
   await repeat('malicious-label');
   current = { mode: 'urltest', active: { id: 'external', label: 'Changed node', type: 'socks' } };
   await poll(); snapshot('changed-label');
   if (name === 'client') assert(status().textContent.includes('Changed node'));
   // Reset creates a fresh widget; an equal result must still populate it.
   const resetHTML = status().outerHTML;
   for (let i = 0; i < 2; i++) {
    const old = status(); await h.map.reset(); await tick();
    assert.notEqual(status(), old); observe();
    assert.equal(status().textContent, 'Collecting data...');
    await poll(); assert.equal(status().outerHTML, resetHTML);
    snapshot('reset-' + i); await repeat('reset-' + i);
   }
   // Re-enter through the actual view and a real readonly Map load/reset.
   h.root().remove(); await tick(); assert.equal(h.polls().length, 0);
   const fresh = await h.app.render(await h.app.load());
   h.w.document.querySelector('#view').append(fresh); await tick();
   const freshMap = h.mods.dom.findClassInstance(h.root());
   freshMap.readonly = readonly; await freshMap.reset(); await tick(); observe();
   await poll(); assert.equal(status().outerHTML, resetHTML);
   snapshot('reentry'); await repeat('reentry');
   observer.disconnect();
   report.push({ name, readonly, snapshots, stable, pollCalls });
  } finally { h.w.close(); }
 }
 if (process.env.HP_STATUS_EVIDENCE) fs.writeFileSync(process.env.HP_STATUS_EVIDENCE, JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report.map(({ name, readonly, stable }) => ({ name, readonly, stable: stable.map(({calls, ...counts}) => counts) })), null, 2));
 if (!process.env.HP_STATUS_ALLOW_REBUILD) assert.deepEqual(performanceFailures, [], 'equal status must preserve DOM nodes without writes');
 console.log('PASS status stability: running/failure/same-node recovery/unknown/stopped/XSS/reset/reentry/readonly and unchanged RPC sequences');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
