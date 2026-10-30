'use strict';
const assert=require('assert/strict');
const {pageBoot,tick}=require('../../tests/helpers/test_page_lifecycle.cjs');
async function until(check, message) {
 const deadline=performance.now()+3000;
 while(!check()) { assert(performance.now()<deadline,message); await new Promise(r=>setTimeout(r,5)); }
}
function response(h,req,value) {
 return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
}
(async()=>{
 const h=await pageBoot('client');
 try {
  const dashboard=()=>h.root().querySelector('[data-name="_dashboard_resources"]');
  assert(dashboard(),'dashboard management belongs beside its client settings');
  assert.match(dashboard().textContent,/Status unavailable/,'unknown never becomes absent');
  assert.equal(h.root().querySelector('[data-name="_open_dashboard"]'),null,'one management/open location');
  const option=n=>h.map.lookupOption(n,'config')[0];
  const field=n=>h.root().querySelector('[data-name="'+n+'"]');
  assert.equal(field('dashboard_port').classList.contains('hidden'),true,'disabled dashboard details fully hidden');
  assert.equal(field('dashboard_secret').classList.contains('hidden'),true);
  assert.equal(option('dashboard_port').retain,true);assert.equal(option('dashboard_secret').retain,true);
  const widget=option('dashboard_enabled').getUIElement('config');widget.setValue('1');h.map.checkDepends();
  assert.equal(field('dashboard_port').classList.contains('hidden'),false);
  assert.equal(field('dashboard_secret').classList.contains('hidden'),false);
  assert.equal(h.root().querySelector('.cbi-tabmenu li[data-tab="advanced"]')!=null,true,'one native advanced tab');
  for(const n of ['main_urltest_interval','main_urltest_tolerance','main_urltest_interrupt_exist_connections','routing_port','tcpip_stack'])
   assert.equal(option(n).tab,'advanced',n+' in advanced settings');
  // Access lists use one native form, rather than an additional nested tab bar.
  assert.equal(h.root().querySelector('[data-name="_control"] .cbi-tabmenu'),null,'access control nested navigation removed');
  const diversion=h.root().querySelector('[data-name="_diversion"]');
  assert.equal(diversion.querySelectorAll('.cbi-tabmenu > li').length,2,'built-in lists share one tab; group table remains separate');
  const nativeTabs=[...h.root().querySelectorAll('.cbi-tabmenu > li')].filter(li=>li.closest('[data-name="_diversion"]')===null);
  assert.deepEqual(nativeTabs.map(li=>li.dataset.tab),['routing','dashboard','control','diversion','tailscale','advanced'],'six native client tabs');
  const routing=option('routing_mode').getUIElement('config');
  routing.setValue('global');h.map.checkDepends();
  assert.equal(field('_control').classList.contains('hidden'),false);
  const wan=()=>[...field('_control').querySelectorAll('h4')].find(el=>el.textContent==='WAN IP Policy');
  assert(wan(),'WAN heading exists in native form');
  routing.setValue('bypass_mainland_china');h.map.checkDepends();
  await h.map.reset();await tick();assert(dashboard());
  const dirty=option('dns_server').getUIElement('config');dirty.setValue('https://dns.google/dns-query');
  const originalRoot=h.root();
  const post=h.mods.request.post;
  const resources=[{type:'dashboard',installed:false}];let pending,writes=0;
  h.mods.request.post=async(url,req)=>{
   if(req.params[2]==='resources_get')return response(h,req,{resources});
   if(req.params[2]==='dashboard_manage') { writes++;return response(h,req,await new Promise(r=>pending=r)); }
   return post(url,req);
  };
  dashboard().querySelector('button').click();
  await until(()=>/Download/.test(dashboard().textContent),'resource retry settles');
  assert.equal(h.root(),originalRoot,'retry must not recreate the Map');
  assert.equal(dirty.getValue(),'https://dns.google/dns-query','resource retry retains unsaved settings');
  assert.equal(option('dns_server').getUIElement('config'),dirty,'native input widget is unchanged');
  for(const button of dashboard().querySelectorAll('button'))assert.equal(button.type,'button','resource controls must not submit the native form');
  dashboard().querySelector('button').click();await until(()=>writes===1,'download starts');
  assert(dashboard().querySelector('button').disabled,'resource action holds lock');
  assert.equal(dirty.getValue(),'https://dns.google/dns-query');
  resources[0].installed=true;resources[0].version='20261030000000';pending({status:0});
  await until(()=>/Remove/.test(dashboard().textContent),'download refresh settles');
  assert.equal(h.root(),originalRoot,'write refresh must not recreate the Map');
  assert.equal(option('dns_server').getUIElement('config'),dirty);
  assert.equal(dirty.getValue(),'https://dns.google/dns-query','resource write retains unsaved edits');
  assert.match(dashboard().textContent,/Downloaded|20261030000000/);
  console.log('PASS client: six native tabs; consolidated dashboard; hidden+retained values; advanced settings; untabbed access; two diversion tabs; retry/write preserve dirty native inputs');
 } finally {h.w.close();}
 const race=await pageBoot('client',{}, {resources:[{type:'dashboard',installed:false}]});
 try {
  const dashboard=()=>race.root().querySelector('[data-name="_dashboard_resources"]');
  const post=race.mods.request.post;
  let finishWrite,finishReset,holdReset=false,installed=false;
  race.mods.request.post=async(url,req)=>{
   if(req.params[2]==='dashboard_manage')return response(race,req,await new Promise(r=>finishWrite=r));
   if(req.params[2]==='resources_get') {
    if(holdReset) {holdReset=false;return response(race,req,await new Promise(r=>finishReset=r));}
    return response(race,req,{resources:[{type:'dashboard',installed}]});
   }
   return post(url,req);
  };
  dashboard().querySelector('button').click();await until(()=>finishWrite,'held dashboard mutation starts');
  holdReset=true;const reset=race.map.reset();await until(()=>finishReset,'reset has an old status request');
  installed=true;finishWrite({status:0});
  await until(()=>/Remove/.test(dashboard().textContent),'mutation refresh has current installed status');
  finishReset({resources:[{type:'dashboard',installed:false}]});await reset;await tick();
  assert.match(dashboard().textContent,/Remove/,'reset status read started before mutation cannot replace newer installed state');
  console.log('PASS resource race: held pre-mutation status across native reset cannot replace post-write installed state');
 } finally {race.w.close();}
 const ro=await pageBoot('client',{}, {readonly:true});
 try {
  const dashboard=()=>ro.root().querySelector('[data-name="_dashboard_resources"]');
  assert(!dashboard().querySelector('button').disabled,'readonly status retry remains available');
  const post=ro.mods.request.post;
  ro.mods.request.post=async(url,req)=>req.params[2]==='resources_get' ? response(ro,req,{resources:[{type:'dashboard',installed:false}]}) : post(url,req);
  dashboard().querySelector('button').click();await until(()=>/Download/.test(dashboard().textContent),'readonly retry recovers status');
  assert(dashboard().querySelector('button').disabled,'readonly cannot download dashboard');
  dashboard().querySelector('button').click();await tick();
  assert.equal(ro.calls.filter(c=>['dashboard_manage','resources_update'].includes(c.method)).length,0,'readonly sends no mutation RPC');
  console.log('PASS client readonly: status retry available, recovered mutation controls remain disabled');
 } finally {ro.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
