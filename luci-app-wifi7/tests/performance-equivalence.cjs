// Differential real-LuCI acceptance. Baseline sources and artifacts stay outside the checkout.
const fs = require('fs'), path = require('path'), cp = require('child_process'), assert = require('assert/strict');
const { boot } = require('./integration.cjs');
const mode = process.argv[2], worker = process.argv[3] === 'worker';
const BASELINE_COMMIT = 'c9636f029c8fbd631cfecff43eff301d8eb898ba';
const MODES = ['clients', 'channels', 'mlo'];
function baselineSources(root) {
 const resources = path.join(root, 'resources');
 for (const relative of ['htdocs/luci-static/resources/view/wifi7/index.js', 'htdocs/luci-static/resources/wifi7/mlo.js', 'htdocs/luci-static/resources/wifi7/telemetry.js', 'root/usr/libexec/wifi7-status']) {
  const target = relative.startsWith('htdocs/') ? path.join(resources, relative.slice('htdocs/luci-static/resources/'.length)) : path.join(root, relative);
  let source = cp.execFileSync('git', ['show', BASELINE_COMMIT + ':luci-app-wifi7/' + relative], {cwd: path.join(__dirname, '../..')});
  if (relative.endsWith('/wifi7/mlo.js')) {
   // Carry only the authorized empty-radio bug fix into the immutable oracle.
   // Keep its intentionally expensive full-overview refresh for cost comparison.
   const old = "let radioText = devices.length ? E('span', { class: 'mlo-overview-radios' }, devices.map(device => E('span', {}, radiosByName[device] ? radioLabel(radiosByName[device], true) : [ device ]))) : _('None');";
   const fixed = "let radioText = E('span', { class: 'mlo-overview-radios' }, devices.length ? devices.map(device => E('span', {}, radiosByName[device] ? radioLabel(radiosByName[device], true) : [ device ])) : _('None'));";
   const text = source.toString();
   assert.equal(text.split(old).length, 2, 'baseline empty-radio correction must match exactly once');
   source = Buffer.from(text.replace(old, fixed));
  }
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, source, {mode:0o600});
 }
 return resources;
}
function snapshot(h, name) {
 return { name, html: h.node.outerHTML, modal: h.w.document.querySelector('.wifi7-mlo-modal')?.outerHTML || null, fields: [...h.w.document.querySelectorAll('input,select')].map(n => ({id:n.id,value:n.value,checked:n.checked,disabled:n.disabled})), calls: structuredClone(h.calls), db: structuredClone(h.db()), notifications: structuredClone(h.notifications) };
}
async function clients() {
 const h = await boot();
 try {
  await h.tab(3); await h.poll();
  const counts = { emptySets: 0, attributionFilters: 0 }, states = [];
  const Set = h.w.Set, filter = h.w.Array.prototype.filter;
  h.w.Set = class extends Set { constructor(value) { super(value); if (value === undefined) counts.emptySets++; } };
  h.w.Array.prototype.filter = function(...args) { if (/at radioFor /.test(new Error().stack)) counts.attributionFilters++; return filter.apply(this,args); };
  const post = h.mods.request.post; let state = 'normal';
  h.mods.request.post = async (url, req) => {
   const [,object,method,p] = req.params;
   if (state === 'failed' && ['iwinfo','file','luci-rpc'].includes(object)) return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[6]}))};
   const response = await post(url,req), body = response.json();
   if (object === 'file' && method === 'exec' && p.command.includes('wifi7-status')) {
    if (state === 'empty') body.result[1].stdout = '@@ devices 0\nInterface ap-mld\n@@ stations ap-mld 0\n';
    if (state === 'unknown') body.result[1].stdout = '@@ devices 1\n\n';
    if (state === 'incomplete') body.result[1].stdout = '@@ devices 0\nInterface ap-mld\n@@ stations ap-mld 0\nStation aa:bb:cc:dd:ee:01 (on ap-mld)\n Link 9:\n tx bitrate: 2400.0 MBit/s 160MHz EHT-MCS 11\n';
   }
   if (object === 'iwinfo' && method === 'assoclist' && ['empty','unknown','incomplete'].includes(state)) body.result = state === 'unknown' ? [6] : [0,{results:[]}];
   if (object === 'iwinfo' && method === 'devices' && state === 'unknown') body.result = [6];
   if (object === 'luci-rpc' && state === 'unknown') body.result = [0,{}];
   return {...response,json:()=>body};
  };
  for (const next of ['normal','unknown','empty','incomplete','failed','normal']) {
   state = next; await h.poll(); states.push(snapshot(h,next));
  }
  assert(states[0].html.includes('MLO 9'));
  assert(states[1].html.includes('Client data unavailable'));
  assert(states[2].html.includes('No connected clients'));
  assert(states[3].html.includes('Unknown'));
  assert.equal(states[0].html,states.at(-1).html,'failure recovers complete markup');
  return {counts,states};
 } finally { h.w.close(); }
}
async function channels() {
 const counts = { frequencyFilters: 0, optionFinds: 0 }, states = [];
 const h = await boot({
  setup(w) {
   const filter = w.Array.prototype.filter, find = w.Array.prototype.find;
   w.Array.prototype.filter = function(...args) { if (this.length && this.every(f=>f && typeof f.mhz==='number' && 'channel' in f)) counts.frequencyFilters++; return filter.apply(this,args); };
   w.Array.prototype.find = function(...args) { if (/at .*channelSelect|at eval .*<anonymous>:/.test(new Error().stack) && this.length && this.every(f=>f && typeof f.mhz==='number' && 'channel' in f)) counts.optionFinds++; return find.apply(this,args); };
  },
  freqlist(staged) { return [{channel:13,mhz:2472},{channel:'auto',mhz:2412},{channel:36,mhz:5180},{channel:'36',mhz:5200},{channel:40,mhz:5200,restricted:true,flags:['no_ir']},{channel:44,mhz:5220,restricted:true,flags:[]},{channel:48,mhz:5240,restricted:true},{channel:37,mhz:6135},...(staged.radio0.country==='US'?[{channel:11,mhz:2462}]:[])]; }
 });
 try {
  await h.poll(); states.push(snapshot(h,'initial'));
  assert.equal(h.field('radio1','channel').value,'104','legacy channel retained');
  const options = [...h.field('radio1','channel').options];
  assert.deepEqual(options.filter(o=>o.value==='36').map(o=>o.textContent),['36 (5180 MHz)','36 (5180 MHz)'],'duplicate channels use first matching label');
  assert(!options.some(o=>o.value==='40'||o.value==='48')); assert(options.some(o=>o.value==='44'));
  assert.equal(h.field('radio0','channel').options[0].textContent,'auto (2412 MHz)','even unusual driver Auto channel retains first-match labeling');
  h.field('radio0','country').value='US'; h.field('radio0','country').dispatchEvent(new h.w.Event('change'));
  states.push(snapshot(h,'country-draft')); await h.clickSave(); states.push(snapshot(h,'country-applied'));
  assert([...h.field('radio0','channel').options].some(o=>o.value==='11'));
  h.state.frequencyFailure=true; h.field('radio0','country').value='CA'; h.field('radio0','country').dispatchEvent(new h.w.Event('change')); await h.clickSave(); states.push(snapshot(h,'discovery-failed'));
  h.state.frequencyFailure=false; h.field('radio0','country').value='US'; h.field('radio0','country').dispatchEvent(new h.w.Event('change')); await h.clickSave(); states.push(snapshot(h,'recovered'));
  return {counts,states};
 } finally { h.w.close(); }
}
async function mlo() {
 const counts = { refreshElements: 0, overviewElements: 0, discardedElements: 0 }, states = [];
 const h = await boot({setup(w) { let seed=17; w.Math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296); }});
 try {
  const iface = {'.name':'mlo0','.type':'wifi-iface','.index':3,mode:'ap',mlo:'1',device:['radio1','radio2'],ssid:'Fixture',encryption:'none'};
  h.db().staged.mlo0=structuredClone(iface); h.db().committed.mlo0=structuredClone(iface);
  const transport=h.mods.request.post;
  h.mods.request.post=async(url,req)=>req.params[1]==='uci' && req.params[2]==='get' && req.params[3].config==='network'
   ? {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,{values:{lan:{'.name':'lan','.type':'interface','.index':0}}}]}))}
   : transport(url,req);
  h.mods.uci.unload('wireless'); await h.mods.uci.load('wireless');
  let operation; const render=h.mods['wifi7.mlo'].render;
  h.mods['wifi7.mlo'].render=function(data,op) { operation=op; return render.call(this,data,op); };
  await h.tab(2); await h.poll();
  const map=h.mods.dom.findClassInstance(h.q('.mlo-map'));
  const create=h.w.document.createElement; let measuring=false, allocated=[];
  h.w.document.createElement=function(...args) { const node=create.apply(this,args); if(measuring) { allocated.push(node); counts.refreshElements++; if(/at overview /.test(new Error().stack)) counts.overviewElements++; } return node; };
  for (const [name,devices,disabled] of [['normal',['radio1','radio2'],'0'],['unknown',['radio1','missing'],'0'],['incomplete',['radio1'],'0'],['empty',[],'0'],['disabled',['radio1','radio2'],'1'],['recovered',['radio1','radio2'],'0']]) {
   h.mods.uci.set('wireless','mlo0','device',h.w.Array.from(devices)); h.mods.uci.set('wireless','mlo0','disabled',disabled);
   await map.reset(); await h.poll();
   states.push(snapshot(h,name+'-reset'));
   allocated=[]; measuring=true; operation.refreshMloConfiguration(); measuring=false;
   counts.discardedElements+=allocated.filter(node=>!node.isConnected).length;
   states.push(snapshot(h,name+'-refresh'));
  }
  assert(states.some(s=>s.html.includes('missing')));
  assert(states.some(s=>s.html.includes('None')));
  assert(states.some(s=>s.html.includes('incomplete')));
  const post=h.mods.request.post;
  h.mods.request.post=async(url,req)=>req.params[1]==='luci-rpc' ? {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[6]}))} : post(url,req);
  await h.poll(); operation.refreshMloConfiguration(); states.push(snapshot(h,'failed'));
  h.mods.request.post=post; await h.poll(); operation.refreshMloConfiguration(); states.push(snapshot(h,'runtime-recovered'));
  for (const devices of [[],['missing'],['radio1','radio2']]) {
   h.mods.uci.set('wireless','mlo0','device',h.w.Array.from(devices));
   operation.refreshMloConfiguration(); states.push(snapshot(h,'direct-transition-'+devices.join(',')));
  }
  // Reset rebinds the summary/overview before updating an open native editor.
  await map.reset(); await h.poll();
  await map.children[0].renderMoreOptionsModal('mlo0');
  const input=h.w.document.getElementById('widget.cbid.wireless.mlo0.ssid');
  input.value='Unsaved draft'; input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  const modal=h.mods.dom.findClassInstance(map.children[0].getActiveModalMap());
  const widget=modal.lookupOption('device','mlo0')[0].getUIElement('mlo0');
  widget.setValue(h.w.Array.of('radio0','radio1'));
  states.push(snapshot(h,'open-draft'));
  h.mods.uci.set('wireless','radio1','channel','36'); operation.refreshMloConfiguration();
  assert.equal(input,h.w.document.getElementById('widget.cbid.wireless.mlo0.ssid'));
  assert.equal(input.value,'Unsaved draft');
  assert.deepEqual(Array.from(widget.getValue()).sort(),['radio0','radio1']);
  states.push(snapshot(h,'open-draft-refreshed'));
  return {counts,states};
 } finally { h.w.close(); }
}
async function run() {
 if (worker) {
  const result = await ({clients,channels,mlo}[mode])();
  const root=process.env.WIFI7_JS || path.join(__dirname,'../htdocs/luci-static/resources/view/wifi7/index.js');
  result.sources=Object.fromEntries([root,path.join(path.dirname(root),'../../wifi7/mlo.js'),path.join(path.dirname(root),'../../wifi7/telemetry.js'),path.join(process.env.LUCI_RESOURCE_DIR,'luci.js')].map(p=>[p,require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
  fs.writeFileSync(process.env.PERF_RESULT,JSON.stringify(result,null,2)); return;
 }
 assert(mode === undefined || MODES.includes(mode), 'Unknown mode: ' + mode);
 assert(process.env.TMPDIR, 'Set TMPDIR to private scratch');
 const temporary = fs.mkdtempSync(path.join(process.env.TMPDIR, 'wifi7-equivalence-'));
 try {
  const baseline = process.env.PERF_BASELINE_DIR || baselineSources(temporary);
  const out = process.env.PERF_OUT || path.join(temporary, 'results');
  fs.mkdirSync(out, {recursive:true});
  for (const selected of mode ? [mode] : MODES) compare(selected, baseline, out);
 } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
}
function compare(mode, baseline, out) {
 const results = [];
 for (const variant of ['baseline','current']) {
  const output = path.join(out,mode+'-'+variant+'.json');
  const env = {...process.env,PERF_RESULT:output};
  if (variant === 'baseline') env.WIFI7_JS = path.join(baseline,'view/wifi7/index.js'); else delete env.WIFI7_JS;
  const r = cp.spawnSync(process.execPath,[__filename,mode,'worker'],{env,encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr); results.push(JSON.parse(fs.readFileSync(output)));
 }
 const [before,after] = results;
 assert.deepEqual(after.states,before.states,'complete ordered HTML, form values, RPC calls, DB and notifications must match');
 console.log(JSON.stringify({mode,before:before.counts,after:after.counts}));
 if (mode === 'clients') {
  assert(before.counts.emptySets>0 && before.counts.attributionFilters>0,'nonzero measured baseline');
  assert.equal(after.counts.emptySets,0,'no unused per-interface mapped Sets');
  assert(after.counts.attributionFilters<before.counts.attributionFilters,'no client-only radio attribution');
 }
 if (mode === 'channels') {
  assert(before.counts.optionFinds>0,'nonzero measured find baseline');
  assert.equal(after.counts.optionFinds,0,'no per-option linear find');
  assert.equal(after.counts.frequencyFilters,5,'one filter per radio initial load and successful country refresh');
 }
 if (mode === 'mlo') {
  assert(before.counts.overviewElements>0 && before.counts.discardedElements>0,'nonzero discarded DOM baseline');
  assert.equal(after.counts.overviewElements,0,'configuration refresh never builds discarded overview');
  assert.equal(after.counts.discardedElements,0,'all newly allocated radio elements are attached');
  assert(after.counts.refreshElements<before.counts.refreshElements,'measured refresh allocation reduction');
 }
 console.log('PASS '+mode+' complete native DOM/data/RPC differential and operation bounds');
}
run().catch(e=>{console.error(e);process.exitCode=1});
