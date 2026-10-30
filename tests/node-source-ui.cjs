// Complete node view and native LuCI; only RPC transport is a fixture.
const assert = require('assert/strict');
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');
const watchdog = setTimeout(() => { console.error('FAIL node source UI stalled'); process.exit(1); }, 15000);
async function until(predicate) {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('node source UI did not settle');
}
(async () => {
 const h = await pageBoot('node');
 try {
  const uci = h.mods.uci;
  const hash = h.mods.homeproxy.calcStringMD5('https://example.invalid/sub');
  uci.add('homeproxy', 'node', 'subnode');
  for (const [key,value] of Object.entries({ type:'socks',label:'Subscription node',address:'example.invalid',port:'1080',grouphash:hash })) uci.set('homeproxy','subnode',key,value);
  uci.set('homeproxy','subscription','subscription_url',['https://example.invalid/sub#' + encodeURIComponent('<img src=x onerror=alert(1)> 中文')]);
  await h.map.load(); await h.map.reset();

  const options = section => section.children.flatMap(option => option.subsection ? options(option.subsection) : option.children?.length ? options(option) : [option]);
  const schedule=options(h.map).find(option=>option.option==='auto_update_time');
  assert(schedule,'cron field retained');
  for(const key of ['auto_update','auto_update_time']) {
   const option=options(h.map).find(option=>option.option===key);
   assert.equal(option.tab,'subscription',key+' belongs directly to the subscription tab');
   assert.equal(h.root().querySelector('[data-name="'+key+'"]').closest('details'),null,key+' is not folded into advanced settings');
  }
  const subscriptionOptions=Array.from(schedule.section.children).filter(o=>o.tab==='subscription').map(o=>o.option);
  assert.deepEqual(subscriptionOptions.slice(0,3),['auto_update','auto_update_time','update_via_proxy'],'schedule controls lead the subscription form');
  h.mods.uci.set('homeproxy','subscription','auto_update_time','17 3 * * 2');
  h.mods.uci.set('homeproxy','subscription','auto_update','0');
  await h.map.load();await h.map.reset();
  assert(!schedule.isActive('subscription'),'auto-update off hides cron field');
  await schedule.parse('subscription');
  await h.map.parse();
  assert.equal(h.mods.uci.get('homeproxy','subscription','auto_update_time'),'17 3 * * 2');
  const autoUpdate=options(h.map).find(option=>option.option==='auto_update');
  autoUpdate.getUIElement('subscription').setValue('1');h.map.checkDepends();
  assert(schedule.isActive('subscription'),'enabling auto-update reveals the top-level cron field');
  schedule.getUIElement('subscription').setValue('99 * * * *');schedule.triggerValidation('subscription');
  await assert.rejects(h.map.parse(),/invalid/i,'top-level cron field keeps native validation');
  schedule.getUIElement('subscription').setValue('23 4 * * 1');schedule.triggerValidation('subscription');
  await h.map.parse();
  assert.equal(h.mods.uci.get('homeproxy','subscription','auto_update_time'),'23 4 * * 1');
  autoUpdate.getUIElement('subscription').setValue('0');h.map.checkDepends();await h.map.parse();
  assert.equal(h.mods.uci.get('homeproxy','subscription','auto_update_time'),'23 4 * * 1','disabled schedule keeps its last value');
  assert(h.root().querySelector('details summary').textContent.includes('Advanced settings'));
  const sources = () => h.root().querySelector('.hp-node-source select');
  const names = () => [...h.root().querySelectorAll('.cbi-tabmenu > li')].map(el=>el.dataset.tab);
  assert.deepEqual(names(), ['node','subscription'], 'fixed navigation must not grow subscription tabs');
  assert(sources(), 'native source selector must render beside a single node grid');
  assert.equal(h.root().querySelectorAll('.hp-node-list').length, 1);
  assert.equal(sources().options[1].textContent, '<img src=x onerror=alert(1)> 中文');
  assert.equal(h.root().querySelectorAll('.hp-node-source img').length,0,'source labels are literal');
  const row = id => h.root().querySelector('[data-sid="'+id+'"]');
  const visible = id => row(id).style.display !== 'none';
  assert(visible('n1')); assert(!visible('subnode'));
  const choose = value => { sources().value=value; sources().dispatchEvent(new h.w.Event('change',{bubbles:true})); };
  const urls=options(h.map).find(o=>o.option==='subscription_url');
  const urlWidget=urls.getUIElement('subscription');
  urlWidget.setValue(['https://example.invalid/unsaved#literal']);
  const originalRow=row('n1');
  choose(hash);
  assert.equal(urls.getUIElement('subscription'),urlWidget,'source switch preserves unsaved native widget identity');
  assert.deepEqual(Array.from(urls.formvalue('subscription')),['https://example.invalid/unsaved#literal'],'source switch retains unsaved form edits');
  assert.equal(row('n1'),originalRow,'filter hides rows without rebuilding');
  urlWidget.setValue(['https://example.invalid/sub#' + encodeURIComponent('<img src=x onerror=alert(1)> 中文')]);
  assert(!visible('n1')); assert(visible('subnode'));
  assert.equal(h.root().querySelector('.cbi-section-create').style.display,'none','subscription source cannot add/import');
  assert(!row('subnode').querySelector('.cbi-button-remove'),'subscription rows cannot be deleted individually');
  await h.map.reset();
  assert.equal(sources().value,hash,'source survives native Map.reset');
  assert(visible('subnode')); assert(!visible('n1'));
  h.app.node_latency_row_state.set('subnode','success',{latency_ms:23});
  await h.map.reset();
  assert(row('subnode').textContent.includes('23'),'latency state retained across resets');
  const actions=h.w.document.createElement('div');actions.className='cbi-page-actions';h.root().parentElement.append(actions);
  h.root().remove();await tick();const fresh=await h.app.render(['homeproxy', await h.mods.homeproxy.getBuiltinFeatures()]);h.w.document.querySelector('#view').append(fresh);
  await until(()=>actions.querySelector('.hp-bulk-latency-test'));
  const calls=[];const original=h.mods.request.post;
  h.mods.request.post=async(url,req)=>{ if(req.params[2]==='node_latency_test')calls.push(req.params[3].nodes);return original(url,req); };
  choose(hash); assert.equal(sources().value,hash); assert(!visible('n1'), 'fresh source hides manual row'); actions.querySelector('.hp-bulk-latency-test').click();
  await until(()=>calls.length);
  assert.deepEqual(Array.from(calls[0]),['subnode'],'bulk test only selected source');
  const currentMap=h.mods.dom.findClassInstance(h.root());
  const grid=options(currentMap).find(o=>o.option==='_test_latency').section;
  for(const [state,result,text] of [['testing',null,'Testing'],['success',{latency_ms:0},'0 ms'],['timeout',null,'Timeout'],['error',{error:{code:'rpc_failed'}},'RPC failed']]) {
   h.app.node_latency_row_state.set('subnode',state,result);grid.refreshNodeLatencyRow('subnode');
   assert(row('subnode').textContent.includes(text),'live latency refresh '+state);
  }
  h.root().querySelector('.cbi-tabmenu [data-tab="subscription"] a').click();await tick();
  assert.equal(actions.querySelector('.hp-bulk-latency-test').style.display,'none');
  h.root().querySelector('.cbi-tabmenu [data-tab="node"] a').click();await tick();
  assert.equal(actions.querySelector('.hp-bulk-latency-test').style.display,'');
  uci.set('homeproxy','subscription','subscription_url',[]);await h.mods.dom.findClassInstance(h.root()).reset();
  assert.equal(sources().value,'','removed source falls back to manual nodes');
  assert(visible('n1'));assert(!visible('subnode'));
  // Exercise LuCI's real TableSection sorter, including its UCI move calls.
  const emptyHash = h.mods.homeproxy.calcStringMD5('https://example.invalid/empty');
  uci.set('homeproxy','subscription','subscription_url',['https://example.invalid/sub#Subscribed','https://example.invalid/empty#Empty']);
  for (const [id,values] of Object.entries({
   n2:{label:'A manual',address:'a.invalid',port:'80'},
   subnode2:{label:'Z subscribed',address:'z.invalid',port:'9000',grouphash:hash}
  })) {
   uci.add('homeproxy','node',id);
   for (const [key,value] of Object.entries({type:'socks',...values})) uci.set('homeproxy',id,key,value);
  }
  await currentMap.load();await currentMap.reset();
  assert.equal(grid.handleSort,h.mods.form.TableSection.prototype.handleSort,'use unchanged native sorter');
  // jsdom has no animation frames; run the native queued DOM/UCI work next turn.
  h.w.requestAnimationFrame = callback => setImmediate(callback);
  const move = currentMap.data.move;
  currentMap.data.move = function(config,sid,reference,...rest) {
   assert(sid && reference,'sort must never move a placeholder/null section');
   assert.equal(uci.get(config,sid,'.type'),'node');
   assert.equal(uci.get(config,reference,'.type'),'node');
   return move.call(this,config,sid,reference,...rest);
  };
  async function sortSource(value,expectedVisible) {
   choose(value);
   const table = h.root().querySelector('.hp-node-list table');
   const header = table.querySelector('tr.cbi-section-table-titles');
   const rows = () => [...table.querySelectorAll('tbody tr[data-sid]')];
   const ids = rows().map(row=>row.dataset.sid).sort();
   for (const key of ['address','port']) {
    const index = [...rows()[0].children].findIndex(cell=>cell.dataset.name===key);
    assert(index>0,'address/port exercise a nonzero native column');
    const th = header.children[index];
    th.removeAttribute('data-sort-direction');
    // A direct call exposes native exceptions rather than swallowing them in UI handlers.
    assert.doesNotThrow(()=>grid.handleSort({target:th,currentTarget:header}),key+' native sort');
    await until(()=>th.getAttribute('data-sort-direction')==='desc');
    const ascending = rows().map(row=>row.dataset.sid);
    const expected = [...ascending].sort((a,b)=>h.w.L.naturalCompare(uci.get('homeproxy',a,key),uci.get('homeproxy',b,key)));
    assert.deepEqual(ascending,expected,key+' ascending order');
    th.click();
    await until(()=>th.getAttribute('data-sort-direction')==='asc');
    const descending = [...ascending].sort((a,b)=>-h.w.L.naturalCompare(uci.get('homeproxy',a,key),uci.get('homeproxy',b,key)));
    assert.deepEqual(rows().map(row=>row.dataset.sid),descending,key+' native click descending');
    assert.deepEqual(rows().map(row=>row.dataset.sid).sort(),ids,'sort preserves real rows');
    assert.deepEqual(rows().filter(row=>row.style.display!=='none').map(row=>row.dataset.sid).sort(),expectedVisible,'sort preserves source filter');
    assert.equal(table.querySelectorAll('tr.cbi-section-table-row:not([data-sid])').length,0,'no false sortable rows');
   }
   assert.equal(table.querySelector('tr.placeholder').style.display,expectedVisible.length?'none':'');
  }
  await sortSource('',['n1','n2']);
  await sortSource(hash,['subnode','subnode2']);
  await sortSource(emptyHash,[]);
  for (const node of uci.sections('homeproxy','node')) uci.remove('homeproxy',node['.name']);
  await currentMap.reset();
  const emptyTable=h.root().querySelector('.hp-node-list table');
  assert.equal(emptyTable.querySelectorAll('[data-sid]').length,0);
  assert.equal(emptyTable.querySelectorAll('tr.cbi-section-table-row').length,0,'native empty placeholder is not a sortable row');
  for (const th of emptyTable.querySelectorAll('th[data-sortable-row]')) {
   const before=th.getAttribute('data-sort-direction');th.click();
   await until(()=>th.getAttribute('data-sort-direction')!==before);
  }
  assert.equal(emptyTable.querySelectorAll('tbody tr').length,1,'empty sorting keeps exactly one placeholder');
  console.log('PASS native address/port sort and header clicks: manual/subscribed/source-empty/all-empty, real order, no false UCI rows; source/reset/bulk acceptance');
 } finally { h.w.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
