// Real LuCI form/DOM/UI/RPC; only transport and log reads are fixtures.
const fs = require('fs'), assert = require('assert/strict'), { JSDOM } = require('jsdom');
const dir = process.env.LUCI_RESOURCE_DIR;
const tick = () => new Promise(r => setImmediate(r));
async function boot() {
 const j = new JSDOM('<body><div id="view"></div></body>', { url:'http://localhost/', runScripts:'outside-only' }), w=j.window;
 // Do not let cbi.js request its unrelated startup module over the network.
 const add=w.document.addEventListener.bind(w.document);
 w.document.addEventListener=(type,...args)=>type==='DOMContentLoaded'?undefined:add(type,...args);
 w.eval(fs.readFileSync(dir+'/cbi.js','utf8'));
 w.document.addEventListener=add;
 w.eval(fs.readFileSync(dir+'/luci.js','utf8').replace(/window\.LuCI\s*=\s*LuCI;/, 'window.LuCI = LuCI; window.mods=classes; window.env=env;'));
 const mods=w.mods, L=w.L=Object.create(w.LuCI.prototype);
 Object.assign(w.env,{resource:'/luci-static/resources',scriptname:'/cgi-bin/luci',sessionid:'fixture',pollinterval:5});
 L.require=n=>Promise.resolve(mods[n]); L.hasViewPermission=()=>true; L.loaded=true; w.E=mods.dom.create.bind(mods.dom);
 const calls=[], pending=[];
 mods.request.post=async(url,req)=>{
  const [,object,method,p]=req.params; calls.push({object,method,p}); let result;
  if(object==='uci'&&method==='get')result=[0,{values:{config:{'.name':'config','.type':'homeproxy',log_level:'warn'},server:{'.name':'server','.type':'server'}}}];
  else if(object==='uci'&&method==='changes')result=[0,{changes:{}}];
  else if(object==='session')result=[0,{access:true}];
  else if(method==='resources_get')result=[0,{resources:[]}];
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
 mods.ui.addNotification=()=>{};
 const app=load('app',fs.readFileSync(process.env.HOMEPROXY_STATUS_JS||__dirname+'/../htdocs/luci-static/resources/view/homeproxy/status.js','utf8'));
 for(let i=0;i<40&&!w.document.querySelector('.homeproxy-status');i++)await tick();await tick();
 const root=()=>w.document.querySelector('.homeproxy-status');assert(root(),'real view mounted');
 const button=text=>[...root().querySelectorAll('button')].find(x=>x.textContent===text);
 const row=()=>root().querySelector('table').rows[1];
 return {j,w,mods,app,polls:()=>mods.poll.queue.map(e=>e.fn),calls,pending,root,button,row,count:()=>calls.filter(x=>x.method==='connection_check').length,async settle(payload){pending.shift().resolve([0,payload]);await tick();await tick();}};
}
(async()=>{
 const h=await boot();try {
  await h.settle({results:[{site:'baidu',result:true,latency_ms:0}]});
  let reads=0;
  h.mods.fs.read_direct=async()=>{reads++;return 'current log';};
  const map=h.mods.dom.findClassInstance(h.root().querySelector('#cbi-homeproxy'));
  const counts=[h.polls().length];
  for(let i=0;i<3;i++){await map.reset();await tick();counts.push(h.polls().length);}
  assert.deepEqual(counts,[3,3,3,3],'real Map.reset must replace rather than accumulate log polls');
  assert.equal(h.root().querySelectorAll('textarea').length,3);
  h.button('Update all').click();await tick();await tick();
  assert.equal(h.polls().length,3,'resource update uses real Map.reset');
  assert.equal(h.count(),1);assert.match(h.row().textContent,/Success0 ms/);
  await Promise.all(h.polls().map(f=>f()));assert.equal(reads,3);
  const old=[...h.root().querySelectorAll('textarea')], before=old.map(t=>t.value);
  const held=[];h.mods.fs.read_direct=()=>{reads++;return new Promise((resolve,reject)=>held.push({resolve,reject}));};
  const stale=h.polls(), requests=stale.map(f=>f());
  await map.reset();await tick();assert.equal(h.polls().length,3);
  held[0].resolve('stale reset success');held[1].reject(Error('NotFoundError'));held[2].reject(Error('stale reset error'));
  await Promise.all(requests);assert.deepEqual(old.map(t=>t.value),before,'reset rejects all old replies');
  const detached=[...h.root().querySelectorAll('textarea')], detachedBefore=detached.map(t=>t.value);
  held.length=0;const callbacks=h.polls(), inFlight=callbacks.map(f=>f());
  h.root().remove();await tick();assert.equal(h.polls().length,0,'detach removes polls without another poll tick');
  held[0].resolve('stale detach success');held[1].reject(Error('NotFoundError'));held[2].reject(Error('stale detach error'));
  await Promise.all(inFlight);assert.deepEqual(detached.map(t=>t.value),detachedBefore,'detach rejects success and error replies');
  const readCount=reads;await Promise.all([...stale,...callbacks].map(f=>f()));assert.equal(reads,readCount,'saved detached callbacks cannot read');
  const fresh=await h.app.render();h.w.document.querySelector('#view').append(fresh);await tick();
  assert.equal(h.polls().length,3,'reentry registers exactly three fresh polls');await h.settle({results:[]});
  h.root().remove();await tick();assert.equal(h.polls().length,0);
  console.log('PASS real LuCI view/form.Map.reset/DOM/RPC/poll: counts '+JSON.stringify(counts)+'; resource reset; detach queue=0 before next tick; stale success/errors ignored; saved callbacks read=0; reentry=3; connection session retained');
 } finally {h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
