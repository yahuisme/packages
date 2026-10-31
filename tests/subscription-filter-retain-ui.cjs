'use strict';
// Native Map save/load/reset with private persistent RPC; no router changes.
const assert=require('assert/strict');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
(async()=>{
 for(const mode of ['blacklist','whitelist']) {
  const keywords=['keep-me','保留关键词'];
  const h=await pageBoot('node',{}, {values:{subscription:{filter_nodes:mode,filter_keywords:keywords}}});
  try {
   const persisted=JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s]))));
   const post=h.mods.request.post;
   h.mods.request.post=async(url,req)=>{
    const [,obj,method,p]=req.params;let value;
    if(obj==='uci'&&method==='get')value={values:persisted};
    else if(obj==='uci'&&method==='set'){Object.assign(persisted[p.section],JSON.parse(JSON.stringify(p.values)));value={};}
    else if(obj==='uci'&&method==='delete'){for(const k of p.options||[])delete persisted[p.section][k];value={};}
    else return post(url,req);
    return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
   };
   const flag=()=>h.map.lookupOption('filter_nodes','subscription')[0];
   const words=()=>h.map.lookupOption('filter_keywords','subscription')[0];
   function setMode(value){flag().getUIElement('subscription').setValue(value);flag().triggerValidation('subscription');h.map.checkDepends();}
   assert(words().isActive('subscription'));
   setMode('disabled');assert(!words().isActive('subscription'));
   await h.map.save(null,true);await h.map.load();await h.map.reset();
   assert.deepEqual(persisted.subscription.filter_keywords,keywords,mode+' disabled save must retain stored keywords');
   assert.equal(flag().formvalue('subscription'),'disabled');
   setMode(mode);assert(words().isActive('subscription'));
   assert.deepEqual(Array.from(words().formvalue('subscription')),keywords,'re-enable restores original native list');
   await h.map.save(null,true);await h.map.load();await h.map.reset();
   assert.equal(flag().formvalue('subscription'),mode);
   assert.deepEqual(Array.from(words().formvalue('subscription')),keywords,'saved re-enabled list survives reload');
   console.log('PASS '+mode+': disable/save/load/reset/re-enable/save/load/reset preserves keywords');
  } finally {h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
