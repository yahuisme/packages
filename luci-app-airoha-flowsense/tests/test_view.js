// Real LuCI view constructor and RPC declaration/reply handling; transport is isolated.
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), { JSDOM } = require('jsdom');
const resources = process.env.LUCI_RESOURCE_DIR;
if (!resources) throw Error('Set LUCI_RESOURCE_DIR to local upstream LuCI resources');
const dom = new JSDOM('<body><div id="maincontent"><div id="view"></div></div></body>', {url:'http://router.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w._=s=>s;w.N_=(n,a,b)=>n===1?a:b;
w.document.body.style.color='#333'; // Explicit theme baseline for neutral labels.
w.eval(fs.readFileSync(path.join(resources,'cbi.js'),'utf8'));
w.eval(fs.readFileSync(path.join(resources,'luci.js'),'utf8').replace('window.LuCI = LuCI;','window.LuCI = LuCI; window.classes=classes; window.environment=env;'));
const mods=w.classes,L=w.L=Object.create(w.LuCI.prototype);
Object.assign(w.environment,{resource:'/resources',scriptname:'/cgi-bin/luci',sessionid:'fixture'});
let writable = process.env.READONLY_TEST !== '1';
L.hasViewPermission=()=>writable;
L.loaded=true;L.require=n=>Promise.resolve(mods[n]);w.E=mods.dom.create.bind(mods.dom);
const hostile='<img src=x onerror="window.auditXss=1"><svg onload="window.auditXss=2"></svg>&';
let notification;
const calls=[],polls=new Map();let overviewError=false,waitOverview=null,waitSave=null,saveError=false;
const sample={timestamp:1000,uptime:100,configured_hw:true,configured_sw:false,monitor:{target:'example.com',enabled:true},jitter:{last_ping:12,deviation:3,loss:4},interfaces:[{device:'lan1',speed:2500,carrier:1,stats:{rx_bytes:10,tx_bytes:20,rx_errors:7,tx_errors:9}}]};
const accelerationSample={hardware:{supported:true,enabled:true,configured:false},vlan:{supported:true,enabled:false,configured:true},pppoe:{supported:false,enabled:null,configured:null},ap:{supported:true,enabled:null,configured:true}};
let accelerationError=false, accelerationSaveError=false, waitAcceleration=null, waitAccelerationSave=null, accelerationPayload;
let staged=null, failure='', hold=null;
mods.request.post=async(url,req)=>{
 if(Array.isArray(req))return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify(req.map(r=>({jsonrpc:'2.0',id:r.id,result:[0,{values:{}}]}))))};
 const method=req.params[2],v=req.params[3];calls.push(method);
 if(req.params[1]==='uci')return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{values:{}}]}))};
 if(hold && method==='saveSettings')await hold.promise;
 let result;
 if(method==='getOverview')result=overviewError?[6]:[0,sample];
 else if(method==='getAcceleration')result=accelerationError?[6]:[0,accelerationSample];
 else if(method==='getSettings')result=[0,{success:true,pending:staged}];
 else if(method==='saveSettings'){if(failure==='save')result=[6];else {staged={...v};result=[0,{success:true}]}}
 else if(method==='applySettings'){
  const a=['hardware','vlan','pppoe','ap'];let acc='unchanged',mon='unchanged';
  if(a.some(k=>staged[k]!==-1)) {acc=failure==='acc'?'failed':'applied';if(acc==='applied')a.forEach(k=>{if(staged[k]!==-1)accelerationSample[k]={supported:true,enabled:!!staged[k],configured:!!staged[k]};staged[k]=-1})}
  if(staged.enabled!==-1){mon=failure==='monitor'?'failed':'applied';if(mon==='applied'){sample.monitor={target:staged.target,enabled:!!staged.enabled};staged.enabled=-1;staged.target=''}}
  const success=acc!=='failed'&&mon!=='failed';if(success)staged=null;
  result=[0,{success,acceleration:acc,monitor:mon}];
 }else throw Error('unexpected RPC '+method);
 return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result}))};
};
function load(name,source){source=source||fs.readFileSync(path.join(resources,name+'.js'),'utf8');const deps=[...source.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);const C=w.Function(...deps,source)(...deps.map(n=>mods[n]));return mods[name]=new C();}
load('rpc');mods.ui={addNotification:(title,node)=>{notification=node;w.document.body.append(node)}};mods.poll.add=(fn,seconds)=>polls.set(seconds,fn);mods.poll.remove=fn=>{for(const [key,value] of polls)if(value===fn)polls.delete(key)};
load('validation');load('uci');mods.session={};mods.fs={};load('ui');mods.network={};mods.uci.load=()=>Promise.resolve();mods.uci.get=()=>null;load('form');
w.LuCI.prototype.hasViewPermission=()=>writable;
const nativeNotify=mods.ui.addNotification.bind(mods.ui);mods.ui.addNotification=(title,node,type)=>{notification=node;return nativeNotify(title,node,type)};
load('app',fs.readFileSync(path.join(__dirname,'../htdocs/luci-static/resources/view/airoha_flowsense/settings.js'),'utf8'));
const settle=()=>new Promise(r=>setTimeout(r,25));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function computedColor(node) {
 // jsdom leaves explicit `inherit` unresolved; follow the CSS inheritance chain.
 const color=w.getComputedStyle(node).color;
 return color==='inherit'||color===''?computedColor(node.parentElement):color;
}
function count(name){return calls.filter(n=>n===name).length;}
(async()=>{
 await settle();await settle();let root=w.document.querySelector('.flowsense-settings');
 const footer=w.document.querySelector('.cbi-page-actions');assert(footer);assert(footer.querySelector('.cbi-button-save'));assert(footer.querySelector('.cbi-button-reset'));assert(footer.querySelector('.cbi-button-apply'));assert(footer.querySelector('.cbi-dropdown'));
 assert.equal(root.querySelectorAll('button,details').length,0);assert.equal(polls.size,0);
 assert.equal(root.querySelectorAll('h2').length,1);assert.equal(root.querySelector('h2').textContent,'Airoha FlowSense');assert(root.querySelector('h2 + .cbi-map-descr'));assert.equal(root.querySelectorAll('input[type=checkbox]').length,5);assert.equal(root.querySelectorAll('select').length,0);
 assert.equal(new Set([...root.querySelectorAll('input[type=checkbox]')].map(n=>n.className)).size,1);
 const edit=(id,value)=>{const n=root.querySelector('[data-name="'+id+'"] input:not([type="hidden"])');if(n.type==='checkbox')n.checked=value;else n.value=value;n.dispatchEvent(new w.Event(n.tagName==='INPUT'&&n.type!=='checkbox'?'input':'change'));};
 const control=id=>root.querySelector('[data-name="'+id+'"] input:not([type="hidden"])');
 assert(control('pppoe').indeterminate);assert(control('pppoe').disabled);
 for(const k of ['hardware','vlan','pppoe','ap'])accelerationSample[k]={supported:true,configured:k!=='ap',enabled:k!=='ap'};
 root.remove();root=await mods.app.render(await mods.app.load());w.document.querySelector('#view').prepend(root);await settle();
 for(const key of ['hardware','vlan','pppoe','ap']){const old=control(key).checked;edit(key,!old);await mods.app.handleSave();assert.equal(staged[key],+!old);await mods.app.handleSaveApply();assert.equal(accelerationSample[key].enabled,!old);edit(key,old);await mods.app.handleSaveApply();}
 edit('hardware',false);edit('target','saved.example');edit('enabled',false);
 const appliesBeforeSave=count('applySettings');footer.querySelector('.cbi-button-save').click();await settle();await settle();assert.equal(count('applySettings'),appliesBeforeSave);
 assert.equal(sample.monitor.target,'example.com');assert.equal(accelerationSample.hardware.enabled,true);assert.equal(staged.target,'saved.example');assert(notification.textContent.includes('not yet applied'));
 edit('target','discard.example');edit('hardware',true);await mods.app.handleReset();assert.equal(control('target').value,'saved.example');assert.equal(control('hardware').checked,false);
 root.remove();await settle();const data=await mods.app.load();root=await mods.app.render(data);w.document.querySelector('#view').prepend(root);await settle();assert.equal(control('target').value,'saved.example');assert.equal(control('hardware').checked,false);
 await mods.app.handleSaveApply();assert.equal(staged,null);assert.equal(sample.monitor.target,'saved.example');assert.equal(accelerationSample.hardware.enabled,false);assert(notification.textContent.includes('saved and applied'));
 edit('target','reset.example');await mods.app.handleReset();assert.equal(control('target').value,'saved.example');
 edit('target','partial.example');edit('hardware',true);failure='monitor';await mods.app.handleSaveApply();assert.equal(staged.hardware,-1);assert.equal(staged.target,'partial.example');assert.equal(accelerationSample.hardware.enabled,true);assert(notification.textContent.includes('Acceleration: Applied'));assert(notification.closest('.alert-message').classList.contains('error'));
 failure='';await mods.app.handleSaveApply();assert.equal(staged,null);assert.equal(sample.monitor.target,'partial.example');
 edit('hardware',false);failure='acc';await mods.app.handleSaveApply();assert.equal(staged.hardware,0);assert(notification.textContent.includes('Probe Settings: Unchanged'));failure='';await mods.app.handleSaveApply();assert.equal(staged,null);
 edit('target','failed.example');failure='save';await mods.app.handleSave();assert.equal(control('target').value,'failed.example');assert(notification.closest('.alert-message').classList.contains('error'));failure='';
 hold=deferred();const first=mods.app.handleSave();await settle();const writes=count('saveSettings');await mods.app.handleSaveApply();await mods.app.handleReset();assert.equal(count('saveSettings'),writes);assert(control('target').disabled);hold.resolve();await first;hold=null;
 writable=false;const before=calls.length;await mods.app.handleSave();await mods.app.handleSaveApply();await mods.app.handleReset();assert.equal(calls.length,before);await mods.app.handleReset();writable=true;
 root.remove();await settle();assert.equal(polls.size,0);
 assert.equal(count('getPpeEntries'),0);assert.equal(count('apply'),0);
 console.log('PASS real LuCI native footer/ComboButton, persistent Save transport, refresh, Reset, double-group/single-group Apply, partial/retry, failure, readonly, guard, telemetry cleanup');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
