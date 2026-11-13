// Production parent/MLO + native LuCI Map/RPC/DOM; held first HTTP reply or native Map render.
'use strict';
const assert = require('node:assert/strict');
const { boot } = require('./integration.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(test, message) {
 for (let i = 0; i < 200 && !test(); i++) await tick();
 assert(test(), message);
}
async function test(kind) {
 const h = await boot();
 try {
  await h.poll();
  const post = h.mods.request.post;
  let generation = 0, holdFirst = kind === 'rpc', release, calls = 0;
  if (kind === 'render') {
   const render = h.mods.form.Map.prototype.render;
   let holdRender = true;
   h.mods.form.Map.prototype.render = function(...args) {
    return render.apply(this, args).then(node => {
     if (!holdRender) return node;
     holdRender = false;
     return new Promise(resolve => { release = () => resolve(node); });
    });
   };
  }
  h.mods.request.post = async (url, req) => {
   if (req.params[1] === 'luci-rpc' && req.params[2] === 'getWirelessDevices') {
    calls++;
    if (holdFirst) { holdFirst = false; await new Promise(resolve => { release = resolve; }); }
    return {ok:true,status:200,json:() => h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,
     {radio1:{up:true,interfaces:[{section:'mlo0',ifname:'ap-mld-' + generation,mld:true}]}}]}))};
   }
   return post(url, req);
  };
  h.q('.cbi-tabmenu').children[2].querySelector('a').click();
  await until(() => release, 'old MLO load has reached held ' + kind + ' boundary');
  h.node.remove(); await tick();
  assert.equal(h.polls.size, 0, 'old parent is detached before its load resolves');
  const next = h.mods.app.render(await h.mods.app.load());
  h.w.document.querySelector('#view').append(next);
  const tab = i => next.querySelector('.cbi-tabmenu').children[i].querySelector('a').click();
  const summary = () => next.querySelector('[data-mlo-summary-status]').textContent;
  tab(2); await until(() => next.querySelector('.mlo-map'), 'new owner MLO ready before old RPC resolves');
  await h.poll(); assert.match(summary(), /ap-mld-0/);
  assert.equal(h.polls.size, 2, 'new parent and MLO each own one poll');
  release(); for (let i = 0; i < 10; i++) await tick();
  generation = 1; await h.poll();
  assert.match(summary(), /ap-mld-1/, 'late detached owner must not pause the new owner');
  assert.equal(h.polls.size, 2, 'abandoned old load must not register a poll');
  tab(0); generation = 2; await h.poll();
  assert.match(summary(), /ap-mld-1/, 'leaving current MLO tab still pauses its runtime rendering');
  tab(2); await h.poll(); assert.match(summary(), /ap-mld-2/, 'current tab reentry resumes without rebuilding the map');
  // Concurrent polls remain a single shared native wireless request.
  holdFirst = true; release = null;
  const before = calls, first = h.poll();
  await until(() => release, 'active owner wireless poll is held');
  const second = h.poll(); await tick();
  assert.equal(calls, before + 1, 'parent and MLO retain shared single-flight across concurrent ticks');
  release(); await Promise.all([first, second]);
  next.remove(); await tick(); assert.equal(h.polls.size, 0);
  const detachedCalls = calls; await h.poll(); assert.equal(calls, detachedCalls, 'unloaded owners send no requests');
  assert.equal(h.writes().length, 0);
  console.log('PASS delayed ' + kind + ': old load/new ready, current tab pause/resume, shared single-flight and teardown');
 } finally { h.w.close(); }
}
(async () => {
 for (const kind of ['rpc', 'render']) await test(kind);
})().catch(error => { console.error(error); process.exitCode = 1; });
