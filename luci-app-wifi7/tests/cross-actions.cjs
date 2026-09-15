// Real LuCI shared-UCI transaction regression; transport is isolated.
const assert=require('assert/strict');
const {boot}=require('./integration.cjs');
const tick=()=>new Promise(r=>setTimeout(r,10));
async function until(fn){for(let i=0;i<500&&!fn();i++)await tick();assert(fn(),'operation settled');}
(async()=>{
 const mode=process.argv[2];
 if(!mode||mode==='add') {
  const h=await boot();try {
   const post=h.mods.request.post;let release,hold=false;
   h.mods.request.post=async(url,req)=>{
    if(hold&&req.params[1]==='session')await new Promise(r=>release=r);
    if(req.params[1]==='uci'&&req.params[2]==='get'&&req.params[3].config==='network')
     return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{values:{lan:{'.name':'lan','.type':'interface','.index':0}}}]}))};
    return post(url,req);
   };
   await h.tab(2);await until(()=>h.q('.mlo-map'));
   const section=h.mods.dom.findClassInstance(h.q('.mlo-map')).children[0];hold=true;
   const adding=section.handleAdd();await until(()=>release);
   assert(h.save.disabled,'native add modal loading must hold shared operation');
   h.field('radio0','power').value='24';h.save.dispatchEvent(new h.w.Event('click'));
   await tick();assert.equal(h.writes().length,0,'radio cannot save a partially initialized add');
   release();await adding;assert(!h.save.disabled);assert(h.w.document.querySelector('.wifi7-mlo-modal'));
   console.log('PASS native add holds through real modal ACL/render');
  }finally{h.w.close();}
 }
 if(!mode||mode==='sort') {
  const h=await boot();try {
   await h.tab(2);await until(()=>h.q('.mlo-map'));
   const section=h.mods.dom.findClassInstance(h.q('.mlo-map')).children[0];
   assert.throws(()=>section.handleSort(null),/target/,'real native sort rejects an invalid event');
   await tick();await tick();assert(!h.save.disabled,'native sort exception must release shared operation');
   h.field('radio0','power').value='24';await h.clickSave();assert.equal(h.db().committed.radio0.txpower,'24');
   // Execute the real header sorter and its queued reorder before unlocking.
   const header=h.q('.cbi-section-table-titles'),th=header.querySelector('th');
   th.setAttribute('data-sortable-row','true');
   section.handleSort({target:th,currentTarget:header});
   assert(h.save.disabled,'sort holds until native animation-frame work');
   await until(()=>!h.save.disabled);assert.equal(th.getAttribute('data-sort-direction'),'desc');
   console.log('PASS native sort exception releases for radio retry; RAF sort state retained');
  }finally{h.w.close();}
 }
 if(!mode||mode==='disabled') {
  const h=await boot();try {
   await h.tab(2);await until(()=>h.q('.mlo-map'));
   const map=h.mods.dom.findClassInstance(h.q('.mlo-map')),section=map.children[0];
   // Native named-section Add is disabled until its name is valid.
   section.anonymous=false;await map.reset();
   const add=h.q('.cbi-section-create .cbi-button-add');
   assert(add,'native named Add rendered');assert(add.disabled,'lock refresh preserves native disabled state');
   h.field('radio0','power').value='24';await h.clickSave();
   assert(add.disabled,'shared release preserves native disabled state');
   console.log('PASS native disabled control survives render and lock cycle');
  }finally{h.w.close();}
 }
 if(!mode||mode==='modal') {
  const h=await boot();try {
   const iface={'.name':'test','.type':'wifi-iface','.index':3,mode:'ap',mlo:'1',device:['radio1','radio2'],network:'lan',ssid:'Before',encryption:'sae',key:'test-password',ieee80211w:'2'};
   h.db().staged.test=structuredClone(iface);h.db().committed.test=structuredClone(iface);
   const post=h.mods.request.post;let hold=false,releaseSet,releaseGet;
   h.mods.request.post=async(url,req)=>{
    const [,object,method,p]=req.params;
    if(object==='uci'&&method==='get'&&p.config==='network')return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{values:{lan:{'.name':'lan','.type':'interface','.index':0}}}]}))};
    if(hold&&object==='uci'&&method==='set')await new Promise(r=>releaseSet=r);
    if(hold&&object==='uci'&&method==='get'&&p.config==='wireless')await new Promise(r=>releaseGet=r);
    return post(url,req);
   };
   h.mods.uci.unload('wireless');await h.mods.uci.load('wireless');
   await h.tab(2);await until(()=>h.q('.mlo-map'));
   const root=h.q('.mlo-map'),map=h.mods.dom.findClassInstance(root),section=map.children[0];
   await section.renderMoreOptionsModal('test');
   const modal=h.mods.dom.findClassInstance(h.w.document.querySelector('.modal .cbi-map'));
   const input=h.w.document.getElementById('widget.cbid.wireless.test.ssid');input.value='After';input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
   hold=true;const saving=section.handleModalSave(modal,{});await until(()=>releaseSet);
   assert(h.save.disabled,'modal staging blocks radio');
   h.field('radio0','power').value='24';h.save.dispatchEvent(new h.w.Event('click'));
   h.q('[data-mlo-action="reset"]').dispatchEvent(new h.w.Event('click'));
   releaseSet();await until(()=>releaseGet);assert(h.save.disabled,'modal reload remains inside lock');
   hold=false;releaseGet();await saving;
   assert(!h.save.disabled);assert.match(h.q('.mlo-overview-primary').textContent,/After/);
   assert.equal(h.q('.mlo-map').querySelectorAll('.mlo-summary').length,1);
   assert.equal(h.db().committed.test.ssid,'Before','modal save stages only');
   assert.equal(h.calls.filter(c=>c.object==='uci'&&['apply','revert'].includes(c.method)).length,0);
   await h.clickSave();assert.equal(h.db().committed.test.ssid,'After');assert.equal(h.db().committed.radio0.txpower,'24');
   h.node.remove();const before=h.calls.length,names=section.cfgsections().join(',');await section.handleAdd();await section.handleRemove('test');
   assert.equal(section.cfgsections().join(','),names,'detached add cannot stage a local section');
   await tick();assert.equal(h.calls.length,before,'detached native handlers cannot mutate');
   console.log('PASS native modal set/reload/redraw barrier, cross-tab retry and detach');
  }finally{h.w.close();}
 }
 if(mode)return;
 for(const first of ['radio','apply','reset']) {
  const h=await boot();try {
   let release,held=false;const post=h.mods.request.post;
   h.mods.request.post=async(url,req)=>{
    const [,object,method,p]=req.params;
    if(object==='uci'&&method===(first==='reset'?'revert':'apply')&&!held){held=true;await new Promise(r=>release=r);}
    if(object==='uci'&&method==='revert'){
     h.calls.push({object,method,params:p});
     Object.keys(h.db().staged).forEach(k=>delete h.db().staged[k]);Object.assign(h.db().staged,structuredClone(h.db().committed));
     return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0]}))};
    }return post(url,req);
   };
   h.field('radio0','power').value='24';
   if(first==='radio')h.save.click();
   await h.tab(2);await until(()=>h.q('[data-mlo-action="apply"]'));
   const button=k=>h.q('[data-mlo-action="'+k+'"]');
   if(first!=='radio')button(first).click();
   await until(()=>release);
   assert(h.save.disabled,'radio blocked by shared transaction');
   assert(button('reset').disabled,'reset blocked by shared transaction');
   assert(button('apply').disabled,'apply blocked by shared transaction');
   const before=h.calls.length;
   h.save.dispatchEvent(new h.w.Event('click'));button('reset').dispatchEvent(new h.w.Event('click'));button('apply').dispatchEvent(new h.w.Event('click'));
   const map=h.mods.dom.findClassInstance(h.q('.mlo-map'));
   await map.children[0].handleAdd();
   await tick();assert.equal(h.calls.length,before,'forced cross-tab actions and add cannot mutate');
   release();await until(()=>!h.save.disabled);assert(!button('apply').disabled);assert(!button('reset').disabled);
   if(first==='radio')assert.equal(h.db().committed.radio0.txpower,'24');
   else {await h.clickSave();assert.equal(h.db().committed.radio0.txpower,'24');}
   console.log('PASS cross-tab '+first+' hold, forced reverse actions, add guard, release/readback/retry');
  }finally{h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
