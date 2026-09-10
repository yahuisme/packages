'use strict';
// First run test_ui_coverage.js against this tree to export fresh real LuCI DOM.
// NODE_PATH=$(npm root -g) FAN_UI_OUTPUT=... AURORA_DIR=... node tests/test_status_browser.js
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),{chromium}=require('playwright');
const out=process.env.FAN_UI_OUTPUT,aurora=process.env.AURORA_DIR;
const source=path.resolve(__dirname,'../htdocs/luci-static/resources/view/fan/status.js');
assert.equal(JSON.parse(fs.readFileSync(path.join(out,'sources.json')))[source],crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),'DOM export must match current production view');
(async()=>{const browser=await chromium.launch({headless:true}),rows=[];try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.fulfill({body:''}));
 for(const stage of ['status-auto','status-manual','status-mismatch','status-unavailable'])for(const width of [320,390,768,1024,1440,1920])for(const dark of [false,true]){
  await page.setViewportSize({width,height:900});await page.setContent(fs.readFileSync(path.join(out,stage+'.html'),'utf8'));
  await page.addStyleTag({content:fs.readFileSync(path.join(aurora,'htdocs/luci-static/aurora/main.css'),'utf8')});
  // Static trusted sidebar markup only; no runtime/user text enters this HTML sink.
  await page.evaluate(d=>{document.documentElement.setAttribute('data-darkmode',String(d));document.body.dataset.navType='sidebar';document.body.insertAdjacentHTML('afterbegin','<aside class="sidebar-panel" id="sidebar-panel" aria-label="导航"><nav class="sidebar-panel-inner"><div class="sidebar-head"><a class="sidebar-brand">离线验证</a></div><ul class="sidebar-list" id="sidebar-list"><li>状态</li><li>设置</li></ul><div class="sidebar-footer"></div></nav></aside>');},dark);
  await page.waitForTimeout(40);
  const row=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};return {main:rect(document.querySelector('#maincontent')),sidebar:rect(document.querySelector('aside')),grid:rect(document.querySelector('.fan-summary-grid')),cards:[...document.querySelectorAll('.fan-summary-card')].map(rect),overflow:document.documentElement.scrollWidth>innerWidth,clipped:[...document.querySelectorAll('.fan-card-value,.fan-card-sub')].filter(e=>e.scrollWidth>e.clientWidth).map(e=>e.textContent),track:getComputedStyle(document.querySelector('.fan-temp-track')).backgroundColor,border:getComputedStyle(document.querySelector('.fan-temp-card')).borderBottomColor,subtitle:document.querySelector('#fan-summary-preset .fan-card-sub').textContent};});
  rows.push({stage,width,dark,...row});fs.writeFileSync(path.join(out,'sidebar-results.json'),JSON.stringify(rows,null,2));
  assert.equal(row.overflow,false);assert.deepEqual(row.clipped,[]);assert.equal(row.cards.length,4);
  assert(row.cards.every(r=>r.left>=row.grid.left-1&&r.right<=row.grid.right+1&&r.right<=width+1));
  if(width===768){assert.equal(row.sidebar.width,272);assert.equal(row.main.width,496);assert(row.cards[2].top>row.cards[0].top,'tablet cards wrap to second row');}
  if(stage!=='status-unavailable')assert.equal(row.subtitle,'自动模式使用的配置曲线');
  if(stage==='status-mismatch'&&[390,768,1440].includes(width))await page.screenshot({path:path.join(out,`sidebar-${width}-${dark?'dark':'light'}.png`),fullPage:true});
 }
 for(const width of [320,390,768,1024,1440,1920]){const pair=rows.filter(r=>r.width===width&&r.stage==='status-auto');assert.notEqual(pair[0].track,pair[1].track);assert.notEqual(pair[0].border,pair[1].border);}
 assert.equal(rows.length,48);assert.deepEqual(errors,[]);console.log('PASS '+rows.length+' fresh-DOM Chromium Aurora sidebar status cases; 768px/272px sidebar, card containment, configured semantics, dark tracks/borders');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
