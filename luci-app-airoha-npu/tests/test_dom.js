/* Run with NODE_PATH pointing to jsdom and LUCI_RPC pointing to upstream rpc.js. */
const fs = require('fs'), assert = require('assert'), path = require('path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<body></body>');
global.document = dom.window.document;
global.window = dom.window;
global.MutationObserver = dom.window.MutationObserver;
function E(tag, attrs, children) {
 const e = document.createElement(tag);
 Object.entries(attrs || {}).forEach(([k,v]) => typeof v === 'function' ? e.addEventListener(k, v) : e.setAttribute(k,v));
 (Array.isArray(children) ? children : [children]).forEach(c => { if(c != null) e.append(c); });
 return e;
}
let callbacks=[], fail=false;
const status = {cpu_cur_freq:500000,cpu_max_freq:1200000,cpu_min_freq:500000,cpu_governor:'schedutil',cpu_count:2,npu_clock:null,npu_bound:true};
const info = {soc_compat:'airoha,test', governors:'schedutil performance',frequencies:'500000 1200000 1400000'};
const declarations=[];
// Evaluate trusted local LuCI source, never downloaded/user-provided expressions.
const rpcSourcePath = process.env.LUCI_RPC || ('/root/wifi7-audit-evidence/rpc.js');
const upstreamSource=fs.readFileSync(rpcSourcePath, 'utf8');
const start=upstreamSource.indexOf('handleCallReply(req, msg) {');
const end=upstreamSource.indexOf('\n\t},',start)+4;
const handler=new Function('L','return ({'+upstreamSource.slice(start,end)+'}).handleCallReply')({isObject:x=>x!==null&&typeof x==='object',raise:()=>{throw Error('RPC failure');}});
const rpc = {declare: spec => { declarations.push(spec); return () => new Promise((resolve,reject)=> {
 const result=spec.method==='getStatus'?status:spec.method==='getInfo'?info:spec.method==='getFlowOffload'?{enabled:false}:{result:'ok'};
 try { handler.call({getStatusText:()=> 'denied'}, {...spec,resolve,reject}, {jsonrpc:'2.0',result:fail?[6]:[0,result]}); } catch(e) {reject(e);}
}); }};
const poll = {add:f=>callbacks.push(f),remove:f=>callbacks=callbacks.filter(x=>x!==f)};
const L = {url:(...a)=>'/'+a.join('/'),hasViewPermission:()=>true};
const source=fs.readFileSync(path.join(__dirname,'../htdocs/luci-static/resources/view/airoha_npu/status.js'),'utf8');
const view=new Function('view','rpc','poll','ui','E','L','_',source)({extend:x=>x},rpc,poll,{addNotification:()=>{}},E,L,x=>x);
(async()=>{
 document.body.append(view.render(await view.load()));
 assert(!document.querySelector('table'), 'use native key/value rows');
 assert(declarations.every(x=>x.raise===true));
 const selects=[...document.querySelectorAll('select')];
 assert.equal(selects.length,3);
 selects.forEach(e=>{assert(e.id && e.name);assert(document.querySelector('label[for="'+e.id+'"]'));});
 const freq=document.querySelector('#npu-frequency');
 freq.value='1400000'; freq.focus();
 const pending=callbacks[0](); assert(pending instanceof Promise); await pending;
 assert.equal(freq.value,'1400000'); assert.equal(document.activeElement,freq);
 fail=true; await callbacks[0]();
 assert(document.body.textContent.includes('Status unavailable or stale'));
 assert.equal(document.querySelector('#npu-current').textContent,'Unknown');
 document.body.replaceChildren(); await new Promise(resolve=>setTimeout(resolve,0)); assert.equal(callbacks.length,0);
 console.log('DOM: labels, controls, focus, returned poll promise, failure and cleanup passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
