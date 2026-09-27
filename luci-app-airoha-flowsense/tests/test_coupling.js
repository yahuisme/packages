// Native LuCI form/footer wired to the path-isolated real UCI/rpcd fixture.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'test_view.js');
let src=fs.readFileSync(file,'utf8').split('(async()=>{')[0];
src+=`(async()=>{
 await settle();await settle();let root=w.document.querySelector('.flowsense-settings');
 const control=k=>root.querySelector('[data-name="'+k+'"] input[type=checkbox]');
 const edit=(k,v)=>{control(k).checked=v;control(k).dispatchEvent(new w.Event('change'));};
 assert.equal(control('vlan').checked,false);assert.equal(control('ap').checked,false);
 edit('vlan',true);
 w.document.querySelector('.cbi-button-apply').click();await settle();await settle();
 assert.equal(notification.textContent,'Settings saved and applied.');
 const data=await mods.app.load();
 assert.equal(data[1].vlan.enabled,true);
 assert.equal(data[1].ap.enabled,false,'VLAN-only apply must preserve unchecked AP');
 assert.equal(data[1].ap.configured,false);
 assert.equal(control('ap').checked,false);
 const base=path.dirname(process.env.MONITOR_RPC);
 const snapshot=()=>Object.fromEntries(['etc/config/firewall','etc/sysctl.d/12-apmode-offload.conf','etc/sysctl.d/14-vlan-offload.conf',...['call-iptables','call-ip6tables','call-arptables','filter-vlan-tagged','pass-vlan-input-dev'].map(k=>'proc/sys/net/bridge/bridge-nf-'+k)].map(p=>{const f=path.join(base,p);return [p,[fs.readFileSync(f,'utf8'),fs.statSync(f).mtimeMs]];}));
 const assertState=async(vlan,ap)=>{const d=await mods.app.load();for(const [k,v] of Object.entries({hardware:true,vlan,pppoe:true,ap})){assert.equal(d[1][k].enabled,v,k+' runtime');assert.equal(d[1][k].configured,v,k+' persistence');assert.equal(control(k).checked,v,k+' checkbox');}return d;};
 const remount=async()=>{root.remove();root=await mods.app.render(await mods.app.load());w.document.querySelector('#view').prepend(root);};
 // No-op must not rewrite production configuration or sysctl fixtures.
 const before=snapshot();await mods.app.handleSaveApply();assert.deepEqual(snapshot(),before);
 // Joint disable, Save/reload/Reset, then Apply must keep both intentions.
 edit('vlan',false);edit('ap',false);await mods.app.handleSave();
 assert.deepEqual(snapshot(),before);let pending=(await mods.app.load())[2].pending;
 assert.equal(pending.vlan,0);assert.equal(pending.ap,0);
 await remount();edit('ap',true);await mods.app.handleReset();assert.equal(control('ap').checked,false);
 await mods.app.handleSaveApply();await assertState(false,false);
 edit('vlan',true);edit('ap',true);await mods.app.handleSaveApply();await assertState(true,true);
 // VLAN-off/AP-on conflicts must not silently switch off the unchanged AP.
 const both=snapshot();edit('vlan',false);await mods.app.handleSaveApply();
 assert(notification.closest('.alert-message').classList.contains('error'));
 assert.deepEqual(snapshot(),both);assert.equal((await mods.app.load())[2].pending.ap,1);
 edit('ap',false);await mods.app.handleSaveApply();await assertState(false,false);
 // AP-on with VLAN-off is likewise rejected and retryable.
 edit('ap',true);await mods.app.handleSaveApply();assert(notification.closest('.alert-message').classList.contains('error'));
 assert.equal((await mods.app.load())[2].pending.vlan,0);
 edit('vlan',true);await mods.app.handleSaveApply();await assertState(true,true);
 // Failed transaction keeps both saved values across reload and retry.
 edit('vlan',false);edit('ap',false);
 const lock=path.join(base,'var/run/flowsense-acceleration.lock');fs.mkdirSync(lock);
 await mods.app.handleSaveApply();assert(notification.closest('.alert-message').classList.contains('error'));
 pending=(await mods.app.load())[2].pending;assert.equal(pending.vlan,0);assert.equal(pending.ap,0);
 fs.rmdirSync(lock);await remount();await mods.app.handleSaveApply();await assertState(false,false);
 // Pending AP intent may not be overwritten when AP telemetry becomes unknown.
 edit('vlan',true);await mods.app.handleSave();
 const knob=path.join(base,'proc/sys/net/bridge/bridge-nf-call-iptables'),old=fs.readFileSync(knob,'utf8');
 fs.writeFileSync(knob,'unknown\\n');await remount();assert(control('ap').disabled);assert(control('ap').indeterminate);
 let writes=count('saveSettings');await mods.app.handleSaveApply();assert.equal(count('saveSettings'),writes);
 fs.writeFileSync(knob,old);await remount();await mods.app.handleSaveApply();await assertState(true,false);
 // An AP readback mismatch must not receive success, even if AP was unchecked and unchanged.
 const actual=(await mods.app.load())[1];edit('vlan',false);
 injected={method:'getAcceleration',result:{...actual,vlan:{supported:true,enabled:false,configured:false},ap:{supported:true,enabled:true,configured:true}}};
 await mods.app.handleSaveApply();assert(notification.closest('.alert-message').classList.contains('error'));assert(notification.textContent.includes('Not verified'));
 injected=null;await remount();await assertState(false,false);
 // Read-only native controls/footer plus forced handlers cannot write.
 writable=false;await remount();for(const k of ['hardware','vlan','pppoe','ap'])assert(control(k).disabled);
 writes=count('saveSettings');await mods.app.handleSave();await mods.app.handleSaveApply();await mods.app.handleReset();assert.equal(count('saveSettings'),writes);
 assert.equal(count('apply'),0);assert(!fs.existsSync(path.join(base,'restarts')));
 console.log('PASS real UCI + native LuCI VLAN/AP intent, joint/bidirectional, no-op, pending/reset, conflict/retry, unknown, readonly');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(src,file);
