'use strict';
// Offline real LuCI modules + Aurora. Transports are fixtures, never router RPCs.
// NODE_PATH=$(npm root -g):/tmp/packages-browser-qa/node_modules LUCI_RESOURCE_DIR=... AURORA_DIR=... node tests/test_ui_coverage.js
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {JSDOM}=require('jsdom'),{chromium}=require('playwright');
const resources=process.env.LUCI_RESOURCE_DIR,aurora=process.env.AURORA_DIR;
assert(resources&&aurora,'LUCI_RESOURCE_DIR and AURORA_DIR required');
const out=process.env.FAN_UI_OUTPUT||'/tmp/fan-ui-coverage';fs.mkdirSync(out,{recursive:true});
const pkg=path.resolve(__dirname,'..');
function catalog(file){const result={};let key='',val='',mode='';function flush(){if(key&&val)result[key]=val;key=val='';}for(const line of fs.readFileSync(file,'utf8').split('\n')){if(line.startsWith('msgid ')){flush();mode='key';key=JSON.parse(line.slice(6));}else if(line.startsWith('msgstr ')){mode='val';val=JSON.parse(line.slice(7));}else if(line.startsWith('"')){if(mode==='key')key+=JSON.parse(line);else if(mode==='val')val+=JSON.parse(line);}}flush();return result;}
(async()=>{
const j=new JSDOM('<!doctype html><html lang="zh-CN"><body><div id="maincontent"><div id="view"></div></div></body></html>',{url:'http://localhost/cgi-bin/luci/admin/system/fan',runScripts:'outside-only'}),w=j.window;
let browser;
try{
 const read=n=>fs.readFileSync(path.join(resources,n+'.js'),'utf8');
 const add=w.document.addEventListener.bind(w.document);w.document.addEventListener=(t,...a)=>{if(t!=='DOMContentLoaded')add(t,...a);};w.eval(read('cbi'));w.document.addEventListener=add;
 const translations=Object.assign(catalog(path.resolve(resources,'../../../po/zh_Hans/base.po')),catalog(path.join(pkg,'po/zh_Hans/luci-app-airoha-fancontrol.po')));
 w.TR={};for(const [k,v] of Object.entries(translations))w.TR[w.sfh(k.trim().replace(/\s+/g,' '))]=v;
 for(const [k,v] of Object.entries(translations))assert.equal(w._(k),v,'native gettext '+k);
 w.eval(read('luci').replace('window.LuCI = LuCI;','window.LuCI = LuCI; window.mods=classes; window.environment=env;'));
 const mods=w.mods,L=w.L=Object.create(w.LuCI.prototype);Object.assign(w.environment,{resource:'/luci-static/resources',scriptname:'/cgi-bin/luci',sessionid:'fixture'});
 L.require=n=>Promise.resolve(mods[n]);L.hasViewPermission=()=>true;w.E=mods.dom.create.bind(mods.dom);w.scrollTo=()=>{};
 const values={settings:{'.name':'settings','.type':'fancontrol',mode:'auto',curve_preset:'custom',manual_pwm:'127'},custom:{'.name':'custom','.type':'curve'}};
 [[40,54],[50,69],[60,95],[70,199],[80,255]].forEach(([t,p],i)=>{values.custom[`point${i+1}_temp`]=String(t);values.custom[`point${i+1}_pwm`]=String(p);});
 mods.rpc={declare:spec=>async()=>spec.object==='session'?true:spec.method==='get'?w.JSON.parse(JSON.stringify(values)):{}};
 function load(n){const text=read(n),deps=[...text.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);const C=w.Function(...deps.map(d=>d.split(' as ')[1]||d.split('.').at(-1)),text)(...deps.map(d=>mods[d.split(' as ')[0]]));mods[n]=new C();}
 load('uci');mods.fs={};load('validation');load('ui');load('form');
 const source=fs.readFileSync(path.join(pkg,'htdocs/luci-static/resources/view/fan/settings.js'),'utf8');
 const C=w.Function('view','form','uci','ui',source)(mods.view.extend({__init__(){}}),mods.form,mods.uci,mods.ui),app=new C();await app.load();
 const node=await app.render();w.document.querySelector('#view').append(node);const map=mods.dom.findClassInstance(node),stages=[];
 function exportStage(name){for(const e of w.document.querySelectorAll('input'))e.setAttribute('value',e.value);const html=w.document.documentElement.outerHTML;fs.writeFileSync(path.join(out,name+'.html'),html);stages.push({name,html});}
 function select(name,value){const option=map.lookupOption(name,'settings')[0];option.getUIElement('settings').setValue(value);map.checkDepends();}
 assert(node.textContent.includes(w._('Control Mode')));assert.notEqual(w._('Control Mode'),'Control Mode');
 for(const preset of ['quiet','balanced','performance','custom']){select('mode','auto');select('curve_preset',preset);exportStage('settings-'+preset);}
 select('mode','manual');exportStage('settings-manual');
 const manual=map.lookupOption('manual_pwm','settings')[0];manual.getUIElement('settings').setValue('999');
 await assert.rejects(map.save());assert(w.document.querySelector('.modal'));exportStage('manual-invalid-modal');mods.ui.hideModal();
 select('mode','auto');select('curve_preset','custom');const input=node.querySelector('[data-name="point1_temp"] input');input.value='90';input.dispatchEvent(new w.Event('input',{bubbles:true}));await assert.rejects(map.save());exportStage('custom-invalid-modal');mods.ui.hideModal();
 let unrelatedHTML;
 mods.ui.showModal('Unrelated',[w.E('p',{},['Independent modal'])]);unrelatedHTML=w.document.documentElement.outerHTML;mods.ui.hideModal();
 node.remove();
 const statusSource=fs.readFileSync(path.join(pkg,'htdocs/luci-static/resources/view/fan/status.js'),'utf8');
 const status=w.Function('dom','poll','rpc','view',statusSource)(mods.dom,{add(){},remove(){}},{declare:()=>async()=>({})},{extend:x=>x});w.requestAnimationFrame=()=>{};
 const fixture={fan_mode:2,uci_mode:'auto',uci_preset:'balanced',fan_rpm:1500,fan_pwm:95,fan_percentage:37,temp_cpu:54,temp_board:42,temp_phy1:48,temp_phy2:49,wifi_24g:51,wifi_5g:58,wifi_6g:61};
 for(const [name,data] of [['status-auto',fixture],['status-manual',{...fixture,fan_mode:1,uci_mode:'manual'}],['status-mismatch',{...fixture,fan_mode:1}],['status-unavailable',{}]]){const n=status.render(data);w.document.querySelector('#view').append(n);assert.equal(n.querySelectorAll('.fan-temp-card').length,7);exportStage(name);n.remove();}
 const css=fs.readFileSync(path.join(aurora,'htdocs/luci-static/aurora/main.css'),'utf8'),fonts=fs.readFileSync(path.join(aurora,'htdocs/luci-static/aurora/fonts/aurora-font.css'),'utf8');
 const header=fs.readFileSync(path.join(aurora,'ucode/template/themes/aurora/header.ut'),'utf8'),themeScript=header.match(/<script>\s*(const setTheme[\s\S]*?)<\/script>/)[1];
 browser=await chromium.launch({headless:true});const page=await browser.newPage({reducedMotion:'reduce'}),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push('resource: '+r.url()));
 await page.route('http://fan.test/**',r=>{const u=new URL(r.request().url());if(u.pathname.includes('/fonts/')){const f=path.join(aurora,'htdocs/luci-static/aurora/fonts',path.basename(u.pathname));return fs.existsSync(f)?r.fulfill({body:fs.readFileSync(f)}):r.abort();}return r.fulfill({body:'<!doctype html><html></html>',contentType:'text/html'});});await page.goto('http://fan.test/');
 for(const stage of stages)for(const theme of ['light','dark'])for(const width of [320,390,768,1024,1440,1920]){
 await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme==='light'?'dark':'light'});await page.evaluate(t=>localStorage.setItem('aurora.theme',t),theme);await page.setContent(stage.html);await page.addStyleTag({content:css+'\n'+fonts});
 // Static shell boundary: sidebar reservation; no router menu bootstrap or custom UCI tokens.
 await page.addStyleTag({content:'body{margin:0;padding:16px}#maincontent{margin:0}@media(min-width:900px){body{padding-left:256px}}'});await page.addScriptTag({content:'(()=>{'+themeScript+'})()'});
 if(stage.name.includes('custom'))await page.evaluate(({source,translations})=>{window._=s=>translations[s]||s;const helpers=source.slice(source.indexOf('function validPoints'),source.indexOf('\nreturn view.extend'));const setup=source.slice(source.indexOf('\t\t\tvar refresh ='),source.indexOf('\t\t\treturn node;',source.indexOf('\t\t\tvar refresh =')));new Function('node',helpers+'\nvar resize;\n'+setup)(document.querySelector('.fan-settings'));},{source,translations});
 await page.waitForTimeout(30);
 const m=await page.evaluate(()=>{const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;const controls=[...document.querySelectorAll('input:not([type=hidden]),select,button')].filter(visible);const cards=[...document.querySelectorAll('.fan-summary-card')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:r.width};});return {dark:document.documentElement.getAttribute('data-darkmode'),background:getComputedStyle(document.body).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,controls:controls.map(e=>({tag:e.tagName,height:e.getBoundingClientRect().height})),cards,modal:!!document.querySelector('.modal')&&visible(document.querySelector('.modal')),text:document.querySelector('#view').textContent,clipped:[...document.querySelectorAll('.fan-card-value,.fan-card-sub,.fan-temp-label')].filter(e=>visible(e)&&e.scrollWidth>e.clientWidth).map(e=>e.textContent)};});
 if(stage.name==='settings-custom' && width===768){
  const pair=await page.evaluate(()=>['point1_temp','point1_pwm'].map(name=>{
   const e=document.querySelector('[data-name="'+name+'"]'), label=e.querySelector('label'), input=e.querySelector('input');
   return {top:e.getBoundingClientRect().top,labelX:label.getBoundingClientRect().x,inputX:input.getBoundingClientRect().x,labelHeight:label.getBoundingClientRect().height,gap:input.getBoundingClientRect().top-label.getBoundingClientRect().bottom};
  }));
  fs.writeFileSync(path.join(out,'tablet-pair.json'),JSON.stringify(pair));
  assert(Math.abs(pair[0].top-pair[1].top)<1,'tablet temperature and PWM form a paired row');
  assert(pair.every(p=>Math.abs(p.labelX-p.inputX)<1),'tablet labels align above controls');
  assert(pair.every(p=>p.gap>=0&&p.gap<=12&&p.labelHeight<=48),'tablet labels stay close to their controls');
 }
 assert.equal(m.dark,String(theme==='dark'));
 assert.equal(m.controls.length,stage.name==='settings-custom'?12:stage.name==='custom-invalid-modal'?13:stage.name==='manual-invalid-modal'?3:stage.name.startsWith('settings-')?2:0,'dependency visibility');
 assert.equal(m.modal,stage.name.endsWith('-modal'));
 results.push({stage:stage.name,theme,width,...m});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({errors,results},null,2));
 if([390,768,1440].includes(width))await page.screenshot({path:path.join(out,`${stage.name}-${width}-${theme}.png`),fullPage:true});
 }
 // Static trusted fixture only; no user HTML or router menu bootstrap.
 for(const theme of ['light','dark'])for(const width of [390,768,1024,1440]){
  await page.setViewportSize({width,height:900});await page.setContent(unrelatedHTML);await page.addStyleTag({content:css});
  await page.evaluate(t=>document.documentElement.dataset.darkmode=String(t==='dark'),theme);
  const styles=()=>page.evaluate(()=>{const e=document.querySelector('.modal'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,x:r.x,font:s.fontFamily,size:s.fontSize,padding:s.padding,maxWidth:s.maxWidth};});
  const withApp=await styles();await page.evaluate(()=>document.querySelector('.fan-settings > style').remove());assert.deepEqual(await styles(),withApp,'unrelated modal unchanged with app stylesheet');
 }
 // Check actual overlay geometry with Aurora's real sidebar at intermediate widths.
 const modalResults=[];
 for(const stage of stages.filter(s=>s.name.endsWith('-modal')))for(const theme of ['light','dark'])for(const width of [390,768,1024,1440]){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme==='light'?'dark':'light'});
  await page.evaluate(t=>localStorage.setItem('aurora.theme',t),theme);await page.setContent(stage.html);
  await page.addStyleTag({content:css+'\n'+fonts});await page.addScriptTag({content:'(()=>{'+themeScript+'})()'});
  await page.evaluate(()=>{document.body.dataset.navType='sidebar';document.body.insertAdjacentHTML('afterbegin','<aside class="sidebar-panel"><div class="sidebar-panel-inner"><nav class="sidebar-list"><a href="#">风扇设置</a></nav></div></aside>');});
  await page.waitForTimeout(30);
  const geometry=await page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const modal=document.querySelector('#modal_overlay .modal'),button=modal.querySelector('button');
   return {modal:rect(modal),button:rect(button),paragraphs:[...modal.querySelectorAll('p')].map(rect),sidebar:rect(document.querySelector('.sidebar-panel')),active:document.body.classList.contains('modal-overlay-active'),dark:document.documentElement.dataset.darkmode,background:getComputedStyle(modal).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  modalResults.push({stage:stage.name,theme,width,...geometry});
  await page.screenshot({path:path.join(out,`modal-sidebar-${stage.name}-${width}-${theme}.png`)});
 }
 fs.writeFileSync(path.join(out,'modal-geometry.json'),JSON.stringify(modalResults,null,2));
 for(const r of modalResults){
  assert(r.active && r.modal.width>0 && r.button.width>0,'real visible modal and dismiss button');
  assert.equal(r.dark,String(r.theme==='dark'));
  if(r.width===768)assert.equal(r.sidebar.width,272,'real tablet sidebar');
  for(const [name,rect] of [['modal',r.modal],['button',r.button],...r.paragraphs.map(p=>['paragraph',p])])
   assert(rect.left>=0 && rect.right<=r.width && rect.top>=0 && rect.bottom<=900,`${r.stage} ${r.theme} ${r.width}: ${name} clipped ${JSON.stringify(rect)}`);
 }
 console.log('PASS modal sidebar geometry: '+modalResults.length+' cases');
 const device=await browser.newPage({reducedMotion:'reduce'});await device.route('**/*',r=>r.fulfill({body:'<!doctype html><body></body>',contentType:'text/html'}));await device.goto('http://device.test/');await device.emulateMedia({colorScheme:'light'});await device.addStyleTag({content:css});await device.addScriptTag({content:'(()=>{'+themeScript+'})()'});const light=await device.evaluate(()=>getComputedStyle(document.body).backgroundColor);await device.emulateMedia({colorScheme:'dark'});await device.waitForTimeout(30);assert.equal(await device.getAttribute('html','data-darkmode'),'true');assert.notEqual(await device.evaluate(()=>getComputedStyle(document.body).backgroundColor),light);await device.close();
 for(const stage of stages){const pair=results.filter(r=>r.stage===stage.name&&r.width===390);assert.notEqual(pair[0].background,pair[1].background);}
 const failures=results.filter(r=>r.overflow||r.clipped.length);assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'sources.json'),JSON.stringify(Object.fromEntries([path.join(pkg,'htdocs/luci-static/resources/view/fan/status.js'),path.join(pkg,'htdocs/luci-static/resources/view/fan/settings.js'),path.join(aurora,'htdocs/luci-static/aurora/main.css')].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),null,2));
 console.log(JSON.stringify({cases:results.length,stages:stages.length,failures:failures.map(({stage,theme,width,overflow,clipped})=>({stage,theme,width,overflow,clipped})),out},null,2));assert.equal(failures.length,0,'geometry failures');
}finally{j.window.close();if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
