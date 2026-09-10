// Current full app and native LuCI form DOM; fixture transport only.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {boot}=require('./integration.cjs');
(async()=>{
 const h=await boot(),out=process.env.TYPOGRAPHY_OUT;
 if(out)fs.mkdirSync(out,{recursive:true});
 const assertMloHierarchy=()=>{
  const root=h.q('.mlo-map');
  assert.equal(root.querySelector('h2,h3'),null,'embedded MLO must not repeat page/section-level titles');
  assert.equal(root.querySelector('.cbi-tblsection > h4').textContent,'MLO Interfaces');
  assert.equal(root.querySelectorAll('.cbi-tblsection > h4').length,1);
  assert.equal(root.querySelector('.cbi-tblsection > h4').tagName,h.q('.wifi7-settings-card h4').tagName,'match sibling tab heading semantics');
 };
 const save=name=>{if(!out)return;for(const e of h.w.document.querySelectorAll('input')){e.setAttribute('value',e.value);e.toggleAttribute('checked',e.checked)}for(const e of h.w.document.querySelectorAll('option'))e.toggleAttribute('selected',e.selected);fs.writeFileSync(path.join(out,name+'.dom.html'),h.j.serialize());};
 try{
  assert(!/font-size|font-weight|font-family|letter-spacing/.test(h.q('.wifi7-map style').textContent),'application leaves typography to the theme');
  for(let i=0;i<4;i++){await h.tab(i);await h.poll();if(i===3)for(const detail of h.node.querySelectorAll('details'))detail.open=true;save('tab'+i);}
  await h.tab(2);
  assertMloHierarchy();
  const map=h.mods.dom.findClassInstance(h.q('.mlo-map')),section=map.children[0];
  const id=h.mods.uci.add('wireless','wifi-iface');
  // Fixture network package is empty: provide the native selector one choice.
  section.children.find(o=>o.option==='network').value('lan','LAN');
  for(const [k,v] of Object.entries({mlo:'1',mode:'ap',ssid:'Typography fixture',device:['radio1','radio2'],network:['lan'],encryption:'sae',key:'fixture-password',ieee80211w:'2'}))h.mods.uci.set('wireless',id,k,v);
  await map.reset();
  assertMloHierarchy();
  assert.equal(h.q('.mlo-map').querySelectorAll('style').length,1);
  assert.equal(h.q('.mlo-map').querySelectorAll('.mlo-summary').length,1);
  assert(!/font-size|font-weight|text-transform|letter-spacing/.test(h.q('.mlo-map style').textContent),'MLO has no private typography overrides');
  assert(h.q('.mlo-overview'),'native populated grid rendered');save('mlo-populated');
  await section.renderMoreOptionsModal(id);
  let modal=h.w.document.querySelector('.modal');
  assert(modal.classList.contains('wifi7-modal'));
  for(const tab of ['general','security','advanced']){modal.querySelector(`.cbi-tabmenu li[data-tab="${tab}"] a`).click();save('modal-'+tab);}
  h.mods.ui.showModal('Unrelated',[]);
  assert(!modal.classList.contains('wifi7-modal'),'native reuse removes application modal scope');
  h.mods.ui.hideModal();await section.renderMoreOptionsModal(id);
  assert(modal.classList.contains('wifi7-modal'),'reopening restores modal ownership');
  h.mods.ui.hideModal();h.node.remove();await new Promise(r=>setImmediate(r));assert.equal(h.polls.size,0);
  assert(!h.w.document.querySelector('.wifi7-map style'),'common stylesheet removed with view');
  console.log('PASS full-app typography ownership, populated native MLO grid/reset, three modal tabs, unrelated modal isolation/reopen, teardown');
 }finally{h.w.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
