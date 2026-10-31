'use strict';
const assert=require('assert/strict');
const {pageBoot,tick}=require('./helpers/test_page_lifecycle.cjs');
(async()=>{
 const h=await pageBoot('client');
 try {
  let current;
  h.setHandler((obj,method)=>{
   if(obj==='service') return {homeproxy:{instances:{'sing-box-c':{running:true}}}};
   if(method==='current_node_get') return current;
  });
  const status=()=>h.root().querySelector('#service_status');
  for(const [response,label] of [
   [{mode:'urltest',active:{id:'urltest'},error:'clash_api_unavailable'},'URLTest: Status unavailable'],
   [{mode:'urltest',active:{id:'urltest'},error:'missing_current_proxy'},'URLTest: Waiting for node selection'],
   [{mode:'urltest',active:{id:null,label:'removed-tag'},error:null},'URLTest: Unavailable node: removed-tag'],
   [{mode:'urltest',active:{id:'n1',label:'Fixture'},error:null},'URLTest:'],
  ]){
   current=response;await Promise.all(h.polls().map(f=>f()));await tick();
   assert(status().textContent.includes(label),status().textContent);
   assert(!status().textContent.includes('Invalid node'));
   const children=[...status().childNodes];
   await Promise.all(h.polls().map(f=>f()));await tick();
   assert(children.every((c,i)=>c===status().childNodes[i]),'equal error state must preserve DOM');
  }
  console.log('PASS: URLTest unavailable/waiting/missing-reference/live states and equal-result DOM retention');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
