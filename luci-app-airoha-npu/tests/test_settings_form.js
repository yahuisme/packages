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

async function scenario(readonly = false, loadFailure = false, capability = 'present') {
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
  L.require = n => Promise.resolve(mods[n]); L.hasViewPermission = () => !readonly;
  w.E = mods.dom.create.bind(mods.dom);
  mods.uci = { load: async () => {}, loadPackage: async () => {}, get: () => null };
  const calls = [], notices = []; let rejectSave = false, staged = capability === 'fixed' ? { governor: 'schedutil', freq: '800000' } : null, fault = null;
  const runtime = { cpu_governor: 'performance', cpu_max_freq: 1000000 };
  mods.rpc = { declare: spec => async (...args) => {
   calls.push([spec.method, ...args]);
   if (spec.object === 'session') return true;
   if (fault && fault.method === spec.method) {
    if (fault.transport) throw new Error('<img src=x onerror=alert(1)> transport details');
    return { error: fault.code };
   }
   if (spec.method === capability) throw Error('offline');
   if (spec.method === 'getInfo') return capability === 'present' ? { governors: 'performance schedutil', frequencies: '1000000 800000' } : { governors: '', frequencies: '' };
   if (spec.method === 'getStatus') return capability === 'absent' ? { cpu_governor: '', cpu_max_freq: null } : { ...runtime };
   if (spec.method === 'getSettings') { if (loadFailure) throw Error('offline'); return { result: 'ok', pending: staged }; }
   if (rejectSave) return { error: 'write_failed' };
   if (spec.method === 'saveSettings') staged = { governor: args[0], freq: args[1] };
   if (spec.method === 'applySettings') { runtime.cpu_governor = staged.governor; runtime.cpu_max_freq = Number(staged.freq); }
   assert(!spec.method.includes('Flow'), 'CPU settings must never query or manage flow offloading');
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
  if (capability !== 'present') {
   assert.equal(node.querySelectorAll('.cbi-map, .cbi-value, select, input').length, 0, 'no unsupported CPU form');
   assert.equal(w.document.querySelectorAll('.cbi-page-actions button').length, 0, 'no unusable settings footer');
   assert.equal(app.settingsMap, undefined);
   assert.equal(app.handleSave, null); assert.equal(app.handleSaveApply, null); assert.equal(app.handleReset, null);
   assert(node.textContent.includes(w._(['getInfo', 'getStatus'].includes(capability)
    ? 'The operation failed. Refresh the page and try again.' : 'The required system interface is unavailable.')));
   assert.equal(calls.filter(c => /^(set|save|apply)/.test(c[0])).length, 0);
   return;
  }
  assert(node.querySelector('style'), 'settings style belongs to view root');
  assert.equal(w.document.head.querySelectorAll('style').length, 0, 'no persistent head styles');
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
  assert.equal(node.querySelectorAll('.cbi-value').length, 2, 'only native CPU controls must render');
  assert.equal(node.querySelector('.cbi-map-descr').textContent, w._('Configure CPU governor and maximum scaling frequency.'));
  for (const [name, section, expected] of [['governor', 'cpu', 'performance'], ['frequency', 'cpu', '1000000']]) {
   const option = map.lookupOption(name, section)[0];
   assert.equal(option.formvalue(section), expected, `${name} must show the RPC value`);
   assert.ok(option.getUIElement(section), `${name} needs a real LuCI widget`);
  }
  if (readonly || loadFailure) {
   assert.equal(map.readonly, true, 'JSONMap must respect view read-only permission');
   for (const [name, section] of [['governor', 'cpu'], ['frequency', 'cpu']])
    assert.equal(map.lookupOption(name, section)[0].getUIElement(section).options.disabled, true);
   assert.equal(w.document.querySelector('.cbi-button-save').disabled, true);
   map.lookupOption('governor', 'cpu')[0].getUIElement('cpu').setValue('schedutil');
   await map.save();
   await app.handleSaveApply();
   assert.equal(calls.filter(c => /^(set|save|apply)/.test(c[0])).length, 0, 'forced readonly actions must not write');
   return;
  }
  exportDOM('');
  {
   await saveClick();
   assert.equal(calls.filter(c => c[0].startsWith('set')).length, 0, 'unchanged form must not write');
   exportDOM('.noop');
   w.document.querySelectorAll('.alert-message').forEach(n => n.remove());
   for (const [name, section, value] of [['governor', 'cpu', 'schedutil'], ['frequency', 'cpu', '800000']])
    map.lookupOption(name, section)[0].getUIElement(section).setValue(value);
   await saveClick();
   assert.deepEqual(calls.filter(c => c[0].startsWith('set')), [], 'Save must not execute immediate kernel setters');
   assert.equal(notices.at(-1), w._('Settings saved.'));
   assert.deepEqual(runtime, { cpu_governor: 'performance', cpu_max_freq: 1000000 }, 'Save leaves runtime untouched');
   const fresh = new C();
   await fresh.render(await fresh.load());
   assert.equal(fresh.settingsMap.lookupOption('governor', 'cpu')[0].default, 'schedutil', 'reload retrieves saved baseline');
   exportDOM('.saved');
   async function assertSavedReset() {
    await map.reset();
    assert.equal(node.querySelectorAll(':scope > style').length, 1, 'reset retains one responsive layout style');
    for (const [name, section, value] of [['governor', 'cpu', 'schedutil'], ['frequency', 'cpu', '800000']])
     assert.equal(map.lookupOption(name, section)[0].formvalue(section), value, 'reset keeps last confirmed ' + name);
   }
   map.lookupOption('frequency', 'cpu')[0].getUIElement('cpu').setValue('1000000');
   await assertSavedReset();
   await saveClick();
   assert.equal(calls.filter(c => c[0].startsWith('set')).length, 0, 'reset then save must not execute kernel setters');
   w.document.querySelectorAll('.alert-message').forEach(n => n.remove());
   rejectSave = true; map.lookupOption('governor', 'cpu')[0].getUIElement('cpu').setValue('performance');
   let globalApply = 0;
   mods.ui.changes.apply = () => { globalApply++; };
   await assert.rejects(app.handleSaveApply(new w.Event('click'), '0'), /./,
    'failed direct RPC save must remain rejected through native Save & Apply');
   assert.equal(globalApply, 0, 'failed save must never apply unrelated global changes');
   assert.equal(notices.at(-1), w._('The change failed. Previous settings were restored.'));
   exportDOM('.failed');
   rejectSave = false;
   await app.handleSaveApply(new w.Event('click'), '0');
   assert.equal(globalApply, 0, 'direct RPC success also must not apply unrelated global changes');
   assert.deepEqual(runtime, { cpu_governor: 'performance', cpu_max_freq: 800000 });
   assert.equal(notices.at(-1), w._('Settings applied.'));
   map.lookupOption('governor', 'cpu')[0].getUIElement('cpu').setValue('schedutil');
   await map.save();
   await assertSavedReset();
   for (const method of ['saveSettings', 'getSettings', 'applySettings', 'getStatus']) {
    for (const failure of [{transport:true}, {code:'<img src=x onerror=alert(1)>'}, {code:'toString'}]) {
     fault = {method, ...failure};
     await assert.rejects(app.handleSaveApply());
     assert.equal(notices.at(-1), w._(method === 'getStatus' && !failure.transport
      ? 'The required system interface is unavailable.' : 'The operation failed. Refresh the page and try again.'),
      'transport and unknown codes must produce only the localized fallback');
     assert.equal(w.document.querySelectorAll('.alert-message img').length, 0);
    }
   }
   fault = null;
   await app.handleSaveApply();
   assert.equal(notices.at(-1), w._('Settings applied.'));
   assert.equal(globalApply, 0);
   const writes = calls.filter(c => /^(set|save|apply)/.test(c[0])).length;
   L.hasViewPermission = () => false;
   map.lookupOption('governor', 'cpu')[0].getUIElement('cpu').setValue('performance');
   await map.save();
   assert.equal(calls.filter(c => /^(set|save|apply)/.test(c[0])).length, writes,
    'permission revoked after render blocks further writes');
  }
  node.remove();
  assert.equal(w.document.querySelectorAll('style').length, 0, 'view removal cleans settings styles; notifications use native theme');
 } finally { w.close(); }
}
(async () => {
 await scenario(false, false, 'absent'); await scenario(false, false, 'fixed');
 await scenario(false, false, 'getInfo'); await scenario(false, false, 'getStatus');
 await scenario(true); await scenario(false, true); await scenario();
 console.log('PASS real LuCI form: CPU-only controls, RPC defaults, no-op/save/reset, failure and read-only');
})().catch(e => { console.error(e); process.exitCode = 1; });
