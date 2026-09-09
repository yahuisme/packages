'use strict';
const fs = require('fs'), assert = require('assert'), { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><head></head><body></body></html>');
global.window = dom.window; global.document = window.document; global.MutationObserver = window.MutationObserver;
const calls = []; let checked = { success: true, candidate_id: 'a'.repeat(32), tag_name: 'v1' }, rejectCheck = false;
const rpc = { declare: d => (...args) => { calls.push([d.method, args]); if (d.method === 'checkUpdate') return rejectCheck ? Promise.reject(Error('offline')) : Promise.resolve(checked); return Promise.resolve({ success: true }); } };
const E = (tag, attrs = {}, children = []) => { const n = document.createElement(tag); Object.entries(attrs).forEach(([k,v]) => { if (k === 'click') n.addEventListener('click',v); else if (k === 'checked') n.checked = v; else n.setAttribute(k,v); }); (Array.isArray(children) ? children : [children]).forEach(c => n.append(c && c.nodeType ? c : String(c))); return n; };
let modal;
const ui = { createHandlerFn: (ctx, name, ...args) => ev => ctx[name](...args,ev), showModal: (title, nodes) => { modal=E('div',{},nodes); document.body.append(modal); }, hideModal: () => modal && modal.remove() };
const polling = new Set(), poll={add: fn=>polling.add(fn),remove: fn=>polling.delete(fn)};
const source=fs.readFileSync(__dirname+'/../htdocs/luci-static/resources/view/firmwareupgrade/index.js','utf8');
const app=Function('rpc','view','ui','poll','E','_','L',source)(rpc,{extend:x=>x},ui,poll,E,x=>x,{bind:(fn,ctx)=>fn.bind(ctx)});
(async()=>{
 document.body.append(app.render({repository:'owner/repo'}));
 const root=document.querySelector('.fwup-dashboard'), notice=root.querySelector('[style="display:none"]'), latest=document.querySelector('#fwup-latest'), detail=document.querySelector('#fwup-detail').parentNode;
 const button=[...root.querySelectorAll('button')].find(x=>x.textContent==='Check update');
 await app.check(notice,latest,detail,{currentTarget:button});
 const upgrade=[...root.querySelectorAll('button')].find(x=>x.textContent==='Upgrade firmware'); upgrade.click();
 // Changing a later discovery must not change the image already confirmed.
 checked={success:true,candidate_id:'b'.repeat(32),tag_name:'v2'};
 await app.check(notice,latest,detail,{currentTarget:button});
 [...modal.querySelectorAll('button')].find(x=>x.textContent==='Start upgrade').click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepStrictEqual(calls.find(x=>x[0]==='startUpgrade')[1],['0','a'.repeat(32)]);
 rejectCheck=true; await app.check(notice,latest,detail,{currentTarget:button});
 assert.strictEqual(detail.style.display,'none'); assert.strictEqual(document.querySelector('#fwup-detail').textContent,'');
 assert.strictEqual(latest.textContent,'Not checked');
 console.log('PASS: actual view confirmation binds candidate identity; RPC failure clears stale release controls');
})().catch(e=>{console.error(e);process.exitCode=1;});
