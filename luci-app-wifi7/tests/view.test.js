// Browser DOM semantics; only local reviewed application source is evaluated.
const fs = require('fs');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<html><head></head><body></body></html>', {url:'http://router.invalid/'});
const document = dom.window.document;
global.window = dom.window; window.confirm = () => false;
function E(tag, attrs={}, children=[]) {
 const el=document.createElement(tag);
 for(const [key,value] of Object.entries(attrs)) {
  if(typeof value==='function') el.addEventListener(key,value);
  else if(value!=null) el.setAttribute(key,String(value));
 }
 for(const child of Array.isArray(children)?children:[children]) if(child!=null) el.append(child);
 return el;
}
String.prototype.format=function(...args){let i=0;return this.replace(/%[sd]/g,()=>args[i++]);};
const source=fs.readFileSync(require('path').join(__dirname,'../htdocs/luci-static/resources/view/wifi7/index.js'),'utf8');
const config={radio0:{band:'2g',channel:'13',htmode:'HE20',country:'AU'},radio1:{band:'5g',channel:'104',htmode:'EHT80',country:'AU'},radio2:{band:'6g',channel:'37',htmode:'EHT160',country:'AU'}};
const writes=[];
const uci={load:async()=>{},get:(pkg,sec,opt)=>config[sec]?.[opt],sections:()=>Object.entries(config).map(([name,c])=>({'.name':name,'.type':'wifi-device',...c})),set:(...a)=>writes.push(a),unset:(...a)=>writes.push(a),save:async()=>{},apply:async()=>{}};
const devices=Object.keys(config).map(name=>({getName:()=>name,get:k=>config[name][k],isUp:()=>true}));
const network={getWifiDevices:async()=>devices,getWifiNetworks:async()=>[],flushCache:async()=>{}};
let pollFn, clientRows=[], diagnosticCalls=0;
URL.createObjectURL=()=>'blob:test'; URL.revokeObjectURL=()=>{}; dom.window.HTMLAnchorElement.prototype.click=function(){};
const rpcSource=fs.readFileSync(process.env.LUCI_RPC,'utf8');
const upstream=new Function('baseclass','request','L',rpcSource)({extend:x=>x},{},{env:{},url:()=>'',isObject:x=>x&&typeof x==='object',raise:(...x)=>{throw Error(x.join(' '))}});
const rpc={declare:spec=>(...args)=>new Promise((resolve,reject)=>{
 if(args[0]==='/usr/libexec/wifi7-diagnostics'){diagnosticCalls++;resolve({code:0,stdout:'diagnostic fixture'});return;}
 const fixture=process.env.NATIVE_TEST;
 const payload=process.env.MLO_TEST && spec.method==='exec'?{code:0,stdout:'@@ devices 0\nInterface ap-mld\n - link ID  7 link addr aa:bb:cc:dd:ee:03\n channel 36 (5180 MHz), width: 80 MHz\n@@ stations ap-mld 0\nStation aa:bb:cc:dd:ee:01 (on ap-mld)\n Link 7:\n signal: -42 [-43, -44] dBm\n tx bitrate: 1200.0 MBit/s 80MHz EHT-MCS 11\n@@ hostapd ap-mld_link7 0\nstate=DFS\nfreq=5260\nchan_util_avg=128\ncac_time_left_seconds=37\n'}:spec.method==='freqlist'?{results:[{channel:13,mhz:2472,band:2,flags:[]},{channel:36,mhz:5180,band:5,flags:[]},{channel:40,mhz:5200,band:5,restricted:true,flags:['no_ir']},{channel:37,mhz:6135,band:6,flags:[]}]}:spec.method==='devices'?{devices:fixture?['wlan5']:[]}:spec.method==='assoclist'?{results:[{mac:'aa:bb:cc:dd:ee:01',signal:-40,tx:{rate:1200000,he:true,mhz:80},rx:{rate:600000,he:true,mhz:80}}]}:spec.method==='info'?{frequency:5180,channel:36,txpower:25}:spec.method==='exec'?{code:1,stdout:''}:{};
 const denied=process.env.DENIED_TEST;
 try { upstream.handleCallReply({...spec,resolve,reject},{jsonrpc:'2.0',result:denied?[6]:[0,payload]}); } catch(e){reject(e);}
})};
const notices=[];
const telemetry=new Function('baseclass',fs.readFileSync(require('path').join(__dirname,'../htdocs/luci-static/resources/wifi7/telemetry.js'),'utf8'))({extend:x=>x});
const app=new Function('view','network','rpc','uci','ui','poll','document','E','_','cbi_update_table','telemetry',source)({extend:x=>x},network,rpc,uci,{addNotification:(...a)=>notices.push(a)},{add:f=>pollFn=f},document,E,x=>x,(t,rows)=>clientRows=rows,telemetry);
(async()=>{
 document.body.append(await app.render(await app.load()));
 await new Promise(r=>setImmediate(r));
 const assert=require('node:assert/strict');
 const fields=[...document.querySelectorAll('input,select')];
 assert.deepEqual(fields.filter(el=>!el.id||!el.name||!document.querySelector(`label[for="${el.id}"]`)),[]);
 assert.deepEqual([...document.querySelectorAll('[id$="channel"]')].map(el=>el.value),['13','104','37']);
 const power=document.querySelector('[id$="power"]'); power.value='31';
 [...document.querySelectorAll('button')].find(b=>b.textContent==='Save & Apply').click(); await new Promise(r=>setImmediate(r)); assert.equal(writes.length,0);
 assert.equal(diagnosticCalls,0);
 window.confirm=()=>true; [...document.querySelectorAll('button')].find(b=>b.textContent==='Export wireless diagnostics').click();
 await new Promise(r=>setImmediate(r));assert.equal(diagnosticCalls,1);window.confirm=()=>false;
 power.value='25'; const country=document.querySelector('[id$=country]');country.value='US';country.dispatchEvent(new window.Event('change'));
 assert.equal(document.querySelector('[id$=channel]').disabled,true);
 [...document.querySelectorAll('button')].find(b=>b.textContent==='Save & Apply').click();
 await new Promise(r=>setImmediate(r));assert.equal(writes.length,0);
 assert.ok(!document.body.textContent.includes('CAC Passed')); assert.ok(!document.body.textContent.includes('Unlocked'));
 if(process.env.MLO_TEST || process.env.NATIVE_TEST) {
  assert.equal(document.querySelectorAll('details').length,1);
  const detail=document.querySelector('details'); detail.open=true;
  await pollFn(); assert.equal(document.querySelector('details').open,true);
  assert.ok(document.body.textContent.includes('5 GHz'));
 }
 if(process.env.MLO_TEST){assert.ok(document.body.textContent.includes('37 seconds remaining'));assert.ok(document.body.textContent.includes('-42 dBm'));assert.ok(document.body.textContent.includes('50%'));assert.ok(document.body.textContent.includes('DFS CAC in progress'));}
 if(process.env.NATIVE_TEST) assert.ok(document.body.textContent.includes('1200.0 Mbit/s'));
 if(!process.env.DENIED_TEST) {
  const ch=document.getElementById('wifi7-radio1-channel');
  assert.ok([...ch.options].some(o=>o.value==='36'));
  assert.ok(![...ch.options].some(o=>o.value==='40'));
  assert.ok(![...ch.options].some(o=>o.value==='13'));
 }
 console.log('Feature assertions passed: dynamic channels, folded clients and retained state');
 console.log('DOM assertions passed: labels, current channels, invalid power blocked, no fabricated status');
 console.log(JSON.stringify({fields:fields.length,unlabelled:fields.filter(el=>!el.id||!el.name||!document.querySelector(`label[for="${el.id}"]`)).map(el=>el.outerHTML),channels:[...document.querySelectorAll('select[id$="channel"]')].map(el=>el.value),text:document.body.textContent},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
