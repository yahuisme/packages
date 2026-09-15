'use strict';
// Real LuCI modal/form lifecycle; fixture transports never touch router configuration.
const assert = require('assert/strict');
const { pageBoot, tick } = require('../../tests/helpers/test_page_lifecycle.cjs');
function grids(map) {
 const found=[];
 function visit(s) { if(s.sectiontype && s.renderMoreOptionsModal) found.push(s); for(const c of s.children||[]) visit(c.subsection||c); }
 visit(map); return found;
}
(async()=>{
 const {boot}=require('../../tests/helpers/test_connection_lifecycle.cjs');
 const status=await boot([{type:'dashboard',installed:true,version:'20260914012345'}]);
 try {
  await status.settle({results:[]});
  for(let i=0;i<2;i++) {
   if(i) await status.mods.dom.findClassInstance(status.root()).reset();
   status.button('Remove').click();await tick();
   const modal=status.w.document.querySelector('.modal');
   assert(modal.classList.contains('hp-resource-modal'),'dashboard confirmation owns its constraint');
   assert.equal(status.w.getComputedStyle(modal).maxWidth,'100%');
   status.mods.ui.cancelModal({key:'Escape'});await tick();
   assert(!status.w.document.body.classList.contains('modal-overlay-active'));
  }
  console.log('PASS dashboard confirmation, Escape/cancel, reset/reopen');
 }finally{status.w.close();}
 for(const name of ['server','node']) {
  const h=await pageBoot(name);
  try {
   const original=h.mods.ui.showModal;
   const grid=grids(h.map).find(g=>g.sectiontype===name);
   for(let i=0;i<2;i++) {
    if(i) await h.map.reset();
    await grid.renderMoreOptionsModal(grid.cfgsections()[0]); await tick();
    const modal=grid.getActiveModalMap().closest('.modal');
    assert(modal.classList.contains('hp-'+name+'-modal'),name+' editor must own its modal constraint');
    assert.equal(h.w.getComputedStyle(modal).maxWidth,'100%',name+' modal width is bounded');
    h.mods.ui.cancelModal({key:'Escape'});await tick();
    assert(!h.w.document.body.classList.contains('modal-overlay-active'));
   }
   h.map.readonly=true;
   await grid.renderMoreOptionsModal(grid.cfgsections()[0]);await tick();
   const map= h.mods.dom.findClassInstance(grid.getActiveModalMap());
   assert.equal(map.readonly,true,'native modal retains read-only');
   const controls=()=>[...grid.getActiveModalMap().querySelectorAll('input,select,textarea')].map(e=>({tag:e.tagName,disabled:e.disabled,readonly:e.readOnly}));
   const ownedControls=controls();
   h.mods.ui.hideModal();
   await h.mods.form.GridSection.prototype.renderMoreOptionsModal.call(grid,grid.cfgsections()[0]);
   assert.deepEqual(controls(),ownedControls,'read-only control state matches unmodified native renderer');
   h.mods.ui.hideModal();
   h.mods.ui.showModal('Unrelated',[h.w.E('button',{},['Close'])]);
   assert.equal(h.w.document.querySelector('.modal').className,'modal');
   assert.equal(h.mods.ui.showModal,original,'never replace global showModal');
   h.root().remove();await tick();
   console.log('PASS '+name+' owned modal, Escape/reopen, Map.reset, read-only, unrelated native modal');
  } finally {h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
