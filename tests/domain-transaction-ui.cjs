'use strict';
// Native LuCI Map.save + native libuci private session storage + actual list files.
// RPC transport and rpcd apply snapshot/reload/timer boundaries are fixtures.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
const repo=path.resolve(__dirname,'..'),app=path.join(repo,'luci-app-homeproxy');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hp-domain-session-'));
 const conf=path.join(dir,'config'),sessions=['a','b'].map(n=>path.join(dir,n));
 for(const p of [conf,...sessions,path.join(dir,'diversion')])fs.mkdirSync(p);
 fs.writeFileSync(path.join(conf,'homeproxy'),'');
 const target=path.join(dir,'diversion/direct.txt');fs.writeFileSync(target,'old.example\n');
 const uc=path.join(dir,'storage.uc');
 fs.writeFileSync(uc,`import { cursor } from 'uci';
const request=json(ARGV[0]); const u=cursor(${JSON.stringify(conf)},request.savedir);
u.load('homeproxy');
if(request.action==='init') { for(let id,s in request.values) {u.set('homeproxy',id,s['.type']);for(let k,v in s)if(substr(k,0,1)!=='.')u.set('homeproxy',id,k,v);}u.save('homeproxy');u.commit('homeproxy'); }
if(request.action==='set') {for(let k,v in request.values)if(!u.set('homeproxy',request.section,k,v))die('set failed');if(!u.save('homeproxy'))die('save failed');}
if(request.action==='delete') {for(let k in request.options||[])u.delete('homeproxy',request.section,k);if(!u.save('homeproxy'))die('save failed');}
if(request.action==='commit'&&!u.commit('homeproxy'))die('commit failed');
if(request.action==='revert'&&!u.revert('homeproxy'))die('revert failed');
let values={};u.foreach('homeproxy',null,s=>values[s['.name']]=s);printf('%J',{values});`);
 const store=(action,params={},session=0)=>JSON.parse(execFileSync('ucode',['-L',process.env.UCODE_LIB_DIR,uc,JSON.stringify({action,savedir:sessions[session],...params})],{encoding:'utf8'}));
 const h=await pageBoot('client',{}, {values:{tailscale:{enabled:'0'}}});
 try {
  store('init',{values:Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],JSON.parse(JSON.stringify(s))]))});
  // Execute production legacy writer if the page uses it, never an in-memory fake.
  const rpc=fs.readFileSync(path.join(app,'root/usr/share/rpcd/ucode/luci.homeproxy'),'utf8');
  const helper=fs.readFileSync(path.join(app,'root/etc/homeproxy/scripts/homeproxy.uc'),'utf8');
  const functions=helper.slice(helper.indexOf('export function normalizeDomainList'),helper.indexOf('export function resolveLanPolicy'))+helper.slice(helper.indexOf('export function isBinary'),helper.indexOf('export function getTime'))+helper.slice(helper.indexOf('export function shellQuote'),helper.indexOf('export function isBinary'));
  const writer=path.join(dir,'rpc.uc');
  fs.writeFileSync(writer,`import { open, readfile, writefile, rename, unlink, rmdir, lsdir, lstat, popen } from 'fs';\nimport { cursor as native_cursor } from 'uci';\nconst HP_DIR=${JSON.stringify(dir)}; function cursor(){return native_cursor(${JSON.stringify(conf)},${JSON.stringify(sessions[1])});}\nfunction validation(t,s){return !!match(s,/^[a-z.-]+$/);}\n`+functions.replaceAll('export function','function')+rpc.slice(rpc.indexOf('function makeTempDir'),rpc.indexOf('const methods ='))+'const methods={'+rpc.slice(rpc.indexOf('\tdomainlist_write: {'),rpc.indexOf('\n\tcertificate_write: {'))+'};\nprintf("%J",methods.domainlist_write.call({args:json(ARGV[0])}));');
  const post=h.mods.request.post;let fail=true,writes=0;
  h.mods.request.post=async(url,req)=>{
   const [,obj,method,p]=req.params;
   const reply=data=>({ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,data]}))});
   if(method==='domainlist_read')return reply({content:p.id==='direct'?fs.readFileSync(target,'utf8'):''});
   if(method==='domainlist_write'){writes++;return reply(JSON.parse(execFileSync('ucode',['-L',process.env.UCODE_LIB_DIR,writer,JSON.stringify(p)],{encoding:'utf8'})));}
   if(obj==='uci'&&method==='get')return reply(store('get'));
   if(obj==='uci'&&method==='set'){if(fail)throw Error('injected native UCI save failure');return reply(store('set',p));}
   if(obj==='uci'&&method==='delete')return reply(store('delete',p));
   return post(url,req);
  };
  await h.map.load();await h.map.reset();
  h.map.lookupOption('_direct_list','diversion')[0].getUIElement('diversion').setValue('new.example\n');
  await assert.rejects(h.map.save(null,true),/RPC|save failure/);
  assert.equal(fs.readFileSync(target,'utf8'),'old.example\n','failed native Save must not mutate persistent list bytes');
  assert.equal(store('get').values.diversion.direct_list,undefined,'failed session write has no saved list');
  console.log('PASS failed native Save preserves private persistent file and session');
  fail=false;await h.map.save(null,true);
  assert.equal(writes,0,'Save must never call the irreversible file writer');
  assert.equal(store('get').values.diversion.direct_list,'new.example\n');
  assert.equal(store('get',{},1).values.diversion.direct_list,undefined,'other session cannot read uncommitted list');
  assert.equal(fs.readFileSync(target,'utf8'),'old.example\n');
  // Revert is native libuci delta removal; reload must not resurrect pending UI text.
  store('revert');h.mods.uci.unload('homeproxy');await h.map.load();await h.map.reset();
  assert.equal(h.map.lookupOption('_direct_list','diversion')[0].formvalue('diversion'),'old.example\n','Revert reloads legacy committed bytes');
  h.map.lookupOption('_direct_list','diversion')[0].getUIElement('diversion').setValue('again.example\n');
  await h.map.save(null,true);store('commit');h.mods.uci.unload('homeproxy');await h.map.load();await h.map.reset();
  assert.equal(h.map.lookupOption('_direct_list','diversion')[0].formvalue('diversion'),'again.example\n','Apply reads committed UCI instead of the retained legacy file');
  assert.equal(store('get',{},1).values.diversion.direct_list,'again.example\n');
  console.log('PASS Save-only session isolation, Revert, committed Apply and reentry');
  h.map.lookupOption('_direct_list','diversion')[0].getUIElement('diversion').setValue('');
  await h.map.save(null,true);store('commit');
  assert.equal(store('get').values.diversion.direct_list,'\n','empty list needs a native UCI value, not option deletion that revives legacy bytes');
  h.map.lookupOption('_direct_list','diversion')[0].getUIElement('diversion').setValue('postload.example\n');
  const load=h.map.load;h.map.load=async()=>{throw Error('injected load failure after saved delta');};
  await assert.rejects(h.map.save(null,true),/load failure/);h.map.load=load;
  assert.equal(store('get').values.diversion.direct_list,'postload.example\n','native save may leave a reversible delta when later rendering fails');
  assert.equal(store('get',{},1).values.diversion.direct_list,'\n');
  assert.equal(fs.readFileSync(target,'utf8'),'old.example\n');
  store('revert');h.mods.uci.unload('homeproxy');await h.map.load();await h.map.reset();
  assert.equal(h.map.lookupOption('_direct_list','diversion')[0].formvalue('diversion'),'\n');
  console.log('PASS explicit clear, post-save load failure remains session-only and Revert recovers');
  // Validation reads pending drafts before loaded UCI/file caches, even when
  // the Save callback reloads every (including unopened) list asynchronously.
  h.map.lookupOption('_direct_list','diversion')[0].getUIElement('diversion').setValue('conflict.example');
  h.map.lookupOption('_proxy_list','diversion')[0].getUIElement('diversion').setValue('sub.conflict.example');
  await assert.rejects(h.map.save(null,true),/conflict/);
  assert.equal(store('get').values.diversion.direct_list,'\n','conflict never reaches native data.save');
  assert.equal(writes,0);
  console.log('PASS Save callback cache reload cannot hide conflicting current drafts');
  await h.map.reset();await h.map.save(null,true);
  assert.equal(store('get').values.diversion.direct_list,'\n','Reset after failed validation must discard pending editor drafts');
 } finally {h.w.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
