// Exercise native luci.js L.require: dependency parsing and constructor contract.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
process.env.PACKAGES_ROOT = path.resolve(__dirname, '..');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const watchdog = setTimeout(() => { console.error('FAIL native loader stalled'); process.exit(1); }, 15000);
(async () => {
 const h = await pageBoot('node');
 try {
  const requested = [];
  const original = h.mods.request.get;
  h.mods.request.get = async url => {
   requested.push(url);
   if (url.includes('/homeproxy/subscriptions.js')) return { ok: true, status: 200, url, text: () => fs.readFileSync(path.join(process.env.PACKAGES_ROOT, 'luci-app-homeproxy/htdocs/luci-static/resources/homeproxy/subscriptions.js'), 'utf8') };
   return original(url);
  };
  delete h.mods['homeproxy.subscriptions'];
  h.w.L.require = h.w.LuCI.prototype.require;
  const module = await h.w.L.require('homeproxy.subscriptions');
  assert.equal(typeof module.URLList, 'function');
  assert.equal(await h.w.L.require('homeproxy.subscriptions'), module, 'native loader caches instance');
  assert.equal(requested.filter(url => url.includes('/homeproxy/subscriptions.js')).length, 1);
  console.log('PASS native L.require homeproxy.subscriptions: parses dependencies, accepts subclass constructor, instantiates URLList export and caches module');
  // Use LuCI's compiler for the complete current local view/module chain.
  const localModules = ['homeproxy', 'homeproxy.lifecycle', 'homeproxy.resources', 'homeproxy.subscriptions'];
  h.w.env.base_url = '/luci-static/resources';
  h.mods.request.get = async url => {
   const marker = '/luci-static/resources/', index = url.indexOf(marker);
   const relative = index >= 0 ? url.slice(index + marker.length).split('?')[0] : '';
   if (/^(?:homeproxy(?:\/[^.]+)*\.js|view\/homeproxy\/(?:client|node|server|status)\.js)$/.test(relative)) {
    requested.push(url);
    return {ok:true, status:200, url, text:() => fs.readFileSync(path.join(process.env.PACKAGES_ROOT, 'luci-app-homeproxy/htdocs/luci-static/resources', relative), 'utf8')};
   }
   return original(url);
  };
  for (const name of localModules) delete h.mods[name];
  const initialized = [], nativeInit = h.mods.view.prototype.__init__;
  h.mods.view.prototype.__init__ = function(...args) {
   const ready = nativeInit.apply(this, args);
   initialized.push(ready);
   return ready;
  };
  for (const name of ['client', 'node', 'server', 'status']) {
   const moduleName = 'view.homeproxy.' + name;
   const page = await h.w.L.require(moduleName);
   await initialized.at(-1);
   assert(h.w.document.querySelector('#cbi-homeproxy'), name + ' native route finishes mounting');
   assert.equal(typeof page.render, 'function', name + ' native view compiles and instantiates');
   assert.equal(typeof page.load, 'function', name + ' native view load contract');
   assert.equal(await h.w.L.require(moduleName), page, name + ' native view caches instance');
  }
  for (const name of localModules) assert(h.mods[name], name + ' resolved through native chain');
  console.log('PASS native L.require current Client/Node/Server/Status views and all HomeProxy dependency aliases, constructors and caching');
 } finally { h.w.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
