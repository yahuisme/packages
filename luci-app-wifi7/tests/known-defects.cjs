// Real LuCI DOM/form/RPC regression; only router transport/storage are fixtures.
const assert = require('assert/strict');
const {boot} = require('./mlo-luci-dom.cjs');
const {boot: wifi} = require('./integration.cjs');

async function main() {
 const test = process.argv[2] || 'text';
 const h = await (test === 'rpc' ? wifi() : boot({iface:{ssid:'<img src=x onerror=window.x=1>'}}));
 try {
  if (test === 'text') {
   assert.equal(h.node.querySelector('img'), null, 'SSID must not create HTML');
   assert.equal(h.node.querySelector('.mlo-overview-primary').textContent, h.db.wireless.test.ssid);
   await h.map.children[0].renderMoreOptionsModal('test');
   assert.equal(h.w.document.querySelector('#modal_overlay img'), null, 'section title must not create HTML');
   h.w.__title = h.map.children[0].sectiontitle('test');
   assert.equal(h.w.eval("E('h3', {}, window.__title).textContent"), h.db.wireless.test.ssid);
  } else if (test === 'lifecycle') {
   const visible = () => {
    assert.equal(h.node.querySelectorAll('[data-mlo-summary-status]').length, 1, 'summary survives native redraw');
    assert.equal(h.node.querySelectorAll('style').length, 1, 'local style survives native redraw');
   };
   visible(); await h.map.reset(); visible();
   const s=h.map.children[0]; await s.renderMoreOptionsModal('test');
   const modal=h.mods.dom.findClassInstance(s.getActiveModalMap());
   modal.children[0].children.find(o=>o.option==='ssid').getUIElement('test').setValue('Changed');
   await s.handleModalSave(modal,{});
   assert.equal(h.db.wireless.test.ssid,'Changed'); visible();
   assert.equal(h.w.document.body.classList.contains('modal-overlay-active'),false);
   await h.map.reset(); visible();
   await s.handleRemove('test',{}); await h.map.reset(); visible();
   assert.equal(h.node.querySelector('.mlo-summary-item strong').textContent,'0');
   h.node.remove(); await new Promise(r=>setImmediate(r));
   assert.equal(h.w.document.querySelector('.mlo-map style'),null);
  } else if (test === 'rpc') {
   await h.tab(3); await h.poll();
   assert.ok(h.q('details'),'initial clients');
   const post=h.mods.request.post; let mode='denied';
   h.mods.request.post=async(url,req)=>{
    const [,obj,method]=req.params;
    if ((obj==='iwinfo'&&method==='assoclist')||obj==='file') {
     if(mode==='denied')return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[6]}))};
     if(mode==='empty')return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,obj==='file'?{code:0,stdout:''}:{results:[]}]}))};
    }
    return post(url,req);
   };
   await h.poll(); assert.match(h.node.textContent,/Client data unavailable/);
   assert.equal(h.q('details'),null,'stale clients removed');
   mode='empty'; await h.poll(); assert.match(h.node.textContent,/No connected clients/);
   assert.doesNotMatch(h.node.textContent,/Client data unavailable/);
   mode='normal'; await h.poll(); assert.ok(h.q('details'),'recovery');
  } else throw Error('unknown case '+test);
  console.log('PASS '+test);
 } finally {h.w.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
