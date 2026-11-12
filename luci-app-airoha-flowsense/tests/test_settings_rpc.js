// Native LuCI settings must reuse committed monitor from the pending read RPC.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'test_view.js');
let source=fs.readFileSync(file,'utf8').split('(async()=>{')[0];
source+=`(async()=>{
 await settle();await settle();let root=w.document.querySelector('.flowsense-settings');assert(root);
 const input=name=>root.querySelector('[data-name="'+name+'"] input:not([type="hidden"])');
 const edit=value=>{input('target').value=value;input('target').dispatchEvent(new w.Event('input'));};
 const remount=async()=>{root.remove();root=await mods.app.render(await mods.app.load());w.document.querySelector('#view').prepend(root);};
 assert.equal(count('getOverview'),0,'Settings must not request uptime, jitter or interfaces');
 assert.equal(count('getSettings'),1);assert.equal(count('getAcceleration'),1);
 assert.equal(input('target').value,'example.com');
 edit('saved.example');let before=calls.length;await mods.app.handleSave();
 assert.deepEqual(calls.slice(before),['saveSettings','getSettings']);
 edit('discard.example');await mods.app.handleReset();assert.equal(input('target').value,'saved.example');
 await remount();assert.equal(input('target').value,'saved.example');
 before=calls.length;await mods.app.handleSaveApply();
 assert.deepEqual(calls.slice(before),['saveSettings','getSettings','applySettings','getAcceleration','getSettings']);
 assert.equal(staged,null);assert.equal(sample.monitor.target,'saved.example');
 edit('partial.example');failure='monitor';await mods.app.handleSaveApply();
 assert.equal(staged.target,'partial.example');assert.equal(staged.hardware,-1);
 failure='';await mods.app.handleSaveApply();assert.equal(staged,null);
 overviewError=true;await remount();assert(input('target').disabled);assert(!input('hardware').disabled);
 overviewError=false;await remount();
 // Pending failure must still carry independently observed monitor into readback.
 const post=mods.request.post;let reads=0;
 mods.request.post=async(url,req)=>{
  const response=await post(url,req);
  if(!Array.isArray(req)&&req.params[2]==='getSettings'&&++reads===2)
   return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{success:false,error:'storage',monitor:sample.monitor}]}))};
  return response;
 };
 edit('readback.example');await mods.app.handleSaveApply();assert(notification.textContent.includes('storage space'));
 assert.equal(input('target').value,'readback.example');assert.equal(input('target').disabled,false);
 mods.request.post=post;
 writable=false;await remount();before=calls.length;await mods.app.handleSaveApply();await mods.app.handleReset();assert.equal(calls.length,before);
 assert(input('target').disabled);assert.equal(count('getOverview'),0);assert.equal(polls.size,0);
 console.log('PASS Settings committed monitor reuse, RPC counts, Save/Reset/reload, Apply/partial retry, unknown/readonly and pending-error readback');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(source,file);
