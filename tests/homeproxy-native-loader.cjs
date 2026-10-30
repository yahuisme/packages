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
 } finally { h.w.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
