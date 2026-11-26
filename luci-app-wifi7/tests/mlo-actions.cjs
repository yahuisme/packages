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
  const cardRoot=h.q('.mlo-map');
  for(let i=0;i<3;i++){await h.tab(0);await h.tab(2);}
  assert.equal(h.q('.mlo-map'),cardRoot,'WiFi7 reuses its loaded feature card');
  assert.equal(h.node.querySelectorAll('.mlo-map').length,1,'one embedded feature owner');
  assert.equal(h.node.querySelectorAll('.wifi7-map').length,0,'no nested standalone application');
  async function edit(value){
   await section.renderMoreOptionsModal('test');
   const edit=h.mods.dom.findClassInstance(h.w.document.querySelector('.modal .cbi-map'));
   const input=h.w.document.getElementById('widget.cbid.wireless.test.ssid');
   input.value=value;input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
   await section.handleModalSave(edit,{});
  }
  for(const invalid of ['short','']) {
   h.mods.uci.set('wireless','radio2','txpower','18'); // A legitimate pre-existing draft.
   await section.renderMoreOptionsModal('test');
   const modal=h.mods.dom.findClassInstance(section.getActiveModalMap());
   for(const [field,value] of [['ssid','Invalid attempt'],['key',invalid]]) {
    const input=h.w.document.getElementById('widget.cbid.wireless.test.'+field);
    input.value=value;input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
   }
   const before=JSON.stringify(h.mods.uci.state),writes=h.writes().length;
   await section.handleModalSave(modal,{});
   assert(section.getActiveModalMap(),'invalid native Save keeps the editor open');
   assert.equal(JSON.stringify(h.mods.uci.state),before,'invalid key must not stage the valid SSID or disturb an existing draft');
   assert.equal(h.writes().length,writes);
   await modal.reset();
   assert.equal(modal.lookupOption('ssid','test')[0].formvalue('test'),'Before');
   await section.handleModalCancel(modal,{});
   h.field('radio0','power').value=invalid?'23':'24';await h.clickSave();
   assert.equal(h.db().committed.test.ssid,'Before','other Save must not commit the abandoned edit');
   assert.equal(h.db().committed.test.key,'test-password');
   assert.equal(h.db().committed.radio2.txpower,'18','legitimate staging survives');
  }
  await edit('After');assert.equal(h.db().committed.test.ssid,'Before');
  const button=kind=>h.q('[data-mlo-action="'+kind+'"]');
  assert(button('apply'),'MLO must provide an explicit apply entry');
  assert(button('reset'),'MLO must provide an explicit reset entry');
  async function click(kind){button(kind).click();for(let i=0;i<100&&button(kind).disabled;i++)await new Promise(r=>setTimeout(r,25));await tick();}
  await click('apply');assert.equal(h.db().committed.test.ssid,'After');assert.equal(h.notifications.at(-1).text,'Configuration applied. Runtime status will refresh.');
  assert(h.calls.some(c=>c.method==='apply'&&c.params.rollback===true));
  await edit('Discard');await click('reset');assert.equal(h.db().staged.test.ssid,'After');assert.match(h.q('.mlo-overview-primary').textContent,/After/);
  await edit('Retry');h.state.applyCode=6;await click('apply');assert.equal(h.db().committed.test.ssid,'After');assert.equal(h.notifications.at(-1).text,h.w._('Failed to apply configuration: %s').replace('%s',h.w._('Permission denied')));
  h.state.applyCode=0;await click('apply');assert.equal(h.db().committed.test.ssid,'Retry');
 await edit('Confirmed');
 h.field('radio0','power').value='26'; // An unrelated, unstaged Radio Settings draft.
 let confirmed=false,failures=2;const transportWithNetwork=h.mods.request.post;
 h.mods.request.post=async(url,req)=>{
  const [,object,method,p]=req.params;
  if(object==='uci'&&method==='confirm')confirmed=true;
  if(confirmed&&object==='uci'&&method==='get'&&p.config==='wireless'&&failures>0){
   failures--;return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[7]}))};
  }
  return transportWithNetwork(url,req);
 };
 await click('apply');assert.equal(h.db().committed.test.ssid,'Confirmed');assert.match(h.notifications.at(-1).text,/^Configuration applied, but/);
 assert.equal(button('apply').textContent,h.w._('Refresh applied configuration'));assert(button('reset').disabled);
 const confirmedWrites=h.writes().length;
 await h.clickSave();assert.equal(h.writes().length,confirmedWrites,'other tab also retries readback only');
 assert.match(h.notifications.at(-1).text,/^Configuration applied, but/);
 await click('apply');assert.equal(h.writes().length,confirmedWrites,'MLO recovery must not apply a second time');
 assert.equal(h.field('radio0','power').value,'26','MLO recovery preserves radio drafts');
 assert.equal(h.notifications.at(-1).type,'info');
 assert.equal(button('apply').textContent,h.w._('Apply staged changes'));assert(!button('reset').disabled);
 await h.clickSave();assert.equal(h.db().committed.radio0.txpower,'26','fresh radio Save after recovery works');
 h.mods.request.post=transportWithNetwork;
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
