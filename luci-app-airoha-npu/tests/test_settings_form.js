'use strict';
// Real upstream LuCI form/DOM/widgets; only RPC and page bootstrap are isolated.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = process.env.LUCI_RESOURCE_DIR;
if (!root) throw new Error('Set LUCI_RESOURCE_DIR to trusted upstream LuCI resources');
const source = fs.readFileSync(process.env.NPU_SETTINGS_JS || path.join(__dirname,
 '../htdocs/luci-static/resources/view/airoha_npu/settings.js'), 'utf8');

async function scenario(unknown = false) {
 const j = new JSDOM('<!doctype html><div id="maincontent"><div id="view"></div></div>',
  { url: 'http://localhost/cgi-bin/luci/admin/system/npu', runScripts: 'outside-only' });
 const w = j.window;
 try {
  w._ = s => s; w.N_ = (n, a, b) => n === 1 ? a : b; w.scrollTo = () => {};
  const read = n => fs.readFileSync(path.join(root, n + '.js'), 'utf8');
  // Avoid cbi's automatic network module fetch; rendering is driven explicitly.
  const add = w.document.addEventListener.bind(w.document);
  w.document.addEventListener = (type, ...args) => { if (type !== 'DOMContentLoaded') add(type, ...args); };
  w.eval(read('cbi'));
  w.document.addEventListener = add;
  require('./l10n')(w);
  w.eval(read('luci').replace('window.LuCI = LuCI;',
   'window.LuCI = LuCI; window.__classes = classes; window.__env = env;'));
  const mods = w.__classes, L = w.L = Object.create(w.LuCI.prototype);
  Object.assign(w.__env, { resource: '/luci-static/resources', media: '/luci-static/bootstrap',
   scriptname: '/cgi-bin/luci', requestpath: ['admin', 'system', 'npu'], sessionid: 'fixture' });
  L.require = n => Promise.resolve(mods[n]); L.hasViewPermission = () => true;
  w.E = mods.dom.create.bind(mods.dom);
  mods.uci = { load: async () => {}, loadPackage: async () => {}, get: () => null };
  const calls = [], notices = []; let rejectSave = false;
  mods.rpc = { declare: spec => async (...args) => {
   calls.push([spec.method, ...args]);
   if (spec.object === 'session') return true;
   if (spec.method === 'getInfo') return { governors: 'performance schedutil', frequencies: '1000000 800000' };
   if (spec.method === 'getStatus') return { cpu_governor: 'performance', cpu_max_freq: 1000000 };
   if (spec.method === 'getFlowOffload') return unknown ? {} : { enabled: false };
   return rejectSave ? { result: 'error', error: 'write_failed' } : { result: 'ok' };
  } };
  mods.fs = {};
  function load(n) {
   const text = n === 'form' && process.env.LUCI_FORM ? fs.readFileSync(process.env.LUCI_FORM, 'utf8') : read(n);
   const deps = [...text.matchAll(/'require ([^';]+)';/g)].map(m => m[1]);
   const C = w.Function(...deps.map(d => d.split(' as ')[1] || d.split('.').at(-1)), text)
    (...deps.map(d => mods[d.split(' as ')[0]]));
   mods[n] = typeof C === 'function' ? new C() : C;
  }
  load('validation'); load('ui'); load('form');
  const notify = mods.ui.addNotification.bind(mods.ui);
  mods.ui.addNotification = (title, node, ...classes) => { notices.push(node.textContent); return notify(title, node, ...classes); };
  // Disable only top-level automatic navigation; use the actual form lifecycle.
  const view = mods.view.extend({ __init__() {} });
  const C = w.Function('view', 'form', 'rpc', 'ui', source)(view, mods.form, mods.rpc, mods.ui);
  const app = new C(), node = await app.render(await app.load());
  w.document.getElementById('view').append(node);
  w.document.getElementById('view').append(app.addFooter());
  const map = mods.dom.findClassInstance(node);
  function exportDOM(suffix) {
   if (!process.env.NPU_SETTINGS_EXPORT) return;
   for (const input of node.querySelectorAll('input')) input.setAttribute('value', input.value);
   fs.writeFileSync(process.env.NPU_SETTINGS_EXPORT + suffix + '.html', w.document.documentElement.outerHTML);
  }
  async function saveClick() {
   let pending; const save = map.save;
   map.save = function() { pending = save.call(this); return pending; };
   const button = w.document.querySelector('.cbi-button-save');
   assert.equal(button.textContent, w._('Save')); button.click();
   await pending; await new Promise(r => setImmediate(r)); map.save = save;
  }
  assert.equal(node.querySelectorAll('.cbi-value').length, 3, 'CPU and firewall settings must render all three controls');
  for (const [name, section, expected] of [['governor', 'cpu', 'performance'], ['frequency', 'cpu', '1000000'], ['flow', 'firewall', unknown ? '' : '0']]) {
   const option = map.lookupOption(name, section)[0];
   assert.equal(option.formvalue(section), expected, `${name} must show the RPC value`);
   assert.ok(option.getUIElement(section), `${name} needs a real LuCI widget`);
  }
  exportDOM(unknown ? '.unknown' : '');
  if (unknown) {
   assert.equal(map.lookupOption('flow', 'firewall')[0].getUIElement('firewall').options.disabled, true);
  } else {
   await saveClick();
   assert.equal(calls.filter(c => c[0].startsWith('set')).length, 0, 'unchanged form must not write');
   exportDOM('.noop');
   w.document.querySelectorAll('.alert-message').forEach(n => n.remove());
   for (const [name, section, value] of [['governor', 'cpu', 'schedutil'], ['frequency', 'cpu', '800000'], ['flow', 'firewall', '1']])
    map.lookupOption(name, section)[0].getUIElement(section).setValue(value);
   await saveClick();
   assert.deepEqual(calls.filter(c => c[0].startsWith('set')), [['setGovernor', 'schedutil'], ['setMaxFreq', '800000'], ['setFlowOffload', '1']]);
   assert.equal(notices.at(-1), w._('Settings applied.'));
   exportDOM('.saved');
   w.document.querySelectorAll('.alert-message').forEach(n => n.remove());
   rejectSave = true; map.lookupOption('governor', 'cpu')[0].getUIElement('cpu').setValue('performance');
   await saveClick();
   assert.equal(notices.at(-1), w._('The change failed and recovery could not be verified. Check the system settings.'));
   exportDOM('.failed');
  }
 } finally { w.close(); }
}
(async () => {
 await scenario(); await scenario(true);
 console.log('PASS real LuCI form: three controls, RPC defaults, no-op/save and unknown read-only');
})().catch(e => { console.error(e); process.exitCode = 1; });
