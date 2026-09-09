const fs = require('fs'), assert = require('assert'), { JSDOM } = require('jsdom');
const document = new JSDOM('<body></body>').window.document;
const window = document.defaultView;
let frame, tick, removed = false, fail = false;
function E(tag, attrs, children) {
 const node = document.createElement(tag);
 Object.entries(attrs || {}).forEach(([key, value]) => typeof value === 'function' ? node.addEventListener(key, value) : node.setAttribute(key, value));
 (Array.isArray(children) ? children : [children]).forEach(child => child != null && node.append(child));
 return node;
}
class Observer { observe() {} disconnect() {} }
const source = fs.readFileSync(require('path').join(__dirname, '../htdocs/luci-static/resources/view/airoha_flowsense/status.js'), 'utf8');
const app = new Function('view','rpc','poll','ui','document','window','ResizeObserver','MutationObserver','E','_','requestAnimationFrame', source)(
 { extend: x => x },
 { declare: spec => () => fail ? Promise.reject(Error('offline')) : Promise.resolve({ timestamp: 1000, uptime: 100, configured_hw: null, configured_sw: true, monitor: { target: 'example.com', enabled: true }, jitter: { last_ping: 12, deviation: 0, loss: 0, received: 10, samples: 10 }, interfaces: [], ppe: { available: false } }) },
 { add: fn => { tick = fn; }, remove: fn => { if (fn === tick) removed = true; } },
 { addNotification: () => {} }, document, window, Observer, Observer, E, x => x, fn => { frame = fn; });
(async () => {
 const root = app.render(); document.body.append(root); frame();
 assert(root.querySelector('.flowsense-summary'));
 assert(root.querySelector('.flowsense-section'));
 assert(root.querySelector('details'));
 assert(root.querySelector('#flowsense-target'));
 await tick();
 assert(document.body.textContent.includes('Ethernet Links'));
 fail = true; await tick(); assert(document.body.textContent.includes('previous readings cleared'));
 root.remove(); await tick(); assert(removed);
 console.log('DOM PASS: compact layout, live metrics, invalid data clearing and poll cleanup');
})().catch(error => { console.error(error); process.exit(1); });
