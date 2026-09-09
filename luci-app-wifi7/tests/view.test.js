const {app,document,writes,poll,counters}=require('./harness');
(async()=>{
 document.body.append(await app.render(await app.load()));
 await new Promise(r=>setImmediate(r));
 const assert=require('node:assert/strict');
 const fields=[...document.querySelectorAll('input,select')];
 assert.deepEqual(fields.filter(el=>!el.id||!el.name||!document.querySelector(`label[for="${el.id}"]`)),[]);
 assert.deepEqual([...document.querySelectorAll('[id$="channel"]')].map(el=>el.value),['13','104','37']);
 const power=document.querySelector('[id$="power"]'); power.value='31';
 [...document.querySelectorAll('button')].find(b=>b.textContent==='Save & Apply').click(); await new Promise(r=>setImmediate(r)); assert.equal(writes.length,0);
 assert.equal(counters().diagnosticCalls,0);
 window.confirm=()=>true; [...document.querySelectorAll('button')].find(b=>b.textContent==='Export wireless diagnostics').click();
 await new Promise(r=>setImmediate(r));assert.equal(counters().diagnosticCalls,1);window.confirm=()=>false;
 power.value='25'; const country=document.querySelector('[id$=country]');country.value='US';country.dispatchEvent(new window.Event('change'));
 assert.equal(document.querySelector('[id$=channel]').disabled,true);
 [...document.querySelectorAll('button')].find(b=>b.textContent==='Save & Apply').click();
 await new Promise(r=>setImmediate(r));assert.equal(writes.length,0);
 assert.ok(!document.body.textContent.includes('CAC Passed')); assert.ok(!document.body.textContent.includes('Unlocked'));
 document.querySelectorAll('.cbi-tabmenu a')[3].dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));
 if(process.env.MLO_TEST || process.env.NATIVE_TEST) {
  await new Promise(r=>setTimeout(r,20));
  assert.equal(document.querySelectorAll('details').length,1);
  const detail=document.querySelector('details'); detail.open=true;
  await poll(); assert.equal(document.querySelector('details').open,true);
  assert.ok(document.body.textContent.includes('5 GHz'));
 }
 if(process.env.MLO_TEST){assert.ok(document.body.textContent.includes('37 seconds remaining'));assert.ok(document.body.textContent.includes('-42 dBm'));assert.ok(document.body.textContent.includes('50%'));assert.ok(document.body.textContent.includes('DFS CAC in progress'));}
 if(process.env.NATIVE_TEST) assert.ok(document.body.textContent.includes('1200.0 Mbit/s'));
 if(!process.env.DENIED_TEST) {
  const ch=document.getElementById('wifi7-radio1-channel');
  assert.ok([...ch.options].some(o=>o.value==='36'));
  assert.ok(![...ch.options].some(o=>o.value==='40'));
  assert.ok(![...ch.options].some(o=>o.value==='13'));
 }
 console.log('Feature assertions passed: dynamic channels, folded clients and retained state');
 console.log('DOM assertions passed: labels, current channels, invalid power blocked, no fabricated status');
 console.log(JSON.stringify({fields:fields.length,unlabelled:fields.filter(el=>!el.id||!el.name||!document.querySelector(`label[for="${el.id}"]`)).map(el=>el.outerHTML),channels:[...document.querySelectorAll('select[id$="channel"]')].map(el=>el.value),text:document.body.textContent},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
