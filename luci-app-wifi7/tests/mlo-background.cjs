'use strict';
const assert = require('assert/strict');
const { boot } = require('./integration.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
 const h = await boot();
 try {
  await h.poll();
  await h.tab(2); await h.poll();
  Object.defineProperty(h.w.document, 'visibilityState', { configurable: true, value: 'hidden' });
  let before = h.calls.length;
  await h.poll();
  assert.equal(h.calls.length, before, 'hidden MLO sends no shared telemetry requests');
  Object.defineProperty(h.w.document, 'visibilityState', { configurable: true, value: 'visible' });
  before = h.calls.length;
  await h.poll();
  assert.equal(h.calls.slice(before).filter(c => c.method === 'getWirelessDevices').length, 1, 'foreground resumes one shared runtime sample');
  h.node.remove(); await flush();
  assert.equal(h.polls.size, 0, 'detach removes both view callbacks');
  console.log('PASS MLO background suspension, shared foreground sampling and detach');
 } finally { h.w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
