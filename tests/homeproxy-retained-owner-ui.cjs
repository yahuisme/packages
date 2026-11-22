'use strict';
// Native LuCI modal; UCI transport only is private. No browser/core/network.
const assert = require('assert/strict');
const {pageBoot} = require('./helpers/test_page_lifecycle.cjs');
const {walk, FEATURES} = require('./homeproxy-editor-parity.cjs');
(async () => {
 for (const name of process.argv[2] ? [process.argv[2]] : ['node', 'server']) {
  const h = await pageBoot(name);
  try {
   const sid = name === 'node' ? 'n1' : 's1';
   h.root().remove();
   h.w.document.querySelector('#view').append(await h.app.render(['homeproxy', FEATURES]));
   h.map = h.mods.dom.findClassInstance(h.root());
   const persisted = JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s => [s['.name'], s]))));
   Object.assign(persisted[sid], {type:'vless',tls:'1',tls_reality:'1',tls_utls:'firefox',uuid:'11111111-1111-4111-8111-111111111111',tls_cert_path:'/etc/homeproxy/certs/server_publickey.pem',tls_key_path:'/etc/homeproxy/certs/server_privatekey.pem',tls_reality_private_key:'retained-private',tls_reality_public_key:'retained-public',tls_reality_short_id:['aabbccdd'],tls_reality_server_addr:'example.invalid',tls_reality_server_port:'443'});
   const post = h.mods.request.post;
   h.mods.request.post = async (url, req) => {
    const [,obj,method,p] = req.params;
    let value;
    if (obj === 'uci' && method === 'get') value = {values:persisted};
    else if (obj === 'uci' && method === 'set') {Object.assign(persisted[p.section], p.values);value={};}
    else if (obj === 'uci' && method === 'delete') {for (const key of p.options || []) delete persisted[p.section][key];value={};}
    else return post(url,req);
    return {ok:true,status:200,json:() => h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
   };
   h.mods.uci.unload('homeproxy');await h.mods.uci.load('homeproxy');await h.map.load();await h.map.reset();
   const grid = walk(h.map).find(o=>o.option==='type' && o.section.sectiontype===name).section;
   await grid.renderMoreOptionsModal(sid);
   const modal = h.mods.dom.findClassInstance(grid.getActiveModalMap()), fields=walk(modal), f=key=>fields.find(o=>o.option===key);
   const set=(key,value)=>{f(key).getUIElement(sid).setValue(value);f(key).triggerValidation(sid);modal.checkDepends();};
   if(name==='node') {
    set('tls_utls','');
    assert.notEqual(f('tls_utls').validate(sid,''),true,'active REALITY still rejects disabled fingerprint');
    set('tls_utls','firefox');
   }
   set('type','http');
   assert(!f('tls_reality').isActive(sid),'retained REALITY owner is inactive after protocol switch');
   if(name==='node') {
    set('tls_utls','');
    assert.equal(f('tls_utls').validate(sid,''),true,'hidden stale REALITY must not block ordinary HTTP TLS');
    set('tls_utls','android');
    assert.equal(f('tls_utls').validate(sid,'android'),true,'hidden stale VLESS flow/REALITY does not constrain HTTP');
    set('tls_utls','');
   } else {
    assert(f('tls_cert_path').isActive(sid),'HTTP TLS exposes the retained certificate despite inactive REALITY');
    assert(f('tls_key_path').isActive(sid),'HTTP TLS exposes the retained key despite inactive REALITY');
   }
   for(const field of fields)if(field.isActive(sid))field.triggerValidation(sid);
   await modal.save(null,true);
   assert.equal(persisted[sid].tls_reality,'1','inactive REALITY survives native Save');
   assert.equal(persisted[sid].type,'http');
   console.log('PASS '+name+' native REALITY owner-switch validation and retained Save');
  } finally {h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
