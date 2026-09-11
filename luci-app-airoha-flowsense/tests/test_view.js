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
const calls=[],polls=new Map();let overviewError=false,waitOverview=null,waitPpe=null,waitSave=null,saveError=false;
const sample={timestamp:1000,uptime:100,configured_hw:true,configured_sw:false,monitor:{target:'example.com',enabled:true},jitter:{last_ping:12,deviation:3,loss:4},interfaces:[{device:'lan1',speed:2500,carrier:1,stats:{rx_bytes:10,tx_bytes:20,rx_errors:7,tx_errors:9}}]};
const ppeSample={available:true,total:1,entries:[{index:'abcd',state:'BND',type:'IPv4'}]};
const accelerationSample={hardware:{supported:true,enabled:true,configured:false},vlan:{supported:true,enabled:false,configured:true},pppoe:{supported:false,enabled:null,configured:null},ap:{supported:true,enabled:null,configured:true}};
let accelerationError=false, accelerationSaveError=false, waitAcceleration=null, waitAccelerationSave=null, accelerationPayload;
mods.request.post=async(url,req)=>{
 const method=req.params[2];calls.push(method);
 if(method==='getAcceleration'&&waitAcceleration)await waitAcceleration.promise;
 if(method==='setAcceleration') { accelerationPayload=req.params[3];if(waitAccelerationSave)await waitAccelerationSave.promise; }
 if(method==='getOverview'&&waitOverview)await waitOverview.promise;
 if(method==='getPpeEntries'&&waitPpe)await waitPpe.promise;
 if(method==='setMonitor') {
  if(waitSave)await waitSave.promise;
  if(!saveError)sample.monitor={target:req.params[3].target,enabled:req.params[3].enabled===1};
 }
 const result=method==='getAcceleration'?(accelerationError?[6]:[0,accelerationSample]):method==='setAcceleration'?[0,{success:!accelerationSaveError}]:method==='getOverview'?(overviewError?[6]:[0,sample]):method==='getPpeEntries'?[0,ppeSample]:method==='setMonitor'?(saveError?[6]:[0,{success:true}]):[6];
 if(method==='setMonitor' && process.env.ERROR_TEXT_TEST==='1')
  return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32000,message:hostile}}))};
 return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result}))};
};
function load(name,source){source=source||fs.readFileSync(path.join(resources,name+'.js'),'utf8');const deps=[...source.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);const C=w.Function(...deps,source)(...deps.map(n=>mods[n]));return mods[name]=new C();}
load('rpc');mods.ui={addNotification:(title,node)=>{notification=node;w.document.body.append(node)}};mods.poll.add=(fn,seconds)=>polls.set(seconds,fn);mods.poll.remove=fn=>{for(const [key,value] of polls)if(value===fn)polls.delete(key)};
load('app',fs.readFileSync(path.join(__dirname,'../htdocs/luci-static/resources/view/airoha_flowsense/status.js'),'utf8'));
const settle=()=>new Promise(r=>setTimeout(r,25));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function computedColor(node) {
 // jsdom leaves explicit `inherit` unresolved; follow the CSS inheritance chain.
 const color=w.getComputedStyle(node).color;
 return color==='inherit'||color===''?computedColor(node.parentElement):color;
}
function count(name){return calls.filter(n=>n===name).length;}
(async()=>{
 await settle();await settle();const root=w.document.querySelector('.flowsense-dashboard');assert(root);assert(polls.has(5));
 if(process.env.ERROR_TEXT_TEST==='1') {
  root.querySelector('#flowsense-target').closest('.cbi-section').querySelector('button').click();await settle();await settle();
  assert(notification,'RPC rejection notification');
  assert(notification.textContent.includes(hostile),'hostile error preserved literally');
  assert.equal(notification.querySelectorAll('*').length,0,'error contains text only');
  assert.equal(w.auditXss,undefined);
  console.log('PASS FlowSense real RPC error text contains no elements');w.close();return;
 }
 if (!writable) {
  const controls=[...root.querySelectorAll('input,button')];
  assert(controls.every(n=>n.disabled),'readonly controls disabled');
  for(const button of root.querySelectorAll('button')) { button.click();button.dispatchEvent(new w.Event('click')); }await settle();
  assert.equal(count('setMonitor'),0,'readonly synthetic handler must not dispatch setter');
  assert.equal(count('setAcceleration'),0,'readonly acceleration setter blocked');
  await polls.get(5)();assert(controls.every(n=>n.disabled),'refresh preserves readonly');
  console.log('PASS readonly controls, native/synthetic clicks, refresh: zero setters');w.close();return;
 }
 assert.equal(root.querySelector(':scope > h2').textContent,'Airoha FlowSense');
 assert.equal(root.querySelector(':scope > h2 + .cbi-map-descr').textContent,'View Ethernet traffic, link quality, and PPE flow entries.');
 assert.equal(w.getComputedStyle(root.querySelector('.flowsense-section .cbi-value')).marginTop,'0px','compact app metric spacing');
 assert(root.querySelector(':scope > .flowsense-status-message'));
 assert.equal(w.getComputedStyle(root.querySelector(':scope > .flowsense-status-message')).textAlign,'right');
 assert.equal(count('getOverview'),1,'load data reused without duplicate RPC');assert.equal(count('getPpeEntries'),0);
 assert.equal(count('getAcceleration'),1,'initial acceleration reused without duplicate RPC');assert.equal(polls.size,2,'no new poll registration');
 assert(root.textContent.includes('12 ms'));assert.equal(root.querySelector('#flowsense-target').labels.length,1);assert.equal(root.querySelector('#flowsense-enabled').labels.length,1);
 const port=root.querySelector('.flowsense-port');
 assert.equal(port.querySelector('.flowsense-status').textContent,'↑Connected');
 assert.equal(w.getComputedStyle(port.querySelector('.flowsense-status-arrow')).color,'rgb(22, 163, 74)');
 assert.equal(w.getComputedStyle(port.querySelector('.flowsense-port-name')).fontWeight,'600');
 assert.equal(port.querySelectorAll('.cbi-value,.cbi-value-title,.cbi-value-field').length,0,'port telemetry must not inherit Aurora form-row margins and right-aligned labels');
 assert.deepEqual([...port.querySelectorAll('dt')].map(n=>n.textContent),['Speed','RX / TX rate','RX / TX errors']);
 assert.deepEqual([...port.querySelectorAll('dd')].map(n=>n.textContent),['2500 Mbit/s','— / —','7 / 9']);
 const overview=polls.get(5),ppePoll=polls.get(30),details=root.querySelector('details');
 await ppePoll();assert.equal(count('getPpeEntries'),0,'closed detail must not scan PPE');
 waitPpe=deferred();details.open=true;await settle();const p1=ppePoll(),p2=ppePoll();assert.equal(count('getPpeEntries'),1,'toggle and poll share PPE request');
 await overview();assert.equal(count('getOverview'),2,'overview independent of blocked PPE');
 overviewError=true;await overview();assert(root.textContent.includes('previous readings cleared'));
 for(const old of ['12 ms','3 ms','4%','2500 Mbit/s','LAN1'])assert(!root.textContent.includes(old),'stale '+old);
 assert.equal(root.querySelector('.flowsense-summary').children.length,0);
 waitPpe.resolve();await Promise.all([p1,p2]);waitPpe=null;assert(!root.textContent.includes('abcd'),'late PPE must not resurrect cleared values');
 overviewError=false;await overview();await ppePoll();assert(root.textContent.includes('abcd'));
 details.open=false;await settle();assert(!root.textContent.includes('abcd'));
 waitPpe=deferred();details.open=true;await settle();details.open=false;await settle();waitPpe.resolve();await ppePoll();await settle();waitPpe=null;assert(!root.textContent.includes('abcd'),'closed disclosure ignores late data');
 waitOverview=deferred();const o1=overview(),o2=overview();assert.equal(count('getOverview'),5,'overview requests single-flight');
 waitPpe=deferred();details.open=true;await settle();const pendingPpe=ppePoll();root.remove();await settle();assert.equal(polls.size,0,'removal unregisters both pollers');const html=root.innerHTML;
 waitOverview.resolve();waitPpe.resolve();await Promise.all([o1,o2,pendingPpe]);assert.equal(root.innerHTML,html,'detached replies cannot mutate DOM');
 const devices=['lan4','usb9','lan2','wan','lan1','lan3','usb2'];
 sample.interfaces=devices.map((device,i)=>({...sample.interfaces[0],device,stats:{rx_bytes:100+i,tx_bytes:200+i,rx_errors:i,tx_errors:i}}));
 const check=mods.app.render(sample);w.document.body.append(check);await settle();
 const names=()=>[...check.querySelectorAll('.flowsense-port-name')].map(n=>n.textContent);
 assert.deepEqual(names(),['WAN','LAN2','LAN3','LAN4','USB9','LAN1','USB2'],'fixed priority, stable extra ports');
 assert.deepEqual(sample.interfaces.map(p=>p.device),devices,'presentation must not mutate identifiers or source order');
 assert.deepEqual([...check.querySelectorAll('.flowsense-port')].map(n=>n.querySelectorAll('dd')[2].textContent),['3 / 3','2 / 2','5 / 5','0 / 0','1 / 1','4 / 4','6 / 6'],'metrics stay with real ports');
 const refresh=polls.get(5);
 const target=check.querySelector('#flowsense-target'),enabled=check.querySelector('#flowsense-enabled'),apply=target.closest('.cbi-section').querySelector('button');
 for(const fail of [false,true]) {
  saveError=fail;waitSave=deferred();target.value=fail?'retry.example':'saved.example';
  target.dispatchEvent(new w.Event('input'));enabled.checked=false;enabled.dispatchEvent(new w.Event('change'));
  apply.click();await settle();
  assert(target.disabled&&enabled.disabled&&apply.disabled,'freeze both editable controls until save settles');
  const writes=count('setMonitor');apply.click();apply.dispatchEvent(new w.Event('click'));await settle();assert.equal(count('setMonitor'),writes,'no duplicate save');
  waitSave.resolve();await settle();await settle();waitSave=null;
  assert(!target.disabled&&!enabled.disabled&&!apply.disabled,'unlock after success or rejection');
  assert.equal(target.value,fail?'retry.example':'saved.example','failed save retains edits');
  assert.equal(enabled.checked,false);
 }
 // Permission revoked while a write is pending must stay locked in finally.
 waitSave=deferred();apply.click();await settle();writable=false;
 waitSave.resolve();await settle();await settle();waitSave=null;
 assert(target.disabled&&enabled.disabled&&apply.disabled,'readonly finally stays locked');
 const writes=count('setMonitor');apply.dispatchEvent(new w.Event('click'));await settle();
 assert.equal(count('setMonitor'),writes,'revoked permission blocks handler');
 writable=true;
 for(const [carrier,label,color] of [[1,'↑Connected','rgb(22, 163, 74)'],[0,'↓Disconnected','rgb(51, 51, 51)'],[null,'—Unknown','rgb(51, 51, 51)'],[true,'↑Connected','rgb(22, 163, 74)'],[false,'↓Disconnected','rgb(51, 51, 51)']]) {
  sample.interfaces.forEach(p=>p.carrier=carrier);await refresh();
  for(const state of check.querySelectorAll('.flowsense-status')) {
   assert.equal(state.textContent,label);
   assert.equal(computedColor(state.firstChild),color);
   assert.equal(computedColor(state.lastChild),carrier?'rgb(22, 163, 74)':'rgb(51, 51, 51)','label computed color');
   assert.equal(w.getComputedStyle(state.firstChild).fontWeight,'600');
   assert.equal(state.firstChild.getAttribute('aria-hidden'),'true');
  }
 }
 sample.interfaces=[sample.interfaces[4],sample.interfaces[1]];await refresh();
 assert.deepEqual(names(),['LAN1','USB9'],'no fabricated priority ports when absent');
 const acceleration=check.querySelector('.flowsense-acceleration'), accelerationButton=acceleration.querySelector('button');
 const inputs=[...acceleration.querySelectorAll('input')], states=()=>[...acceleration.querySelectorAll('.flowsense-acceleration-state')];
 await refresh();await settle();
 assert.equal(acceleration.previousElementSibling.className,'flowsense-summary');
 assert.equal(acceleration.nextElementSibling.querySelector('h3').textContent,'Ethernet Links');
 assert.equal(inputs.length,4);assert(inputs.every(n=>n.labels.length===1));
 for (const input of inputs) {
  assert.equal(input.type,'checkbox','native checkbox accessibility and keyboard semantics');
  assert.equal(w.getComputedStyle(input).appearance,'none','native UA checkbox must not overlay the rectangular toggle');
  assert.equal(w.getComputedStyle(input).width,'48px');
  assert.equal(w.getComputedStyle(input).height,'24px');
  assert.equal(w.getComputedStyle(input).borderRadius,'2px');
  assert.equal(w.document.getElementById(input.getAttribute('aria-describedby')),input.previousElementSibling,'confirmed runtime status is the accessible description, not checked state');
 }
 inputs[0].labels[0].click();assert.equal(inputs[0].checked,true,'native label click changes configured edit');
 assert.equal(states()[0].textContent,'Enabled','native label click leaves real runtime state unchanged');
 inputs[0].labels[0].click();assert.equal(inputs[0].checked,false);
 inputs[2].labels[0].click();assert.equal(inputs[2].checked,false);assert(inputs[2].indeterminate,'disabled unsupported label click retains mixed state');
 assert.deepEqual(states().map(n=>n.textContent),['Enabled','Disabled','Unsupported','Unknown']);
 assert.equal(computedColor(states()[0]),'rgb(22, 163, 74)');assert.equal(computedColor(states()[1]),'rgb(51, 51, 51)');assert.equal(computedColor(states()[3]),'var(--cbi-muted-color,var(--text-muted,#888))','jsdom retains the theme-muted expression');
 assert.deepEqual(inputs.map(n=>n.disabled),[false,false,true,true]);
 assert.deepEqual(inputs.map(n=>n.indeterminate),[false,false,true,true],'unconfirmed controls must not look like ordinary off switches');
 assert.deepEqual(inputs.map(n=>n.checked),[false,true,false,true],'checkbox baseline is configured, not enabled');
 assert.equal(w.getComputedStyle(acceleration.querySelector('label')).fontWeight,'600');
 assert.equal(w.getComputedStyle(acceleration.querySelector('label')).textAlign,'left');
 for(const fail of [false,true]) {
  inputs[0].checked=true;inputs[0].dispatchEvent(new w.Event('change'));
  assert.equal(states()[0].textContent,'Enabled','editing never changes runtime label');
  accelerationSaveError=fail;waitAccelerationSave=deferred();accelerationButton.click();await settle();
  assert(inputs.every(n=>n.disabled));const writes=count('setAcceleration');accelerationButton.dispatchEvent(new w.Event('click'));await settle();assert.equal(count('setAcceleration'),writes);
  assert.deepEqual(JSON.parse(JSON.stringify(accelerationPayload)),{hardware:1,vlan:1,pppoe:-1,ap:-1});
  waitAccelerationSave.resolve();await settle();await settle();waitAccelerationSave=null;
  assert.equal(inputs[0].checked,false,'success or failure restores real readback, never requested state');
  assert.equal(states()[0].textContent,'Enabled');
 }
 assert.equal(count('apply'),0,'local setter never invokes global apply');
 waitAcceleration=deferred();await refresh();const reads=count('getAcceleration');await refresh();assert.equal(count('getAcceleration'),reads,'held sibling remains single-flight without blocking overview');
 waitAcceleration.resolve();waitAcceleration=null;await settle();
 accelerationError=true;await refresh();await settle();assert(states().every(n=>n.textContent==='Unknown'));assert(inputs.every(n=>n.disabled));assert(accelerationButton.disabled);
 assert(inputs.every(n=>n.indeterminate),'failed reads show mixed rather than off');
 accelerationError=false;await refresh();await settle();
 assert.deepEqual(inputs.map(n=>n.indeterminate),[false,false,true,true],'recovery clears mixed state only for confirmed controls');
 // A pre-save read must settle before the setter and a fresh read must follow it.
 waitAcceleration=deferred();await refresh();const beforeSave=count('setAcceleration');accelerationButton.click();await settle();assert.equal(count('setAcceleration'),beforeSave);
 waitAcceleration.resolve();waitAcceleration=null;await settle();await settle();assert.equal(count('setAcceleration'),beforeSave+1);assert.equal(inputs[0].checked,false);
 accelerationSample.hardware={supported:'true',enabled:1,configured:1};await refresh();await settle();assert(inputs[0].disabled);assert.equal(states()[0].textContent,'Unknown','malformed booleans fail closed');
 accelerationSample.hardware={supported:true,enabled:true,configured:false};await refresh();await settle();
 waitAccelerationSave=deferred();accelerationButton.click();await settle();writable=false;waitAccelerationSave.resolve();waitAccelerationSave=null;await settle();await settle();assert(inputs.every(n=>n.disabled));assert(accelerationButton.disabled);
 const accelerationWrites=count('setAcceleration');accelerationButton.dispatchEvent(new w.Event('click'));await settle();assert.equal(count('setAcceleration'),accelerationWrites);writable=true;
 sample.interfaces=[{device:'wan',carrier:1},{device:'lan2',carrier:0},{device:'lan3'},{device:'eth0',carrier:1}];await refresh();
 const physical=()=>check.querySelectorAll('.flowsense-card')[2];
 assert.equal(physical().children.length,3);assert.equal(physical().querySelector('.flowsense-value').textContent,'— / 3');
 sample.interfaces[2].carrier=1;await refresh();assert.equal(physical().querySelector('.flowsense-value').textContent,'2 / 3');
 sample.interfaces=[];await refresh();assert.equal(physical().querySelector('.flowsense-value').textContent,'0 / 0');
 assert.equal(check.querySelectorAll('.flowsense-card').length,4);assert.equal(w.getComputedStyle(physical()).minHeight,'96px');
 assert(!check.textContent.includes('Software flow offload'));assert(!check.textContent.includes('PPE Flow Engine'));
 waitAcceleration=deferred();await refresh();check.remove();await settle();const detached=check.innerHTML;waitAcceleration.resolve();waitAcceleration=null;await settle();assert.equal(check.innerHTML,detached);assert.equal(polls.size,0);
 console.log('PASS real view/RPC errors, initial reuse, all stale metrics cleared, labels, independent single-flight, closed and detached late replies');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
