// Shared real LuCI loader; status must not import or write settings.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'test_view.js');
let src=fs.readFileSync(file,'utf8').split('(async()=>{')[0].replace('airoha_flowsense/settings.js','airoha_flowsense/status.js');
src+=`(async()=>{
await settle();await settle();const root=w.document.querySelector('.flowsense-dashboard');assert(root);assert.equal(root.querySelectorAll('h2').length,1);assert.equal(root.querySelector('h2').textContent,'Airoha FlowSense');assert(root.querySelector('h2 + .cbi-map-descr'));assert.equal(w.document.querySelectorAll('.cbi-page-actions').length,0);assert.equal(root.querySelectorAll('input,select,button,details').length,0);assert.equal(count('getSettings'),0);
assert.deepEqual([...root.querySelectorAll('.flowsense-acceleration-state')].map(n=>n.textContent),['Enabled','Not enabled','Unknown','Unknown']);assert.equal(root.querySelectorAll('.flowsense-active').length,1);
function assertDots(){const states=[...root.querySelectorAll('.flowsense-acceleration-state')];assert.equal(states.length,4);for(const state of states){const dot=state.querySelector('.flowsense-acceleration-dot');assert(dot);assert.equal(dot.getAttribute('aria-hidden'),'true');assert.equal(dot.textContent,'');assert.equal(state.children.length,2);assert.equal(w.getComputedStyle(dot).backgroundColor,w.getComputedStyle(state).color);assert.equal(w.getComputedStyle(dot).width,'6px');assert.equal(w.getComputedStyle(state).gap,'8px');}}
const accelerationRoot=root.querySelector('.flowsense-acceleration');
const retainedAcceleration=[...accelerationRoot.querySelectorAll('*')];
const changes=[];const observed=new w.MutationObserver(records=>changes.push(...records));observed.observe(accelerationRoot,{subtree:true,childList:true,attributes:true,characterData:true});
await polls.get(5)();await settle();observed.disconnect();
console.log('Acceleration unchanged refresh DOM mutations:',changes.length);
assert.equal(changes.length,0,'unchanged acceleration telemetry must not rewrite DOM');
assert.deepEqual([...accelerationRoot.querySelectorAll('*')],retainedAcceleration,'unchanged acceleration refresh retains its owned DOM');
const rateText=()=>root.querySelectorAll('.flowsense-port-metric dd')[1].textContent;
const totals=()=>[...root.querySelectorAll('.flowsense-summary .flowsense-value')].slice(0,2).map(n=>n.textContent);
sample.interfaces[0].ifindex=3;sample.uptime=105;await polls.get(5)();
sample.interfaces[0].stats.rx_bytes=1000;sample.interfaces[0].stats.tx_bytes=2000;sample.uptime=110;await polls.get(5)();
sample.interfaces[0].ifindex=4;sample.interfaces[0].stats.rx_bytes=100001000;sample.interfaces[0].stats.tx_bytes=200002000;sample.uptime=115;await polls.get(5)();
assert.equal(rateText(),'— / —','same-name recreated interface needs a fresh baseline');assert.deepEqual(totals(),['—','—']);
sample.interfaces[0].stats.rx_bytes+=625000;sample.interfaces[0].stats.tx_bytes+=1250000;sample.uptime=120;await polls.get(5)();
assert.equal(rateText(),'1.0 Mbit/s / 2.0 Mbit/s');assert.deepEqual(totals(),['1.0 Mbit/s','2.0 Mbit/s']);
// Identical output must not rebuild the port rows or rewrite their cells.
const portRows=[...root.querySelectorAll('.flowsense-port')],portCells=[...root.querySelectorAll('.flowsense-port-metric dd')],portMutations=[];
const portObserver=new w.MutationObserver(records=>portMutations.push(...records));
portObserver.observe(root.querySelector('.flowsense-ports'),{subtree:true,childList:true,attributes:true,characterData:true});
sample.interfaces[0].stats.rx_bytes+=625000;sample.interfaces[0].stats.tx_bytes+=1250000;sample.uptime=125;await polls.get(5)();
portObserver.disconnect();
assert.equal(portMutations.length,0,'unchanged port telemetry must not rewrite DOM');
assert.deepEqual([...root.querySelectorAll('.flowsense-port')],portRows,'port rows are reused across refreshes');
assert.deepEqual([...root.querySelectorAll('.flowsense-port-metric dd')],portCells,'metric cells are reused across refreshes');
sample.uptime=130;await polls.get(5)();assert.equal(rateText(),'0.00 Mbit/s / 0.00 Mbit/s');sample.interfaces[0].stats.rx_bytes=0;sample.interfaces[0].stats.tx_bytes=0;sample.uptime=130;await polls.get(5)();assert.equal(rateText(),'— / —');
sample.interfaces[0].stats.rx_bytes=625000;sample.interfaces[0].stats.tx_bytes=1250000;sample.uptime=135;await polls.get(5)();assert.equal(rateText(),'1.0 Mbit/s / 2.0 Mbit/s');
sample.interfaces[0].ifindex=null;sample.uptime=140;await polls.get(5)();
sample.interfaces[0].stats.rx_bytes+=625000;sample.uptime=145;await polls.get(5)();
assert.equal(rateText(),'— / —','unknown identity cannot establish a rate baseline');assert.deepEqual(totals(),['—','—']);
sample.interfaces[0].ifindex=5;sample.uptime=150;await polls.get(5)();assert.equal(rateText(),'— / —');
sample.uptime=155;await polls.get(5)();assert.equal(rateText(),'0.00 Mbit/s / 0.00 Mbit/s');
// A successful RPC may still lack its monotonic sample time. Never subtract
// null as zero or recover rates against a fabricated zero-time baseline.
sample.uptime=null;sample.interfaces[0].stats.rx_bytes+=625000;await polls.get(5)();
assert.equal(rateText(),'— / —','missing uptime must not produce a traffic rate');assert.deepEqual(totals(),['—','—']);
sample.uptime=160;sample.interfaces[0].stats.rx_bytes+=625000;await polls.get(5)();
assert.equal(rateText(),'— / —','first valid uptime after a gap establishes the baseline');
sample.uptime=165;sample.interfaces[0].stats.rx_bytes+=625000;await polls.get(5)();
assert.equal(rateText(),'1.0 Mbit/s / 0.00 Mbit/s');
assertDots();
assert.equal(polls.size,1);overviewError=true;accelerationError=true;await polls.get(5)();await settle();assert.equal(root.querySelector('.flowsense-summary').children.length,0);assert([...root.querySelectorAll('.flowsense-acceleration-state')].every(n=>n.textContent==='Unknown'));assert.equal(root.querySelectorAll('.flowsense-active').length,0);assertDots();
overviewError=false;accelerationError=false;await polls.get(5)();await settle();
assert.deepEqual([...root.querySelectorAll('.flowsense-acceleration-state')].map(n=>n.textContent),['Enabled','Not enabled','Unknown','Unknown'],'identical success recovers after failure');assert.equal(root.querySelectorAll('.flowsense-active').length,1);
root.remove();await settle();assert.equal(polls.size,0);assert.equal(count('saveSettings'),0);assert.equal(count('applySettings'),0);console.log('PASS real LuCI status: unique title/description, runtime only, enabled/disabled/unknown, no footer/controls/settings RPC/PPE, failure cleanup');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(src,file);
