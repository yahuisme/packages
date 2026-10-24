// Native LuCI/RPC transport with property-write accounting, no router services.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'test_view.js');
let source=fs.readFileSync(file,'utf8').split('(async()=>{')[0];
source+=`(async()=>{
 await settle();await settle();const root=w.document.querySelector('.flowsense-settings');assert(root);
 const input=name=>root.querySelector('[data-name="'+name+'"] input:not([type="hidden"])');
 const descriptor=Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'checked');
 let writes=0;
 Object.defineProperty(w.HTMLInputElement.prototype,'checked',{...descriptor,set(value){if(root.contains(this))writes++;descriptor.set.call(this,value)}});
 input('target').value='verified.example';input('target').dispatchEvent(new w.Event('input'));
 writes=0;const before=calls.length;await mods.app.handleSaveApply();
 console.log('Apply successful readback checkbox assignments:',writes);
 assert.equal(writes,5,'one paint per verified Apply readback');
 assert.deepEqual(calls.slice(before),['saveSettings','getSettings','applySettings','getAcceleration','getOverview','getSettings']);
 assert(notification.textContent.includes('saved and applied'));
 // An unavailable saved baseline must still paint the observed runtime once.
 input('target').value='failure-readback.example';input('target').dispatchEvent(new w.Event('input'));
 injected={method:'getSettings',skip:2,result:{success:false,error:'storage'}};
 writes=0;await mods.app.handleSaveApply();
 assert.equal(writes,5,'failed saved readback still paints current runtime once');
 assert.equal(sample.monitor.target,'failure-readback.example');
 assert(notification.textContent.includes('storage space'));
 assert.equal(input('enabled').checked,sample.monitor.enabled);
 console.log('PASS one Apply paint; unchanged RPC sequence; failed saved baseline preserves runtime readback');
 w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(source,file);
