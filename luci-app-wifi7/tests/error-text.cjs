// Real LuCI DOM/UI/RPC and compiled Chinese catalog; isolated transport only.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {execFileSync}=require('child_process');
const {boot}=require('./integration.cjs');
const hostile='<img src=x onerror="window.auditXss=1"><svg onload="window.auditXss=2"></svg>&';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wifi7-errors-'));
const old=process.env.WIFI7_LMO;
(async()=>{
 try {
  const po=path.resolve(__dirname,'../po/zh_Hans/wifi7.po'),lmo=path.join(tmp,'wifi7.lmo');
  execFileSync(process.env.PO2LMO||path.resolve(process.env.LUCI_RESOURCE_DIR,'../../../src/po2lmo'),[po,lmo]);
  process.env.WIFI7_LMO=lmo;
  for(const mode of ['save','mlo-apply','mlo-reset','diagnostics']) {
   if(process.env.ERROR_MODE && process.env.ERROR_MODE!==mode)continue;
   const h=await boot();
   try {
    const notices=[],native=h.mods.ui.constructor.prototype.addNotification;
    h.mods.ui.addNotification=function(title,node,type){notices.push(node);return native.call(this,title,node,type);};
    if(mode.startsWith('mlo'))await h.tab(2);
    else await h.tab(mode==='save'?1:0);
    const post=h.mods.request.post;
    let fault;
    const save=h.mods.uci.save;
    h.mods.uci.save=function(...args){return fault.saveError?Promise.reject(new Error(fault.saveError)):save.apply(this,args);};
    h.mods.request.post=async(url,req)=>{
     const [,object,method,p]=req.params;
     const target=mode==='diagnostics'?object==='file'&&p.command==='/usr/libexec/wifi7-diagnostics':object==='uci'&&method===(mode==='mlo-reset'?'revert':'apply');
     if(!target)return post(url,req);
     if(fault.transport)throw new Error(fault.transport);
     const frame=fault.jsonError?{error:{code:-32000,message:fault.jsonError}}:{result:fault.numeric?[0,fault.code]:[fault.code]};
     return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,...frame}))};
    };
    const cases=[...['无效命令','无效参数','方法不存在','资源不存在','未收到数据','权限被拒绝','请求超时','不支持此操作','未指定的错误','连接已断开'].map((reason,i)=>({code:i+1,reason})),{code:999},{code:'toString'},{code:hostile},{jsonError:hostile},{transport:'Permission denied '+hostile}];
    if(mode==='save')cases.push({saveError:hostile},{code:999,numeric:true},{code:'6',numeric:true});
    if(mode==='save'||mode==='mlo-apply')cases.unshift({code:6,numeric:true,reason:'权限被拒绝'});
    for(fault of cases){
     const before=notices.length;
     let button;
     if(mode==='save'){h.field('radio0','power').value='24';await h.clickSave();button=h.save;}
     else {
      button=mode==='diagnostics'?[...h.node.querySelectorAll('button')].find(n=>n.textContent===h.w._('Export wireless diagnostics')):h.q('[data-mlo-action="'+(mode==='mlo-reset'?'reset':'apply')+'"]');
      assert(button&&button.isConnected,'actual localized action must exist: '+mode);
      button.click();for(let i=0;i<300&&(button.disabled||notices.length===before);i++){
       await new Promise(r=>setTimeout(r,10));
       if(mode.startsWith('mlo'))button=h.q('[data-mlo-action="'+(mode==='mlo-reset'?'reset':'apply')+'"]');
      }
     }
     assert(!button.disabled,'failure restores action');
     assert.equal(notices.length,before+1);
     const node=notices.at(-1);assert(node.isConnected,'real UI mounted notification');
     const prefix=mode==='diagnostics'?'无线诊断采集失败':mode==='mlo-reset'?'更新配置失败：':'应用配置失败：';
     const expected=mode==='diagnostics'?prefix:prefix+(fault.reason||'操作失败，请重试。');
     assert.equal(node.textContent,expected,mode+' '+JSON.stringify(fault));
     assert.equal(node.querySelectorAll('*').length,0,'no HTML descendants');
     assert.equal(h.w.auditXss,undefined);
    }
    console.log('PASS Chinese '+mode+': known, unknown, hostile, transport; native notifications and restored controls');
   }finally{h.w.close();}
  }
 }finally{if(old===undefined)delete process.env.WIFI7_LMO;else process.env.WIFI7_LMO=old;fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
