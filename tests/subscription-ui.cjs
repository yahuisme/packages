const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../luci-app-homeproxy/htdocs/luci-static/resources/view/homeproxy');
// Only fixed local source slices are evaluated; markup fixtures are constant.
const nativeDir = process.env.LUCI_RESOURCE_DIR;
let nativeMapSave, nativeUCIApply;
if (nativeDir) {
 const formSource = fs.readFileSync(path.join(nativeDir, 'form.js'), 'utf8');
 const uciSource = fs.readFileSync(path.join(nativeDir, 'uci.js'), 'utf8');
 nativeMapSave = new Function('return ({' + formSource.slice(formSource.indexOf('save(cb,silent){'), formSource.indexOf(',reset(){', formSource.indexOf('save(cb,silent){'))) + '}).save')();
 nativeUCIApply = new Function('window','return ({' + uciSource.slice(uciSource.indexOf('apply(timeout=10){'), uciSource.indexOf(',changes:', uciSource.indexOf('apply(timeout=10){'))) + '}).apply')({setTimeout:fn=>setImmediate(fn)});
}
String.prototype.format = function(...args) { let i = 0; return this.replace(/%[sd]/g, () => args[i++]); };
const tick = () => new Promise(r => setImmediate(r));
function fixture() {
 const document = new JSDOM('<body></body>').window.document;
 let urls = [], main = 'a', nodes = [{'.name':'a',grouphash:'sub'}, {'.name':'b',grouphash:'sub'}, {'.name':'user'}];
 const calls = [], options = {}, notices = [];
 let saveError, applyError, execCode = 0, saveGate, applyGate;
 function E(tag, attrs, children) { if (Array.isArray(attrs)) { children=attrs; attrs={}; } const e=document.createElement(tag); for(const [k,v] of Object.entries(attrs||{})) { if(k==='click') e.addEventListener(k,v); else e.setAttribute(k,v); } for(const c of children||[]) e.append(c); return e; }
 const map = {save:async cb => {calls.push('save'); await saveGate; if(saveError) throw saveError; if(cb) await cb(); calls.push('saved');},reset:async()=>calls.push('reset')};
 const uci = {get:(_c,s,k)=>k==='main_node'?main:urls,sections:(_c,_t,cb)=>nodes.forEach(cb),remove:(_c,id)=>{calls.push('remove');nodes=nodes.filter(n=>n['.name']!==id);},set:(_c,_s,_k,v)=>{main=v;},apply:async()=>{calls.push('apply');await applyGate;if(applyError)throw applyError;calls.push('applied');}};
 const ui = {changes:{apply:()=>{throw Error('non-promise apply must not be used for updating');},setIndicator:()=>{}},addNotification:(_t,n)=>notices.push(n.textContent),showModal:(_t,n)=>{document.body.replaceChildren(...n);},hideModal:()=>document.body.replaceChildren(),createHandlerFn:(ctx,fn)=>(ev)=>{Promise.resolve(fn.call(ctx,ev)).catch(e=>{throw e;});}};
 if (nativeMapSave) {
  Object.assign(map, {checkDepends(){},parse:async()=>{calls.push('save');await saveGate;if(saveError)throw saveError;},data:{save:async()=>calls.push('saved')},load:async()=>{},renderContents:async()=>{}});
  map.save = nativeMapSave;
  uci.callApply = async()=>{calls.push('apply');await applyGate;if(applyError)throw applyError;return 0;};
  uci.callConfirm = async()=>{calls.push('applied');return 0;};
  uci.apply = nativeUCIApply;
 }
 const subscriptionURLs={map,formvalue:()=>urls};
 const source=fs.readFileSync(path.join(root,'node.js'),'utf8');
 const begin=source.indexOf("\t\to = s.taboption('subscription', form.Button, '_save_subscriptions'");
 new Function('s','form','uci','data','ui','E','fs','location','_','L','document','subscriptionURLs', 'let o;'+source.slice(begin,source.indexOf('/* Subscriptions settings end */',begin)))({taboption:(_t,_c,id)=>options[id]={map,cbid:()=>id}}, {Button:{}},uci,['homeproxy'],ui,E,{exec:async()=>{calls.push('exec');return {code:execCode,stderr:'failure'};}},{reload:()=>calls.push('reload')},s=>s,{toArray:v=>Array.isArray(v)?v:[v]},document,subscriptionURLs);
 return {options,calls,notices,document,subscriptionURLs,setURLs:v=>urls=v,setNodes:v=>nodes=v,getNodes:()=>nodes,getMain:()=>main,setSaveError:v=>saveError=v,setApplyError:v=>applyError=v,setExecCode:v=>execCode=v,setSaveGate:v=>saveGate=v,setApplyGate:v=>applyGate=v};
}
(async()=>{
 let f=fixture(), update=f.options._update_subscriptions;
 update.inputtitle('subscription'); assert.equal(update.readonly,true);
 f.setURLs(['https://example.com/sub']);update.inputtitle('subscription');assert.equal(update.readonly,false);
 // Native LuCI Button cbid belongs to a hidden input, not the visible button.
 f.document.body.innerHTML='<output for="_update_subscriptions"><button disabled>old</button></output><input type="hidden" id="_update_subscriptions">';
 f.subscriptionURLs.onchange(null,'subscription'); assert.equal(f.document.querySelector('button').disabled,false);
 assert.match(f.document.querySelector('button').textContent,/Save and update 1/);
 f.setURLs([]);f.subscriptionURLs.onchange(null,'subscription');assert.equal(f.document.querySelector('button').disabled,true);
 f=fixture();let releaseSave,releaseApply;
 f.setSaveGate(new Promise(r=>releaseSave=r));f.setApplyGate(new Promise(r=>releaseApply=r));
 const pending=f.options._update_subscriptions.onclick();await tick();assert.deepEqual(f.calls,['save']);
 await f.options._update_subscriptions.onclick();assert.deepEqual(f.calls,['save']);
 releaseSave();await tick();assert.deepEqual(f.calls,['save','saved','apply']);
 releaseApply();await pending;assert.deepEqual(f.calls,['save','saved','apply','applied','exec','reload','reset']);
 for(const error of ['save','apply','exec']) { f=fixture();if(error==='save')f.setSaveError(Error('invalid'));if(error==='apply')f.setApplyError(Error('reject'));if(error==='exec')f.setExecCode(1);await f.options._update_subscriptions.onclick();assert(!f.calls.includes('reload'));if(error!=='exec')assert(!f.calls.includes('exec'));assert.equal(f.notices.length,1); }
 f=fixture();const remove=f.options._remove_subscriptions;remove.onclick();assert.match(f.document.body.textContent,/Remove 2 subscription nodes/);assert.match(f.document.body.textContent,/main node will be cleared/);f.document.querySelector('button').click();await tick();assert.equal(f.getNodes().length,3);assert.equal(f.getMain(),'a');assert.deepEqual(f.calls,[]);
 remove.onclick();f.document.querySelector('.cbi-button-negative').click();await tick();assert.deepEqual(f.getNodes().map(n=>n['.name']),['user']);assert.equal(f.getMain(),'nil');remove.inputtitle();assert.equal(remove.readonly,true);f.setNodes([{'.name':'new',grouphash:'sub'}]);remove.inputtitle();assert.equal(remove.readonly,false);
 f=fixture();f.setSaveError(Error('validation'));f.options._remove_subscriptions.onclick();f.document.querySelector('.cbi-button-negative').click();await tick();assert.equal(f.getNodes().length,3);assert.equal(f.getMain(),'a');
 console.log('PASS: subscription update ordering/failures/single-flight, live readonly, confirmation/cancel/removal/validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
