// Full native LuCI form/RPC/UI. Python also runs this against private real UCI.
const fs=require('fs'),path=require('path'),Module=require('module');
// Discovery has one entrypoint; exercise both native catalog modes every time.
if (!process.env.FLOWSENSE_REFRESH_WORKER) {
 const {spawnSync}=require('child_process');
 for(const mode of ['0','1']) {
  const result=spawnSync(process.execPath,[__filename],{stdio:'inherit',env:{...process.env,FLOWSENSE_REFRESH_WORKER:'1',ERROR_MESSAGES_TEST:mode}});
  if(result.status!==0)process.exit(result.status||1);
 }
 process.exit(0);
}
const file=path.join(__dirname,'test_view.js');
let source=fs.readFileSync(file,'utf8').split('(async()=>{')[0];
source+=`(async()=>{
 await settle();await settle();let root=w.document.querySelector('.flowsense-settings');
 const input=n=>root.querySelector('[data-name="'+n+'"] input:not([type="hidden"])');
 const edit=(n,v)=>{input(n).value=v;input(n).dispatchEvent(new w.Event('input'));};
 const originalPost=mods.request.post;
 let cases=0;
 for(const fault of ['transport','storage','invalid','acceleration']) {
  if(!process.env.MONITOR_RPC) {
   for(const key of ['hardware','vlan','pppoe','ap'])accelerationSample[key]={supported:true,enabled:true,configured:true};
  }
  root.remove();root=await mods.app.render(await mods.app.load());w.document.querySelector('#view').prepend(root);
  edit('target',fault+'-refresh.example');
  if(!process.env.MONITOR_RPC){input('hardware').checked=false;input('hardware').dispatchEvent(new w.Event('change'));}
  const start=calls.length;
  injected=fault==='acceleration'?{method:'getAcceleration',transport:true}:{method:'getSettings',skip:2,...(fault==='transport'?{transport:true}:{result:{success:false,error:fault,monitor:{target:fault+'-refresh.example',enabled:true}}})};
  await mods.app.handleSaveApply();
  assert(notification.closest('.alert-message').classList.contains('warning'),'confirmed Apply + '+fault+' refresh failure must warn, never report transaction failure: '+notification.textContent);
  assert(notification.textContent.includes(w._('Settings were applied, but the current state could not be refreshed. Retry the read without applying again.')));
  assert.equal(calls.slice(start).filter(n=>n==='applySettings').length,1);
  if(fault==='transport') {assert(input('target').disabled);assert.equal(input('target').value,'','unknown monitor must not display stale requested value');assert(input('enabled').indeterminate);}
  if(fault==='acceleration'){assert(input('hardware').disabled);assert(input('hardware').indeterminate);}
  if(fault==='storage'||fault==='invalid') assert.equal(input('target').value,fault+'-refresh.example','independently observed monitor remains available');
  const retry=[...notification.querySelectorAll('button')].find(n=>n.textContent===w._('Refresh current state'));
  assert(retry,'warning provides an explicit read-only recovery action');
  const writes=calls.filter(n=>/^(saveSettings|applySettings)$/.test(n)).length;
  // Recovery must work with write permission revoked and perform reads only.
  writable=false;retry.click();await settle();await settle();
  assert.equal(calls.filter(n=>/^(saveSettings|applySettings)$/.test(n)).length,writes);
  assert(input('target').disabled);writable=true;
  injected=null;
  // A second read after transport recovery must make the same view usable.
  await mods.app.refreshSettings();
  assert(!input('target').disabled);assert.equal(input('target').value,fault+'-refresh.example');
  assert(!input('hardware').disabled);
  assert.equal(notification.textContent,w._('Current state refreshed.'),'recovery must not leave a stale refresh-failed notice as the last result');
  let nextDesired;
  mods.request.post=async(url,req)=>{if(!Array.isArray(req)&&req.params[2]==='applySettings')nextDesired=JSON.parse(req.params[3].expected);return originalPost(url,req);};
  await mods.app.handleSaveApply();
  assert.deepEqual(nextDesired,{hardware:-1,vlan:-1,pppoe:-1,ap:-1,target:'',enabled:-1},'completed groups must not be reapplied');
  mods.request.post=originalPost;
  assert.equal(notification.textContent,w._('Settings saved and applied.'));
  if(!process.env.MONITOR_RPC)assert.equal(staged,null);
  cases++;
 }
 // A new verified Save is not an old completed checkpoint, even if values match.
 edit('target','saved-again.example');
 injected={method:'getSettings',skip:2,transport:true};await mods.app.handleSaveApply();
 assert(notification.closest('.alert-message').classList.contains('warning'));
 const refresh=[...notification.querySelectorAll('button')].find(n=>n.textContent===w._('Refresh current state'));assert(refresh);
 injected=null;
 if(process.env.MONITOR_RPC) {
  const result=require('child_process').execFileSync(process.env.MONITOR_BUSYBOX,
   ['ash',process.env.MONITOR_RPC,'call','setMonitor'],{input:JSON.stringify({target:'external.example',enabled:1,ubus_rpc_session:'0123456789abcdef0123456789abcdef'}),
    env:{...process.env,PATH:process.env.MONITOR_PATH},encoding:'utf8'});
  assert.equal(JSON.parse(result).success,true);
 } else sample.monitor={target:'external.example',enabled:true};
 await mods.app.refreshSettings();assert.equal(input('target').value,'external.example');
 edit('target','saved-again.example');await mods.app.handleSave();
 assert.equal(notification.textContent,w._('Settings saved; not yet applied.'));
 const saved=(await mods.app.load())[0];
 assert.equal(saved.pending.target,'saved-again.example');assert.equal(saved.monitor.target,'external.example');
 const reads=calls.length;refresh.click();await settle();await settle();
 assert.deepEqual(calls.slice(reads),['getSettings','getAcceleration'],'refreshing a new Save must still be read-only');
 const refreshed=(await mods.app.load())[0];
 const afterRefresh={displayed:input('target').value,pending:refreshed.pending.target,current:refreshed.monitor.target};
 await mods.app.handleSaveApply();const after=(await mods.app.load())[0];
 console.log(JSON.stringify({afterRefresh,afterApply:{current:after.monitor.target,pending:after.pending}}));
 assert.equal(afterRefresh.pending,'saved-again.example');assert.equal(afterRefresh.current,'external.example');
 assert.equal(afterRefresh.displayed,'saved-again.example','newly saved request must not be hidden as an obsolete completed request');
 assert.equal(after.monitor.target,'saved-again.example','Apply must apply the explicitly saved request');assert.equal(after.pending,null);
 assert.equal(notification.textContent,w._('Settings saved and applied.'));
 console.log('PASS newly verified Save survives old completion mask and read-only refresh'+(errorTest?' Chinese':''));
 if(!process.env.MONITOR_RPC) {
  // Successful groups are cleared even when the independent pending read fails.
  edit('target','partial-refresh.example');input('hardware').checked=true;input('hardware').dispatchEvent(new w.Event('change'));
  failure='monitor';injected={method:'getSettings',skip:2,transport:true};await mods.app.handleSaveApply();
  assert(notification.closest('.alert-message').classList.contains('error'),'actual partial failure is still an error');
  assert(notification.textContent.includes(w._('Acceleration')+': '+w._('Applied')));
  assert(notification.textContent.includes(w._('Probe Settings')+': '+w._('Not verified; check current settings.')));
  injected=null;failure='';await mods.app.refreshSettings();
  let desired;
  mods.request.post=async(url,req)=>{if(!Array.isArray(req)&&req.params[2]==='applySettings')desired=JSON.parse(req.params[3].expected);return originalPost(url,req);};
  await mods.app.handleSaveApply();assert.equal(desired.hardware,-1,'successful acceleration group must not be applied again');assert.equal(staged,null);
  mods.request.post=originalPost;
 }
 console.log('PASS '+cases+' confirmed Apply refresh warning/read-only recovery cases'+(process.env.MONITOR_RPC?' with real BusyBox/jshn/UCI':' plus partial failure completion'));w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(source,file);
