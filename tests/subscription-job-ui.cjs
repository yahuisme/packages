'use strict';
const assert=require('assert/strict');
const {pageBoot,tick}=require('./helpers/test_page_lifecycle.cjs');
(async()=>{
 const h=await pageBoot('node');
 try {
  const calls=[];let held, polls=0;
  h.w.setTimeout=fn=>setTimeout(fn,0);
  const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{
   if(req.params[1]==='uci'&&req.params[2]==='apply')return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[5]}))};
   return post(url,req);
  };
  let started=false;
  h.mods.fs.exec=async(path,args)=>{
   if(args?.[0]==='--status'&&!started)return {code:0,stdout:'{"state":"idle"}'};
   calls.push(args?.[0]);
   if(!args) return {code:0};
   if(args[0]==='--start'){started=true;return {code:0,stdout:'{"state":"running"}'};}
   assert.equal(args[0],'--status');polls++;
   await new Promise(resolve=>held=resolve);
   return {code:0,stdout:'{"state":"done","code":0}'};
  };
  const option=h.map.lookupOption('_update_subscriptions','subscription')[0];
  const task=option.onclick(null,'subscription');
  const deadline=performance.now()+3000;
  while(!held){assert(performance.now()<deadline,'background status requested');await tick();}
  assert.deepEqual(calls,['--start','--status']);
  assert(h.root().querySelector('.hp-subscription-result').textContent.includes('background'));
  const before=calls.length;await option.onclick(null,'subscription');assert.equal(calls.length,before,'single flight while job runs');
  await h.map.reset();
  assert(h.root().querySelector('.hp-subscription-result').textContent.includes('background'),'progress survives reset');
  held();await task;
  assert(h.root().querySelector('.hp-subscription-result').textContent.includes('successfully'));
  assert.equal(polls,1);
  const fresh=h.mods.dom.findClassInstance(h.root());
  let saves=0;fresh.save=async()=>{saves++;throw Error('must not save during an existing job');};
  h.mods.fs.exec=async(_path,args)=>{assert.equal(args[0],'--status');return {code:0,stdout:'{"state":"running"}'};};
  await fresh.lookupOption('_update_subscriptions','subscription')[0].onclick(null,'subscription');
  assert.equal(saves,0,'reentry/busy task cannot apply or discard unrelated drafts');
  assert(h.root().querySelector('.hp-subscription-result').textContent.includes('already running'));
  h.mods.fs.exec=async()=>{throw Error('status transport failed');};
  await fresh.lookupOption('_update_subscriptions','subscription')[0].onclick(null,'subscription');
  assert(h.root().querySelector('.hp-subscription-result').textContent.includes('may still be running'));
  console.log('PASS: short start/status RPCs, held worker feedback, double-click lock, reset retention, busy-reentry no-save, status uncertainty and done refresh');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
