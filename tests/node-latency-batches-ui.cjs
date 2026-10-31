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
  const row=h.root().querySelector('[data-sid="n1"]');
  const button=Array.from(row.querySelectorAll('button')).find(b=>b.textContent==='Test');
  assert(button,'actual per-row Test button');
  let release;
  h.mods.request.post=async(url,req)=>{
   if(req.params[2]!=='node_latency_test')return post(url,req);
   calls.push(Array.from(req.params[3].nodes));
   await new Promise(resolve=>release=resolve);
   return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{results:[{node:'n1',state:'timeout',status:'timeout'}]}]}))};
  };
  button.click();
  const deadline=performance.now()+3000;
  while(!release){assert(performance.now()<deadline,'row click dispatches');await new Promise(r=>setTimeout(r,5));}
  try {
   assert.deepEqual(calls.at(-1),['n1'],'native click must send the section ID, not its MouseEvent');
   assert(button.disabled,'row action disabled while its request is pending');
  } finally { release(); }
  while(!row.textContent.includes('Timeout')){assert(performance.now()<deadline,'requested row receives its own result');await new Promise(r=>setTimeout(r,5));}
  assert(!button.disabled,'row action recovers after request');
  console.log('PASS: sequential 16/16/3 batches with progress; actual row Test click sends n1 and updates its row');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
