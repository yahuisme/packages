// Real node view and ui.showModal exports, unchanged Aurora in Chromium.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http'),crypto=require('crypto');
const {chromium}=require('playwright');
const {pageBoot,tick}=require('./test_page_lifecycle.cjs');
const out=process.env.HP_MODAL_OUTPUT,aurora=process.env.AURORA_HTDOCS;
assert(out&&aurora,'Set HP_MODAL_OUTPUT and AURORA_HTDOCS');
const appdir=path.resolve(__dirname,'..'),tr={};
for(const file of [path.resolve(process.env.LUCI_RESOURCE_DIR,'../../../po/zh_Hans/base.po'),path.join(appdir,'po/zh_Hans/homeproxy.po')]) {
 for(const block of fs.readFileSync(file,'utf8').split(/\n\s*\n/)) {
  const a=block.match(/^msgid ((?:"[^\n]*"\n?)+)/m),b=block.match(/^msgstr ((?:"[^\n]*"\n?)+)/m);
  const d=m=>m[1].trim().split('\n').map(JSON.parse).join('');if(a&&b&&d(a)&&d(b))tr[d(a)]=d(b);
 }
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const h=await pageBoot('node',tr),snapshots={};
 try {
  let grid;function walk(s){if(s.handleLinkImport)grid=s;for(const c of s.children||[]){if(c.subsection)walk(c.subsection);else if(c.children)walk(c);}}walk(h.map);assert(grid);
  h.mods.ui.showModal('Unrelated modal',[h.w.E('button',['Close'])]);snapshots.before=h.w.document.documentElement.outerHTML;
  grid.handleLinkImport();await tick();assert(h.w.document.querySelector('.modal').textContent.includes(tr['Import share links']));snapshots.import=h.w.document.documentElement.outerHTML;
  h.mods.ui.hideModal();h.mods.ui.showModal('Unrelated modal',[h.w.E('button',['Close'])]);snapshots.after=h.w.document.documentElement.outerHTML;
  assert(!h.w.document.querySelector('.modal').className.includes('homeproxy'));
  assert.equal(h.w.document.querySelector('[data-homeproxy-modal-style]'),null);
 }finally{h.w.close();}
 for(const [name,html]of Object.entries(snapshots))fs.writeFileSync(path.join(out,name+'.html'),html);
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/luci-static/aurora/')){try{const p=path.join(aurora,req.url);res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(p));}catch{res.statusCode=404;res.end();}return;}
  const html=snapshots[req.url.slice(1)];if(!html){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html.replace('</head>','<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/luci-static/aurora/main.css"><link rel="stylesheet" href="/luci-static/aurora/fonts/aurora-font.css"></head>'));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const rows=[],failures=[];
 try{browser=await chromium.launch({args:['--no-sandbox']});for(const width of [390,768,1440])for(const dark of [false,true]){
  const measurements={};for(const stage of ['before','import','after']){
   const p=await browser.newPage({viewport:{width,height:1000},colorScheme:dark?'light':'dark'}),errors=[];
   p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>errors.push(r.url()));p.on('response',r=>{if(r.status()>=400)errors.push(r.url());});
   await p.goto(`http://127.0.0.1:${server.address().port}/${stage}`,{waitUntil:'networkidle'});await p.evaluate(d=>document.documentElement.dataset.darkmode=String(d),dark);
   const data=await p.evaluate(()=>{const m=document.querySelector('body.modal-overlay-active #modal_overlay > .modal');const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};m.scrollTop=m.scrollHeight;return {modal:rect(m),buttons:[...m.querySelectorAll('button')].map(e=>({text:e.textContent,...rect(e)})),color:getComputedStyle(m).backgroundColor,scroll:document.documentElement.scrollWidth};});
   assert.deepEqual(errors,[]);assert(data.modal.width>0);measurements[stage]=data;rows.push({width,dark,stage,...data});
   if(stage==='import'){await p.screenshot({path:path.join(out,`import-${width}-${dark?'dark':'light'}.png`)});if(data.modal.left<0||data.modal.right>width||data.buttons.some(b=>b.left<0||b.right>width||b.bottom>1000))failures.push({width,dark,...data});}
   await p.close();
  }assert.deepEqual(measurements.after,measurements.before,'unrelated modal remains unchanged');
 }}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sources:{node:hash(appdir+'/htdocs/luci-static/resources/view/homeproxy/node.js'),luci:hash(process.env.LUCI_RESOURCE_DIR+'/ui.js'),aurora:hash(aurora+'/luci-static/aurora/main.css')},rows,failures},null,2));
 assert.equal(rows.length,18);for(const width of [390,768,1440])assert.notEqual(rows.find(r=>r.width===width&&!r.dark).color,rows.find(r=>r.width===width&&r.dark).color);
 assert.deepEqual(failures,[],'import modal and footer must stay within viewport');console.log('PASS 18 Chromium cases: import/before/after × 390/768/1440 × light/dark; unrelated modal unchanged; '+out);
})().catch(e=>{console.error(e);process.exitCode=1;});
