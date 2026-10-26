'use strict';
const assert = require('assert/strict');
const { boot } = require('./integration.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
 const h = await boot();
 try {
  const render = h.mods.form.Map.prototype.render;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  h.mods.form.Map.prototype.render = function(...args) {
   return render.apply(this, args).then(node => new Promise(resolve => {
    release = () => resolve(node); entered();
   }));
  };
  h.q('.cbi-tabmenu').children[2].querySelector('a').click();
  await started;
  assert.equal(h.polls.size, 1, 'only parent polls before MLO render resolves');
  h.node.remove(); await flush();
  assert.equal(h.polls.size, 0, 'parent has processed detach');
  release(); await flush(); await flush();
  assert.equal(h.polls.size, 0, 'abandoned async MLO render must not register a poll');
  const calls = h.calls.length;
  for (let i = 0; i < 3; i++) await h.poll();
  assert.equal(h.calls.length, calls, 'abandoned view sends no requests');
  assert.equal(h.w.document.querySelector('.mlo-map'), null);
  console.log('PASS abandoned async MLO render leaves no polling or requests');
 } finally { h.w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
