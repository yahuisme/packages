'use strict';
// NODE_PATH=$(npm root -g) LUCI_RESOURCE_DIR=/path/to/resources node tests/test_settings_form.js
// Actual LuCI form, UCI, DOM and widgets; only transport and page bootstrap are isolated.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const resources = process.env.LUCI_RESOURCE_DIR;
if (!resources) throw Error('Set LUCI_RESOURCE_DIR to upstream LuCI resources');
const j = new JSDOM('<!doctype html><div id="maincontent"><div id="view"></div></div>', {url:'http://localhost/cgi-bin/luci/admin/system/fan',runScripts:'outside-only'});
const w = j.window;
(async () => {
 try {
  w._=s=>s; w.N_=(n,a,b)=>n===1?a:b; w.scrollTo=()=>{};
  const read=n=>fs.readFileSync(path.join(resources,n+'.js'),'utf8');
  const add=w.document.addEventListener.bind(w.document);
  w.document.addEventListener=(type,...args)=>{if(type!=='DOMContentLoaded')add(type,...args);};
  w.eval(read('cbi')); w.document.addEventListener=add;
  w.eval(read('luci').replace('window.LuCI = LuCI;', 'window.LuCI = LuCI; window.mods=classes; window.environment=env;'));
  const mods=w.mods,L=w.L=Object.create(w.LuCI.prototype);
  Object.assign(w.environment,{resource:'/luci-static/resources',scriptname:'/cgi-bin/luci',sessionid:'fixture'});
  L.require=n=>Promise.resolve(mods[n]);L.hasViewPermission=()=>true;w.E=mods.dom.create.bind(mods.dom);
  const values={settings:{'.name':'settings','.type':'fancontrol',mode:'auto',curve_preset:'custom',manual_pwm:'127'},custom:{'.name':'custom','.type':'curve'}};
  [[40,54],[50,69],[60,95],[70,199],[80,255]].forEach(([t,p],i)=>{values.custom[`point${i+1}_temp`]=String(t);values.custom[`point${i+1}_pwm`]=String(p);});
  mods.rpc={declare:spec=>async()=>spec.object==='session'?true:spec.method==='get'?w.JSON.parse(JSON.stringify(values)): {}};
  function load(n){const text=read(n),deps=[...text.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);const C=w.Function(...deps.map(d=>d.split(' as ')[1]||d.split('.').at(-1)),text)(...deps.map(d=>mods[d.split(' as ')[0]]));mods[n]=new C();}
  load('uci'); mods.fs={};load('validation');load('ui');load('form');
  const source=fs.readFileSync(path.join(__dirname,'../htdocs/luci-static/resources/view/fan/settings.js'),'utf8');
  const observed=[];let disconnects=0;
  w.ResizeObserver=class { observe(svg){observed.push(svg);} disconnect(){disconnects++;} };
  const C=w.Function('view','form','uci',source)(mods.view.extend({__init__(){}}),mods.form,mods.uci);
  const app=new C();await app.load();const node=await app.render();w.document.querySelector('#view').append(node);
  assert.equal(node.querySelector(':scope > h2').textContent, 'Airoha Fan Settings');
  const section=node.querySelector('.cbi-section-node[data-section-id="custom"]');assert(section);
  assert.equal(node.querySelectorAll('[data-section-id="custom"] .cbi-section-node').length,0,'section id is on the node itself, not its ancestor');
  assert.equal(section.querySelectorAll('[data-name^="point"] input').length,10);
  assert.equal(section.querySelectorAll('.cbi-value').length,11);
  assert.equal(section.lastElementChild.dataset.name,'_curve_preview','CSS reorders preview visually without changing native form DOM order');
  assert.deepEqual([...section.querySelectorAll('[data-name^="point"]')].map(e=>e.dataset.name),
   Array.from({length:5},(_,i)=>[`point${i+1}_temp`,`point${i+1}_pwm`]).flat(),'preserve parameter and keyboard order');
  const map=mods.dom.findClassInstance(node);
  assert.equal(map.lookupOption('point1_temp','custom')[0].formvalue('custom'),'40');
  assert.equal(section.querySelector('[data-name="point5_pwm"] input').disabled,true);
  assert.equal(section.querySelectorAll('.fan-curve-dots circle').length,5);
  const svg=section.querySelector('.fan-curve-preview svg');
  assert.deepEqual([...svg.querySelectorAll('.fan-curve-x-tick')].map(e=>e.textContent),['0','10','20','30','40','50','60','70','80','90','100']);
  assert.deepEqual([...svg.querySelectorAll('.fan-curve-y-tick')].map(e=>e.textContent),['0','32','64','96','128','160','192','224','255']);
  assert(svg.textContent.includes('°C') && svg.textContent.includes('PWM'));
  assert.equal(svg.hasAttribute('viewBox'),false,'SVG coordinates remain CSS pixels at every width');
  assert.equal(svg.querySelector('.fan-curve-line').getAttribute('stroke-width'),'1.5');
  assert.equal(svg.querySelector('.fan-curve-line').getAttribute('vector-effect'),'non-scaling-stroke');
  const input=section.querySelector('[data-name="point1_temp"] input'), line=section.querySelector('.fan-curve-line'), before=line.getAttribute('points');
  input.value='41';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.notEqual(line.getAttribute('points'),before);
  input.value='90';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(line.getAttribute('points'),'');assert(section.querySelector('.fan-curve-message').textContent);
  input.value='40';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(node.querySelectorAll(':scope > style').length,1);assert.equal(w.document.head.querySelectorAll('style').length,0);
  if(process.env.EXPORT_DOM){for(const e of node.querySelectorAll('input'))e.setAttribute('value',e.value);fs.writeFileSync(process.env.EXPORT_DOM,w.document.documentElement.outerHTML);}
  await map.reset();
  assert.equal(node.querySelectorAll(':scope > style').length,1,'reset retains responsive layout and preview styles');
  const resetSVG=node.querySelector('.fan-curve-preview svg');
  assert.notEqual(resetSVG,svg,'native reset replaces SVG');
  assert.equal(observed.at(-1),resetSVG,'observer is rebound to replacement SVG');
  assert.equal(disconnects,1,'old SVG observer disconnected on reset');
  assert.equal(resetSVG.querySelectorAll('.fan-curve-dots circle').length,5,'reset redraws valid curve');
  assert.deepEqual([...resetSVG.querySelectorAll('.fan-curve-x-tick')].map(e=>e.textContent),['0','10','20','30','40','50','60','70','80','90','100']);
  assert.deepEqual([...resetSVG.querySelectorAll('.fan-curve-y-tick')].map(e=>e.textContent),['0','32','64','96','128','160','192','224','255']);
  assert.equal(resetSVG.querySelector('.fan-curve-dots circle:last-child').getAttribute('cy'),'28','PWM 255 remains actual top endpoint');
  assert.equal(resetSVG.querySelectorAll('.fan-curve-axes line').length,20,'all tick gridlines remain after reset');
  const resetInput=node.querySelector('[data-name="point1_temp"] input');
  resetInput.value='90';resetInput.dispatchEvent(new w.Event('input',{bubbles:true}));
  await assert.rejects(map.save());
  assert(w.document.querySelector('.modal h4'),'native validation modal is visible');
  assert.equal(w.document.querySelectorAll('.modal style').length,0,'validation modal uses native theme without typography injection');
  mods.ui.hideModal();mods.ui.showModal('Unrelated',[w.E('p',{},['Independent modal'])]);
  assert(!w.document.querySelector('.fan-settings-modal'),'next modal must not inherit fan styling');
  mods.ui.hideModal();
  node.remove();assert.equal(w.document.querySelectorAll('.fan-settings style').length,0);
  console.log('PASS real LuCI settings: custom section, ten widgets, defaults, fixed PWM, live valid/invalid curve, local style cleanup');
 } finally {j.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
