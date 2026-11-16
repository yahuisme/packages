'use strict';
const assert=require('node:assert/strict');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
const {walk}=require('./homeproxy-editor-parity.cjs');
const watchdog=setTimeout(()=>{console.error('FAIL diversion URLTest gate stalled');process.exit(1);},45000);
(async()=>{
 const h=await pageBoot('client',{}, {values:{
  diversion:{direct_list:'',proxy_list:''},
  n2:{'.type':'node',type:'socks',label:'<img src=x onerror=evil()> & node',address:'other.invalid',port:'1080'},
  route_test:{'.type':'domain_route',enabled:'1',label:'Independent group',node:'urltest',urltest_nodes:['n1','n2'],domain_list:'route.example\n',urltest_interrupt_exist_connections:'1'}
 }});
 try{
  const grid=walk(h.map).find(o=>o.option==='label'&&o.section.sectiontype==='domain_route').section;
  assert(grid.children.find(o=>o.option==='node').keylist.includes('urltest'),'Independent URLTest is an available diversion target');
  const persisted=JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s]))));
  const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{
   const[,object,method,p]=req.params;let value;
   if(object==='uci'&&method==='get')value={values:persisted};
   else if(object==='uci'&&method==='set'){Object.assign(persisted[p.section],p.values);value={};}
   else if(object==='uci'&&method==='delete'){for(const key of p.options||[])delete persisted[p.section][key];value={};}
   else return post(url,req);
   return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
  };
  await grid.renderMoreOptionsModal('route_test');
  const modal=grid.getActiveModalMap().closest('.modal');
  assert(modal.classList.contains('hp-diversion-modal'),'Diversion modal has local tablet-width bound');
  assert(modal.querySelector('style').textContent.includes('max-width: 100%'));
  const map=h.mods.dom.findClassInstance(grid.getActiveModalMap());
  const fields=walk(map),field=name=>fields.find(o=>o.option===name);
  const choices=field('urltest_nodes');assert(choices&&choices.retain&&choices.modalonly);
  assert(choices.isActive('route_test'));assert(field('urltest_interrupt_exist_connections').isActive('route_test'));
  choices.getUIElement('route_test').setValue([]);
  choices.triggerValidation('route_test');
  await assert.rejects(()=>map.save(null,true),/Select at least one available URLTest node/);
  assert.equal(choices.validate('route_test'),'Select at least one available URLTest node.');
  choices.getUIElement('route_test').setValue(['missing']);
  assert.equal(choices.validate('route_test'),'Select at least one available URLTest node.');
  choices.getUIElement('route_test').setValue(['n1','n2']);
  assert.equal(choices.validate('route_test',''),true,'Empty add-item control must not invalidate selected nodes');
  assert(!grid.getActiveModalMap().querySelector('img'),'Node labels are text, not markup');
  choices.getUIElement('route_test').setValue(['n2']);choices.triggerValidation('route_test');
  await map.save(null,true);
  assert.deepEqual(Array.from(persisted.route_test.urltest_nodes),['n2']);
  assert.equal(persisted.route_test.node,'urltest');
  assert.equal(persisted.route_test.urltest_interrupt_exist_connections,'1');
  h.mods.ui.hideModal();await h.map.load();await h.map.reset();
  await h.map.save(null,true);
  assert.deepEqual(Array.from(persisted.route_test.urltest_nodes),['n2'],'Parent save retains members after modal closes');
  await grid.renderMoreOptionsModal('route_test');
  const again=h.mods.dom.findClassInstance(grid.getActiveModalMap());
  const later=walk(again),get=name=>later.find(o=>o.option===name);
  get('node').getUIElement('route_test').setValue('n1');get('node').triggerValidation('route_test');again.checkDepends();
  assert(!get('urltest_nodes').isActive('route_test'),'Switching target hides selector but retains saved members');
  await again.save(null,true);assert.deepEqual(Array.from(persisted.route_test.urltest_nodes),['n2']);
  h.mods.uci.set('homeproxy','route_test','urltest_nodes',['n2','missing','n2']);
  h.mods.homeproxy.reconcileUrltestNodes('homeproxy');
  assert.deepEqual(Array.from(h.mods.uci.get('homeproxy','route_test','urltest_nodes')),['n2']);
  h.mods.ui.hideModal();h.mods.ui.showModal('Unrelated modal',[h.w.E('p',{},['Unrelated content'])]);
  assert(!h.w.document.querySelector('#modal_overlay > .modal').classList.contains('hp-diversion-modal'));
  assert(!h.w.document.querySelector('#modal_overlay > .modal style'),'Local modal style is removed by native showModal');
  console.log('PASS independent diversion URLTest: native modal, valid selection, save/reset/reopen, inactive member retention, literal labels and deleted-node reconciliation');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
