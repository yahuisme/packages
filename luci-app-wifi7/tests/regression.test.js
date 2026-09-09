const {app,document,uci,config,staged,writes,calls,notices,tick,poll,counters}=require('./harness');
const assert=require('node:assert/strict');
(async()=>{
 let confirmations=0; window.confirm=()=>{confirmations++;return true};
 if(process.env.MISSING_MODE_TEST) delete config.radio0.htmode;
 document.body.append(await app.render(await app.load())); await tick();
 assert.ok(document.body.textContent.includes('Firmware test version'),'load-time firmware');
 assert.equal(calls.filter(c=>c[1]==='/usr/libexec/wifi7-firmware').length,1);
 assert.ok(![...document.getElementById('wifi7-radio0-width').options].some(o=>o.value.startsWith('EHT')),'no invented EHT support');
 const save=[...document.querySelectorAll('button')].find(b=>b.textContent==='Save & Apply');
 if(process.env.READONLY_TEST) {
  assert.equal(save.disabled,true);
  assert.ok([...document.querySelectorAll('input,select')].every(e=>e.disabled));
  save.click(); await tick(); assert.equal(counters().saves,0);
  console.log('PASS readonly controls'); return;
 }
 save.click(); await tick();
 assert.equal(writes.length,0,'untouched optional values must not be written');
 assert.equal(counters().saves,0,'no-op must not save'); assert.equal(counters().applies,0);
 assert.equal(confirmations,0,'unchanged missing mode must not confirm');
 console.log('PASS unchanged form is a no-op');
 const power=document.getElementById('wifi7-radio0-power');
 const country=document.getElementById('wifi7-radio0-country');
 const channel=document.getElementById('wifi7-radio0-channel');
 country.value='00'; country.dispatchEvent(new window.Event('change'));
 assert.equal(country.checkValidity(),true,'world country code is valid');
 let finish; const apply=uci.apply;
 uci.apply=()=>{ apply(); return new Promise(r=>finish=()=>{for(const [s,v] of Object.entries(staged)) Object.assign(config[s],v);r()})};
 save.click(); await tick();
 assert.ok([...document.querySelectorAll('input,select')].every(e=>e.disabled),'saving freezes all controls');
 finish(); await tick();
 // Persist fixture values, as the real apply endpoint does before reload.
 for(const [s,v] of Object.entries(staged)) Object.assign(config[s],v);
 uci.apply=apply;
 assert.equal(channel.disabled,false,'successful country change unlocks refreshed channels');
 assert.ok(counters().loads>1,'wireless configuration must be reloaded');
 const before=counters().saves; save.click(); await tick(); assert.equal(counters().saves,before,'new baseline prevents repeated writes');
 power.value='24'; uci.apply=async()=>{await apply();throw 6};
 save.click(); await tick();
 assert.ok(notices.at(-1)[1].textContent.endsWith('6'),'numeric apply failure is visible');
 assert.equal(power.value,'24'); assert.equal(power.disabled,false);
 const failed=counters().applies; uci.apply=apply; save.click(); await tick();
 assert.equal(counters().applies,failed+1,'failed change must retry apply');
 assert.equal(writes.filter(w=>w[2]==='disabled'||w[2]==='background_radar').length,0);
 console.log('PASS save transaction, country refresh and retry');
 assert.equal(document.querySelectorAll('details').length,0,'hidden clients must not render');
 document.querySelectorAll('.cbi-tabmenu a')[3].dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));
 await new Promise(r=>setTimeout(r,20));
 if(process.env.MLO_TEST || process.env.NATIVE_TEST) {
  const detail=document.querySelector('details'); assert.ok(detail);
  detail.open=true; const summary=detail.querySelector('summary'); summary.focus();
  const first=poll(), second=poll(); assert.equal(first,second,'overlap returns same inflight promise');
  await first; assert.equal(document.querySelector('details'),detail); assert.equal(document.activeElement,summary);
  assert.equal(detail.open,true);
  if(process.env.MLO_TEST) {
   assert.ok(detail.textContent.includes('MLO 8'),'unknown RSSI link retained');
   assert.ok(detail.textContent.includes('600.0 Mbit/s'),'iw rate normalized');
   assert.ok(!detail.textContent.includes('MBit/s'));
  }
  if(process.env.NATIVE_TEST) {
   assert.ok(document.querySelector('.wifi7-grid').textContent.includes('36 / 80 MHz'));
   const last=calls.filter(c=>c[0]==='assoclist');
   assert.equal(last.length,calls.filter(c=>c[0]==='devices').length,'duplicate device RPCs deduplicated');
  }
 }
 assert.equal(calls.filter(c=>c[1]==='/usr/libexec/wifi7-firmware').length,1);
 assert.ok(document.querySelector('style').textContent.includes('.wifi7-grid'));
 console.log('PASS client telemetry, stable DOM and RPC lifecycle');
 power.value='23'; uci.apply=async()=>{await apply();config.radio0.txpower='22'};
 save.click(); await tick(); assert.equal(power.value,'22','reload updates normalized controls');
 power.value='21'; uci.apply=async()=>{await apply();delete config.radio0};
 save.click(); await tick(); assert.ok(power.disabled,'removed radio cannot be written again');

})().catch(e=>{console.error(e);process.exitCode=1});
