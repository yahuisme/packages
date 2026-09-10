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
  await page.addStyleTag({content:'body{margin:0;padding:16px} #maincontent{margin:0} @media(min-width:900px){body{padding-left:256px}}'});
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
   const setup=source.slice(source.indexOf('\t\t\tvar refresh ='),source.indexOf('\t\t\treturn node;'));
   // Trusted checked-out application source only; no user-supplied code.
   new Function('node',helpers+'\n'+setup)(document.querySelector('.fan-settings'));
  },source);
  for(const dark of [false,true]) for(const width of [320,390,768,1024,1440,1920]) {
   await page.setViewportSize({width,height:1000});
   await page.evaluate(d=>document.documentElement.setAttribute('data-darkmode',String(d)),dark);
   await page.waitForTimeout(80);
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
    const overlap=ticks.some((e,i)=>i&&ticks[i-1].getBoundingClientRect().right>e.getBoundingClientRect().left);
    return {width:innerWidth,dark:document.documentElement.getAttribute('data-darkmode')==='true',stacked,layoutOK,chartWidth:r.width,height:r.height,font:getComputedStyle(text).fontSize,stroke:getComputedStyle(line).strokeWidth,color:getComputedStyle(line).stroke,clipped,overlap,overflow:document.documentElement.scrollWidth>innerWidth,points:line.getAttribute('points')};
   });
   assert.equal(result.height,244);assert.equal(result.font,'12px');assert.equal(result.stroke,'1.5px');assert.equal(result.color,'rgb(59, 130, 246)');
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
