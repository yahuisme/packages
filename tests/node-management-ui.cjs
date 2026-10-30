// Native management actions and server conditional settings, private RPC only.
const assert = require('assert/strict');
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const { walk, FEATURES } = require('./homeproxy-editor-parity.cjs');
const watchdog = setTimeout(() => { console.error('FAIL management paths stalled'); process.exit(1); }, 60000);
async function until(p) { const end = performance.now()+3000; while (!p() && performance.now()<end) await new Promise(r=>setTimeout(r,1)); assert(p(),'native action settled'); }
(async () => {
 for (const name of ['node','server']) {
  const h = await pageBoot(name);
  try {
   h.root().remove(); h.w.document.querySelector('#view').append(await h.app.render(['homeproxy',FEATURES]));
   h.map = h.mods.dom.findClassInstance(h.root());
   const grid = walk(h.map).find(o=>o.option==='type' && o.section.sectiontype===name).section;
   const persisted=JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s]))));
   const post=h.mods.request.post;
   h.mods.request.post=async(url,req)=>{
    const [,object,method,p]=req.params;let value;
    if(object==='uci'&&method==='get')value={values:persisted};
    else if(object==='uci'&&method==='set'){Object.assign(persisted[p.section],p.values);value={};}
    else if(object==='uci'&&method==='add'){persisted[p.name]={'.name':p.name,'.type':p.type,...p.values};value={section:p.name};}
    else if(object==='uci'&&method==='delete'){if(p.options)for(const k of p.options)delete persisted[p.section][k];else delete persisted[p.section];value={};}
    else return post(url,req);
    return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
   };
   const create = h.root().querySelector('.cbi-section-create-name');
   assert(create,'native add identifier');
   create.value = 'cancelled'; create.dispatchEvent(new h.w.Event('keyup',{bubbles:true}));
   const add = h.root().querySelector('.cbi-section-create > .cbi-button-add');
   assert(!add.disabled); add.click(); await until(()=>grid.getActiveModalMap());
   assert(h.mods.uci.get('homeproxy','cancelled'));
   await grid.handleModalCancel(null,{target:add});
   assert.equal(h.mods.uci.get('homeproxy','cancelled'),null,'Cancel removes unsaved new section');
   const createSaved=h.root().querySelector('.cbi-section-create-name');
   createSaved.value='native_added';createSaved.dispatchEvent(new h.w.Event('keyup',{bubbles:true}));
   h.root().querySelector('.cbi-section-create > .cbi-button-add').click();
   await until(()=>grid.getActiveModalMap());
   const addedMap=h.mods.dom.findClassInstance(grid.getActiveModalMap()), addedFields=walk(addedMap);
   for(const [key,value] of Object.entries({type:'socks',address:name==='server'?'127.0.0.1':'added.invalid',port:'2080',label:'Native added'})) {
    const option=addedFields.find(o=>o.option===key);option.getUIElement('native_added').setValue(value);option.triggerValidation('native_added');addedMap.checkDepends();
   }
   await grid.handleModalSave(grid.getActiveModalMap(),{target:add});
   assert.equal(persisted.native_added.type,'socks');assert.equal(persisted.native_added.label,'Native added');
   assert(h.root().querySelector('[data-sid="native_added"]'),'native Add save reloads grid');
   const sid=name==='node'?'n1':'s1';
   const remove=h.root().querySelector('[data-sid="'+sid+'"] .cbi-button-remove');
   assert(remove); remove.click(); await until(()=>!h.mods.uci.get('homeproxy',sid));
   await until(()=>!h.root().querySelector('[data-sid="'+sid+'"]'));
   console.log('PASS '+name+' native Add/Save persists and reloads grouped editor, Cancel discards new section, Remove refreshes grid');
  } finally {h.w.close();}
 }
 const multi=await pageBoot('node');
 try {
  const urls=['https://one.invalid/sub#One','https://two.invalid/sub#Two'];
  multi.mods.uci.set('homeproxy','subscription','subscription_url',urls);
  const hashes=urls.map(url=>multi.mods.homeproxy.calcStringMD5(url.split('#')[0]));
  for(const [i,hash] of hashes.entries()) {
   const id='multi'+i;multi.mods.uci.add('homeproxy','node',id);
   for(const [key,value] of Object.entries({type:'socks',address:'example.invalid',port:'1080',label:'Subscribed '+i,grouphash:hash}))multi.mods.uci.set('homeproxy',id,key,value);
  }
  await multi.map.load();await multi.map.reset();
  const choose=value=>{const select=multi.root().querySelector('.hp-node-source select');select.value=value;select.dispatchEvent(new multi.w.Event('change',{bubbles:true}));};
  const visible=()=>[...multi.root().querySelectorAll('.hp-node-list [data-sid]')].filter(row=>row.style.display!=='none').map(row=>row.dataset.sid);
  assert.equal(multi.root().querySelectorAll('.hp-node-source option').length,3,'manual plus each subscription, no all-source choice');
  choose(hashes[0]);assert.deepEqual(visible(),['multi0']);
  choose(hashes[1]);assert.deepEqual(visible(),['multi1']);
  const grid=walk(multi.map).find(o=>o.option==='type').section;
  await grid.renderMoreOptionsModal('multi1');
  const modal=multi.mods.dom.findClassInstance(grid.getActiveModalMap()), label=walk(modal).find(o=>o.option==='label');
  label.getUIElement('multi1').setValue('Edited subscribed');label.triggerValidation('multi1');await modal.parse();
  multi.mods.ui.hideModal();await multi.map.load();await multi.map.reset();
  assert.equal(multi.root().querySelector('.hp-node-source select').value,hashes[1]);
  assert.equal(multi.mods.uci.get('homeproxy','multi1','label'),'Edited subscribed');
  choose('');assert.deepEqual(visible(),['n1']);
  console.log('PASS multiple subscriptions separate filtering, subscribed modal edit/reset retains selected source, manual fallback');
 } finally {multi.w.close();}
 const h = await pageBoot('server');
 try {
  h.root().remove(); h.w.document.querySelector('#view').append(await h.app.render(['homeproxy',FEATURES]));
  h.map=h.mods.dom.findClassInstance(h.root());
  const grid=walk(h.map).find(o=>o.option==='type'&&o.section.sectiontype==='server').section;
  const global=walk(h.map).find(o=>o.option==='enabled'&&o.section.section==='server');
  global.getUIElement('server').node.querySelector('input[type=checkbox]').click();
  const row=key=>h.root().querySelector('[data-sid="s1"] [data-name="'+key+'"] input[type=checkbox]');
  row('enabled').click(); row('firewall').click();
  await h.map.parse();
  assert.equal(h.mods.uci.get('homeproxy','server','enabled'),'1');
  assert.equal(h.mods.uci.get('homeproxy','s1','enabled'),'0');
  assert.equal(h.mods.uci.get('homeproxy','s1','firewall'),'1');
  await grid.renderMoreOptionsModal('s1');
  const modal=h.mods.dom.findClassInstance(grid.getActiveModalMap()), fields=walk(modal), f=k=>fields.find(o=>o.option===k);
  const set=(k,v)=>{f(k).getUIElement('s1').setValue(v);f(k).triggerValidation('s1');modal.checkDepends();};
  set('type','vless');set('uuid','11111111-1111-4111-8111-111111111111');set('tls','1');
  set('tls_cert_path','/etc/homeproxy/certs/server_publickey.pem');set('tls_key_path','/etc/homeproxy/certs/server_privatekey.pem');
  assert(f('tls_cert_path').isActive('s1'));
  set('tls_acme','1');
  assert(!f('tls_cert_path').isActive('s1')); assert(f('tls_acme_domain').isActive('s1'));
  set('tls_acme_domain',['example.invalid']);set('tls_acme_dsn','example.invalid');set('tls_acme_email','a@example.invalid');set('tls_acme_provider','letsencrypt');
  set('tls_dns01_challenge','1');set('tls_dns01_provider','alidns');
  for(const k of ['tls_dns01_ali_akid','tls_dns01_ali_aksec','tls_dns01_ali_rid'])set(k,'fixture');
  assert(f('tls_dns01_ali_akid').isActive('s1'));assert(!f('tls_dns01_cf_api_token').isActive('s1'));
  set('tls_dns01_provider','cfdns');set('tls_dns01_cf_api_token','fixture-token');
  assert(!f('tls_dns01_ali_akid').isActive('s1'));assert(f('tls_dns01_cf_api_token').isActive('s1'));
  await modal.parse();
  assert.equal(h.mods.uci.get('homeproxy','s1','tls_dns01_cf_api_token'),'fixture-token');
  set('tls_acme','0');set('tls_reality','1');
  assert(!f('tls_acme_email').isActive('s1'));assert(!f('tls_cert_path').isActive('s1'));assert(f('tls_reality_private_key').isActive('s1'));
  set('tls_reality_private_key',Buffer.alloc(32,1).toString('base64'));set('tls_reality_short_id',['aabbccdd']);set('tls_reality_server_addr','example.invalid');set('tls_reality_server_port','443');
  await modal.parse();
  assert.equal(h.mods.uci.get('homeproxy','s1','tls_dns01_cf_api_token'),'fixture-token','hidden ACME credentials retained');
  console.log('PASS server native global/per-row Enable and Firewall clicks; certificate→ACME AliDNS→Cloudflare→REALITY, active blocks and parsed retained credentials');
 } finally {h.w.close();}
 for(const name of ['node','server']) {
  const h=await pageBoot(name);
  try {
   h.root().remove();h.w.document.querySelector('#view').append(await h.app.render(['homeproxy',{}]));
   const fields=walk(h.mods.dom.findClassInstance(h.root())), types=fields.find(o=>o.option==='type'&&o.section.sectiontype===name).keylist;
   for(const type of ['hysteria','hysteria2','tuic','wireguard','naive'])assert(!types.includes(type),'feature-off excludes '+type);
   for(const key of ['tls_utls','tls_acme','grpc_permit_without_stream'])
    assert(!fields.some(o=>o.option===key),'feature-off excludes '+key);
   console.log('PASS '+name+' feature-off native form gates QUIC/WireGuard/uTLS/ACME/gRPC options');
  } finally {h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
