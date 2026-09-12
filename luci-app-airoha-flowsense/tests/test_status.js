// Shared real LuCI loader; status must not import or write settings.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'test_view.js');
let src=fs.readFileSync(file,'utf8').split('(async()=>{')[0].replace('airoha_flowsense/settings.js','airoha_flowsense/status.js');
src+=`(async()=>{
await settle();await settle();const root=w.document.querySelector('.flowsense-dashboard');assert(root);assert.equal(root.querySelectorAll('h2').length,1);assert.equal(root.querySelector('h2').textContent,'Airoha FlowSense');assert(root.querySelector('h2 + .cbi-map-descr'));assert.equal(w.document.querySelectorAll('.cbi-page-actions').length,0);assert.equal(root.querySelectorAll('input,select,button,details').length,0);assert.equal(count('getSettings'),0);
assert.deepEqual([...root.querySelectorAll('.flowsense-acceleration-state')].map(n=>n.textContent),['Enabled','Not enabled','Unknown','Unknown']);assert.equal(root.querySelectorAll('.flowsense-active').length,1);
function assertDots(){const states=[...root.querySelectorAll('.flowsense-acceleration-state')];assert.equal(states.length,4);for(const state of states){const dot=state.querySelector('.flowsense-acceleration-dot');assert(dot);assert.equal(dot.getAttribute('aria-hidden'),'true');assert.equal(dot.textContent,'');assert.equal(state.children.length,2);assert.equal(w.getComputedStyle(dot).backgroundColor,w.getComputedStyle(state).color);assert.equal(w.getComputedStyle(dot).width,'6px');assert.equal(w.getComputedStyle(state).gap,'8px');}}
assertDots();
assert.equal(polls.size,1);overviewError=true;accelerationError=true;await polls.get(5)();await settle();assert.equal(root.querySelector('.flowsense-summary').children.length,0);assert([...root.querySelectorAll('.flowsense-acceleration-state')].every(n=>n.textContent==='Unknown'));assert.equal(root.querySelectorAll('.flowsense-active').length,0);assertDots();
root.remove();await settle();assert.equal(polls.size,0);assert.equal(count('saveSettings'),0);assert.equal(count('applySettings'),0);console.log('PASS real LuCI status: unique title/description, runtime only, enabled/disabled/unknown, no footer/controls/settings RPC/PPE, failure cleanup');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(src,file);
