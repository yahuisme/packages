// Native LuCI Map/E/ui/rpc, isolated transport; no router service is started.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
process.env.PACKAGES_ROOT = path.resolve(__dirname, '..');
const { boot, tick } = require('./helpers/test_connection_lifecycle.cjs');
const po = fs.readFileSync(path.join(process.env.PACKAGES_ROOT, 'luci-app-homeproxy/po/zh_Hans/homeproxy.po'), 'utf8');
const translations = {};
for (const entry of po.split(/(?=^msgid )/m)) {
 const m = entry.match(/^msgid "([^"\n]*)"\nmsgstr "([^"\n]*)"/m);
 if (m && m[2]) translations[m[1]] = m[2];
}
const watchdog = setTimeout(() => { console.error('UI test timed out'); process.exit(1); }, 20000);
(async () => {
 const resources = [{ type:'geoip_cn', version:'20260901000000' }, { type:'geosite_cn', version:'20260901000000' }, {type:'dashboard', installed:false}];
 const h = await boot(resources, translations);
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
  const rows = () => [...h.root().querySelector('.hp-resources table').rows].slice(1);
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
  h.button('Update resources').click(); await tick();
  await settle({status:0, resources:[{type:'geoip_cn',status:0},{type:'geosite_cn',status:3},{type:'dashboard',status:3}]});
  expect(0,'已更新','success'); expect(1,'已是最新版本。'); expect(2,'已是最新版本。');
  if (process.env.RESOURCE_UI_SNAPSHOT) fs.writeFileSync(process.env.RESOURCE_UI_SNAPSHOT,h.w.document.documentElement.outerHTML);
  click(0); await tick(); await settle({status:0,apply_failed:true}); assert.match(result(0).textContent,/恢复|还原/); assert.equal(result(0).dataset.status,'neutral');
  click(1); await tick(); await settle({status:0,rollback_failed:true}); assert.match(result(1).textContent,/恢复失败/); assert.equal(result(1).dataset.status,'neutral');
  click(2); await tick(); await settle({status:3}); expect(2,'已是最新版本。');
  click(2,1); await tick();
  const confirm = [...h.w.document.querySelectorAll('.modal button')].find(b=>b.textContent===h.w._('Remove'));
  assert(confirm); confirm.click(); await tick(); resources[2].installed=false; resources[2].version=null;
  await settle({status:0}); expect(2,'已删除','success'); assert.equal(rows()[2].querySelectorAll('button').length,1); assert.match(rows()[2].textContent,/未安装/);
  h.button('Update resources').click(); await tick(); await settle({status:3,resources:[{type:'geoip_cn',status:3},{type:'geosite_cn',status:3}]}); assert.equal(result(2).textContent,'');
  click(0); await tick(); pending.reject(Error('fixture transport failure')); for(let i=0;i<25;i++) await tick(); expect(0,'更新失败。');
  click(0); await tick(); await settle({status:0}); expect(0,'已更新','success');
  assert.equal(notifications,0); assert([...h.root().querySelectorAll('.hp-resources button')].every(b=>!b.disabled));
  assert(h.root().querySelector('.hp-resources style').textContent.includes('.hp-resource-result{color:inherit}'));
  console.log('PASS native LuCI clicks: manual mixed/absent dashboard, single update, download/remove state+version, failure flag priority, transport failure, reset retention, busy reset, retry, Chinese inline results, zero notifications');
 } finally { h.j.window.close(); clearTimeout(watchdog); }
})().catch(e=>{clearTimeout(watchdog); console.error(e);process.exitCode=1;});
