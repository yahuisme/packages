// Native LuCI form/notification checkpoint regression; isolated RPC transport.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'test_view.js');
let source=fs.readFileSync(file,'utf8').split('(async()=>{')[0];
source+=`(async()=>{
 await settle();await settle();const root=w.document.querySelector('.flowsense-settings');assert(root);
 const input=name=>root.querySelector('[data-name="'+name+'"] input:not([type="hidden"])');
 input('target').value='checkpoint.example';input('target').dispatchEvent(new w.Event('input'));
 // Backend completed monitor readback, but publishing pending checkpoint failed.
 const post=mods.request.post;
 mods.request.post=async(url,req)=>{
  if(!Array.isArray(req)&&req.params[2]==='applySettings'){
   sample.monitor={target:staged.target,enabled:!!staged.enabled};
   return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{success:false,error:'storage',acceleration:'applied',monitor:'applied'}]}))};
  }
  return post(url,req);
 };
 await mods.app.handleSaveApply();
 const message=w._('Settings were applied, but the pending record could not be updated. Check storage and retry.');
 assert(notification.textContent.includes(message),notification.textContent);
 assert(notification.textContent.includes(w._('Probe Settings')+': '+w._('Applied')));
 assert(notification.closest('.alert-message').classList.contains('warning'));
 assert.equal(input('target').value,'checkpoint.example');
 mods.request.post=post;
 await mods.app.handleSaveApply();
 assert.equal(staged,null);
 assert(notification.textContent.includes(w._('Settings saved and applied.')));
 // The same completion boundary holds when independent refresh also fails.
 input('target').value='checkpoint-refresh.example';input('target').dispatchEvent(new w.Event('input'));
 mods.request.post=async(url,req)=>{
  if(!Array.isArray(req)&&req.params[2]==='applySettings'){
   sample.monitor={target:staged.target,enabled:!!staged.enabled};
   return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{success:false,error:'storage',acceleration:'unchanged',monitor:'applied'}]}))};
  }
  return post(url,req);
 };
 injected={method:'getSettings',skip:2,transport:true};await mods.app.handleSaveApply();
 assert(notification.closest('.alert-message').classList.contains('warning'));assert(notification.textContent.includes(message));
 assert.equal(input('target').value,'');assert(input('enabled').indeterminate);
 const refresh=notification.querySelector('button');assert(refresh);
 injected=null;writable=false;const reads=calls.length;refresh.click();await settle();await settle();
 assert.deepEqual(calls.slice(reads),['getSettings','getAcceleration'],'checkpoint recovery is read-only');
 writable=true;await mods.app.refreshSettings();assert.equal(input('target').value,'checkpoint-refresh.example');
 mods.request.post=post;
 let retryDesired;
 mods.request.post=async(url,req)=>{if(!Array.isArray(req)&&req.params[2]==='applySettings')retryDesired=JSON.parse(req.params[3].expected);return post(url,req);};
 await mods.app.handleSaveApply();assert.equal(retryDesired.enabled,-1);assert.equal(retryDesired.hardware,-1);assert.equal(staged,null);
 mods.request.post=post;
 staged={hardware:-1,vlan:-1,pppoe:-1,ap:-1,target:'another-session.example',enabled:0};
 await mods.app.refreshSettings();assert.equal(input('target').value,'another-session.example',"completion masking cannot discard another session's different request");
 await mods.app.handleSaveApply();assert.equal(sample.monitor.target,'another-session.example');assert.equal(staged,null);
 writable=false;const n=calls.length;await mods.app.handleSaveApply();assert.equal(calls.length,n);
 console.log('PASS native checkpoint completion warning, readback, retry, readonly'+(errorTest?' Chinese':''));w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(source,file);
