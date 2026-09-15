'use strict';
// Real LuCI Poll + DOM; only the RPC transport is held/rejected.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const resources = process.env.LUCI_RESOURCE_DIR;
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/fan/status.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
 for (const failFirst of [false, true]) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' }), w = dom.window;
  try {
   w.eval(fs.readFileSync(path.join(resources, 'luci.js'), 'utf8').replace('window.LuCI = LuCI;', 'window.LuCI = LuCI;window.mods=classes;'));
   w.E = w.mods.dom.create.bind(w.mods.dom); w._ = s => s;
   const frames = [], requests = [];
   w.requestAnimationFrame = fn => frames.push(fn);
   const app = w.Function('dom', 'poll', 'rpc', 'view', source)(w.mods.dom, w.mods.poll,
    { declare: () => () => new Promise((resolve, reject) => requests.push({ resolve, reject })) }, { extend: x => x });
   const root = app.render({}); w.document.body.append(root); frames.shift()();
   assert.equal(requests.length, 1);
   w.mods.poll.tick = 0; w.mods.poll.step(); await flush();
   assert.equal(requests.length, 1, 'mount and real poll.step share one in-flight request');
   if (failFirst) requests[0].reject(new Error('old transport')); else requests[0].resolve({ fan_rpm: 1000 });
   await flush();
   w.mods.poll.tick = 5; w.mods.poll.step(); await flush();
   assert.equal(requests.length, 2, 'settlement releases the shared guard');
   requests[1].resolve({ fan_rpm: 2000 }); await flush();
   assert.equal(root.querySelector('.fan-card-value').textContent, '2000 RPM');
   w.mods.poll.tick = 10; w.mods.poll.step(); await flush();
   assert.equal(requests.length, 3);
   root.remove(); await flush();
   assert.equal(w.mods.poll.queue.length, 0, 'teardown unregisters without another tick');
   if (failFirst) requests[2].reject(new Error('detached')); else requests[2].resolve({ fan_rpm: 3000 });
   await flush();
   assert.equal(root.querySelector('.fan-card-value').textContent, '2000 RPM', 'detached success/error cannot write');
  } finally { w.close(); }
 }
 console.log('PASS real Poll: held mount success/error, single-flight, retry, detached replies and teardown');
})().catch(e => { console.error(e); process.exitCode = 1; });
