const assert=require('assert/strict');
const {boot}=require('./integration.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const h=await boot();
 try {
  const iface={'.name':'test','.type':'wifi-iface','.index':3,mode:'ap',mlo:'1',device:['radio1','radio2'],network:'lan',ssid:'Before',encryption:'sae',key:'test-password',ieee80211w:'2'};
  h.db().staged.test=structuredClone(iface);h.db().committed.test=structuredClone(iface);
  const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{
   const [,object,method,p]=req.params;
   if(object==='uci'&&method==='get'&&p.config==='network')return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{values:{lan:{'.name':'lan','.type':'interface','.index':0}}}]}))};
   if(object==='uci'&&method==='revert'){
    assert.equal(p.config,'wireless');
    for(const k of Object.keys(h.db().staged))delete h.db().staged[k];
    Object.assign(h.db().staged,structuredClone(h.db().committed));
    return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0]}))};
   }
   return post(url,req);
  };
  h.mods.uci.unload('wireless');await h.mods.uci.load('wireless');await h.tab(2);
  const map=h.mods.dom.findClassInstance(h.q('.mlo-map')),section=map.children[0];
  async function edit(value){
   await section.renderMoreOptionsModal('test');
   const edit=h.mods.dom.findClassInstance(h.w.document.querySelector('.modal .cbi-map'));
   const input=h.w.document.getElementById('widget.cbid.wireless.test.ssid');
   input.value=value;input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
   await section.handleModalSave(edit,{});
  }
  await edit('After');assert.equal(h.db().committed.test.ssid,'Before');
  const button=kind=>h.q('[data-mlo-action="'+kind+'"]');
  assert(button('apply'),'MLO must provide an explicit apply entry');
  assert(button('reset'),'MLO must provide an explicit reset entry');
  async function click(kind){button(kind).click();for(let i=0;i<100&&button(kind).disabled;i++)await new Promise(r=>setTimeout(r,25));await tick();}
  await click('apply');assert.equal(h.db().committed.test.ssid,'After');
  assert(h.calls.some(c=>c.method==='apply'&&c.params.rollback===true));
  await edit('Discard');await click('reset');assert.equal(h.db().staged.test.ssid,'After');assert.match(h.q('.mlo-overview-primary').textContent,/After/);
  await edit('Retry');h.state.applyCode=6;await click('apply');assert.equal(h.db().committed.test.ssid,'After');assert.match(h.notifications.at(-1).text,/6/);
  h.state.applyCode=0;await click('apply');assert.equal(h.db().committed.test.ssid,'Retry');
  await edit('Held');
  const transport=h.mods.request.post;let release,applyCount=0;
  h.mods.request.post=async(url,req)=>{
   if(req.params[1]==='uci'&&req.params[2]==='apply'){applyCount++;await new Promise(r=>release=r);}
   return transport(url,req);
  };
  button('apply').click();for(let i=0;i<20&&!release;i++)await tick();assert(release);
  button('apply').dispatchEvent(new h.w.Event('click'));
  button('reset').dispatchEvent(new h.w.Event('click'));await tick();
  assert.equal(applyCount,1);assert.equal(h.db().staged.test.ssid,'Held');
  h.w.L.hasViewPermission=()=>false;release();await new Promise(r=>setTimeout(r,1200));
  assert.equal(h.db().committed.test.ssid,'Held');assert(button('apply').disabled);assert(button('reset').disabled);
  h.w.L.hasViewPermission=()=>false;const before=h.writes().length;
  button('apply').dispatchEvent(new h.w.Event('click'));await tick();assert.equal(h.writes().length,before);assert(button('apply').disabled);assert(button('reset').disabled);
  console.log('PASS MLO modal staging, apply/confirm, reset, failure/retry, permission');
 } finally {h.j.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
