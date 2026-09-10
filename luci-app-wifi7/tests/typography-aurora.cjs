// Regenerate with typography.cjs first; original Aurora CSS, current native DOM.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {JSDOM}=require('jsdom'),{chromium}=require('playwright');
(async()=>{
 const out=process.env.TYPOGRAPHY_OUT,assets=process.env.AURORA_HTDOCS,header=process.env.AURORA_HEADER,shell=process.env.AURORA_SHELL;
 assert(out&&assets&&header&&shell,'Set TYPOGRAPHY_OUT and AURORA_HTDOCS/HEADER/SHELL');
 const script=[...fs.readFileSync(header,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('const setTheme'))[1];
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),results=[],errors=[];
 try{
 for(const state of ['tab0','tab1','tab2','tab3','mlo-populated','modal-general','modal-security','modal-advanced']){
  const doc=new JSDOM(fs.readFileSync(shell,'utf8')).window.document,dom=new JSDOM(fs.readFileSync(path.join(out,state+'.dom.html'),'utf8')).window.document;
  doc.querySelector('#view').replaceChildren(...dom.querySelector('#view').childNodes);
  for(const e of dom.querySelectorAll('body > #modal_overlay'))doc.body.append(e);
  doc.body.className=dom.body.className+' lang_zh';doc.documentElement.lang='zh';
  const s=doc.createElement('script');s.textContent=script;doc.head.prepend(s);
  // Fixed test-only markup, never interpolated application or user data.
  const ref=doc.createElement('div');ref.id='unrelated';ref.innerHTML='<table><tr><th>Reference</th><td>Text</td></tr></table><h3>Reference</h3><input value="Reference">';doc.querySelector('#view').append(ref);
  for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
   const ctx=await browser.newContext({viewport:{width,height:1000},colorScheme:theme==='light'?'dark':'light'});await ctx.addInitScript(t=>localStorage.setItem('aurora.theme',t),theme);
   const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   await p.route('http://wifi7.test/**',r=>{const u=new URL(r.request().url());if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html>'+doc.documentElement.outerHTML});const file=path.join(assets,u.pathname);if(!fs.existsSync(file)){errors.push('missing '+file);return r.fulfill({status:404,body:''})}return r.fulfill({path:file})});
   await p.goto('http://wifi7.test/');await p.evaluate(()=>document.fonts.ready);
   const result=await p.evaluate(()=>{
    const visible=e=>e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
    const rect=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {text:e.textContent.slice(0,80),x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,size:s.fontSize,weight:s.fontWeight,padding:s.padding,gap:s.gap,margin:s.margin,bg:s.backgroundColor}};
    const all=(selector)=>[...document.querySelectorAll(selector)].filter(visible).map(rect),root=':is(.wifi7-map,.wifi7-modal)';
    const ref=()=>[...document.querySelector('#unrelated').querySelectorAll('*')].map(e=>{const s=getComputedStyle(e);return [s.fontSize,s.fontWeight]});
    const before=ref();const sheets=[...document.querySelectorAll('.wifi7-map style')];sheets.forEach(e=>e.sheet.disabled=true);const after=ref();sheets.forEach(e=>e.sheet.disabled=false);
    return {dark:document.documentElement.dataset.darkmode,documentWidth:document.documentElement.scrollWidth,referenceUnchanged:JSON.stringify(before)===JSON.stringify(after),body:all('.wifi7-map'),headings:all(root+' :is(h2,h3,h4)'),tables:all(root+' :is(table,.table)'),cells:all(root+' :is(td,.td)'),strong:all(root+' strong'),forms:all(root+' :is(input:not([type=hidden]),select,button,.cbi-button,.cbi-dropdown)'),labels:all(root+' .cbi-value-title'),description:all(root+' .cbi-map-descr'),summary:all('.mlo-summary-item'),summaryLabels:all('.mlo-summary .wifi7-label'),summaryValues:all('.mlo-summary strong'),modal:all('.wifi7-modal'),tableRows:all('.mlo-map .cbi-section-table-row')};
   });
   results.push({state,width,theme,...result});
   assert.equal(result.dark,String(theme==='dark'));assert(result.referenceUnchanged,'no sibling typography changes');
   assert.equal(result.body.length,1);assert.equal(result.body[0].size,'13px');
   for(const key of ['tables','cells','forms','labels','description'])for(const e of result[key])assert.equal(e.size,'13px',`${state} ${width} ${key} ${e.text}`);
   for(const e of result.headings){assert.equal(e.size,'15px');assert.equal(e.weight,'500')}
   for(const e of result.strong)assert.equal(e.weight,'500');
   for(const e of result.summaryLabels)assert.equal(e.size,'12px');
   for(const e of result.summaryValues)assert.equal(e.size,'13px');
   if(state==='mlo-populated'){assert(result.tableRows.length);assert(result.summary.length);for(const e of result.summary)assert.equal(e.padding,'16px')}
   if(state.startsWith('modal-')){assert.equal(result.modal.length,1);assert(result.forms.length);assert(result.modal[0].x>=0&&result.modal[0].right<=width+1,'modal within viewport');}
   assert(result.documentWidth<=width,'no document overflow');
   await p.screenshot({path:path.join(out,`${state}-${width}-${theme}.png`),fullPage:true});await ctx.close();
  }
 }
 assert.equal(results.length,80);assert.equal(errors.length,0,errors.join('\n'));
 }finally{await browser.close();fs.writeFileSync(path.join(out,'typography-results.json'),JSON.stringify({boundary:'Fresh native app/LuCI DOM exports; fixture RPC/UCI; original Aurora CSS/fonts/theme script and static sidebar shell. No router.',sources:[header,path.join(assets,'luci-static/aurora/main.css'),shell,path.join(__dirname,'../htdocs/luci-static/resources/view/wifi7/index.js'),path.join(__dirname,'../htdocs/luci-static/resources/wifi7/mlo.js')].map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),results,errors},null,2))}
 console.log(`PASS ${results.length} current Aurora renders: common typography, sibling isolation, native MLO table/modal, no document/modal overflow; ${errors.length} errors`);
})().catch(e=>{console.error(e);process.exitCode=1});
