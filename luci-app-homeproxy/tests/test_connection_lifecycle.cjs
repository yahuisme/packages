// Real LuCI form/DOM/UI/RPC; only transport and log reads are fixtures.
const fs = require('fs'), assert = require('assert/strict'), { JSDOM } = require('jsdom');
const dir = process.env.LUCI_RESOURCE_DIR;
const tick = () => new Promise(r => setImmediate(r));
async function boot(resources = [], translations = {}) {
 const j = new JSDOM('<body><div id="view"></div></body>', { url:'http://localhost/', runScripts:'outside-only' }), w=j.window;
 // Do not let cbi.js request its unrelated startup module over the network.
 const add=w.document.addEventListener.bind(w.document);
 w.document.addEventListener=(type,...args)=>type==='DOMContentLoaded'?undefined:add(type,...args);
 w.eval(fs.readFileSync(dir+'/cbi.js','utf8'));
 w.TR = {};
 for(const [key,value] of Object.entries(translations)) w.TR[w.sfh(key.trim().replace(/\s+/g,' '))]=value;
 w.document.addEventListener=add;
 w.eval(fs.readFileSync(dir+'/luci.js','utf8').replace(/window\.LuCI\s*=\s*LuCI;/, 'window.LuCI = LuCI; window.mods=classes; window.env=env;'));
 const mods=w.mods, L=w.L=Object.create(w.LuCI.prototype);
 Object.assign(w.env,{resource:'/luci-static/resources',scriptname:'/cgi-bin/luci',sessionid:'fixture',pollinterval:5});
 L.require=n=>Promise.resolve(mods[n]); L.hasViewPermission=()=>true; L.loaded=true; w.E=mods.dom.create.bind(mods.dom);
 const calls=[], pending=[], polls=[];
 mods.request.post=async(url,req)=>{
  const [,object,method,p]=req.params; calls.push({object,method,p}); let result;
  if(object==='uci'&&method==='get')result=[0,{values:{config:{'.name':'config','.type':'homeproxy',log_level:'warn'},server:{'.name':'server','.type':'server'}}}];
  else if(object==='uci'&&method==='changes')result=[0,{changes:{}}];
  else if(object==='session')result=[0,{access:true}];
  else if(method==='resources_get')result=[0,{resources}];
  else if(method==='resources_update')result=[0,{status:3}];
  else if(method==='connection_check')result=await new Promise((resolve,reject)=>pending.push({resolve,reject}));
  else throw Error('Unexpected RPC '+object+'/'+method);
  return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result}))};
 };
 function load(name,src=fs.readFileSync(dir+'/'+name+'.js','utf8')) {
  const deps=[...src.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);
  const C=w.Function(...deps.map(x=>x.split(' as ')[1]||x.split('.').at(-1)),src)(...deps.map(x=>mods[x.split(' as ')[0]]));
  return mods[name]=typeof C==='function'?new C():C;
 }
 load('rpc');load('uci');mods.fs={read_direct:async()=>''};load('validation');load('ui');L.ui=mods.ui;load('form');
 mods.ui.addNotification=()=>{};mods.poll.add=f=>polls.push(f);
 mods.poll.remove=f=>{const i=polls.indexOf(f);if(i>=0)polls.splice(i,1);};
 const app=load('app',fs.readFileSync(process.env.HOMEPROXY_STATUS_JS||__dirname+'/../htdocs/luci-static/resources/view/homeproxy/status.js','utf8'));
 for(let i=0;i<40&&!w.document.querySelector('.homeproxy-status');i++)await tick();await tick();
 const root=()=>w.document.querySelector('.homeproxy-status');assert(root(),'real view mounted');
 const button=text=>[...root().querySelectorAll('button')].find(x=>x.textContent===w._(text));
 const row=()=>root().querySelector('table').rows[1];
 return {j,w,mods,app,polls,calls,pending,root,button,row,count:()=>calls.filter(x=>x.method==='connection_check').length,async settle(payload){pending.shift().resolve([0,payload]);await tick();await tick();}};
}
module.exports = { boot, tick };
if (require.main === module) (async()=>{
 const h=await boot();try {
  if(process.argv.includes('--repro-reset')) {
   h.button('Test all').click();await tick();await h.settle({results:[{site:'baidu',result:true,latency_ms:18}]});
   assert.match(h.row().textContent,/18 ms/);h.button('Update all').click();await tick();await tick();
   assert.match(h.row().textContent,/18 ms/,'resource Map.reset must retain results');return;
  }
  assert.equal(h.count(),1,'mount must automatically run exactly once');
  h.button('Test all').click();assert.equal(h.count(),1,'manual/auto single flight');
  await h.settle({results:[{site:'baidu',result:true,latency_ms:0}]});assert.match(h.row().textContent,/Success0 ms/);
  for(const p of h.polls)await p();assert.equal(h.count(),1,'poll must not retest');
  h.button('Update all').click();await tick();await tick();assert.match(h.row().textContent,/Success0 ms/);assert.equal(h.count(),1);
  const map=h.mods.dom.findClassInstance(h.root().querySelector('#cbi-homeproxy'));
  await map.reset();await map.reset();assert.match(h.row().textContent,/Success0 ms/);assert.equal(h.count(),1);
  assert.equal(await h.app.render(),h.root(),'repeat view render reuses current root');assert.equal(h.count(),1);
  for(const payload of [{results:null},{results:{}},{results:[null,{site:'baidu',result:'true',latency_ms:5}]}]) {
   h.button('Test all').click();await tick();await h.settle(payload);assert.match(h.row().textContent,/Failed-/);assert(!h.button('Test all').disabled);
  }
  h.button('Test all').click();await tick();h.pending.shift().resolve([6]);await tick();await tick();assert.match(h.row().textContent,/Failed-/);
  h.button('Test all').click();await tick();h.pending.shift().reject(Error('transport failure'));await tick();await tick();assert.match(h.row().textContent,/Failed-/);
  const setTimeout=h.w.setTimeout;let expire;
  h.w.setTimeout=(fn,ms)=>ms===10000?(expire=fn,123):setTimeout.call(h.w,fn,ms);
  h.button('Test all').click();await tick();expire();assert.match(h.row().textContent,/Timed out-/);assert(h.button('Test all').disabled);
  const timeoutCount=h.count();await map.reset();h.button('Test all').click();assert.equal(h.count(),timeoutCount);
  await h.settle({results:[{site:'baidu',result:true,latency_ms:88}]});assert.match(h.row().textContent,/Timed out-/);assert(!h.button('Test all').disabled);
  h.w.setTimeout=setTimeout;
  const beforeManual=h.count();
  h.button('Test all').click();await tick();assert.equal(h.count(),beforeManual+1);assert.match(h.row().textContent,/Testing/);
  await map.reset();assert(h.button('Test all').disabled);assert.match(h.row().textContent,/Testing/);
  await h.settle({results:[{site:'baidu',result:false,latency_ms:55}]});assert.match(h.row().textContent,/Failed-/);
  h.button('Test all').click();await tick();const old=h.root(),before=old.textContent;old.remove();await tick();
  await h.settle({results:[{site:'baidu',result:true,latency_ms:99}]});assert.equal(old.textContent,before,'detached reply must not write');
  const prior=h.count(), fresh=await h.app.render();h.w.document.querySelector('#view').append(fresh);await tick();assert.equal(h.count(),prior+1,'re-enter starts a fresh test');
  await h.settle({results:[]});
  console.log('PASS real LuCI mount auto-once, manual single-flight, poll independence, resource/reset retention, in-flight reset and detached reply');
 } finally {h.j.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
