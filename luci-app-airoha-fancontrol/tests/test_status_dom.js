// NODE_PATH must point to a directory containing jsdom.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('path').join(__dirname,
 '../htdocs/luci-static/resources/view/fan/status.js'), 'utf8');
const document = new JSDOM('<html><head></head><body></body></html>').window.document;
const frames = [], observers = [], polls = [];
let pending;
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
 rpc: {declare: () => () => new Promise(resolve => { pending = resolve; })},
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
 assert.strictEqual(polls[0].interval, 5);
 assert.strictEqual(node.querySelectorAll('.fan-summary-card').length, 4);
 assert.strictEqual(node.querySelectorAll('canvas').length, 3);
 assert.strictEqual(node.querySelectorAll('.fan-chart-value').length, 0);
 pending({fan_mode:2,uci_mode:'auto',uci_preset:'quiet',fan_rpm:1500,fan_pwm:80});
 await new Promise(resolve => setImmediate(resolve));
 assert(node.querySelector('#fan-summary-rpm').textContent.includes('1500'));
 assert(node.querySelector('#fan-summary-preset').textContent.includes('Configured Curve'));
 assert.strictEqual(document.querySelectorAll('#fan-theme-css').length, 1);
 const promise = polls[0].fn();
 node.remove(); observers.find(o => o !== observers[0]).callback();
 assert(polls[0].removed); assert(observers.every(o => o.disconnected));
 pending({fan_rpm:9999}); await promise;
 assert(!node.textContent.includes('9999'), 'detached view must ignore in-flight reply');
 console.log('status DOM, polling, layout, observer cleanup and detached RPC: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
