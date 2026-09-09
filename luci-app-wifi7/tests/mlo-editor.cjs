const fs=require('fs'),assert=require('assert/strict');
const {JSDOM}=require('jsdom');global.document=new JSDOM('<body/>').window.document;
String.prototype.format=function(...a){let i=0;return this.replace(/%[sd]/g,()=>a[i++]);};
const E=(tag,attrs,children)=>{if(Array.isArray(attrs)||typeof attrs==='string'){children=attrs;attrs={}};let n=document.createElement(tag);for(let [k,v]of Object.entries(attrs||{})){if(typeof v==='function')n.addEventListener(k,v);else if(v!=null)n.setAttribute(k,v)};for(let c of [children].flat(Infinity))if(c!=null)n.append(c);return n};
const root=process.env.LUCI_RESOURCE_DIR+'/';
function extract(file,name,last=false){let src=fs.readFileSync(root+file,'utf8');if(last)src=src.slice(src.indexOf('const CBIGridSection ='));let a=src.indexOf('\t'+name+'('),b=src.indexOf('\n\t},',a);return Function('dom','return ({'+src.slice(a,b+4)+'})')({})[name]}
const nativeAdd=extract('form.js','handleAdd',true),nativeCancel=extract('form.js','handleModalCancel',true);
let grid,map,records={},modalCalls=0;
const uci={load:()=>Promise.resolve(),sections:(c,t)=>Object.values(records).filter(r=>r['.type']===t),get:(c,s,k)=>k?records[s]?.[k]:records[s],add:(c,t,s)=>{s=s||'new0';records[s]={'.name':s,'.type':t};return s},set:(c,s,k,v)=>records[s][k]=v,remove:(c,s)=>delete records[s]};
const form={GridSection:{prototype:{handleAdd:nativeAdd,renderMoreOptionsModal:()=>{modalCalls++;return Promise.resolve()},renderRowActions:()=>E('td',{},E('button',{},'Edit'))}},Map:function(c){map=this;this.config=c;this.data=uci;this.chain=()=>{};this.section=()=>grid={map:this,sectiontype:'wifi-iface',children:[],tab:()=>{},getPreviousModalMap:()=>null,renderMoreOptionsModal:form.GridSection.prototype.renderMoreOptionsModal,super:()=>Promise.resolve(),option:function(type,name,title){let o={option:name,title,section:this,choices:[],value:function(v){this.choices.push(v)},depends:()=>{},formvalue:s=>uci.get(c,s,name)};this.children.push(o);return o},taboption:function(t,...args){return this.option(...args)}};this.render=()=>Promise.reject(Error('STOP'));}};
const L={toArray:v=>v==null?[]:Array.isArray(v)?v:String(v).split(/\s+/),naturalCompare:(a,b)=>a.localeCompare(b),url:(...x)=>x.join('/'),hasViewPermission:()=>true};
const src=fs.readFileSync(require('path').join(__dirname, '../htdocs/luci-static/resources/wifi7/mlo.js'),'utf8');
const view=Function('baseclass','form','uci','ui','poll','rpc','L','_','E',src)({extend:v=>v},form,uci,{createHandlerFn:(c,fn)=>fn,addNotification:()=>{}},{},{declare:()=>()=>Promise.resolve({})},L,s=>s,E);
(async()=>{records={radio0:{'.name':'radio0','.type':'wifi-device'},radio1:{'.name':'radio1','.type':'wifi-device'},wan:{'.name':'wan','.type':'interface'},mesh:{'.name':'mesh','.type':'wifi-iface',mode:'mesh'},legacy:{'.name':'legacy','.type':'wifi-iface',mode:'ap',encryption:'psk2+ccmp'}};
try{await view.render([null,null,{radios:[],sections:{},activeMldIfnames:[] }])}catch(e){assert.equal(e.message,'STOP')}
await grid.handleAdd({preventDefault(){}});let added=Object.values(records).find(r=>r['.type']==='wifi-iface'&&!['mesh','legacy'].includes(r['.name']));assert(added);assert.equal(map.addedSection,added['.name']);assert(!added.device?.length);assert(!added.network?.length);assert.equal(added.mode,'ap');await nativeCancel.call(grid,{},{});assert(!records[added['.name']]);console.log('PASS native cancel cleanup and safe empty defaults');
if(process.argv.includes('--add-only'))return;
assert.deepEqual(grid.children.filter(o=>!o.modalonly).map(o=>o.option),['_overview']);
modalCalls=0;await grid.renderMoreOptionsModal('mesh');await grid.renderMoreOptionsModal('legacy');assert.equal(modalCalls,0);assert.equal(records.mesh.mode,'mesh');assert.equal(records.legacy.encryption,'psk2+ccmp');
map.readonly=true;await grid.handleAdd({preventDefault(){}});await grid.renderMoreOptionsModal('legacy');assert.equal(modalCalls,0);assert.equal(Object.keys(records).length,5);
let pmf=grid.children.find(o=>o.option==='ieee80211w');records.legacy.encryption='sae';assert.notEqual(pmf.validate('legacy','0'),true);assert.notEqual(pmf.validate('legacy','1'),true);assert.equal(pmf.validate('legacy','2'),true);records.legacy.encryption='owe';assert.notEqual(pmf.validate('legacy','1'),true);records.legacy.encryption='sae-mixed';assert.equal(pmf.validate('legacy','1'),true);
console.log('PASS one detail column, modal-only editors, unsupported/read-only guards and PMF validation');
assert.equal(grid.children.find(o=>o.option==='ssid').rmempty,false);
let required=grid.children.find(o=>o.option==='_pmf_required');assert(required);assert.equal(required.readonly,true);assert.equal(required.forcewrite,true);assert.equal(required.cfgvalue('legacy'),'2');required.write('legacy','0');assert.equal(records.legacy.ieee80211w,'2');
console.log('PASS required SSID and fixed SAE/OWE PMF write');
map.readonly=false;form.GridSection.prototype.renderMoreOptionsModal=()=>Promise.reject(Error('modal failed'));await assert.rejects(grid.handleAdd({preventDefault(){}}),/modal failed/);assert.equal(map.addedSection,undefined);assert.equal(Object.keys(records).length,5);console.log('PASS failed add cleans up its section');
})().catch(e=>{console.error(e);process.exitCode=1});
