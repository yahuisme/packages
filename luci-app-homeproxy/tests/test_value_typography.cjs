// Real LuCI Map/reset exports + unchanged Aurora CSS in Chromium; transport is fixture-only.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { boot, tick } = require('./test_connection_lifecycle.cjs');
const { chromium } = require('playwright');
const http = require('http'), crypto = require('crypto');
const appdir = path.resolve(__dirname, '..');
const out = process.env.HP_TYPOGRAPHY_OUTPUT;
const aurora = process.env.AURORA_HTDOCS;
const translations = {};
for(const block of fs.readFileSync(path.join(appdir,'po/zh_Hans/homeproxy.po'),'utf8').split(/\n\s*\n/)) {
 const id=block.match(/^msgid ((?:"[^\n]*"\n?)+)/m), str=block.match(/^msgstr ((?:"[^\n]*"\n?)+)/m);
 const decode=m=>m[1].trim().split('\n').map(x=>JSON.parse(x)).join('');
 if(id&&str&&decode(id)&&decode(str))translations[decode(id)]=decode(str);
}
const resources = ['geoip_cn', 'geosite_cn', 'dashboard'].map((type, i) => ({
 type, version: i === 1 ? '2026-09-08' : '20260908094002',
 source: 'https://raw.githubusercontent.com/example/resources/' + 'long-path-'.repeat(15) + type + '.srs'
}));
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function check(h) {
 const root=h.root(), tables=root.querySelectorAll('table');
 assert.equal(root.querySelectorAll('style').length,1);
 assert.equal(root.querySelectorAll('.hp-monospace-value').length,12);
 for(const [i, table] of [...tables].entries()) for(const row of [...table.rows].slice(1)) {
  assert.equal(row.cells[0].querySelector('.hp-monospace-value'),null);
  assert(row.cells[1].querySelector('.hp-monospace-value'));
  if(i===1) assert(row.cells[2].querySelector('a.hp-monospace-value'));
  else assert.equal(row.cells[2].querySelector('.hp-monospace-value'),null);
 }
 for(const a of root.querySelectorAll('table a')) {
  assert.equal(a.target,'_blank'); assert.equal(a.rel,'noreferrer noopener');
  assert.equal(a.getAttribute('href'),a.textContent);
 }
}
(async()=>{
 const snapshots={};
 for(const fresh of [false,true]) {
  const h=await boot(resources, translations);
  try {
   assert.equal(h.w._('Connection Status'),translations['Connection Status']);
   assert(h.root().textContent.includes('连接状态'));
   await h.settle({results:[{site:'baidu',result:true,latency_ms:18}]});check(h);
   if(fresh) {snapshots.refresh=h.root().outerHTML;continue;}
   snapshots.initial=h.root().outerHTML;
   const old=h.root().querySelector('table');
   h.button('Update all').click();await tick();await tick();
   const map=h.mods.dom.findClassInstance(h.root().querySelector('#cbi-homeproxy'));
   await map.reset();await map.reset();check(h);
   assert.notEqual(h.root().querySelector('table'),old);
   assert.equal(h.count(),1);assert.match(h.row().textContent,/18 ms/);
   snapshots.reset=h.root().outerHTML;
   h.root().remove();await tick();assert.equal(h.w.document.querySelector('.homeproxy-status style'),null);
  } finally {h.w.close();}
 }
 // Exercise the exact production form.Map constructor with actual LuCI form/DOM.
 for(const name of ['client','server']) {
  const src=fs.readFileSync(path.join(appdir,'htdocs/luci-static/resources/view/homeproxy',name+'.js'),'utf8');
  assert(!src.includes('Powered by'));
  const h=await boot();try {
   const ctor=src.match(/m = new form.Map\('homeproxy',[\s\S]*?\);/)[0];
   const map=h.w.Function('form','let m;'+ctor+'return m;')(h.mods.form);
   const root=await map.render();assert(root.querySelector('h2'));assert.equal(root.querySelector('.cbi-map-descr'),null);
  }finally{h.w.close();}
 }
 console.log('PASS real LuCI exact value scope, href/target/rel, resource update + repeated Map.reset, fresh mount, style cleanup, client/server description removal');
 if(!aurora || !out) return;
 fs.mkdirSync(out,{recursive:true});
 for(const [state,dom] of Object.entries(snapshots))fs.writeFileSync(path.join(out,state+'.html'),dom);
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/luci-static/')) {
   const file=path.join(aurora,decodeURIComponent(req.url));
   try {res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));}catch {res.statusCode=404;res.end();}return;
  }
  const state=req.url.slice(1)||'initial';
  if(!snapshots[state]){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html data-darkmode="false"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/luci-static/aurora/main.css"><link rel="stylesheet" href="/luci-static/aurora/fonts/aurora-font.css"><body class="lang_en"><header><div class="container"><a class="brand">OpenWrt</a></div></header><div class="main"><div class="main-left" id="mainmenu"><ul class="nav"><li><a>HomeProxy</a></li></ul></div><div class="main-right"><div id="maincontent"><div id="view">${snapshots[state]}</div><a id="outside" class="hp-monospace-value">Unrelated URL</a></div></div></div></body></html>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const results=[];
 try {
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const state of Object.keys(snapshots))for(const width of [320,390,768,1024,1440])for(const dark of [false,true]) {
   const page=await browser.newPage({viewport:{width,height:1000},colorScheme:dark?'light':'dark'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()));page.on('response',r=>{if(r.status()>=400)errors.push(r.url()+':'+r.status());});
   await page.goto(`http://127.0.0.1:${server.address().port}/${state}`,{waitUntil:'networkidle'});
   await page.evaluate(dark=>document.documentElement.dataset.darkmode=String(dark),dark);
   const data=await page.evaluate(()=>{
    const root=document.querySelector('.homeproxy-status'), values=[...root.querySelectorAll('.hp-monospace-value')];
    const family=e=>getComputedStyle(e).fontFamily;
    const other=[...root.querySelectorAll('th,button,td:first-child,td:nth-child(3) span,td:nth-child(4) span')];
    const before=other.map(family),outside=family(document.querySelector('#outside'));
    const measured=values.map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {font:s.fontFamily,wrap:s.overflowWrap,white:s.whiteSpace,bg:s.backgroundColor,width:r.width,height:r.height};});
    const sheet=root.querySelector('style').sheet;sheet.disabled=true;
    const unchanged=other.every((e,i)=>family(e)===before[i])&&outside===family(document.querySelector('#outside'));
    sheet.disabled=false;
    return {count:values.length,measured,unchanged,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,rootWidth:root.getBoundingClientRect().width,theme:getComputedStyle(document.body).backgroundColor};
   });
   assert.deepEqual(errors,[]);assert.equal(data.count,12);assert(data.rootWidth>0);assert(data.unchanged);
   assert(data.scroll<=data.client+1,JSON.stringify({state,width,dark,data}));
   for(const v of data.measured){assert.match(v.font,/mono/i);assert.equal(v.wrap,'anywhere');assert.equal(v.white,'normal');assert.equal(v.bg,'rgba(0, 0, 0, 0)');assert(v.width>0);}
   if(width===390)assert(data.measured.at(-1).height>40,'long source URL wraps');
   results.push({state,width,dark,...data});
   if(state==='reset'&&[390,1440].includes(width))await page.screenshot({path:path.join(out,`${state}-${width}-${dark?'dark':'light'}.png`),fullPage:true});
   await page.close();
  }
 } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
 const sources={};for(const name of ['status','client','server'])sources[name]=hash(fs.readFileSync(path.join(appdir,'htdocs/luci-static/resources/view/homeproxy',name+'.js')));
 sources.aurora=hash(fs.readFileSync(path.join(aurora,'luci-static/aurora/main.css')));
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sources,snapshots:Object.fromEntries(Object.entries(snapshots).map(([k,v])=>[k,hash(v)])),results},null,2));
 assert.equal(results.length,30);console.log('PASS 30 Aurora Chromium initial/reset/fresh-mount × 5 widths × light/dark: exact font scope, transparent background, long URL wrap, no document overflow; '+out);
})().catch(e=>{console.error(e);process.exitCode=1;});
