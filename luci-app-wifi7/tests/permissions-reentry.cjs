const assert = require('assert/strict');
const { boot } = require('./integration.cjs');
const tick = () => new Promise(r => setImmediate(r));
(async () => {
 const h = await boot();
 try {
  if (process.argv[2] === 'reentry') {
   await h.tab(2); await h.tab(0); h.node.remove(); await tick();
   assert.equal(h.polls.size, 0);
   const node = h.mods.app.render(await h.mods.app.load());
   h.w.document.querySelector('#view').appendChild(node);
   node.querySelector('.cbi-tabmenu').children[2].querySelector('a').click();
   for (let i=0;i<10;i++) await tick();
   assert(node.querySelector('.mlo-map'));
   const count = () => h.calls.filter(c => c.object === 'luci-rpc').length;
   const before = count(); await h.poll(); await h.poll();
   assert(count() > before, 'remounted active MLO must resume runtime polling');
   node.remove(); await tick(); assert.equal(h.polls.size, 0);
  } else {
   h.field('radio0','power').value = '24';
   if (process.argv[2] === 'pending') {
    const post = h.mods.request.post; let release;
    h.mods.request.post = async (url, req) => {
     if (req.params[1] === 'uci' && req.params[2] === 'apply') await new Promise(r => release = r);
     return post(url, req);
    };
    h.save.click(); for(let i=0;i<10&&!release;i++) await tick();
    assert(release); h.w.L.hasViewPermission = () => false; release();
    await new Promise(r=>setTimeout(r,1200));
   } else {
    h.w.L.hasViewPermission = () => false;
    h.save.dispatchEvent(new h.w.Event('click')); await tick();
    assert.equal(h.writes().length, 0, 'revoked permission must prevent writes');
   }
   assert(h.save.disabled, 'revoked permission must keep actions disabled');
   assert([...h.node.querySelectorAll('input,select')].every(e => e.disabled));
  }
  console.log('PASS', process.argv[2] || 'revoked');
 } finally { h.j.window.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
