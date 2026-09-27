const assert = require('assert/strict');
const { boot } = require('./integration.cjs');
async function zero() {
 const h = await boot({zeroPower:true});
 try {
  assert.equal(h.field('radio0','power').value, '0');
  assert(h.field('radio0','power').checkValidity(), 'existing zero power must remain valid');
  h.field('radio1','power').value = '25';
  await h.clickSave();
  assert.equal(h.db().committed.radio0.txpower, '0');
  assert.equal(h.db().committed.radio1.txpower, '25');
  for (const invalid of ['-1', '31', '0.5']) {
   h.field('radio1','power').value = invalid;
   assert(!h.field('radio1','power').checkValidity(), invalid);
   const writes = h.writes().length;
   await h.clickSave();
   assert.equal(h.writes().length, writes);
  }
  console.log('PASS zero baseline, unrelated Apply, bounded integer power');
 } finally { h.w.close(); }
}
const tick = () => new Promise(r => setTimeout(r, 10));
async function until(fn) { for (let i=0; i<500 && !fn(); i++) await tick(); assert(fn()); }
async function mlo() {
 const h = await boot();
 try {
  const iface = {'.name':'test','.type':'wifi-iface','.index':3,mode:'ap',mlo:'1',device:['radio1','radio2'],ssid:'Before',encryption:'sae',key:'test-password',ieee80211w:'2'};
  h.db().staged.test=structuredClone(iface); h.db().committed.test=structuredClone(iface);
  const transport=h.mods.request.post;
  h.mods.request.post=async(url,req)=> req.params[1]==='uci' && req.params[2]==='get' && req.params[3].config==='network'
   ? {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{values:{lan:{'.name':'lan','.type':'interface','.index':0}}}]}))}
   : transport(url,req);
  h.mods.uci.unload('wireless'); await h.mods.uci.load('wireless');
  await h.tab(2); await until(()=>h.q('.mlo-overview'));
  const map=h.mods.dom.findClassInstance(h.q('.mlo-map')), section=map.children[0];
  await section.renderMoreOptionsModal('test');
  const input=h.w.document.getElementById('widget.cbid.wireless.test.ssid');
  input.value='Unsaved draft'; input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  const modal=h.mods.dom.findClassInstance(section.getActiveModalMap());
  const radioWidget=modal.lookupOption('device','test')[0].getUIElement('test');
  radioWidget.setValue(h.w.Array.of('radio0','radio1'));
  await h.tab(1); h.field('radio1','channel').value='36';
  let release; const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{
   if(req.params[1]==='uci' && req.params[2]==='apply') await new Promise(r=>release=r);
   return post(url,req);
  };
  const saving=h.clickSave(); await until(()=>release);
  assert(h.q('[data-mlo-action="reset"]').disabled);
  await section.handleRemove('test');
  assert(h.mods.uci.get('wireless','test'));
  release(); await saving;
  await h.tab(2); await h.poll();
  assert.equal(h.db().committed.radio1.channel,'36');
  assert.match(h.q('.mlo-overview-radios').textContent,/channel 36/,'loaded MLO label must use applied radio snapshot');
  assert.doesNotMatch(h.q('.mlo-overview-radios').textContent,/channel 104/);
  assert.equal(h.w.document.getElementById('widget.cbid.wireless.test.ssid'),input);
  assert.equal(input.value,'Unsaved draft','refresh must not reset the open native editor');
  assert.deepEqual(Array.from(radioWidget.getValue()).sort(),['radio0','radio1'],'unsaved radio selection retained');
  assert.equal(h.db().committed.test.ssid,'Before');
  assert.match(h.w.document.querySelector('.wifi7-mlo-modal').textContent,/channel 36/,'open editor radio labels refresh without discarding drafts');
  assert.doesNotMatch(h.w.document.querySelector('.wifi7-mlo-modal').textContent,/channel 104/);
  h.mods.ui.hideModal(); await section.renderMoreOptionsModal('test');
  assert.match(h.w.document.querySelector('.wifi7-mlo-modal').textContent,/channel 36/,'next editor uses fresh radio choices');
  assert.doesNotMatch(h.w.document.querySelector('.wifi7-mlo-modal').textContent,/channel 104/);
  console.log('PASS MLO applied snapshot, editor choices, unsaved input and shared lock');
 } finally { h.w.close(); }
}
(async()=>{ if(process.argv[2]!=='mlo') await zero(); if(process.argv[2]!=='zero') await mlo(); })().catch(e => { console.error(e); process.exitCode=1; });
