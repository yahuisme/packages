// NODE_PATH must point to a directory containing jsdom.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('path').join(__dirname,
 '../htdocs/luci-static/resources/view/fan/status.js'), 'utf8');
const document = new JSDOM('<html><head></head><body></body></html>').window.document;
const frames = [], observers = [], polls = [];
let pending, rejectPending;
class Observer {
 constructor(callback) { this.callback = callback; observers.push(this); }
 observe() {}
 disconnect() { this.disconnected = true; }
}
const context = {
 document, window: {devicePixelRatio: 1, getComputedStyle: () => ({getPropertyValue: () => ''})}, Number, Date,
 _: value => value,
 getComputedStyle: () => ({color:'rgb(230, 230, 230)', getPropertyValue: () => ''}),
 requestAnimationFrame: callback => frames.push(callback),
 ResizeObserver: Observer, MutationObserver: Observer,
 rpc: {declare: () => () => new Promise((resolve, reject) => { pending = resolve; rejectPending = reject; })},
 view: {extend: value => value}, L: {bind: (fn, self) => fn.bind(self)},
 poll: {add: (fn, interval) => polls.push({fn, interval}),
  remove: fn => { const entry = polls.find(p => p.fn === fn); entry.removed = true; }},
 E: (tag, attrs, children) => {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k,v]) => node.setAttribute(k,v));
  (Array.isArray(children) ? children : [children]).forEach(child => {
   if (child != null) node.append(child);
  });
  return node;
 }
};
document.defaultView.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
 get: () => () => {}, set: () => true
});
vm.createContext(context);
const view = vm.runInContext('(function(){'+source+'})()', context);
(async () => {
 const node = view.render({}); document.body.append(node); frames.shift()();
 assert.strictEqual(node.querySelector(':scope > h2').textContent, 'Airoha Fan Status');
 assert.strictEqual(polls[0].interval, 5);
 assert.strictEqual(node.querySelectorAll('.fan-summary-card').length, 4);
 assert.strictEqual(node.querySelectorAll('.fan-temp-card').length, 7);
 const temperatures=[-128,49.9,50,65,65.1,75,75.1];
 const keys=['temp_cpu','temp_board','temp_phy2','temp_phy1','wifi_24g','wifi_5g','wifi_6g'];
 const good={fan_mode:2,uci_mode:'auto',uci_preset:'quiet',fan_rpm:1500,fan_pwm:80,...Object.fromEntries(keys.map((key,i)=>[key,temperatures[i]]))};
 pending(good);
 await new Promise(resolve => setImmediate(resolve));
 const accents=[...node.querySelectorAll('.fan-temp-card')].map(e=>e.style.getPropertyValue('--fan-temp-accent'));
 ['success','success','warning','warning','orange','orange','danger'].forEach((token,i)=>{
  if (token === 'warning') assert.strictEqual(accents[i], '#eab308', 'yellow is fixed clear yellow');
  else if (token === 'orange') assert.strictEqual(accents[i], '#f97316', 'orange is fixed vivid orange');
  else assert(accents[i].startsWith('var(--'+token+','),'temperature threshold '+temperatures[i]+' uses '+token);
 });
 assert.notStrictEqual(accents[3],accents[4],'the 65-degree transition retains its stronger warning color');
 assert(node.querySelector('#fan-summary-rpm').textContent.includes('1500'));
 assert(node.querySelector('#fan-summary-preset').textContent.includes('Configured Curve'));
 assert.strictEqual(node.querySelectorAll(':scope > style').length, 1);
 assert.strictEqual(document.head.querySelectorAll('style').length, 0);
 const w=document.defaultView, proto=w.Element.prototype, query=proto.querySelector, queryAll=proto.querySelectorAll;
 let selectors=0, records=[];
 const changes=new w.MutationObserver(batch=>records.push(...batch));changes.observe(node,{subtree:true,attributes:true,childList:true,characterData:true});
 async function refresh(data,failed=false) {
  changes.takeRecords();records=[];selectors=0;
  proto.querySelector=function(...args){selectors++;return query.apply(this,args);};
  proto.querySelectorAll=function(...args){selectors++;return queryAll.apply(this,args);};
  try {const promise=polls[0].fn();if(failed)rejectPending(new Error('transport'));else pending(data);await promise;}
  finally {proto.querySelector=query;proto.querySelectorAll=queryAll;}
  records.push(...changes.takeRecords());
 }
 await refresh(good);
 assert.strictEqual(selectors,0,'refresh reuses view-scoped DOM references');
 assert.strictEqual(records.length,0,'unchanged values do not write text or styles');
 await refresh({...good,temp_board:49.8});
 assert.strictEqual(records.length,2,'same-band change only writes temperature text and width');
 await refresh(null,true);
 assert([...node.querySelectorAll('.fan-card-sub')].every(e=>e.textContent==='Read failed'));
 assert([...node.querySelectorAll('.fan-temp-value')].every(e=>e.textContent==='—'));
 assert([...node.querySelectorAll('.fan-temp-fill')].every(e=>e.style.width==='0%'));
 assert.strictEqual(node.querySelector('#fan-summary-rpm .fan-card-value').textContent,'—');
 await refresh(null,true);assert.strictEqual(records.length,0,'repeated failure is a no-op');assert.strictEqual(selectors,0);
 await refresh({});
 assert.strictEqual(node.querySelector('#fan-summary-rpm .fan-card-sub').textContent,'—','successful empty data replaces transport failure');
 await refresh(good);
 assert.strictEqual(node.querySelector('#fan-summary-mode .fan-card-sub').textContent,'Following fan curve');
 assert.strictEqual(node.querySelector('#temp-board .fan-temp-value').textContent,'49.9°C');
 // Read live displayed values, not a raw-status equality shortcut.
 node.querySelector('#temp-board .fan-temp-value').textContent='stale';
 await refresh(good);assert.strictEqual(records.length,1);
 assert.strictEqual(node.querySelector('#temp-board .fan-temp-value').textContent,'49.9°C');
 changes.disconnect();
 const promise = polls[0].fn();
 node.remove(); observers[0].callback();
 assert.strictEqual(document.querySelectorAll('.fan-dashboard style').length, 0);
 assert(polls[0].removed); assert(observers.every(o => o.disconnected));
 pending({fan_rpm:9999}); await promise;
 assert(!node.textContent.includes('9999'), 'detached view must ignore in-flight reply');
 console.log('status DOM, polling, layout, observer cleanup and detached RPC: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
