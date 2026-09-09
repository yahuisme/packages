// Compile the actual PO, load LMO values into native LuCI TR, render real forms.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {execFileSync}=require('child_process');
const {boot}=require('./mlo-luci-dom.cjs');
const app=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wifi7-i18n-'));
const converter=process.env.PO2LMO||path.resolve(process.env.LUCI_RESOURCE_DIR,'../../../src/po2lmo');
const previous=process.env.MLO_LMO;
const source=fs.readFileSync(path.join(app,'htdocs/luci-static/resources/wifi7/mlo.js'),'utf8');
(async()=>{
 try {
  const po=path.join(app,'po/zh_Hans/wifi7.po');
  execFileSync('msgfmt',['--check','-o',path.join(tmp,'wifi7.mo'),po],{stdio:'inherit'});
  execFileSync(converter,[po,path.join(tmp,'wifi7.lmo')],{stdio:'inherit'});
  process.env.MLO_LMO=path.join(tmp,'wifi7.lmo');
  const catalog=JSON.parse(execFileSync('python3',['-c',
   'import json,runpy,pathlib,sys; print(json.dumps(runpy.run_path(sys.argv[1])["catalog"](pathlib.Path(sys.argv[2]))))',
   path.join(__dirname,'catalog.test.py'),po],{encoding:'utf8'}));
  const previousTranslations=process.env.WIFI7_TRANSLATIONS;
  fs.writeFileSync(path.join(tmp,'catalog.json'),JSON.stringify(catalog));
  process.env.WIFI7_TRANSLATIONS=path.join(tmp,'catalog.json');
  try {
   const parent=await require('./integration.cjs').boot();
   try {
    const title=parent.q(':scope > h2'),description=parent.q(':scope > .cbi-map-descr');
    assert.equal(title.textContent,'WiFi 7');
    assert.equal(title.nextElementSibling,description);
    assert.equal(description.nextElementSibling,parent.q(':scope > .cbi-tabmenu'));
    assert.equal(description.textContent,'Wi-Fi 7 (802.11be) 和 MLO 设置');
    assert.equal(description.getAttribute('style'),null);
    console.log('PASS native Chinese page description between original title and tabs');
   } finally {parent.w.close();}
  } finally {
   if(previousTranslations===undefined)delete process.env.WIFI7_TRANSLATIONS;
   else process.env.WIFI7_TRANSLATIONS=previousTranslations;
  }
  let x=await boot();
  try {
   for(const [key,value]of Object.entries(catalog))assert.equal(x.w._(key),value,'native translation lookup: '+key);
   assert(x.node.textContent.includes('配置 Wi-Fi 7 多链路操作接口。'));
   assert(x.node.textContent.includes('添加 MLO'));
   assert(x.node.textContent.includes('信道 36'));
   await x.map.children[0].renderMoreOptionsModal('test');
   const modal=x.w.document.querySelector('.modal .cbi-map');assert(modal);
   for(const text of ['常规','安全','高级','射频设备','关联网络','加密','密码短语','802.11w 管理帧保护','启用 WDS / 四地址模式','低 ACK 时断开关联'])assert(modal.textContent.includes(text),'missing modal Chinese: '+text);
   for(const match of source.matchAll(/_\('([^']+)'\)/g)){
    const key=match[1];if(catalog[key]!==key)assert(!modal.textContent.includes(key),'English leaked: '+key);
   }
   const m=x.mods.dom.findClassInstance(modal);
   assert.equal(m.lookupOption('device','test')[0].validate('test',['radio0']),'MLO 至少需要两个射频设备');
   console.log('PASS native cbi.js lookup for '+Object.keys(catalog).length+' catalog entries; Chinese real MLO table, editor and validation');
  } finally {x.j.window.close();}
  x=await boot({unknown:true});
  try{assert(x.node.textContent.includes('运行状态不可用'));assert(!x.node.textContent.includes('Runtime status unavailable'));console.log('PASS translated RPC-unavailable state');}finally{x.j.window.close();}
 } finally {
  if(previous===undefined)delete process.env.MLO_LMO;else process.env.MLO_LMO=previous;
  fs.rmSync(tmp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
