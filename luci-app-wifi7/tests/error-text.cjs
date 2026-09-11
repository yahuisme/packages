// Real LuCI DOM/UI/RPC with isolated error boundaries; never execute injected HTML.
const assert=require('assert/strict');
const {boot}=require('./integration.cjs');
const hostile='<img src=x onerror="window.auditXss=1"><svg onload="window.auditXss=2"></svg>&';
(async()=>{
 for(const mode of ['save','diagnostics']) {
  if(process.env.ERROR_MODE && process.env.ERROR_MODE!==mode)continue;
  const h=await boot();
  try {
   // Keep the real UI notification implementation as well as real DOM creation.
   const notices=[];const native=h.mods.ui.constructor.prototype.addNotification;
   h.mods.ui.addNotification=function(title,node,type){notices.push(node);return native.call(this,title,node,type);};
   if(mode==='save') {
    h.mods.uci.save=()=>Promise.reject(new Error(hostile));
    h.field('radio0','power').value='24';await h.clickSave();
    assert(!h.save.disabled,'write failure restores save');
    assert(!h.field('radio0','power').disabled,'write failure restores editing');
   } else {
    const post=h.mods.request.post;
    h.mods.request.post=async(url,req)=>req.params[3].command==='/usr/libexec/wifi7-diagnostics'
     ? {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32000,message:hostile}}))}
     :post(url,req);
    await h.tab(0);
    const button=[...h.node.querySelectorAll('button')].find(n=>n.textContent.includes('Export'));
    button.click();for(let i=0;i<20&&button.disabled;i++)await new Promise(r=>setTimeout(r,10));
    assert(!button.disabled,'diagnostics failure restores action');
   }
   const node=notices.at(-1);assert(node&&node.isConnected,'real UI mounted notification');
   assert(node.textContent.includes(hostile),'hostile string preserved literally');
   assert.equal(node.querySelectorAll('*').length,0,'no HTML descendants');
   assert.equal(h.w.auditXss,undefined);
   console.log('PASS WiFi '+mode+': literal error, zero elements, controls recovered');
  } finally {h.w.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
