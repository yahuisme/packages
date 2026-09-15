'use strict';
// Export real LuCI DOM using test_settings_form.js first. Offline Chromium + optional Aurora CSS.
// NODE_PATH=/path/to/playwright/node_modules FAN_DOM=/tmp/fan.dom.html node tests/test_curve_browser.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true});
 const results=[];
 try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(fs.readFileSync(process.env.FAN_DOM,'utf8'));
  if(process.env.AURORA_CSS) await page.addStyleTag({content:fs.readFileSync(process.env.AURORA_CSS,'utf8')});
  if(process.env.AURORA_DIR){
   const header=fs.readFileSync(path.join(process.env.AURORA_DIR,'ucode/template/themes/aurora/header.ut'),'utf8');
   const sidebar=header.slice(header.indexOf('<aside class="sidebar-panel"'),header.indexOf('</aside>')+8).replace(/{%[\s\S]*?%}/g,'').replace(/{{[^}]*}}/g,'');
   // Trusted local Aurora template only; no user/runtime text in this sink.
   await page.evaluate(html=>{document.body.dataset.navType='sidebar';document.body.insertAdjacentHTML('afterbegin',html);},sidebar);
  }else await page.addStyleTag({content:'body{margin:0;padding:16px} #maincontent{margin:0} @media(min-width:900px){body{padding-left:256px}}'});
  const source=fs.readFileSync(path.join(__dirname,'../htdocs/luci-static/resources/view/fan/settings.js'),'utf8');
  // Execute unchanged production preview functions and render-time event/observer setup.
  await page.evaluate(source=>{
   window._=s=>s;
   window.resizeDisconnects=0;
   const NativeResizeObserver=window.ResizeObserver;
   window.ResizeObserver=class extends NativeResizeObserver {
    disconnect(){window.resizeDisconnects++;super.disconnect();}
   };
   const helpers=source.slice(source.indexOf('function validPoints'),source.indexOf('\nreturn view.extend'));
   const setup=source.slice(source.indexOf('\t\t\tvar refresh ='),source.indexOf('\t\t\treturn node;',source.indexOf('\t\t\tvar refresh =')));
   // Trusted checked-out application source only; no user-supplied code.
   new Function('node',helpers+'\nvar resize;\n'+setup)(document.querySelector('.fan-settings'));
  },source);
  for(const dark of [false,true]) for(const width of [320,390,768,1024,1440,1920]) {
   await page.setViewportSize({width,height:1000});
   await page.evaluate(d=>document.documentElement.setAttribute('data-darkmode',String(d)),dark);
   await page.waitForTimeout(80);
   // Native Bootstrap hides inactive LuCI options with an ordinary .hidden rule.
   // Layout must not override that rule at any responsive container width.
   const hiddenRule=await page.addStyleTag({content:'.hidden{display:none}'});
   const inactive=await page.evaluate(()=>{
    const fields=[...document.querySelectorAll('.cbi-section-node[data-section-id="custom"] > .cbi-value')];
    fields.forEach(e=>e.classList.add('hidden'));
    const displays=fields.map(e=>({name:e.dataset.name,display:getComputedStyle(e).display}));
    fields.forEach(e=>e.classList.remove('hidden'));
    return displays;
   });
   await hiddenRule.evaluate(e=>e.remove());
   assert.equal(inactive.length,11,'ten custom parameters and curve preview');
   assert.deepEqual(inactive.filter(e=>e.display!=='none'),[],'inactive options stay hidden despite app layout');
   const result=await page.evaluate(()=>{
    const svg=document.querySelector('.fan-curve-preview svg'),r=svg.getBoundingClientRect();
    const line=svg.querySelector('polyline'),text=svg.querySelector('text');
    const section=document.querySelector('.cbi-section-node[data-section-id="custom"]');
    const field=section.querySelector('[data-name="point1_temp"]').getBoundingClientRect();
    const preview=section.querySelector('[data-name="_curve_preview"]').getBoundingClientRect();
    const stacked=preview.bottom<=field.top+1;
    const layoutOK=stacked || field.right<=preview.left+1;
    const clipped=[...svg.querySelectorAll('text')].filter(e=>{const b=e.getBoundingClientRect();return b.left<r.left||b.right>r.right||b.top<r.top||b.bottom>r.bottom;}).map(e=>e.textContent);
    const ticks=[...svg.querySelectorAll('.fan-curve-x-tick')];
    const overlap=ticks.some((e,i)=>i&&ticks[i-1].getBoundingClientRect().right>e.getBoundingClientRect().left && ticks[i-1].getBoundingClientRect().top<e.getBoundingClientRect().bottom && e.getBoundingClientRect().top<ticks[i-1].getBoundingClientRect().bottom);
    const yTicks=[...svg.querySelectorAll('.fan-curve-y-tick')];
    const yOverlap=yTicks.some((e,i)=>i&&e.getBoundingClientRect().bottom>yTicks[i-1].getBoundingClientRect().top);
    const probe=document.createElement('span');
    probe.style.color='var(--cbi-primary-color,light-dark(#2563eb,#60a5fa))';
    section.append(probe);
    const expectedColor=getComputedStyle(probe).color;probe.remove();
    return {expectedColor,dotColor:getComputedStyle(svg.querySelector('circle')).fill,textColor:getComputedStyle(text).fill,xTicks:ticks.map(e=>e.textContent),yTicks:yTicks.map(e=>e.textContent),yOverlap,width:innerWidth,dark:document.documentElement.getAttribute('data-darkmode')==='true',stacked,layoutOK,chartWidth:r.width,height:r.height,font:getComputedStyle(text).fontSize,stroke:getComputedStyle(line).strokeWidth,color:getComputedStyle(line).stroke,clipped,overlap,overflow:document.documentElement.scrollWidth>innerWidth,points:line.getAttribute('points')};
   });
   assert.equal(result.height,360);assert.equal(result.font,'12px');assert.equal(result.stroke,'1.5px');
   assert.equal(result.color,result.expectedColor,'curve follows the active blue theme accent');
   assert.equal(result.dotColor,result.expectedColor,'markers follow the same accent');
   assert.notEqual(result.color,result.textColor,'missing token must not turn the curve into body text');
   assert.deepEqual(result.xTicks,['0','10','20','30','40','50','60','70','80','90','100']);assert.deepEqual(result.yTicks,['0','32','64','96','128','160','192','224','255']);assert.equal(result.yOverlap,false);
   assert.deepEqual(result.clipped,[]);assert.equal(result.overlap,false);assert.equal(result.overflow,false);
   assert.equal(result.layoutOK,true,'preview stacks above fields or sits alongside them without overlap');
   const x=Number(result.points.split(' ')[0].split(',')[0]);
   assert(Math.abs(x-(40+0.4*(result.chartWidth-2-64)))<1,'resize recalculates point geometry');
   results.push(result);
   if(process.env.FAN_SCREENSHOTS && [390,1440].includes(width)) {
    fs.mkdirSync(process.env.FAN_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:path.join(process.env.FAN_SCREENSHOTS,`fan-${width}-${dark?'dark':'light'}.png`),fullPage:true});
   }
  }
  await page.locator('[data-name="point1_temp"] input').fill('41');
  const valid=await page.locator('.fan-curve-line').getAttribute('points');assert(valid);
  await page.locator('[data-name="point1_temp"] input').fill('90');assert.equal(await page.locator('.fan-curve-line').getAttribute('points'),'');
  await page.locator('[data-name="point1_temp"] input').fill('40');assert(await page.locator('.fan-curve-line').getAttribute('points'));
  await page.evaluate(()=>document.querySelector('.fan-settings').remove());await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.resizeDisconnects),1,'resize observer disconnects on view removal');
  assert.deepEqual(errors,[]);
  if(process.env.FAN_RESULTS) fs.writeFileSync(process.env.FAN_RESULTS,JSON.stringify(results,null,2));
  console.log('PASS Chromium: '+results.length+' width/theme cases; ticks, clipping, fixed pixel typography/stroke, resize, live invalid/recovery, detach');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
