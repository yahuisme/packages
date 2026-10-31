const assert = require('node:assert/strict');
const { boot } = require('./integration.cjs');
const tick = () => new Promise(r => setTimeout(r, 10));
async function until(f) { for (let i = 0; i < 500 && !f(); i++) await tick(); assert(f()); }
(async () => {
 const h = await boot();
 try {
  const post = h.mods.request.post;
  h.mods.request.post = async (url, req) => {
   const [, obj, method] = req.params;
   if (obj === 'uci' && method === 'revert') {
    const db = h.db(); for (const k of Object.keys(db.staged)) delete db.staged[k];
    Object.assign(db.staged, structuredClone(db.committed));
    return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0', id:req.id, result:[0]})) };
   }
   return post(url, req);
  };
  h.field('radio0', 'power').value = '24'; h.state.applyCode = 6; await h.clickSave();
  assert.equal(h.db().staged.radio0.txpower, '24');
  await h.tab(2); await until(() => h.q('[data-mlo-action="reset"]'));
  h.q('[data-mlo-action="reset"]').click(); await until(() => !h.save.disabled); await tick();
  assert.equal(h.db().staged.radio0.txpower, undefined);
  assert.equal(h.notifications.at(-1).text, 'Wireless changes reset; radio drafts were discarded.');
  assert.equal(h.field('radio0', 'power').value, '', 'reset reconciles the parent input');
  h.field('radio1', 'power').value = '20'; h.state.applyCode = 0; await h.clickSave();
  assert.equal(h.db().committed.radio0.txpower, undefined, 'unrelated save must not reintroduce reverted power');
  assert.equal(h.db().committed.radio1.txpower, '20');
  console.log('PASS failed radio Apply → MLO Reset → unrelated radio Apply');
 } finally { h.w.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
