// Native LuCI Map/E/ui/rpc, isolated transport; no router service is started.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
process.env.PACKAGES_ROOT = path.resolve(__dirname, '..');
const { tick } = require('./helpers/test_connection_lifecycle.cjs');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const po = fs.readFileSync(path.join(process.env.PACKAGES_ROOT, 'luci-app-homeproxy/po/zh_Hans/homeproxy.po'), 'utf8');
const translations = {};
for (const entry of po.split(/(?=^msgid )/m)) {
 const m = entry.match(/^msgid "([^"\n]*)"\nmsgstr "([^"\n]*)"/m);
 if (m && m[2]) translations[m[1]] = m[2];
}
const watchdog = setTimeout(() => { console.error('UI test timed out'); process.exit(1); }, 20000);
(async () => {
 const resources = [{ type:'geoip_cn', version:'20260901000000' }, { type:'geosite_cn', version:'20260901000000' }, {type:'dashboard', installed:false}];
 const h = await pageBoot('client', translations, {resources});
 h.j = {window:h.w};
 h.button = text => [...h.root().querySelectorAll('button')].find(b=>b.textContent===h.w._(text));
 const testRules=h.map.section(h.mods.form.NamedSection,'config','homeproxy');
 const ruleOption=testRules.option(h.mods.form.DummyValue,'_test_status_rules');
 ruleOption.render=function(){return h.mods['homeproxy.resources'].render(this,['geoip_cn','geosite_cn']);};
 await h.map.reset();
 // This extra widget exercises the same shared rules renderer as the Status route.
 try {
  let pending, count = 0, notifications = 0;
  const original = h.mods.request.post;
  h.mods.ui.addNotification = () => notifications++;
  h.mods.request.post = async (url, req) => {
   const method = req.params[2];
   if (!['dashboard_manage', 'resources_update'].includes(method)) return original(url, req);
   count++;
   const result = await new Promise((resolve, reject) => { pending = {resolve, reject}; });
   return {ok:true, status:200, json:() => h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0', id:req.id, result:[0,result]}))};
  };
  const map = h.mods.dom.findClassInstance(h.root());
  const rows = () => [ ...[...h.root().querySelectorAll('.hp-resources table')[1].rows].slice(1), h.root().querySelector('[data-name="_dashboard_resources"] table').rows[1] ];
  const result = i => rows()[i].querySelector('.hp-resource-result');
  const click = (i, n=0) => rows()[i].querySelectorAll('button')[n].click();
  const settle = async value => { pending.resolve(value); for(let i=0;i<25;i++) await tick(); };
  const expect = (i, text, status='neutral') => { assert.equal(result(i).textContent,text); assert.equal(result(i).dataset.status,status); };
  click(2); await tick(); assert.equal(count,1);
  assert([...h.root().querySelectorAll('.hp-resources button')].every(b=>b.disabled));
  await map.reset(); click(2); assert.equal(count,1);
  resources[2].installed=true; resources[2].version='20260915000000';
  await settle({status:0}); expect(2,'已下载','success'); assert.equal(rows()[2].querySelectorAll('button').length,2); assert.match(rows()[2].textContent,/20260915000000/);
  await map.reset(); expect(2,'已下载','success');
  click(0); await tick(); expect(0,h.w._('Updating…'),'pending');
  await map.reset(); expect(0,h.w._('Updating…'),'pending');
  assert([...h.root().querySelectorAll('.hp-resources button')].every(b=>b.disabled));
  await settle({status:3}); expect(0,'已是最新版本','success');
  await map.reset(); expect(0,'已是最新版本','success');
  click(0); await tick(); await settle({status:2}); expect(0,h.w._('Update already in progress.'));
  click(0); await tick(); await settle({status:1}); expect(0,'更新失败','error');
  await map.reset(); expect(0,'更新失败','error');
  h.button('Update resources').click(); await tick();
  await settle({status:1,resources:[{type:'geoip_cn',status:3},{type:'geosite_cn',status:1},{type:'dashboard',status:0}]});
  expect(0,'已是最新版本','success'); expect(1,'更新失败','error'); expect(2,'已更新','success');
  await map.reset(); expect(0,'已是最新版本','success'); expect(1,'更新失败','error');
  click(2,1); await tick();
  [...h.w.document.querySelectorAll('.modal button')].find(b=>b.textContent===h.w._('Remove')).click();
  await tick(); await settle({status:3}); expect(2,h.w._('Not installed'));
  h.button('Update resources').click(); await tick();
  await settle({status:0, resources:[{type:'geoip_cn',status:0},{type:'geosite_cn',status:3},{type:'dashboard',status:3}]});
  expect(0,'已更新','success'); expect(1,'已是最新版本','success'); expect(2,'已是最新版本','success');
  if (process.env.RESOURCE_UI_SNAPSHOT) fs.writeFileSync(process.env.RESOURCE_UI_SNAPSHOT,h.w.document.documentElement.outerHTML);
  click(0); await tick(); await settle({status:0,apply_failed:true}); assert.match(result(0).textContent,/恢复|还原/); assert.equal(result(0).dataset.status,'error');
  click(1); await tick(); await settle({status:0,rollback_failed:true}); assert.match(result(1).textContent,/恢复失败/); assert.equal(result(1).dataset.status,'error');
  click(2); await tick(); await settle({status:3}); expect(2,'已是最新版本','success');
  click(2,1); await tick();
  const confirm = [...h.w.document.querySelectorAll('.modal button')].find(b=>b.textContent===h.w._('Remove'));
  assert(confirm); confirm.click(); await tick(); resources[2].installed=false; resources[2].version=null;
  await settle({status:0}); expect(2,'已删除','success'); assert.equal(rows()[2].querySelectorAll('button').length,1); assert.match(rows()[2].textContent,/未安装/);
  h.button('Update resources').click(); await tick(); await settle({status:3,resources:[{type:'geoip_cn',status:3},{type:'geosite_cn',status:3}]}); assert.equal(result(2).textContent,'');
  click(0); await tick(); pending.reject(Error('fixture transport failure')); for(let i=0;i<25;i++) await tick(); expect(0,'更新失败','error');
  click(0); await tick(); await settle(null); expect(0,'更新失败','error');
  click(0); await tick(); await settle([]); expect(0,'更新失败','error');
  click(0); await tick(); await settle({status:0}); expect(0,'已更新','success');
  // Exercise actual native Map reset, document visibility and route detach/reentry.
  let polls=0, starts=0, statusPending;
  const job='resource-job-fixture', rpcReply=(req,value)=>({ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))});
  const realTimer=h.w.setTimeout.bind(h.w);
  h.w.setTimeout=(fn,ms,...args)=>realTimer(fn,ms===1000?20:ms,...args);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(test,label)=>{const end=Date.now()+3000;while(!test()){assert(Date.now()<end,label);await sleep(5);}};
  const visibility=value=>{
   Object.defineProperty(h.w.document,'visibilityState',{configurable:true,value});
   h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  };
  h.mods.request.post=async(url,req)=>{
   if(['dashboard_manage','resources_update'].includes(req.params[2])) {
    starts++;
    const value=await new Promise(resolve=>{pending={resolve};});
    return rpcReply(req,value);
   }
   if(req.params[2]==='resources_job_status') {
    assert.equal(req.params[3].job,job);polls++;
    return rpcReply(req,await new Promise((resolve,reject)=>{statusPending={resolve,reject};}));
   }
   return original(url,req);
  };
  visibility('hidden');
  h.button('Update resources').click();await tick();
  expect(0,h.w._('Updating…'),'pending');expect(1,h.w._('Updating…'),'pending');expect(2,'');
  pending.resolve({state:'running',job});await sleep(70);
  assert.equal(polls,0,'hidden start never polls');
  await map.reset();expect(0,h.w._('Updating…'),'pending');
  await sleep(70);assert.equal(polls,0,'hidden reset never polls');
  visibility('visible');await until(()=>polls===1,'visible view resumes');
  await map.reset();await sleep(70);assert.equal(polls,1,'held status is single-flight across reset');
  visibility('hidden');statusPending.reject(Error('login expired / persistent offline'));
  await until(()=>result(0).textContent===h.w._('Status unavailable'),'read failure is visible after reset');
  expect(0,h.w._('Status unavailable'),'neutral');expect(1,h.w._('Status unavailable'),'neutral');expect(2,'');
  assert.match(result(0).textContent,/状态/,'status uncertainty uses existing Chinese translation');
  assert([...h.root().querySelectorAll('.hp-resources button')].every(b=>b.disabled),'unknown job retains busy');
  await sleep(70);assert.equal(polls,1,'hidden after rejected in-flight status stays paused');
  visibility('visible');await until(()=>polls===2,'foreground retries same job');
  const detached=h.root();detached.remove();await tick();const detachedHTML=detached.innerHTML;
  statusPending.reject(Error('still offline after leaving'));await sleep(80);
  visibility('visible');await sleep(80);assert.equal(polls,2,'no resource views means no polling even in foreground');
  visibility('hidden');
  const fresh=await h.app.render(await h.app.load());h.w.document.querySelector('#view').append(fresh);await tick();
  const reenteredMap=h.mods.dom.findClassInstance(h.root());
  const reenteredRules=reenteredMap.section(h.mods.form.NamedSection,'config','homeproxy');
  const reenteredOption=reenteredRules.option(h.mods.form.DummyValue,'_test_status_rules');
  reenteredOption.render=ruleOption.render;
  await reenteredMap.reset();await tick();
  expect(0,h.w._('Status unavailable'),'neutral');expect(1,h.w._('Status unavailable'),'neutral');expect(2,'');
  assert([...h.root().querySelectorAll('.hp-resources button')].every(b=>b.disabled),'route reentry retains session lock');
  await sleep(70);assert.equal(polls,2,'hidden reentry stays paused');
  visibility('visible');await until(()=>polls===3,'visible reentry resumes same job');
  statusPending.reject(Error('network still unavailable'));await until(()=>polls===4,'visible offline retries');
  expect(0,h.w._('Status unavailable'),'neutral');assert.equal(starts,1,'outage/reset/reentry never starts a second worker');
  statusPending.resolve({state:'running'});
  await until(()=>result(0).textContent===h.w._('Updating…'),'running reply clears unavailable state');
  expect(0,h.w._('Updating…'),'pending');expect(1,h.w._('Updating…'),'pending');
  visibility('hidden');await sleep(70);assert.equal(polls,4,'hide cancels the queued next read');
  visibility('visible');
  await until(()=>polls===5,'running job continues');
  statusPending.resolve({state:'done',status:0,resources:[{type:'geoip_cn',status:0},{type:'geosite_cn',status:3}]});
  await until(()=>[...h.root().querySelectorAll('.hp-resources button')].every(b=>!b.disabled),'terminal evidence unlocks');
  expect(0,'已更新','success');expect(1,'已是最新版本','success');expect(2,'');
  assert.equal(starts,1);assert.equal(polls,5);assert.equal(detached.innerHTML,detachedHTML,'detached route is not repainted after reentry');
  console.log('PASS native resource lifecycle: manual pending, hidden/leave pause, held status across reset, Chinese neutral read failures, same-job reentry/offline recovery, terminal-only unlock');
  assert.equal(notifications,0); assert([...h.root().querySelectorAll('.hp-resources button')].every(b=>!b.disabled));
  assert.equal(h.root().querySelectorAll('.hp-resource-version').length,3,'version text has a scoped shrinkable wrapping container');
  const version=h.root().querySelector('.hp-resource-version');
  assert.match(version.getAttribute('style'),/min-width:0/);
  assert.match(version.getAttribute('style'),/overflow-wrap:anywhere/);
  const css = h.root().querySelector('.hp-resources style').textContent;
  assert(css.includes('.hp-resource-result{color:inherit}'));
  assert(css.includes('[data-status="success"]{color:var(--success,var(--success-color-high,light-dark(#15803d,#16a34a)))}'), 'success must use Aurora and Bootstrap tokens');
  assert(css.includes('[data-status="error"]{color:var(--danger,var(--error-color-high,light-dark(#b91c1c,#dc2626)))}'), 'failure must use Aurora and Bootstrap tokens');
  console.log('PASS native LuCI clicks: manual mixed/absent dashboard, single update, download/remove state+version, failure flag priority, transport failure, reset retention, busy reset, retry, Chinese inline results, zero notifications');
 } finally { h.j.window.close(); clearTimeout(watchdog); }
})().catch(e=>{clearTimeout(watchdog); console.error(e);process.exitCode=1;});
