// Native primary-node button and Map.save; apply/reload is a fixture boundary.
const assert=require('assert/strict');
process.env.PACKAGES_ROOT=require('path').resolve(__dirname,'..');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
const {walk}=require('./homeproxy-editor-parity.cjs');
(async()=>{
 const h=await pageBoot('node',{}, {values:{subnode:{'.type':'node',type:'socks',label:'<img src=x onerror=alert(1)> 订阅',address:'example.invalid',port:'1080',grouphash:'placeholder'}}});
 try {
  const hash=h.mods.homeproxy.calcStringMD5('https://example.invalid/sub');
  h.mods.uci.set('homeproxy','subnode','grouphash',hash);
  const persisted=JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s]))));
  const original=h.mods.request.post, sequence=[];
  h.mods.request.post=async(url,req)=>{
   const [,obj,method,p]=req.params;let value;
   if(obj==='uci'&&method==='get') value={values:persisted};
   else if(obj==='uci'&&method==='set'){sequence.push('set:'+p.section);Object.assign(persisted[p.section],p.values);value={};}
   else if(obj==='uci'&&method==='delete'){for(const key of p.options||[])delete persisted[p.section][key];value={};}
   else return original(url,req);
   return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
  };
  await h.map.load();await h.map.reset();
  const source=()=>h.root().querySelector('.hp-node-source select');
  source().value=hash;source().dispatchEvent(new h.w.Event('change',{bubbles:true}));
  let applied=0;
  h.mods.ui.changes.apply=rollback=>{sequence.push('apply');assert.equal(rollback,true);assert.equal(persisted.config.main_node,'subnode','native Map.save writes primary node before apply');applied++;};
  const applyOption=walk(h.map).find(o=>o.option==='_apply');let pending;
  const onclick=applyOption.onclick;
  applyOption.onclick=function(...args){return pending=onclick.apply(this,args);};
  const button=[...h.root().querySelector('[data-sid="subnode"]').querySelectorAll('button')].find(b=>b.textContent==='Apply');
  assert(button&&!button.disabled);button.click();await pending;
  assert.equal(applied,1);assert(sequence.indexOf('set:config')<sequence.indexOf('apply'));
  assert.equal(source().value,hash,'primary save/reset retains selected source');
  await h.map.load();await h.map.reset();
  const row=h.root().querySelector('[data-sid="subnode"]');
  assert.equal(row.style.display,'');
  assert([...row.querySelectorAll('button')].some(b=>b.textContent==='Applied'&&b.disabled));
  assert.equal(h.root().querySelectorAll('.hp-node-list img').length,0);
  assert.equal(persisted.n1.label,'测试节点','applying subscribed node preserves manual node');
  console.log('PASS primary subscribed node native click→Map.save→apply(true); persisted primary before apply; source retained; reload/reset Applied state; literal labels');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
