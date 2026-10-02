'use strict';
// Native LuCI Poll/Map/DOM; only RPC transport and timer delivery are fixtures.
const assert = require('assert/strict');
const { boot } = require('./mlo-luci-dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
 for (const state of ['initialized', 'cold', 'active', 'stopped']) {
  let generation = 0;
  const h = await boot({ runtimeValue: () => ({radio0: {up:true, interfaces:[{section:'test',mld:true,ifname:'ap-mld-' + ++generation,config:{device:['radio0','radio1'],mode:'ap'}}]}}), pollSetup(w, poll) {
   w.setInterval = () => 1;
   w.clearInterval = () => {};
   const sentinel = () => Promise.resolve();
   if (state === 'initialized') poll.start();
   if (state === 'active' || state === 'stopped') {
    poll.add(sentinel, 5); poll.start();
    if (state === 'stopped') poll.remove(sentinel);
   }
  } });
  const poll = h.mods.poll, expected = state === 'active' ? 2 : 1;
  try {
   await flush();
   assert.equal(poll.queue.length, expected, state + ': mounted MLO retains polling');
   if (!poll.active()) poll.start();
   await flush();
   async function sample() {
    const before = h.replies.length;
    const previous = h.node.querySelector('[data-mlo-summary-status]').textContent;
    poll.tick = 5; poll.step(); await flush();
    assert(h.replies.length > before, state + ': periodic RPC continues');
    const current = h.node.querySelector('[data-mlo-summary-status]').textContent;
    assert(current.includes('ap-mld-' + generation));
    assert.notEqual(current, previous, 'visible runtime follows fresh RPC values');
   }
   await sample();
   for (let i = 0; i < 3; i++) {
    await h.map.reset(); await flush();
    assert.equal(poll.queue.length, expected, 'Map reset cannot duplicate/remove polling');
    await sample();
   }
   h.node.remove(); await flush();
   assert.equal(poll.queue.length, expected - 1, 'detach removes only owned callback');
   const before = h.replies.length;
   poll.tick = 10; poll.step(); await flush();
   assert.equal(h.replies.length, before, 'detached module makes no requests');
   const next = await h.app.render(await h.app.load());
   h.w.document.getElementById('view').append(next); await flush();
   assert.equal(poll.queue.length, expected, 'reentry restores exactly one callback');
   if (!poll.active()) poll.start();
   await flush();
   const entered = h.replies.length;
   poll.tick = 15; poll.step(); await flush();
   assert(h.replies.length > entered, 'reentry continues periodic RPCs');
   next.remove(); await flush();
   console.log('PASS MLO ' + state + ': mount, periodic refresh, Map reset, detach and reentry');
  } finally { poll.stop(); h.w.close(); }
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
