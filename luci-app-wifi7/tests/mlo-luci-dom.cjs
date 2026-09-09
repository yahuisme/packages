// Execute trusted local LuCI modules; UCI/RPC are isolated fixtures.
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
const {JSDOM}=require('jsdom');
const ROOT=process.env.LUCI_RESOURCE_DIR.replace(/\/$/,'')+'/';
const APP=process.env.MLO_JS||require('path').join(__dirname,'../htdocs/luci-static/resources/wifi7/mlo.js');
const SOURCE=fs.readFileSync(APP,'utf8');
async function boot({readonly=false,unknown=false,iface={}}={}) {
 const j=new JSDOM('<!doctype html><html><body><div id="maincontent"><div id="view"></div></div></body></html>',{url:'http://localhost/cgi-bin/luci/admin/network/mlo',runScripts:'outside-only',pretendToBeVisual:true});
 const w=j.window;w.scrollTo=()=>{};
 let core=fs.readFileSync(ROOT+'luci.js','utf8');
 core=core.replace('window.LuCI = LuCI;','window.LuCI = LuCI; window.__classes=classes; window.__env=env;');
 w.eval(fs.readFileSync(ROOT+'cbi.js','utf8'));
 // Use native cbi.js hash lookup, not an identity/string-map translation stub.
 w.TR={};
 if(process.env.MLO_TRANSLATIONS)for(const [key,value] of Object.entries(JSON.parse(fs.readFileSync(process.env.MLO_TRANSLATIONS,'utf8'))))w.TR[w.sfh(w.trimws(key))]=value;
 if(process.env.MLO_LMO){
  const data=fs.readFileSync(process.env.MLO_LMO),index=data.readUInt32BE(data.length-4);
  assert(index<=data.length-4 && (data.length-4-index)%16===0,'invalid LMO index');
  for(let p=index;p<data.length-4;p+=16){const key=data.readUInt32BE(p),offset=data.readUInt32BE(p+8),length=data.readUInt32BE(p+12);assert(offset+length<=index,'invalid LMO value');w.TR[key.toString(16).padStart(8,'0')]=data.subarray(offset,offset+length).toString('utf8');}
 }
 w.eval(core);const mods=w.__classes;const L=w.L=Object.create(w.LuCI.prototype);
 Object.assign(w.__env,{resource:'/luci-static/resources',media:'/luci-static/bootstrap',scriptname:'/cgi-bin/luci',requestpath:['admin','network','mlo'],sessionid:'fixture',apply_rollback:30});
 L.require=n=>Promise.resolve(mods[n]); L.hasViewPermission=()=>!readonly;w.E=mods.dom.create.bind(mods.dom);
 const db={wireless:{radio0:{'.name':'radio0','.type':'wifi-device',band:'5g',channel:'36'},radio1:{'.name':'radio1','.type':'wifi-device',band:'6g',channel:'37'},test:{'.name':'test','.type':'wifi-iface',mode:'ap',ssid:'Audit',mlo:'1',device:['radio0','radio1'],network:['lan'],encryption:'sae',key:'audit-password',ieee80211w:'2',...iface}},network:{lan:{'.name':'lan','.type':'interface'},wwan:{'.name':'wwan','.type':'interface'}},luci:{}};
 const clone=x=>w.JSON.parse(JSON.stringify(x)); for(const c in db)db[c]=clone(db[c]); const writes=[];
 mods.uci={load:async()=>{},loadPackage:async()=>{},get:(c,s,k)=>k==null?db[c]?.[s]:db[c]?.[s]?.[k],get_first:()=>null,sections:(c,t,fn)=>{let a=w.Array.from(Object.values(db[c]||{}).filter(s=>!t||s['.type']===t));if(fn)a.forEach(fn);return a;},set:(c,s,k,v)=>{writes.push(['set',c,s,k,v]);db[c][s][k]=v;},unset:(c,s,k)=>{writes.push(['unset',c,s,k]);delete db[c][s][k];},add:(c,t,s)=>{s=s||'cfgnew';db[c][s]={'.name':s,'.type':t};return s;},remove:(c,s)=>{delete db[c][s];},save:async()=>{},unload:()=>{},changes:async()=>({}),reorder:()=>{},apply:async()=>{}};
 function load(n){const source=fs.readFileSync(ROOT+n+'.js','utf8');const deps=[...source.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);const names=deps.map(x=>x.split(' as ')[1]||x.split('.').at(-1));const values=deps.map(x=>mods[x.split(' as ')[0]]);let C=w.Function(...names,source).apply({},values);mods[n]=typeof C==='function'?new C():C;return mods[n];}
 load('rpc');const rpc=mods.rpc; const replies=[];
 rpc.declare=spec=>async(...args)=>{if(unknown&&spec.object!=='session')throw new Error('fixture RPC unavailable');let value=spec.object==='session'?{access:!readonly}:{radio0:{up:true,config:{band:'5g'},interfaces:[{section:'test',ifname:'ap-mld0',config:{device:['radio0','radio1'],mode:'ap'}}]}};replies.push({spec,args});return new Promise((resolve,reject)=>rpc.handleCallReply({...spec,resolve,reject,priv:[]},clone({jsonrpc:'2.0',result:[0,value]})));};
 mods.fs={};load('validation');load('ui');load('form');
 mods.poll.add=()=>{};
 const src=SOURCE;const deps=['baseclass','form','uci','ui','poll','rpc'];let C=w.Function(...deps,src)(...deps.map(n=>mods[n]));const app=new C();
 const node=await app.render(await app.load());w.document.getElementById('view').append(node);
 const map=mods.dom.findClassInstance(node);return {j,w,mods,db,writes,node,map,app,clone,hash:crypto.createHash('sha256').update(src).digest('hex')};
}
module.exports={boot};
