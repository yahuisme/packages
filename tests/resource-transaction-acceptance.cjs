'use strict';
// Real LuCI RPC validation, shared module and DOM, isolated transport only.
const assert=require('assert/strict');
const fs=require('fs'),path=require('path');
const {pageBoot,tick}=require('./helpers/test_page_lifecycle.cjs');
const watchdog=setTimeout(()=>{console.error('FAIL resource acceptance stalled');process.exit(1);},30000);
const response=(h,req,value,status=0)=>({ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[status,value]}))});
async function until(check,message){const end=performance.now()+5000;while(!check()){assert(performance.now()<end,message);await new Promise(r=>setTimeout(r,5));}}
async function panelLinkage(){
 const h=await pageBoot('client',{}, {values:{config:{dashboard_enabled:'0',dashboard_port:'9195'}},resources:[{type:'dashboard',installed:true}]});
 try {
  const dashboard=()=>h.root().querySelector('[data-name="_dashboard_resources"]');
  const button=()=>[...dashboard().querySelectorAll('button')].find(b=>b.textContent==='Open dashboard');
  assert.equal(button(),undefined,'disabled dashboard has no open action');
  const o=h.map.lookupOption('dashboard_enabled','config')[0];o.getUIElement('config').setValue('1');h.map.checkDepends();
  assert.equal(button(),undefined,'unsaved enable does not claim the running dashboard is enabled');
  assert.equal(h.mods.uci.get('homeproxy','config','dashboard_enabled'),'0','toggle remains an unsaved native form edit');
  const post=h.mods.request.post;let resources=[{type:'dashboard',installed:true}],opens=[];
  h.mods.request.post=async(url,req)=>req.params[2]==='resources_get'?response(h,req,{resources}):post(url,req);
  h.w.open=(...args)=>opens.push(args);
  h.mods.uci.set('homeproxy','config','dashboard_enabled','1');await h.map.reset();await tick();
  assert(button(),'saved enabled dashboard exposes exactly one open button');
  assert.equal([...h.root().querySelectorAll('button')].filter(b=>b.textContent==='Open dashboard').length,1);
  const port=h.map.lookupOption('dashboard_port','config')[0];port.getUIElement('config').setValue('9295');
  button().click();await until(()=>opens.length===1,'open rechecks installed status');
  assert.equal(opens[0][0],'http://localhost:9195/dashboard/','open uses configured port while unsaved port edits remain dirty');
  assert.equal(port.formvalue('config'),'9295');
  resources=[{type:'dashboard',installed:false}];button().click();await tick();await tick();assert.equal(opens.length,1,'removed files cannot open a stale dashboard');
  console.log('PASS dashboard linkage: disabled/unsaved enable, one Open beside settings, saved port vs dirty input, fresh installed check');
 }finally{h.w.close();}
}
function loadView(h,name){
 const source=fs.readFileSync(path.join(process.env.PACKAGES_ROOT,'luci-app-homeproxy/htdocs/luci-static/resources/view/homeproxy/'+name+'.js'),'utf8');
 const deps=[...source.matchAll(/'require ([^';]+)';/g)].map(m=>m[1].split(' as '));
 const C=h.w.Function(...deps.map(([n,a])=>a||n.split('.').at(-1)),source)(...deps.map(([n])=>h.mods[n]));
 return typeof C==='function'?new C():C;
}
async function routeTransaction(){
 const h=await pageBoot('client',{}, {resources:[{type:'dashboard',installed:false}]});
 try {
  const post=h.mods.request.post;let finishWrite,finishOld,holdOld=false,installed=false,writes=0;const scopes=[];
  h.mods.request.post=async(url,req)=>{
   const method=req.params[2];
   if(method==='dashboard_manage'){writes++;return response(h,req,await new Promise(r=>finishWrite=r));}
   if(method==='resources_update'){scopes.push(req.params[3].scope);return response(h,req,{status:3,resources:[{type:'geoip_cn',status:3},{type:'geosite_cn',status:3}]});}
   if(method==='resources_get'){
    if(holdOld){holdOld=false;return response(h,req,await new Promise(r=>finishOld=r));}
    return response(h,req,{resources:[{type:'dashboard',installed,version:installed?'20261030000000':null}]});
   }
   if(method==='connection_check')return response(h,req,{results:[]});
   return post(url,req);
  };
  h.root().querySelector('[data-name="_dashboard_resources"] button').click();await until(()=>finishWrite,'write started');
  const detached=h.root();detached.remove();await tick();
  // Enter the actual Status route while the Client mutation is held.
  const status=loadView(h,'status');
  await until(()=>h.root()&&h.root().querySelector('.hp-resources'),'actual Status route mounts during held Client mutation');
  assert([...h.root().querySelectorAll('.hp-resources button')].every(b=>b.disabled),'attached Status observes the Client mutation lock');
  h.root().querySelector('.hp-resources button').click();await tick();assert.equal(scopes.length,0,'route change cannot bypass shared lock');
  holdOld=true;const statusMap=h.mods.dom.findClassInstance(h.root());const reset=statusMap.reset();
  await until(()=>finishOld,'replacement Status reset has held old read');
  installed=true;finishWrite({status:0});await tick();finishOld({resources:[{type:'dashboard',installed:false}]});await reset;
  await until(()=>h.root()&&h.root().querySelector('.hp-resources'),'new route renders');await tick();
  // A Status top update must still use backend-selected manual scope, regardless
  // of its displayed rows or whether Dashboard was installed after entry.
  const top=()=>[...h.root().querySelectorAll('button')].find(b=>b.textContent==='Update resources');
  await until(()=>!top().disabled,'shared lock releases on attached route');top().click();await until(()=>scopes.length===1&&!top().disabled,'manual transaction settled');
  assert.deepEqual(scopes,['manual']);
  h.root().remove();await tick();h.w.document.querySelector('#view').append(await h.app.render(await h.app.load()));await tick();
  assert.match(h.root().querySelector('[data-name="_dashboard_resources"]').textContent,/Remove/,'reentered client reads current installation');
  assert.match(h.root().querySelector('[data-name="_dashboard_resources"]').textContent,/20261030000000/);
  assert.equal(writes,1,'one mutation across detach/route/reentry');
  assert.equal(detached.isConnected,false);
  console.log('PASS resource route transaction: detached Client write, held Status read, session lock, manual backend scope, current Client reentry');
 }finally{h.w.close();}
}
(async()=>{
 await panelLinkage();await routeTransaction();
 const h=await pageBoot('client',{}, {resources:[{type:'dashboard',installed:false}]});
 try {
  const rules=h.map.section(h.mods.form.NamedSection,'config','homeproxy');
  const option=rules.option(h.mods.form.DummyValue,'_acceptance_rules');
  option.render= function(){return h.mods['homeproxy.resources'].render(this,['geoip_cn','geosite_cn']);};
  await h.map.reset();await tick();
  const post=h.mods.request.post;let started=0;
  h.mods.request.post=async(url,req)=>{
   if(['dashboard_manage','resources_update'].includes(req.params[2])){started++;return response(h,req,{status:0},6);}
   return post(url,req);
  };
  const dashboard=()=>h.root().querySelector('[data-name="_dashboard_resources"]');
  dashboard().querySelector('button').click();
  await until(()=>started===1&&!dashboard().querySelector('button').disabled,'dashboard failed RPC settles');
  assert.equal(dashboard().querySelector('.hp-resource-result').dataset.status,'error','nonzero ubus status must outrank a success-looking payload');
  const rule=()=>h.root().querySelector('[data-name="_acceptance_rules"]')||h.root().querySelectorAll('.hp-resources')[1];
  [...rule().querySelectorAll('button')].find(b=>b.textContent==='Update').click();
  await until(()=>started===2&&[...rule().querySelectorAll('button')].every(b=>!b.disabled),'rule failed RPC settles');
  assert.equal(rule().querySelector('.hp-resource-result').dataset.status,'error','resource update also fails closed on nonzero ubus');
  console.log('PASS native resource RPC boundary: nonzero ubus status never becomes dashboard/rule success');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
