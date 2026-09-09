// Offline Chromium: actual LuCI DOM exports and unmodified Aurora assets.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {JSDOM}=require('jsdom'),{chromium}=require('playwright');
(async()=>{
 const out=process.env.TAB_OUT,htdocs=process.env.AURORA_HTDOCS,shell=process.env.AURORA_SHELL,header=process.env.AURORA_HEADER;
 assert(out&&htdocs&&shell&&header,'Set TAB_OUT, AURORA_HTDOCS, AURORA_SHELL, AURORA_HEADER');
 const template=fs.readFileSync(header,'utf8');const scripts=[...template.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 const themeScript=scripts.find(m=>m[1].includes('const setTheme')).at(1);
 const pages=[];for(let i=0;i<4;i++){
  const doc=new JSDOM(fs.readFileSync(shell,'utf8')).window.document;
  const exported=new JSDOM(fs.readFileSync(path.join(out,'tab-'+i+'.html'),'utf8')).window.document;
  doc.querySelector('#view').replaceChildren(...exported.querySelector('#view').childNodes);
  // Same markup as Aurora menu-aurora.js renderTabMenu(), outside the app scope.
  const reference=doc.createElement('ul');reference.id='top-level-reference';reference.className='tabs';
  for(const [n,a] of [...doc.querySelectorAll('.wifi7-map > .cbi-tabmenu a')].entries()){
   const li=doc.createElement('li');if(n===i)li.className='active';const link=doc.createElement('a');link.href='#';link.textContent=a.textContent;li.append(link);reference.append(li);
  }
  doc.querySelector('#view').append(reference);
  doc.documentElement.removeAttribute('data-darkmode');
  const script=doc.createElement('script');script.textContent=themeScript;doc.head.prepend(script);
  pages.push('<!doctype html>'+doc.documentElement.outerHTML);
 }
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results=[],errors=[];
 try{
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark'])for(let tab=0;tab<4;tab++){
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme==='light'?'dark':'light',reducedMotion:'reduce'});
  await context.addInitScript(t=>localStorage.setItem('aurora.theme',t),theme);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.route('http://wifi7.test/**',async route=>{const p=new URL(route.request().url()).pathname;
   if(p==='/')return route.fulfill({contentType:'text/html',body:pages[tab]});
   const file=path.join(htdocs,p);if(!fs.existsSync(file)){errors.push('missing '+p);return route.fulfill({status:404,body:''});}
   return route.fulfill({path:file});
  });
  await page.goto('http://wifi7.test/');await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>{
   const menus=[document.querySelector('.wifi7-map > .cbi-tabmenu'),document.querySelector('#top-level-reference'),document.querySelector('#native-reference > .cbi-tabmenu')];
   const properties=['backgroundColor','color','borderRadius','padding','fontSize','fontWeight','boxShadow','borderBottomWidth','borderBottomColor','overflowX'];
   const style=e=>Object.fromEntries(properties.map(k=>[k,getComputedStyle(e)[k]]));
   return {dark:document.documentElement.dataset.darkmode,menus:menus.map(m=>({style:style(m),items:[...m.children].map(style),links:[...m.querySelectorAll('a')].map(style),left:m.getBoundingClientRect().left,right:m.getBoundingClientRect().right,client:m.clientWidth,scroll:m.scrollWidth})),labels:[...menus[0].querySelectorAll('a')].map(a=>a.textContent),text:document.querySelector('.wifi7-map').textContent};
  });
  assert.equal(result.dark,String(theme==='dark'));const [app,reference,native]=result.menus;
  for(const key of ['backgroundColor','borderRadius','padding','borderBottomWidth','borderBottomColor','overflowX'])assert.equal(app.style[key],native.style[key],'native menu '+key);
  assert.deepEqual(app.links,native.links,'preserve native segmented appearance');
  assert.equal(app.items[tab].borderBottomWidth,native.items[tab].borderBottomWidth);
  assert.notEqual(native.links[tab].backgroundColor,reference.links[tab].backgroundColor,'native segmented fill differs from Aurora top-level .tabs');
  assert(app.left>=0&&app.right<=width+1,'menu within viewport');assert.equal(app.style.overflowX,'auto');
  for(let i=0;i<4;i++){const a=page.locator('.wifi7-map > .cbi-tabmenu a').nth(i);await a.scrollIntoViewIfNeeded();assert(await a.isVisible());const box=await a.boundingBox();assert(box.x>=app.left-1&&box.x+box.width<=app.right+1,'each Chinese tab fully reachable');}
  await page.locator('.wifi7-map > .cbi-tabmenu a').nth(tab).scrollIntoViewIfNeeded();
  assert(result.text.includes('WiFi 7'));if(process.env.EXPECT_TAB_LABEL)assert(result.labels.includes(process.env.EXPECT_TAB_LABEL));
  if(process.env.WIFI7_TRANSLATIONS){const tr=JSON.parse(fs.readFileSync(process.env.WIFI7_TRANSLATIONS));assert.deepEqual(result.labels,['Radio Status','Radio Settings','MLO','Connected Clients'].map(s=>tr[s]||s));}
  delete result.text;
  await page.screenshot({path:path.join(out,`${width}-${theme}-tab${tab}.png`),fullPage:true});results.push({width,theme,tab,...result});await context.close();
 }
 for(const tab of [0,1,2,3]){const a=results.find(r=>r.width===390&&r.theme==='light'&&r.tab===tab),b=results.find(r=>r.width===390&&r.theme==='dark'&&r.tab===tab);assert.notEqual(a.menus[0].links[tab].color,b.menus[0].links[tab].color);}
 assert.equal(results.length,40);assert.equal(errors.length,0,errors.join('\n'));
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({boundary:'Offline real DOM snapshots; static Aurora sidebar shell; no router, no custom theme tokens/patches. Tab events and polls tested separately in native-tabs.cjs.',sources:[header,path.join(htdocs,'luci-static/aurora/main.css'),path.join(htdocs,'luci-static/resources/menu-aurora.js'),shell,path.join(__dirname,'../htdocs/luci-static/resources/view/wifi7/index.js')].map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),results,errors},null,2));}
 console.log(`PASS ${results.length} Aurora width/theme/tab renders: native segmented appearance retained, distinct top-level .tabs reference, horizontal reachability, actual light/dark colors; ${errors.length} errors`);
})().catch(e=>{console.error(e);process.exitCode=1});
