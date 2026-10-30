'use strict';
// Complete production client + native LuCI forms; private persistent RPC transport.
const assert = require('assert/strict');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');
let stage='matrix';
const watchdog = setTimeout(() => { console.error('FAIL client acceptance stalled at '+stage); process.exit(1); }, 120000);
const clone = value => JSON.parse(JSON.stringify(value));
function response(h, req, value, status = 0) {
 return { ok:true, status:200, json:() => h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0', id:req.id, result:[status,value]})) };
}
function native(h) {
 const option = (key, sid='config') => h.map.lookupOption(key,sid)[0];
 const set = (key, value, sid='config') => {
  const o = option(key, sid); assert(o, key); const widget=o.getUIElement(sid); assert(widget,key+' widget');
  widget.setValue(value); o.triggerValidation(sid); h.map.checkDepends();
 };
 return { option, set, active:(key,sid='config') => option(key,sid).isActive(sid) };
}
async function matrix() {
 const h=await pageBoot('client', {}, {with_gvisor:true});
 try {
  const {set,active}=native(h);let cases=0;
  const defaultValues={routing_mode:'bypass_mainland_china',main_node:'nil',dns_server:'https://dns.quad9.net/dns-query',china_dns_server:'https://dns.alidns.com/dns-query',tcpip_stack:'mixed',ipv6_support:'1',dashboard_enabled:'0',dashboard_port:'9095'};
  const n=native(h);
  for(const [key,value]of Object.entries(defaultValues))assert.equal(n.option(key).default,value,key+' native UI default');
  for(const mode of ['bypass_mainland_china','global']) for(const main of ['nil','n1','urltest']) for(const ipv6 of ['0','1']) for(const ts of ['0','1']) {
   set('routing_mode',mode);set('main_node',main);set('ipv6_support',ipv6);set('enabled',ts,'tailscale');
   assert.equal(active('china_dns_server'),mode==='bypass_mainland_china');
   for(const key of ['main_urltest_nodes','main_urltest_interval','main_urltest_tolerance','main_urltest_interrupt_exist_connections']) assert.equal(active(key),main==='urltest',key);
   for(const key of ['routing_port','tcpip_stack','_control','_diversion','_tailscale'])assert(active(key),key+' configuration remains editable while main node is disabled');
   assert.equal(active('wan_proxy_ipv6_ips','control'),mode==='bypass_mainland_china'&&ipv6==='1');
   assert.equal(active('wan_direct_ipv6_ips','control'),ipv6==='1');
   for(const key of ['auth_key','control_url','hostname','accept_routes','exit_node','exit_node_allow_lan_access','advertise_routes','advertise_exit_node','listen_port'])assert.equal(active(key,'tailscale'),ts==='1',key);
   for(const enabled of ['0','1']) {
    set('dashboard_enabled',enabled);
    for(const key of ['dashboard_port','dashboard_secret'])assert.equal(active(key),enabled==='1',key);
   }
   for(const list of ['0','1']) {
    set('lan_whitelist_mode',list,'control');
    assert.equal(active('lan_whitelist_mode','control'),mode==='bypass_mainland_china');
    assert.equal(active('lan_direct_ipv4_ips','control'),mode==='global'||list==='0');
    assert.equal(active('lan_auto_proxy_ipv4_ips','control'),mode==='bypass_mainland_china'&&list==='1');
   }
   cases++;
  }
  console.log('PASS native client dependency matrix: '+cases+' mode/main/IPv6/Tailscale combinations, dashboard/list subcases');
 } finally {h.w.close();}
}
async function preservation() {
 const initial={
  config:{main_node:'urltest',main_urltest_nodes:['n1'],main_urltest_interval:'137',main_urltest_tolerance:'37',main_urltest_interrupt_exist_connections:'1',dashboard_enabled:'1',dashboard_port:'9195',dashboard_secret:'retained-secret',ipv6_support:'1',china_dns_server:'https://dns.alidns.com/dns-query'},
  control:{lan_whitelist_mode:'1',lan_auto_proxy_ipv4_ips:['192.168.7.2'],lan_proxy_ipv4_ips:['192.168.7.3'],wan_proxy_ipv6_ips:['2001:db8::/48'],wan_direct_ipv6_ips:['2001:db8:1::/48']},
  tailscale:{enabled:'1',auth_key:'tskey-retained',hostname:'retained-router',control_url:'https://control.example.invalid',advertise_routes:['192.168.7.0/24'],listen_port:'41641'}
 };
 const h=await pageBoot('client', {}, {values:initial,resources:[{type:'dashboard',installed:true}]});
 // Native view footer handlers locate Maps beneath maincontent in the real shell.
 h.w.document.querySelector('#view').parentElement.id='maincontent';
 try {
  const persisted=clone(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s])));
  const lists={direct:'direct.example\n',proxy:'proxy.example\n'};
  const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{
   const [,object,method,p]=req.params;
   if(object==='uci'&&method==='get')return response(h,req,{values:persisted});
   if(object==='uci'&&method==='set'){Object.assign(persisted[p.section],clone(p.values));return response(h,req,{});}
   if(object==='uci'&&method==='delete'){for(const key of p.options||[])delete persisted[p.section][key];return response(h,req,{});}
   if(method==='domainlist_read')return response(h,req,{content:lists[p.id]||''});
   if(method==='domainlist_write'){Object.assign(lists,clone(p.lists));return response(h,req,{result:true});}
   return post(url,req);
  };
  stage='preservation load/reset';await h.map.load();await h.map.reset();
  let n=native(h);
  n.set('main_urltest_interval','149');n.set('dashboard_port','9295');n.set('hostname','unsaved-router','tailscale');
  n.set('main_node','n1');n.set('dashboard_enabled','0');n.set('enabled','0','tailscale');n.set('routing_mode','global');n.set('ipv6_support','0');
  n.set('main_node','urltest');n.set('dashboard_enabled','1');n.set('enabled','1','tailscale');n.set('routing_mode','bypass_mainland_china');n.set('ipv6_support','1');
  assert.equal(n.option('main_urltest_interval').formvalue('config'),'149');
  assert.equal(n.option('dashboard_port').formvalue('config'),'9295');
  assert.equal(n.option('hostname','tailscale').formvalue('tailscale'),'unsaved-router');
  // Hide after editing, then save the entire form through native parse/save/load/render.
  n.set('main_node','n1');n.set('dashboard_enabled','0');n.set('enabled','0','tailscale');n.set('routing_mode','global');n.set('ipv6_support','0');
  stage='preservation full save';await h.map.save(null,true);
  for(const [sid,values] of Object.entries(initial))for(const [key,value]of Object.entries(values)) {
   if(['main_node','dashboard_enabled','enabled','routing_mode','ipv6_support'].includes(key))continue;
   assert.deepEqual(persisted[sid][key],value,'hidden persisted '+sid+'.'+key+' retained');
  }
  await h.map.load();await h.map.reset();n=native(h);
  n.set('main_node','urltest');n.set('dashboard_enabled','1');n.set('enabled','1','tailscale');n.set('routing_mode','bypass_mainland_china');n.set('ipv6_support','1');
  for(const [key,value]of Object.entries({main_urltest_interval:'137',dashboard_port:'9195'}))assert.equal(n.option(key).formvalue('config'),value,'reloaded hidden '+key);
  n.set('routing_port','70000');await assert.rejects(h.map.save(null,true),/invalid/i,'native save rejects invalid port');
  n.set('routing_port','53,80,443,1000-2000');n.set('tcpip_stack','system');n.set('dns_server','https://dns.google/dns-query');
  await h.map.save(null,true);
  assert.equal(persisted.config.routing_port,'53,80,443,1000-2000');assert.equal(persisted.config.tcpip_stack,'system');
  await h.app.handleReset();await tick();
  assert.equal(native(h).option('dns_server').formvalue('config'),'https://dns.google/dns-query');
  h.root().remove();await tick();h.w.document.querySelector('#view').append(await h.app.render(await h.app.load()));await tick();
  h.map=h.mods.dom.findClassInstance(h.root());
  assert.equal(native(h).option('dns_server').formvalue('config'),'https://dns.google/dns-query');
  console.log('PASS native client Map.save/load/reset/reentry: hidden persisted UCI, unsaved switch-back values, invalid routing ports, stack/DNS persistence');
 } finally {h.w.close();}
}
async function applyBoundary(outcome='success') {
 stage='native Save & Apply '+outcome;
 const h=await pageBoot('client', {}, {values:{tailscale:{enabled:'0'}}});
 h.w.document.querySelector('#view').parentElement.id='maincontent';
 try {
  const persisted=clone(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s])));
  const post=h.mods.request.post, events=[],saveReleases=[];let releaseApply, releaseConfirm;
  Object.assign(h.w.env,{apply_rollback:30,apply_holdoff:0,apply_timeout:5,apply_display:30});
  h.mods.request.post=async(url,req)=>{
   const [,object,method,p]=req.params;
   if(object==='uci'&&method==='get')return response(h,req,{values:persisted});
   if(object==='uci'&&method==='set'){
    events.push('save:'+p.section);await new Promise(r=>saveReleases.push(r));
    if(outcome==='save-failure')return response(h,req,{},6);
    Object.assign(persisted[p.section],clone(p.values));return response(h,req,{});
   }
   if(object==='uci'&&method==='delete'){for(const key of p.options||[])delete persisted[p.section][key];return response(h,req,{});}
   if(method==='domainlist_read')return response(h,req,{content:p.id==='direct'?'direct.example\n':'proxy.example\n'});
   if(method==='domainlist_write')return response(h,req,{result:true});
   return post(url,req);
  };
  // Keep the actual LuCI view/ui.changes apply and confirmation implementation.
  h.mods.request.request=async(url,options)=>{
   if(url.endsWith('/apply_unchecked')) {events.push('apply');await new Promise(r=>releaseApply=r);return {status:outcome==='apply-failure'?500:204,json:()=>null};}
   if(url.endsWith('/confirm')) {events.push('confirm');await new Promise(r=>releaseConfirm=r);return {status:204};}
   throw Error('unexpected native HTTP boundary '+url);
  };
  async function until(check,message){const deadline=performance.now()+5000;while(!check()){assert(performance.now()<deadline,message);await new Promise(r=>setTimeout(r,5));}}
  let applied=0;h.w.document.addEventListener('uci-applied',()=>applied++);
  native(h).set('routing_port','70000');
  await assert.rejects(h.app.handleSaveApply(null,'1'),/invalid/i,'invalid native form cannot reach apply');
  assert.equal(events.length,0);native(h).set('routing_port','common');
  native(h).set('dns_server','https://dns.google/dns-query');
  const save=h.app.handleSaveApply(null,'1');
  await until(()=>saveReleases.length,'real Map.save reached held uci.set');
  assert(events.every(e=>e.startsWith('save:')),'apply cannot start while native save is held');
  if(outcome==='save-failure') {
   const failed=assert.rejects(save,/RPC|status|denied/i);saveReleases.forEach(r=>r());await failed;
   assert(events.every(e=>e.startsWith('save:')));assert.equal(applied,0);
   console.log('PASS native Save & Apply: rejected UCI save aborts before HTTP apply');return;
  }
  saveReleases.forEach(r=>r());await save;await until(()=>releaseApply,'native HTTP apply starts after save');
  assert.equal(persisted.config.dns_server,'https://dns.google/dns-query');assert.equal(applied,0);
  releaseApply();
  if(outcome==='apply-failure') {
   await until(()=>/Apply request failed/.test(h.w.document.body.textContent),'native apply failure displayed');
   assert.equal(events.includes('confirm'),false);assert.equal(applied,0);
   console.log('PASS native Save & Apply: failed HTTP apply does not confirm or dispatch applied');return;
  }
  await until(()=>releaseConfirm,'native delayed confirmation starts');assert.equal(applied,0,'held confirm must not dispatch applied');
  releaseConfirm();await until(()=>applied===1,'native applied event');
  assert.deepEqual(events.slice(-2),['apply','confirm']);
  assert(events.slice(0,-2).every(e=>e.startsWith('save:')));
  assert.equal(h.calls.filter(c=>['resources_update','dashboard_manage'].includes(c.method)).length,0,'footer save/apply never downloads resources');
  console.log('PASS native client footer Map.save → HTTP apply → delayed confirm → uci-applied; held save/confirm block progression');
 }finally{h.w.close();}
}
(async()=>{await matrix();await preservation();for(const outcome of ['success','save-failure','apply-failure'])await applyBoundary(outcome);})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
