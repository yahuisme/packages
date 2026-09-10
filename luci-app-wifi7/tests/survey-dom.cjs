// Real LuCI view and RPC; survey transport fixture only, no wireless writes.
const assert=require('assert/strict');
const {boot}=require('./integration.cjs');
(async()=>{
 const h=await boot();
 try {
  const previous=h.mods.request.post;let generation=0,missing=false;
  h.mods.request.post=async(url,req)=>{
   const [,object,method,p]=req.params;
   if(object==='file'&&method==='exec'&&p.command==='/usr/libexec/wifi7-status-summary'){
    const stdout=missing?'':`@@ survey shared-mld 0\n`+[2412,5180,6135].map((f,i)=>`Survey data from shared-mld\n frequency: ${f} MHz [in use]\n channel active time: ${1000+generation*100} ms\n channel busy time: ${[0,200,500][i]+generation*[0,20,50][i]} ms\n`).join('');
    return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{code:0,stdout}]}))};
   }
   return previous(url,req);
  };
  const values=()=>[...h.node.querySelectorAll('.wifi7-card')].map(n=>n.querySelectorAll('.wifi7-value')[2].textContent);
  await h.poll();assert.deepEqual(values(),['—','—','—']);
  generation++;await h.poll();assert.deepEqual(values(),['0%','20%','50%']);
  missing=true;await h.poll();assert.deepEqual(values(),['—','—','—']);
  missing=false;generation++;await h.poll();assert.deepEqual(values(),['—','—','—']);
  generation++;await h.poll();assert.deepEqual(values(),['0%','20%','50%']);
  generation=0;await h.poll();assert.deepEqual(values(),['—','—','—']);
  assert.equal(h.calls.filter(c=>c.method==='assoclist'||c.params.command==='/usr/libexec/wifi7-status').length,0);
  const states=()=>[...h.node.querySelectorAll('.wifi7-status-badge')];
  h.node.style.color='#333'; // Explicit theme baseline for unchanged neutral labels.
  function computedColor(node) {
   // jsdom leaves explicit `inherit` unresolved; follow the CSS inheritance chain.
   const color=h.w.getComputedStyle(node).color;
   return color==='inherit'||color===''?computedColor(node.parentElement):color;
  }
  function assertStates(labels) {
   assert.deepEqual(states().map(n=>n.textContent),labels);
   for(const state of states()) {
    const up=state.textContent==='↑Enabled';
    assert.equal(h.w.getComputedStyle(state.firstChild).color,up?'rgb(22, 163, 74)':'rgb(34, 34, 34)');
    assert.equal(computedColor(state.lastChild),up?'rgb(22, 163, 74)':'rgb(51, 51, 51)','label computed color');
    assert.equal(h.w.getComputedStyle(state.firstChild).fontWeight,'600');
    assert.equal(state.firstChild.getAttribute('aria-hidden'),'true');
   }
  }
  const getDevices=h.mods.network.getWifiDevices;
  assertStates(['↑Enabled','↑Enabled','↑Enabled']);
  h.mods.network.getWifiDevices=async()=>[{getName:()=>'radio0',isUp:()=>false}];
  await h.poll();assertStates(['↓Disabled','—Unknown','—Unknown']);
  h.mods.network.getWifiDevices=getDevices;
  await h.poll();assertStates(['↑Enabled','↑Enabled','↑Enabled']);
  console.log('PASS three-band summary-only surveys, zero busy, delta units, reset/outage, no station scans');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
