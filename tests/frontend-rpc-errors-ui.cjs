'use strict';
// Actual rpc.js dispatcher receives contradictory [nonzero, success payload].
// Only HTTP/UCI/file boundaries are private fixtures, not real router operations.
const assert=require('assert/strict');
const fs=require('fs'),path=require('path');
const {pageBoot,tick}=require('./helpers/test_page_lifecycle.cjs');
const {boot}=require('./helpers/test_connection_lifecycle.cjs');
const {walk,FEATURES}=require('./homeproxy-editor-parity.cjs');
const response=(h,req,value,status=0)=>({ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[status,value]}))});
async function until(f){const end=performance.now()+4000;while(!f()){assert(performance.now()<end,'RPC UI settled');await new Promise(r=>setTimeout(r,5));}}
async function editor(name,translations={}) {
 const sid=name==='node'?'n1':'s1',h=await pageBoot(name,translations);
 h.root().remove();h.w.document.querySelector('#view').append(await h.app.render(['homeproxy',FEATURES]));h.map=h.mods.dom.findClassInstance(h.root());
 for(const [key,value] of Object.entries({type:'vless',tls:'1',tls_cert_path:name==='node'?'/etc/homeproxy/certs/client_ca.pem':'/etc/homeproxy/certs/server_publickey.pem',tls_self_sign:'1'}))h.mods.uci.set('homeproxy',sid,key,value);
 await h.map.load();await h.map.reset();
 const grid=walk(h.map).find(o=>o.option==='type'&&o.section.sectiontype===name).section;
 await grid.renderMoreOptionsModal(sid);
 const modal=grid.getActiveModalMap(),map=h.mods.dom.findClassInstance(modal);
 return Object.assign(h,{sid,modal,modalMap:map,fields:walk(map)});
}
async function upload() {
 for(const name of ['node','server']) {
  const h=await editor(name);
  try {
   const upload=h.fields.find(o=>o.option==='_upload_cert'),notes=[];let calls=0;
   assert(upload.isActive(h.sid),'upload is reachable in the native TLS editor');
   h.mods.ui.addNotification=(_title,body)=>notes.push(body.textContent);
   h.mods.ui.uploadFile=async()=>({size:17});const post=h.mods.request.post;
   h.mods.request.post=async(url,req)=>req.params[2]==='certificate_write'?(calls++,response(h,req,{result:true},6)):post(url,req);
   const button=h.modal.querySelector('output[for="'+upload.cbid(h.sid)+'"] button');assert(button);
   button.click();await until(()=>notes.length);
   assert.equal(calls,1);assert(!notes.some(n=>n.includes('successfully uploaded')),'nonzero status must not consume successful upload payload');
   assert(notes.some(n=>/Failed|error/i.test(n)),'upload failure is visible');
   console.log('PASS '+name+' upload: nonzero native RPC rejects success-shaped payload');
  } finally {h.w.close();}
 }
}
async function generate() {
 const msgid='Failed to generate %s, error: %s.';
 const po=fs.readFileSync(path.resolve(__dirname,'../luci-app-homeproxy/po/zh_Hans/homeproxy.po'),'utf8');
 const match=po.match(/msgid "Failed to generate %s, error: %s\."\nmsgstr "([^"]+)"/);assert(match,'Chinese generator error is catalogued');
 const h=await editor('server',{[msgid]:match[1]});
 try {
  const field=key=>h.fields.find(o=>o.option===key),sid=h.sid;
  const notes=[];h.mods.ui.addNotification=(_title,body,severity)=>notes.push({text:body.textContent,severity});
  const reality=field('tls_reality');reality.getUIElement(sid).setValue('1');reality.triggerValidation(sid);h.modalMap.checkDepends();
  const original={tls_reality_private_key:'ORIGINAL_PRIVATE',tls_reality_public_key:'ORIGINAL_PUBLIC',tls_ech_key:'ORIGINAL_ECH_KEY',tls_ech_config:'ORIGINAL_ECH_CFG'};
  for(const [key,value] of Object.entries(original))field(key).getUIElement(sid).setValue(value);
  let calls=0,mode='status';const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{
   if(req.params[2]!=='singbox_generator')return post(url,req);
   calls++;
   if(mode==='transport')throw new Error('injected transport failure');
   if(mode==='backend')return response(h,req,{error:'injected backend failure'});
   return response(h,req,{result:{private_key:'INJECTED_PRIVATE',public_key:'INJECTED_PUBLIC',ech_key:'INJECTED_ECH_KEY',ech_cfg:'INJECTED_ECH_CFG'}},mode==='success'?0:6);
  };
  for(const key of ['tls_reality_private_key','tls_ech_key']) {
   if(key==='tls_ech_key') {reality.getUIElement(sid).setValue('0');reality.triggerValidation(sid);h.modalMap.checkDepends();}
   assert(field(key).isActive(sid),'Generate field is active: '+key);
   const button=Array.from(h.modal.querySelector('[id="widget.'+field(key).cbid(sid)+'"]').parentElement.querySelectorAll('button')).find(b=>b.textContent==='Generate');assert(button);
   for(mode of ['status','transport','backend']) {
    const before=calls,n=notes.length;button.click();await until(()=>calls>before);await until(()=>!button.disabled);
    assert.equal(notes.length,n+1,key+' '+mode+' presents one concise failure, not generic handler failure');
    assert.match(notes.at(-1).text,/生成 .+ 失败，错误：.+/,'Chinese failure must explain rejection');
    assert.equal(notes.at(-1).severity,'error');
    for(const [k,v] of Object.entries(original))assert.equal(field(k).formvalue(sid),v,'failed generator preserves '+k);
   }
  }
  mode='success';
  for(const key of ['tls_reality_private_key','tls_ech_key']) {
   reality.getUIElement(sid).setValue(key==='tls_reality_private_key'?'1':'0');reality.triggerValidation(sid);h.modalMap.checkDepends();
   const button=Array.from(h.modal.querySelector('[id="widget.'+field(key).cbid(sid)+'"]').parentElement.querySelectorAll('button')).find(b=>b.textContent==='Generate');
   const before=calls;button.click();await until(()=>calls>before);await until(()=>!button.disabled);
  }
  for(const [key,value] of Object.entries({tls_reality_private_key:'INJECTED_PRIVATE',tls_reality_public_key:'INJECTED_PUBLIC',tls_ech_key:'INJECTED_ECH_KEY',tls_ech_config:'INJECTED_ECH_CFG'}))assert.equal(field(key).formvalue(sid),value,'successful generator still updates '+key);
  assert.equal(notes.length,6,'successful retry produces no error notification');
  console.log('PASS REALITY/ECH Generate: nonzero/transport/backend errors are Chinese and preserve all inputs; successful retry updates both pairs');
 } finally {h.w.close();}
}
async function domain() {
 const h=await pageBoot('client');
 try {
  const persisted=JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s]))));
  let contents={direct:'old.example\n',proxy:'proxy.example\n'},fail=true;const writes=[],notes=[],post=h.mods.request.post;
  h.mods.ui.addNotification=(_title,body)=>notes.push(body.textContent);
  h.mods.request.post=async(url,req)=>{
   const [,obj,method,p]=req.params;
   if(method==='domainlist_read')return response(h,req,{content:contents[p.id]||''});
   if(method==='domainlist_write'){writes.push(JSON.parse(JSON.stringify(p.lists)));if(!fail)Object.assign(contents,p.lists);return response(h,req,{result:true},fail?6:0);}
   if(obj==='uci'&&method==='get')return response(h,req,{values:persisted});
   if(obj==='uci'&&method==='set'){Object.assign(persisted[p.section],JSON.parse(JSON.stringify(p.values)));return response(h,req,{});}
   if(obj==='uci'&&method==='delete'){for(const k of p.options||[])delete persisted[p.section][k];return response(h,req,{});}
   return post(url,req);
  };
  await h.map.load();await h.map.reset();
  const o=h.map.lookupOption('_direct_list','diversion')[0];o.getUIElement('diversion').setValue('new.example\n');
  await assert.rejects(h.map.save(null,true),/ubus|RPC|status|error/i,'nonzero write must reject native Map.save');
  assert.equal(writes.length,1);assert.equal(contents.direct,'old.example\n');
  assert.equal(persisted.diversion.direct_list_checksum,undefined,'failed bytes never get a persisted checksum');
  assert.equal(h.mods.uci.get('homeproxy','diversion','direct_list_checksum'),undefined,'failed bytes never get a staged checksum');
  assert.equal(o.formvalue('diversion'),'new.example\n','failed save keeps current draft');assert.equal(notes.length,1);
  fail=false;await h.map.save(null,true);await h.map.load();await h.map.reset();
  assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1],'retry uses preserved staged bytes');
  assert.equal(contents.direct,'new.example\n');assert.equal(persisted.diversion.direct_list_checksum,h.mods.homeproxy.calcStringMD5(contents.direct));
  assert.equal(o.formvalue('diversion'),'new.example\n');
  console.log('PASS domain save: nonzero status rejects; old bytes/checksum retained; draft retries and reloads successfully');
 } finally {h.w.close();}
}
async function log() {
 const h=await boot();
 try {
  await h.settle({results:[]});const notes=[];let clears=0,reads=0;const post=h.mods.request.post;
  h.mods.ui.addNotification=(_title,body,severity)=>notes.push({text:body.textContent,severity});
  h.mods.fs.read_direct=async()=>{reads++;return 'original log bytes';};
  for(const poll of h.polls)await poll();
  const area=h.root().querySelector('textarea'),before=reads;
  h.mods.request.post=async(url,req)=>req.params[2]==='log_clean'?(clears++,response(h,req,{result:true},6)):post(url,req);
  const button=h.button('Clean log');button.click();await until(()=>clears===1);await until(()=>!button.disabled);
  assert.equal(notes.length,1,'log clear must report nonzero native status');assert.equal(notes[0].severity,'error');assert.match(notes[0].text,/Unable to clear log/);
  assert.equal(area.value,'original log bytes');assert.equal(reads,before,'failure must not trigger successful-clear refresh');
  console.log('PASS log clear: nonzero status reports error and retains original bytes without success refresh');
 } finally {h.w.close();}
}
(async()=>{const cases={upload,generate,domain,log};const names=process.argv.slice(2);for(const name of names.length?names:Object.keys(cases)){assert(cases[name],'known case');await cases[name]();}})().catch(e=>{console.error(e);process.exitCode=1;});
