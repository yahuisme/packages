'use strict';
// Offline actual-view DOM with Aurora CSS; not a router session.
const fs=require('fs'), path=require('path'), assert=require('assert');
const {JSDOM}=require('jsdom'), {chromium}=require('playwright');
const base=path.resolve(__dirname,'..');
const out=process.env.LAYOUT_OUT || '/root/fwup-layout'; fs.mkdirSync(out,{recursive:true});
const dom=new JSDOM('<html><body></body></html>');
global.document=dom.window.document;
const E=(tag,attrs={},children=[])=>{const n=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>{if(k==='click')n.addEventListener(k,v);else if(k==='checked')n.checked=v;else n.setAttribute(k,v);});(Array.isArray(children)?children:[children]).forEach(c=>n.append(c&&c.nodeType?c:String(c)));return n;};
const po=fs.readFileSync(base+'/po/zh_Hans/firmwareupgrade.po','utf8'), translations={};
for(const m of po.matchAll(/msgid "([^\n]*)"\nmsgstr "([^\n]*)"/g)) translations[m[1]]=m[2];
const app=Function('rpc','view','ui','poll','E','_','L',fs.readFileSync(base+'/htdocs/luci-static/resources/view/firmwareupgrade/index.js','utf8'))({declare:()=>()=>Promise.resolve({})},{extend:x=>x},{createHandlerFn:()=>()=>{}},{},E,x=>translations[x]||x,{});
document.body.append(app.render({repository:'VIKINGYFY/OpenWRT-CI',release_pattern:'IPQ807X-WIFI-YES-*',asset_pattern:'*linksys_mx4200v2-squashfs-sysupgrade-*.bin',download_proxy:'https://gh-proxy.com/'}));
const html=document.body.innerHTML;
(async()=>{const browser=await chromium.launch({headless:true});const results=[];try{for(const width of [320,375,768,1024,1440]){const page=await browser.newPage({viewport:{width,height:1100}});await page.setContent('<html><head><meta charset="utf-8"></head><body>'+html+'</body></html>');await page.addStyleTag({path:process.env.AURORA_CSS||'/tmp/packages-fix-aurora/htdocs/luci-static/aurora/main.css'});for(const dark of [false,true]){await page.evaluate(d=>document.documentElement.setAttribute('data-darkmode',String(d)),dark);const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,fields:[...document.querySelectorAll('.fwup-input')].map(n=>{const r=n.getBoundingClientRect();return {id:n.id,left:r.left,right:r.right,height:r.height};}),text:document.body.textContent}));assert(result.text.includes('固件文件通配符'));assert(result.scroll<=width,JSON.stringify(result));for(const f of result.fields){assert(f.left>=0&&f.right<=width,JSON.stringify(f));assert.strictEqual(f.height,32);}results.push({width,dark,scroll:result.scroll,fields:result.fields});await page.screenshot({path:out+'/'+width+'-'+dark+'.png',fullPage:true});}await page.close();}}finally{await browser.close();fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));}console.log('PASS offline Chromium/Aurora: '+results.length+' width/theme states, no page/input overflow; 32px inputs');})().catch(e=>{console.error(e);process.exitCode=1;});
