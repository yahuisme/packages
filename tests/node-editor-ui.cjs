// Native LuCI modal grouping and option retention; no browser or router.
const assert = require('assert/strict');
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const watchdog=setTimeout(()=>{console.error('FAIL editor UI stalled');process.exit(1);},60000);
const { walk, FEATURES } = require('./homeproxy-editor-parity.cjs');
(async()=>{
 for(const [name,sid] of [['node','n1'],['server','s1']]) {
  const h=await pageBoot(name);
  try {
   h.root().remove();
   const source=await h.app.render(['homeproxy',FEATURES]);
   h.w.document.querySelector('#view').append(source);
   h.map=h.mods.dom.findClassInstance(h.root());
   const option=walk(h.map).find(o=>o.option==='type' && o.section.sectiontype===name);
   const grid=option.section;
   // Native Map.save writes and reloads this private persistent UCI transport.
   const persisted=JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s]))));
   const post=h.mods.request.post;
   h.mods.request.post=async(url,req)=>{
    const [,object,method,params]=req.params;
    let value;
    if(object==='uci' && method==='get') value={values:persisted};
    else if(object==='uci' && method==='set') {Object.assign(persisted[params.section],params.values);value={};}
    else if(object==='uci' && method==='delete') {for(const key of params.options||[])delete persisted[params.section][key];value={};}
    else return post(url,req);
    return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
   };
   // Preserve actual inactive persisted settings while switching protocols.
   for(const [key,value] of Object.entries({transport:'ws',ws_host:'preserved.invalid',tls:'0',tls_sni:'retained.invalid',multiplex:'1',multiplex_brutal_up:'47'})) {
    h.mods.uci.set('homeproxy',sid,key,value);persisted[sid][key]=value;
   }
   await h.map.load();await h.map.reset();
   await grid.renderMoreOptionsModal(sid);
   const modal=grid.getActiveModalMap();assert(modal,'native GridSection modal');
   const map=h.mods.dom.findClassInstance(modal);
   assert.deepEqual([...modal.querySelectorAll('.cbi-tabmenu > li')].map(el=>el.dataset.tab),['basic','transport','tls','advanced'],name+' editor has native bounded tabs');
   const fields=walk(map);
   const expected=require('./fixtures/homeproxy-editor-options.json')[name].map(o=>o.option).filter(key=>!['_apply','_latency','_test_latency'].includes(key));
   assert.deepEqual(Array.from(fields,o=>o.option),expected,name+' preserves every supported editor option in order');
   const types=fields.find(o=>o.option==='type').keylist;
   for(const protocol of (name==='node'?['direct','anytls','http','hysteria','hysteria2','shadowsocks','shadowtls','socks','ssh','trojan','tuic','vless','vmess','wireguard']:['anytls','http','hysteria','hysteria2','naive','mixed','shadowsocks','socks','trojan','tuic','vless','vmess']))assert(types.includes(protocol),name+' retains '+protocol);
   for(const key of ['label','type','address','port','password','transport','ws_host','tls','tls_sni','multiplex','tcp_fast_open'])assert(fields.some(o=>o.option===key),name+' retains '+key);
   assert.equal(fields.find(o=>o.option==='type').tab,'basic');
   assert.equal(fields.find(o=>o.option==='ws_host').tab,'transport');
   assert.equal(fields.find(o=>o.option==='tls_sni').tab,'tls');
   assert.equal(fields.find(o=>o.option==='multiplex').tab,'advanced');
   assert(!fields.find(o=>o.option==='ws_host').isActive(sid),'SOCKS hides entire inactive transport block even with saved ws transport');
   assert(!fields.find(o=>o.option==='tls_sni').isActive(sid),'SOCKS hides TLS children');
   for(const key of ['ws_host','tls_sni','multiplex_brutal_up']) {
    const o=fields.find(o=>o.option===key);
    assert.equal(o.retain,true,'inactive '+key+' must be retained');
    await o.parse(sid);
   }
   assert.equal(h.mods.uci.get('homeproxy',sid,'ws_host'),'preserved.invalid');
   assert.equal(h.mods.uci.get('homeproxy',sid,'tls_sni'),'retained.invalid');
   assert.equal(h.mods.uci.get('homeproxy',sid,'multiplex_brutal_up'),'47');
   const field=key=>fields.find(o=>o.option===key);
   const literal='<img src=x onerror=alert(1)> 编辑 & label';
   field('label').getUIElement(sid).setValue(literal);
   field('port').getUIElement(sid).setValue('70000');
   field('port').triggerValidation(sid);
   await assert.rejects(map.parse(),/invalid/i,'native validation rejects an out-of-range port');
   field('port').getUIElement(sid).setValue('1081');
   field('port').triggerValidation(sid);
   await map.save(null,true);
   assert.equal(persisted[sid].label,literal);
   assert.equal(persisted[sid].port,'1081');
   for(const [key,value] of Object.entries({ws_host:'preserved.invalid',tls_sni:'retained.invalid',multiplex_brutal_up:'47'}))assert.equal(persisted[sid][key],value,'Map.save preserves inactive '+key);
   h.mods.ui.hideModal();await h.map.load();await h.map.reset();await grid.renderMoreOptionsModal(sid);
   let active=h.mods.dom.findClassInstance(grid.getActiveModalMap());
   let reopened=walk(active);
   assert.equal(reopened.find(o=>o.option==='label').formvalue(sid),literal,'saved literal label survives reload/reopen');
   assert.equal(grid.getActiveModalMap().querySelectorAll('img').length,0,'literal label never becomes markup');
   const set=(key,value)=>{const o=reopened.find(o=>o.option===key);o.getUIElement(sid).setValue(value);o.triggerValidation(sid);active.checkDepends();};
   set('type','vmess');set('uuid','11111111-1111-4111-8111-111111111111');set('tls','0');
   assert(reopened.find(o=>o.option==='ws_host').isActive(sid),'VMess activates saved WebSocket block');
   set('ws_host','edited.invalid');
   await active.save(null,true);
   assert.equal(persisted[sid].type,'vmess');assert.equal(persisted[sid].ws_host,'edited.invalid');
   h.mods.ui.hideModal();await h.map.load();await h.map.reset();await grid.renderMoreOptionsModal(sid);
   active=h.mods.dom.findClassInstance(grid.getActiveModalMap());reopened=walk(active);
   set('type','socks');
   assert(!reopened.find(o=>o.option==='ws_host').isActive(sid),'protocol change hides stale transport children');
   await active.save(null,true);
   assert.equal(persisted[sid].type,'socks');assert.equal(persisted[sid].ws_host,'edited.invalid');
   assert.equal(persisted[sid].tls_sni,'retained.invalid');
   h.mods.ui.hideModal();await grid.renderMoreOptionsModal(sid);
   assert.equal(grid.getActiveModalMap().querySelectorAll('.cbi-tabmenu > li').length,4,'reopening does not duplicate tabs');
   console.log('PASS '+name+' native Basic/Transport/TLS/Advanced; invalid port rejected; Map.save/reload/reopen; literal label; SOCKS→VMess→SOCKS cascades retain inactive UCI');
  }finally{h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
