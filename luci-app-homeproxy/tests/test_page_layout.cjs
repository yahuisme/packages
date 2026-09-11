// Real node view and ui.showModal exports, unchanged Aurora in Chromium.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http'),crypto=require('crypto');
const {chromium}=require('playwright');
const {pageBoot,tick}=require('./test_page_lifecycle.cjs');
const out=process.env.HP_LAYOUT_OUTPUT,aurora=process.env.AURORA_HTDOCS;
assert(out&&aurora,'Set HP_MODAL_OUTPUT and AURORA_HTDOCS');
const appdir=path.resolve(__dirname,'..'),tr={};
for(const file of [path.resolve(process.env.LUCI_RESOURCE_DIR,'../../../po/zh_Hans/base.po'),path.join(appdir,'po/zh_Hans/homeproxy.po')]) {
 for(const block of fs.readFileSync(file,'utf8').split(/\n\s*\n/)) {
  const a=block.match(/^msgid ((?:"[^\n]*"\n?)+)/m),b=block.match(/^msgstr ((?:"[^\n]*"\n?)+)/m);
  const d=m=>m[1].trim().split('\n').map(JSON.parse).join('');if(a&&b&&d(a)&&d(b))tr[d(a)]=d(b);
 }
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const snapshots={};
 for(const name of ['client','node','server']){const h=await pageBoot(name,tr);try{
  await Promise.all(h.polls().map(f=>f()));snapshots[name]=h.w.document.documentElement.outerHTML;
  for(const tab of h.root().querySelectorAll('.cbi-tabmenu a')){tab.click();await tick();snapshots[name+'-'+tab.textContent]=h.w.document.documentElement.outerHTML;}
 }finally{h.w.close();}}
 for(const [name,html]of Object.entries(snapshots))fs.writeFileSync(path.join(out,name+'.html'),html);
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/luci-static/aurora/')){try{const p=path.join(aurora,req.url);res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(p));}catch{res.statusCode=404;res.end();}return;}
  const html=snapshots[decodeURIComponent(req.url.slice(1))];if(!html){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html.replace('</head>','<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/luci-static/aurora/main.css"><link rel="stylesheet" href="/luci-static/aurora/fonts/aurora-font.css"></head>'));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const rows=[],failures=[];
 try{browser=await chromium.launch({args:['--no-sandbox']});for(const width of [390,768,1440])for(const dark of [false,true]){
  const measurements={};for(const stage of Object.keys(snapshots)){
   const p=await browser.newPage({viewport:{width,height:1000},colorScheme:dark?'light':'dark'}),errors=[];
   p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>errors.push(r.url()));p.on('response',r=>{if(r.status()>=400)errors.push(r.url());});
   await p.goto(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(stage)}`,{waitUntil:'networkidle'});await p.evaluate(d=>document.documentElement.dataset.darkmode=String(d),dark);
   const data=await p.evaluate(()=>{
    const root=document.querySelector('#cbi-homeproxy'),status=root.querySelector('.hp-service-status');
    const weight=status?getComputedStyle(status).fontWeight:null, parent=status?getComputedStyle(status.parentElement).fontWeight:null;
    const style=status?.querySelector('style');let unchanged=true;
    if(style){const before=getComputedStyle(root).fontWeight;style.sheet.disabled=true;unchanged=getComputedStyle(root).fontWeight===before;style.sheet.disabled=false;}
    return {width:root.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,color:getComputedStyle(document.body).backgroundColor,weight,parent,unchanged,text:root.textContent.slice(0,100)};
   });
   assert.deepEqual(errors,[]);assert(data.width>0);assert(data.scroll<=width);assert(data.unchanged);
   rows.push({width,dark,stage,...data});if(data.weight!==data.parent)failures.push({width,dark,stage,...data});
   if(['client','node','server'].includes(stage))await p.screenshot({path:path.join(out,`${stage}-${width}-${dark?'dark':'light'}.png`)});
   await p.close();
  }
 }}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sources:{homeproxy:hash(appdir+'/htdocs/luci-static/resources/homeproxy.js'),client:hash(appdir+'/htdocs/luci-static/resources/view/homeproxy/client.js'),server:hash(appdir+'/htdocs/luci-static/resources/view/homeproxy/server.js'),node:hash(appdir+'/htdocs/luci-static/resources/view/homeproxy/node.js'),luci:hash(process.env.LUCI_RESOURCE_DIR+'/ui.js'),aurora:hash(aurora+'/luci-static/aurora/main.css')},rows,failures},null,2));
 assert.equal(rows.length,Object.keys(snapshots).length*6);
 assert.deepEqual(failures,[],'plain service status must inherit native text weight');console.log('PASS '+rows.length+' Chromium page/tab cases at 390/768/1440 light/dark; inherited service weight; '+out);
})().catch(e=>{console.error(e);process.exitCode=1;});
