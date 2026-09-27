// Native LuCI network/RPC boundary, never stub WifiDevice.isUp().
const fs=require('fs'),assert=require('assert/strict');
const {boot}=require('./integration.cjs');
const tick=()=>new Promise(r=>setTimeout(r,10));
async function until(fn){for(let i=0;i<500&&!fn();i++)await tick();assert(fn());}
const mode=process.argv[2]||'availability';
(async()=>{
 const h=await boot();
 try {
  let status={radio0:{up:true,interfaces:[]},radio1:{up:true,interfaces:[{section:'mlo0',ifname:'ap-mld',mld:true,config:{ssid:'Live SSID'}}]},radio2:{up:false,interfaces:[]}};
  let failure=false,hold=false,release;
  const calls=[],post=h.mods.request.post;
  const reply=(req,result)=>({ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result}))});
  h.mods.request.post=async(url,req)=>{
   const [,object,method]=req.params;calls.push(object+'/'+method);
   if(object==='luci-rpc'&&method==='getWirelessDevices') {
    if(hold)await new Promise(r=>release=r);
    return reply(req,failure?[6]:[0,status]);
   }
   if(object==='luci-rpc'||object==='network')return reply(req,[0,{}]);
   if(object==='network.interface')return reply(req,[0,{interface:[]}]);
   return post(url,req);
  };
  h.w.L.hasSystemFeature=()=>false;
  const src=fs.readFileSync(process.env.LUCI_RESOURCE_DIR+'/network.js','utf8');
  const deps=[...src.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);
  const C=h.w.Function(...deps,src)(...deps.map(d=>h.mods[d]));
  const real=new C();
  Object.assign(h.mods.network,{flushCache:real.flushCache.bind(real),getWifiDevices:real.getWifiDevices.bind(real),getWifiNetworks:real.getWifiNetworks.bind(real)});
  const badges=()=>[...h.node.querySelectorAll('.wifi7-status-badge')].map(n=>n.textContent);
  if(mode==='availability') {
   failure=true;await real.flushCache();
   const configured=await real.getWifiDevices();
   assert(configured.length>=3);assert(configured.every(d=>!d.isUp()),'native network synthesizes down configured objects after denied runtime');
   await h.poll();assert(badges().every(s=>s.includes('Unknown')),'denied runtime must not become Disabled');
   failure=false;status={};await h.poll();assert(badges().every(s=>s.includes('Unknown')),'empty runtime is not disabled');
   status={radio0:{up:true,interfaces:[]},radio1:{up:false,interfaces:[]},radio2:{interfaces:[]}};
   await h.poll();assert.match(badges()[2],/Unknown/,'missing up is unknown');
   status.radio2.up=true;await h.poll();
   assert.match(badges()[0],/Enabled/);assert.match(badges()[1],/Disabled/);assert.match(badges()[2],/Enabled/);
   console.log('PASS native network denial/empty/malformed/explicit down/recovery');
  } else {
   await h.poll();calls.length=0;await h.poll();
   console.log('OVERVIEW_RPC',JSON.stringify(calls));
   assert.equal(calls.length,5,'overview needs only wireless status, summary and three radio info calls');
   assert(!calls.includes('network.interface/dump'));
   await h.tab(2);await until(()=>h.q('.mlo-map'));await h.poll();calls.length=0;await h.poll();
   console.log('MLO_RPC',JSON.stringify(calls));
   assert.equal(calls.length,5);assert.equal(calls.filter(c=>c==='luci-rpc/getWirelessDevices').length,1);
   assert.match(h.q('[data-mlo-summary-status]').textContent,/Active/);
   await h.tab(3);await h.poll();assert.match(h.q('.wifi7-client-summary').textContent,/Live SSID/);
   status.radio1.interfaces[0].iwinfo={ifname:'ap-mld'};delete status.radio1.interfaces[0].ifname;
   status.radio1.interfaces[0].config.ssid='Fallback interface SSID';
   await h.poll();assert.match(h.q('.wifi7-client-summary').textContent,/Fallback interface SSID/,'native iwinfo.ifname fallback retains SSID association');
   status.radio1.interfaces[0].ifname='ap-mld';
   await h.tab(2);await h.poll();calls.length=0;hold=true;
   const first=h.poll();await until(()=>release);const second=h.poll();
   assert.equal(calls.filter(c=>c==='luci-rpc/getWirelessDevices').length,1,'shared single-flight');
   hold=false;release();await Promise.all([first,second]);
   failure=true;await h.poll();assert(badges().every(s=>s.includes('Unknown')));assert.match(h.q('[data-mlo-summary-status]').textContent,/Unavailable/);
   failure=false;status={};await h.poll();assert(badges().every(s=>s.includes('Unknown')));assert.match(h.q('[data-mlo-summary-status]').textContent,/Unavailable/);
   status={radio0:{up:true,interfaces:[]},radio1:{up:true,interfaces:[{section:'mlo0',ifname:'ap-mld',mld:true}]},radio2:{up:false,interfaces:[]}};
   await h.poll();assert.match(badges()[0],/Enabled/);assert.match(h.q('[data-mlo-summary-status]').textContent,/Active/);
   // A changed runtime frequency must not be served from network's old cache.
   const infoPost=h.mods.request.post;
   h.mods.request.post=async(url,req)=>req.params[1]==='iwinfo'&&req.params[2]==='info'&&req.params[3].device==='radio0'
    ? reply(req,[0,{frequency:2412,channel:1,htmode:'HE20',txpower:0}]) : infoPost(url,req);
   await h.poll();assert.match(h.q('.wifi7-card').textContent,/1 \/ 20 MHz/);assert.match(h.q('.wifi7-card').textContent,/0 dBm/);
   h.mods.request.post=infoPost;
   calls.length=0;hold=true;const pending=h.poll();await until(()=>release);const before=h.node.textContent;
   h.node.remove();await tick();assert.equal(h.polls.size,0);hold=false;release();await pending;assert.equal(h.node.textContent,before);
   const count=calls.length;await h.poll();assert.equal(calls.length,count);
   console.log('PASS shared precise RPC, SSID mapping, single-flight, failure/recovery, detach');
  }
 } finally {h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
