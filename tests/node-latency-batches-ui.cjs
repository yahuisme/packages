'use strict';
const assert=require('assert/strict');
const {pageBoot,tick}=require('./helpers/test_page_lifecycle.cjs');
const {walk}=require('./homeproxy-editor-parity.cjs');
(async()=>{
 const h=await pageBoot('node');
 try {
  const grid=walk(h.map).find(o=>o.option==='_test_latency').section;
  const calls=[],progress=[];let active=0;
  const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{
   const [,obj,method,p]=req.params;
   if(method!=='node_latency_test')return post(url,req);
   calls.push([...p.nodes]);assert.equal(active++,0,'batches remain sequential');
   await tick();active--;
   return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{results:p.nodes.map(node=>({node,state:'timeout',status:'timeout'}))}]}))};
  };
  const nodes=Array.from({length:35},(_,i)=>'n'+i);
  await grid.handleNodeLatencyTests(nodes,(done,total)=>progress.push([done,total]));
  assert.deepEqual(calls.map(c=>c.length),[16,16,3],'one 5-second backend wave per RPC, not all nodes');
  assert.deepEqual(calls.flat(),nodes);
  assert.deepEqual(progress,[[0,35],[16,35],[32,35],[35,35]]);
  console.log('PASS: 35 slow-result fixtures split into sequential 16/16/3 requests, incremental 0/16/32/35 progress');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
