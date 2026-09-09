// Independent integration audit: application and actual LuCI modules, fixture transport only.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {JSDOM}=require('jsdom');
const ROOT=process.env.LUCI_RESOURCE_DIR;
const APP=process.env.WIFI7_JS||path.join(__dirname,'../htdocs/luci-static/resources/view/wifi7/index.js');
const OUT=process.env.AUDIT_OUT;
const SOURCE=fs.readFileSync(APP,'utf8'), TELEMETRY=fs.readFileSync(path.join(path.dirname(APP),'../../wifi7/telemetry.js'),'utf8'), MLO=fs.readFileSync(path.join(path.dirname(APP),'../../wifi7/mlo.js'),'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const tick=()=>new Promise(r=>setImmediate(r));
async function boot({readonly=false,missing=false,frequencyFailure=false}={}) {
 const j=new JSDOM('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="maincontent"><div id="view"></div></div></body></html>',{url:'http://localhost/cgi-bin/luci/admin/network/wifi7',runScripts:'outside-only',pretendToBeVisual:true}),w=j.window;
 const translations=process.env.WIFI7_TRANSLATIONS?JSON.parse(fs.readFileSync(process.env.WIFI7_TRANSLATIONS,'utf8')):{};
 w._=s=>translations[s]||s;w.N_=(n,a,b)=>n===1?a:b;w.scrollTo=()=>{};w.confirm=()=>true;
 let core=fs.readFileSync(ROOT+'/luci.js','utf8').replace('window.LuCI = LuCI;','window.LuCI = LuCI; window.__classes=classes; window.__env=env;');
 w.eval(fs.readFileSync(ROOT+'/cbi.js','utf8'));w.eval(core);
 const mods=w.__classes,L=w.L=Object.create(w.LuCI.prototype);
 Object.assign(w.__env,{resource:'/luci-static/resources',media:'/luci-static/bootstrap',scriptname:'/cgi-bin/luci',requestpath:['admin','network','wifi7'],sessionid:'fixture',apply_rollback:30});
 L.require=n=>Promise.resolve(mods[n]);L.hasViewPermission=()=>!readonly;w.E=mods.dom.create.bind(mods.dom);
 const clone=x=>w.JSON.parse(JSON.stringify(x));
 const initial={radio0:{'.name':'radio0','.type':'wifi-device','.index':0,band:'2g',channel:'13',country:'00',htmode:'HE20'},radio1:{'.name':'radio1','.type':'wifi-device','.index':1,band:'5g',channel:'104',country:'AU',htmode:'VENDOR_UNKNOWN'},radio2:{'.name':'radio2','.type':'wifi-device','.index':2,band:'6g',channel:'37',country:'AU',htmode:'EHT160'}};
 if(missing)delete initial.radio0.htmode;
 let staged=clone(initial),committed=clone(initial);const calls=[],notifications=[],errors=[];
 w.addEventListener('error',e=>errors.push(String(e.error||e.message)));
 const state={applyCode:0,generation:0,frequencyFailure};
 function stdout(){return `@@ devices 0\nInterface ap-mld\n - link ID 7 link addr aa:bb:cc:dd:ee:03\n channel 36 (5180 MHz), width: 80 MHz\n - link ID 9 link addr aa:bb:cc:dd:ee:04\n channel 37 (6135 MHz), width: 160 MHz\n@@ stations ap-mld 0\nStation aa:bb:cc:dd:ee:01 (on ap-mld)\n connected time: ${100+state.generation}\n Link 7:\n signal: -42 [-43, -44] dBm\n tx bitrate: 1200.0 MBit/s 80MHz EHT-MCS 11\n Link 9:\n tx bitrate: 2400.0 MBit/s 160MHz EHT-MCS 11\n@@ hostapd ap-mld_link7 0\nstate=DFS\nfreq=5260\nchan_util_avg=128\ncac_time_left_seconds=37\n`;}
 mods.request.post=async(url,req)=>{
  assert.equal(req.method,'call');const [,object,method,p]=req.params;calls.push({object,method,params:JSON.parse(JSON.stringify(p))});let result;
  if(object==='uci') {
   if(method==='get')result=[0,{values:staged}];
   else if(method==='changes')result=[0,{changes:{}}];
   else if(method==='set'){Object.assign(staged[p.section],clone(p.values));result=[0];}
   else if(method==='delete'){for(const k of p.options||[])delete staged[p.section][k];result=[0];}
   else if(method==='apply'){assert.equal(p.rollback,true);if(!state.applyCode)committed=clone(staged);result=state.applyCode?(state.ubusFailure?[state.applyCode]:[0,state.applyCode]):[0];}
   else if(method==='confirm')result=[0];
   else throw Error('Unhandled UCI method '+method);
  } else if(object==='luci-rpc'&&method==='getWirelessDevices')result=[0,{radio0:{up:true,interfaces:[]},radio1:{up:true,interfaces:[{section:'mlo0',ifname:'ap-mld0',mld:true}]},radio2:{up:true,interfaces:[]}}];
  else if(object==='iwinfo') {
   if(method==='freqlist')result=state.frequencyFailure?[6]:[0,{results:[{channel:13,mhz:2472},{channel:36,mhz:5180},{channel:40,mhz:5200,restricted:true,flags:['no_ir']},{channel:37,mhz:6135},...(staged.radio0.country==='US'?[{channel:11,mhz:2462}]:[])]}];
   else if(method==='devices')result=[0,{devices:['ap-mld']}];
   else if(method==='assoclist')result=[0,{results:[{mac:'aa:bb:cc:dd:ee:01',signal:-42,tx:{rate:1200000,eht:true,mhz:80}}]}];
   else if(method==='info')result=[0,{frequency:5180,channel:36,txpower:25,htmode:'HE80',htmodes:['HE20','HE40','HE80']}];
  } else if(object==='file'&&method==='exec')result=[0,{code:0,stdout:p.command==='/usr/libexec/wifi7-firmware'?'firmware version fixture':stdout()}];
  else if(object==='session')result=[0,{access:!readonly}];
  if(!result)throw Error('Unhandled RPC '+object+'/'+method);
  const body=clone({jsonrpc:'2.0',id:req.id,result});return {ok:true,status:200,json:()=>body};
 };
 function load(n,src){src=src||fs.readFileSync(ROOT+'/'+n+'.js','utf8');const deps=[...src.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]),names=deps.map(x=>x.split(' as ')[1]||x.split('.').at(-1)),values=deps.map(x=>mods[x.split(' as ')[0]]);const C=w.Function(...names,src)(...values);return mods[n]=typeof C==='function'?new C():C;}
 load('rpc');load('uci');
 const applyRejections=[],realApply=mods.uci.apply;mods.uci.apply=function(...args){return realApply.apply(this,args).catch(e=>{applyRejections.push({type:typeof e,value:String(e)});throw e;});};
 mods.fs={};load('validation');load('ui');load('form');
 mods.ui.addNotification=(title,node,type)=>notifications.push({text:node.textContent,type});
 let poll;mods.poll.add=f=>{poll=f};L.loaded=true;
 mods.network={flushCache:async()=>{},getWifiDevices:async()=>Object.keys(staged).map(id=>({getName:()=>id,isUp:()=>true})),getWifiNetworks:async()=>[{getIfname:()=>'ap-mld',getWifiDeviceName:()=>'radio1',getSSID:()=>'Fixture MLO'}]};
 load('wifi7.telemetry',TELEMETRY);load('wifi7.mlo',MLO);const app=load('app',SOURCE);
 const deadline=Date.now()+3000;while(!w.document.querySelector('.wifi7-map') && Date.now()<deadline)await tick();
 await tick();const node=w.document.querySelector('.wifi7-map');assert.ok(node,'real view constructor must mount parent');assert.equal(node.querySelectorAll('.cbi-tabmenu a').length,4);assert.equal(node.querySelectorAll('.mlo-map').length,0,'MLO must not auto-mount');
 const q=s=>node.querySelector(s),field=(id,key)=>q('#wifi7-'+id+'-'+key),save=q('.cbi-button-apply');
 async function clickSave(){save.click();await tick();const deadline=Date.now()+5000;while(save.disabled&&!readonly&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));await tick();assert.ok(!save.disabled||readonly,'save did not settle');assert.deepEqual(errors,[]);}
 return {j,w,node,q,field,save,calls,state,notifications,applyRejections,clickSave,poll:async()=>{await poll();await tick()},tab:async i=>{q('.cbi-tabmenu').children[i].querySelector('a').click();await tick()},db:()=>({staged,committed}),writes:()=>calls.filter(c=>c.object==='uci'&&['set','delete','apply','confirm'].includes(c.method))};
}
module.exports={boot};
async function main(){if(OUT)fs.mkdirSync(OUT,{recursive:true});const results=[];
 async function test(name,fn,opts){let h;try{h=await boot(opts);await fn(h);results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}finally{if(h){if(OUT)fs.writeFileSync(path.join(OUT,name+'.rpc.json'),JSON.stringify(h.calls,null,2));h.j.window.close();}}console.log((results.at(-1).pass?'PASS ':'FAIL ')+name);}
 await test('no-op-and-unsupported-mode',async h=>{assert.equal(h.field('radio1','width').value,'VENDOR_UNKNOWN');await h.clickSave();assert.equal(h.writes().length,0);});
 await test('missing-mode-no-op',async h=>{await h.clickSave();assert.equal(h.writes().length,0);},{missing:true});
 await test('failed-freqlist-preserves-config',async h=>{assert.equal(h.field('radio1','channel').value,'104');await h.clickSave();assert.equal(h.writes().length,0);},{frequencyFailure:true});
 await test('country00-baseline-refresh',async h=>{assert.ok(h.field('radio0','country').checkValidity());h.field('radio0','power').value='24';await h.clickSave();assert.equal(h.db().committed.radio0.txpower,'24');assert.equal(h.db().committed.radio0.country,'00');const country=h.field('radio0','country');country.value='US';country.dispatchEvent(new h.w.Event('change'));assert.equal(h.field('radio0','channel').disabled,true);const before=h.calls.filter(c=>c.method==='freqlist').length;await h.clickSave();assert.equal(h.db().committed.radio0.country,'US');assert.ok(h.calls.filter(c=>c.method==='freqlist').length>before);assert.ok([...h.field('radio0','channel').options].some(o=>o.value==='11'));assert.equal(h.field('radio0','channel').disabled,false);const writes=h.writes().length;await h.clickSave();assert.equal(h.writes().length,writes);assert.ok(h.calls.some(c=>c.method==='confirm'));});
 await test('numeric-apply-failure-and-retry',async h=>{h.field('radio0','power').value='24';h.state.applyCode=6;await h.clickSave();assert.deepEqual(h.applyRejections,[{type:'number',value:'6'}]);assert.match(h.notifications.at(-1).text,/6/);assert.equal(h.field('radio0','power').value,'24');assert.equal(h.db().committed.radio0.txpower,undefined);const applies=h.calls.filter(c=>c.method==='apply').length;h.state.applyCode=0;await h.clickSave();assert.equal(h.calls.filter(c=>c.method==='apply').length,applies+1);assert.equal(h.db().committed.radio0.txpower,'24');});
 await test('ubus-apply-failure-and-retry',async h=>{h.field('radio0','power').value='25';h.state.applyCode=6;h.state.ubusFailure=true;await h.clickSave();assert.match(h.notifications.at(-1).text,/6/);assert.equal(h.applyRejections[0].type,'object');assert.equal(h.db().committed.radio0.txpower,undefined);h.state.applyCode=0;await h.clickSave();assert.equal(h.db().committed.radio0.txpower,'25');});
 await test('failed-edit-restored-before-next-apply',async h=>{h.field('radio0','power').value='24';h.state.applyCode=6;await h.clickSave();h.field('radio0','power').value='';h.field('radio1','power').value='25';h.state.applyCode=0;await h.clickSave();assert.equal(h.db().committed.radio0.txpower,undefined);assert.equal(h.db().committed.radio1.txpower,'25');});
 await test('readonly-prohibits-writes',async h=>{assert.equal(h.save.disabled,true);assert.ok([...h.node.querySelectorAll('input,select')].every(e=>e.disabled));await h.clickSave();assert.equal(h.writes().length,0);},{readonly:true});
 await test('MLO tab loads within WiFi 7',async h=>{await h.tab(2);assert.ok(h.q('[data-wifi7-pane="mlo"] .mlo-map'));assert.ok(h.node.isConnected);assert.equal(h.w.document.querySelectorAll('.wifi7-map').length,1);assert.equal(h.node.querySelectorAll('.cbi-tabmenu a').length,4);});
 await test('unknown-RSSI-link-retained',async h=>{await h.tab(3);const detail=h.q('details');assert.ok(detail);detail.open=true;assert.match(detail.textContent,/MLO 9/);assert.match(detail.textContent,/2400/);assert.match(detail.textContent,/6 GHz/);});
 await test('client-DOM-identity',async h=>{await h.tab(3);const detail=h.q('details');detail.open=true;await h.poll();assert.equal(h.q('details'),detail);assert.equal(detail.open,true);});
 await test('tab-activation-latest-and-export',async h=>{await h.tab(3);await h.tab(0);h.state.generation=23;await h.poll();await h.tab(3);assert.match(h.q('details').textContent,/123 s/);h.q('details').open=true;for(let i=0;i<4;i++){await h.tab(i);if(OUT)fs.writeFileSync(path.join(OUT,'tab-'+i+'.html'),h.j.serialize());}});
 const report={application:APP,sourceSha256:hash(SOURCE),telemetrySha256:hash(TELEMETRY),realModules:['cbi.js','luci.js','rpc.js (declare/call/parseCallReply/handleCallReply)','uci.js (load/set/unset/save/apply/confirm)','validation.js','ui.js','wifi7.telemetry'],boundary:'HTTP request.post fixture; staged/committed UCI simulation, network WifiDevice/WifiNetwork fixtures, no router or geometry validation; real apply timeout and numeric rejection unchanged',results};if(OUT)fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
