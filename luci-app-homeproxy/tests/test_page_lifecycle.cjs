// Complete production views, actual LuCI Map/UI/RPC/poll; only transport is a fixture.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {boot,tick}=require('./test_connection_lifecycle.cjs');
const base=path.resolve(__dirname,'..'),dir=process.env.LUCI_RESOURCE_DIR;
async function pageBoot(name,translations={}) {
 const h=await boot([],translations);await h.settle({results:[]});h.root().remove();await tick();
 const {w,mods}=h;mods.poll.add=Object.getPrototypeOf(mods.poll).add.bind(mods.poll);mods.poll.remove=Object.getPrototypeOf(mods.poll).remove.bind(mods.poll);mods.poll.queue=[];
const vals={};for(const n of ['config','infra','control','diversion','tailscale','subscription','server'])vals[n]={'.name':n,'.type':'homeproxy'};
Object.assign(vals.config,{main_node:'n1',routing_mode:'bypass_mainland_china',dns_server:'wan',china_dns_server:'wan',tcpip_stack:'mixed'});Object.assign(vals.subscription,{subscription_url:['https://example.invalid/sub#示例订阅']});Object.assign(vals.tailscale,{enabled:'1'});vals.n1={'.name':'n1','.type':'node',type:'socks',label:'测试节点',address:'example.invalid',port:'1080'};vals.s1={'.name':'s1','.type':'server',type:'socks',label:'测试服务',port:'1080',enabled:'1'};
mods.uci.unload('homeproxy');const calls=[];let handler=null;mods.request.post=async(url,req)=>{const [,obj,method]=req.params;calls.push({obj,method});let value;if(handler && (obj==='service'||['current_node_get','tailscale_status'].includes(method))){const held=handler(obj,method);if(held!==undefined)value=await held;}if(value!==undefined){}else if(obj==='uci'&&method==='get')value={values:vals};else if(obj==='uci'&&method==='changes')value={changes:{}};else if(obj==='session')value={access:true};else if(obj==='service')value={homeproxy:{instances:{'sing-box-c':{running:true},'sing-box-s':{running:false}}}};else if(method==='domainlist_read')value={content:'example.org\n'};else if(method==='tailscale_status')value={state:'NeedsLogin'};else value={};return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};};
function load(n,src){src=src||fs.readFileSync(dir+'/'+n.replaceAll('.','/')+'.js','utf8');const deps=[...src.matchAll(/'require ([^';]+)';/g)].map(x=>x[1]);const C=w.Function(...deps.map(x=>x.split(' as ')[1]||x.split('.').at(-1)),src)(...deps.map(x=>mods[x.split(' as ')[0]]));return mods[n]=typeof C==='function'?new C():C;}
mods.network={getHostHints:async()=>({hosts:{}}),getDevices:async()=>[],getNetworks:async()=>[]};mods.firewall={};load('tools.widgets');load('tools.firewall',fs.readFileSync(path.resolve(dir,'../../../../../applications/luci-app-firewall/htdocs/luci-static/resources/tools/firewall.js'),'utf8'));load('homeproxy',fs.readFileSync(base+'/htdocs/luci-static/resources/homeproxy.js','utf8'));mods.homeproxy.getBuiltinFeatures=async()=>({version:'1.14.0',with_quic:true,with_wireguard:true,with_utls:true});
const app=load('page',fs.readFileSync(base+'/htdocs/luci-static/resources/view/homeproxy/'+name+'.js','utf8'));for(let i=0;i<80;i++)await tick();const root=w.document.querySelector('#cbi-homeproxy');assert(root,name+' mounted');const map=mods.dom.findClassInstance(root);
 return {w,mods,app,map,calls,root:()=>w.document.querySelector('#cbi-homeproxy'),polls:()=>mods.poll.queue.map(x=>x.fn),setHandler:f=>handler=f};
}
module.exports={pageBoot,tick};
if(require.main===module){
 const watchdog=setTimeout(()=>{console.error('FAIL lifecycle test stalled');process.exit(1);},15000);
 (async()=>{
 for(const name of ['client','server']) {
  const h=await pageBoot(name);try {
   const expected=name==='client'?2:1,counts=[h.polls().length];
   for(let i=0;i<2;i++){await h.map.reset();await tick();counts.push(h.polls().length);}
   assert.deepEqual(counts,[expected,expected,expected],name+' reset queue');
   // Hold all transport while repeatedly ticking, resetting and leaving/re-entering.
   const held=[];h.setHandler((obj,method)=>new Promise((resolve,reject)=>held.push({obj,method,resolve,reject})));
   const old=[h.root().querySelector('#service_status'),h.root().querySelector('[data-name="_tailscale_status"]')].filter(Boolean),oldHTML=old.map(e=>e.innerHTML),callbacks=h.polls(),requests=callbacks.map(f=>f());await tick();
   const started=held.length;assert.equal(started,name==='client'?3:1);
   for(let i=0;i<3;i++)await Promise.all(h.polls().map(f=>f()));assert.equal(held.length,started,'single flight while suspended');
   await h.map.reset();await tick();const resetHTML=h.root().innerHTML;
   await Promise.all(h.polls().map(f=>f()));assert.equal(held.length,started,'single flight across reset');
   for(const p of held)p.resolve(p.obj==='service'?{homeproxy:{instances:{'sing-box-c':{running:true},'sing-box-s':{running:true}}}}:{state:'NeedsLogin',mode:'urltest',active:{label:'STALE'}});
   await Promise.all(requests);await tick();assert.equal(h.root().innerHTML,resetHTML,'old replies cannot write replacement');assert.deepEqual(old.map(e=>e.innerHTML),oldHTML,'old replies cannot write detached elements');
   held.length=0;const pending=h.polls().map(f=>f());await tick();
   const stale=h.polls();const detached=h.root(),detachedHTML=detached.innerHTML;detached.remove();await tick();assert.equal(h.polls().length,0,name+' detach');
   const fresh=await h.app.render(await h.app.load());h.w.document.querySelector('#view').append(fresh);await tick();
   assert.equal(h.polls().length,expected,'re-entry queue');const freshHTML=h.root().innerHTML;
   await Promise.all(h.polls().map(f=>f()));assert.equal(held.length,started,'single flight across reentry');
   for(const p of held)p.reject(Error('injected stale transport failure'));
   await Promise.all(pending);await tick();assert.equal(detached.innerHTML,detachedHTML);assert.equal(h.root().innerHTML,freshHTML,'stale errors cannot write fresh view');
   h.setHandler(()=>Promise.reject(Error('injected current transport failure')));
   await Promise.all(h.polls().map(f=>f()));assert(h.root().textContent.includes('Status unavailable'),'failure uses unavailable state');
   h.setHandler(null);await Promise.all(h.polls().map(f=>f()));assert(h.root().querySelector('.hp-service-state.'+(name==='client'?'running':'stopped')),'recovers after failed transport');
   h.mods.poll.stop();h.mods.poll.start();h.mods.poll.stop();await tick();assert.equal(h.polls().length,expected,'scheduler stop/start preserves bounded queue');
   h.root().remove();await tick();assert.equal(h.polls().length,0);
   const before=h.calls.length;await Promise.all(stale.map(f=>f()));assert.equal(h.calls.length,before);
   console.log('PASS '+name+' real Map.reset '+JSON.stringify(counts)+'; detach=0 before next tick; held RPC single-flight across reset/reentry; stale success/error ignored; failed transport recovery; poll stop/start; detached callbacks no reads');
  }finally{h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
}
