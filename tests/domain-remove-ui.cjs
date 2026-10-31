'use strict';
const assert=require('assert/strict');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
const {walk}=require('./homeproxy-editor-parity.cjs');
(async()=>{
 const h=await pageBoot('client',{}, {values:{route_test:{'.type':'domain_route',enabled:'1',label:'fixture',node:'n1'}}});
 try {
  const grid=walk(h.map).find(o=>o.option==='label'&&o.section.sectiontype==='domain_route').section;
  const events=[],post=h.mods.request.post;
  const persisted=Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],JSON.parse(JSON.stringify(s))]));
  h.mods.request.post=async(url,req)=>{
   const [,obj,method,p]=req.params;
   const reply=data=>({ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,data]}))});
   if(method==='domainlist_read')return reply({content:p.id+'.example.org\n'});
   if(obj==='uci'&&method==='get')return reply({values:persisted});
   if(obj==='uci'&&method==='delete'){events.push('session-delete');delete persisted[p.section];return reply({});}
   if(method==='domainlist_remove'){events.push('permanent-remove');return reply({result:true});}
   if(method==='domainlist_write'){
    assert.equal(p.groups_complete,true,'RPC receives the complete current session group set');
    assert.equal(p.group_states.route_test,undefined,'deleted group is excluded while its file is retained: '+JSON.stringify(p));
    events.push('write-lists');return reply({result:true});
   }
   return post(url,req);
  };
  await grid.handleRemove('route_test');
  assert(events.includes('session-delete'));
  assert(!events.includes('permanent-remove'),'pending UCI deletion must not destroy revertible domain bytes');
  assert(!h.calls.some(c=>c.obj==='uci'&&['apply','commit'].includes(c.method)));
  const direct=h.map.lookupOption('_direct_list','diversion')[0];
  direct.getUIElement('diversion').setValue('moved.example');
  await h.map.save(null,true);
  assert(events.includes('write-lists'),'native Save writes the moved domain with the session group set');
  console.log('PASS: native domain-route deletion saves only UCI session; permanent bytes survive pending/revert');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
