'use strict';
// Native LuCI modal save/reload, private persistent UCI RPC; no browser/service.
const assert = require('assert/strict');
const path = require('path');
process.env.PACKAGES_ROOT = path.resolve(__dirname, '../..');
const {pageBoot} = require('../../tests/helpers/test_page_lifecycle.cjs');
const {walk, FEATURES} = require('../../tests/homeproxy-editor-parity.cjs');
(async () => {
 const h = await pageBoot('server');
 try {
  h.root().remove();
  h.w.document.querySelector('#view').append(await h.app.render(['homeproxy', FEATURES]));
  h.map = h.mods.dom.findClassInstance(h.root());
  const persisted = JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s => [s['.name'], s]))));
  const post = h.mods.request.post;
  h.mods.request.post = async (url, req) => {
   const [, object, method, p] = req.params;
   let value;
   if (object === 'uci' && method === 'get') value = {values:persisted};
   else if (object === 'uci' && method === 'set') {Object.assign(persisted[p.section], p.values); value = {};}
   else if (object === 'uci' && method === 'delete') {for (const k of p.options || []) delete persisted[p.section][k]; value = {};}
   else return post(url, req);
   return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
  };
  let grid = walk(h.map).find(o => o.option === 'type' && o.section.sectiontype === 'server').section;
  for (const provider of ['cfdns', 'alidns', 'cfdns']) {
   await grid.renderMoreOptionsModal('s1');
   const modal = h.mods.dom.findClassInstance(grid.getActiveModalMap());
   const fields = walk(modal), f = key => fields.find(o => o.option === key);
   const set = (key, value) => {f(key).getUIElement('s1').setValue(value); f(key).triggerValidation('s1'); modal.checkDepends();};
   assert.equal(f('tls_dns01_provider').default, 'cfdns', 'retain native stored/UI spelling');
   for (const [key, value] of Object.entries({type:'vless', uuid:'11111111-1111-4111-8111-111111111111',
       tls:'1', tls_acme:'1', tls_acme_domain:['example.invalid'], tls_acme_dsn:'example.invalid',
       tls_acme_email:'fixture@example.invalid', tls_acme_provider:'letsencrypt', tls_dns01_challenge:'1'})) set(key, value);
   // Populate both credential branches via their real active widgets once.
   if (!persisted.s1.tls_dns01_ali_akid) {
    set('tls_dns01_provider','alidns');
    set('tls_dns01_ali_akid','fixture-id'); set('tls_dns01_ali_aksec','fixture-secret'); set('tls_dns01_ali_rid','cn-hangzhou');
    await modal.parse();
   }
   if (!persisted.s1.tls_dns01_cf_api_token) {
    set('tls_dns01_provider','cfdns'); set('tls_dns01_cf_api_token','fixture-token');
    await modal.parse();
   }
   set('tls_dns01_provider', provider);
   assert.equal(f('tls_dns01_ali_akid').isActive('s1'), provider === 'alidns');
   assert.equal(f('tls_dns01_cf_api_token').isActive('s1'), provider === 'cfdns');
   await modal.save();
   assert.equal(persisted.s1.tls_dns01_provider, provider);
   assert.equal(persisted.s1.tls_dns01_ali_aksec, 'fixture-secret');
   assert.equal(persisted.s1.tls_dns01_cf_api_token, 'fixture-token');
   h.mods.ui.hideModal();
   await h.map.load(); await h.map.reset();
   grid = walk(h.map).find(o => o.option === 'type' && o.section.sectiontype === 'server').section;
   assert.equal(h.mods.uci.get('homeproxy','s1','tls_dns01_provider'), provider);
  }
  console.log('PASS native ACME DNS-01 Cloudflare→AliDNS→Cloudflare save/reload preserves inactive credentials and active dependencies');
 } finally {h.w.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
