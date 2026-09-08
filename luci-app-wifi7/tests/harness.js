// Browser DOM semantics; only local reviewed application source is evaluated.
const fs = require('fs');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<html><head></head><body></body></html>', {url:'http://router.invalid/'});
const document = dom.window.document;
global.L = {hasViewPermission: () => !process.env.READONLY_TEST};
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
const writes=[]; let saves=0, applies=0, loads=0; const staged={};
const uci={load:async()=>{loads++},unload:()=>{},get:(pkg,sec,opt)=>config[sec]?.[opt],sections:()=>Object.entries(config).map(([name,c])=>({'.name':name,'.type':'wifi-device',...c})),set:(p,s,k,v)=>{writes.push([p,s,k,v]); (staged[s] ||= {})[k]=v},unset:(p,s,k)=>{writes.push([p,s,k]); (staged[s] ||= {})[k]=undefined},save:async()=>{saves++},apply:async()=>{applies++;for(const [s,v] of Object.entries(staged)) Object.assign(config[s],v)}};
const devices=Object.keys(config).map(name=>({getName:()=>name,get:k=>config[name][k],isUp:()=>true}));
const network={getWifiDevices:async()=>devices,getWifiNetworks:async()=>[],flushCache:async()=>{}};
let pollFn, clientRows=[], diagnosticCalls=0; const calls=[];
URL.createObjectURL=()=>'blob:test'; URL.revokeObjectURL=()=>{}; dom.window.HTMLAnchorElement.prototype.click=function(){};
const rpcPath = process.env.LUCI_RPC || (process.env.LUCI_RESOURCE_DIR ? require('path').join(process.env.LUCI_RESOURCE_DIR, 'rpc.js') : null) || '/tmp/luci-upstream/modules/luci-base/htdocs/luci-static/resources/rpc.js';
const rpcSource = fs.readFileSync(rpcPath, 'utf8');
const upstream=new Function('baseclass','request','L',rpcSource)({extend:x=>x},{},{env:{},url:()=>'',isObject:x=>x&&typeof x==='object',raise:(...x)=>{throw Error(x.join(' '))}});
const rpc={declare:spec=>(...args)=>new Promise((resolve,reject)=>{
 calls.push([spec.method,...args]);
 if(args[0]==='/usr/libexec/wifi7-firmware'){resolve({code:0,stdout:'Firmware test version'});return;}
 if(args[0]==='/usr/libexec/wifi7-diagnostics'){diagnosticCalls++;resolve({code:0,stdout:'diagnostic fixture'});return;}
 const fixture=process.env.NATIVE_TEST;
 const payload=process.env.MLO_TEST && spec.method==='exec'?{code:0,stdout:'@@ devices 0\nInterface ap-mld\n - link ID  7 link addr aa:bb:cc:dd:ee:03\n channel 36 (5180 MHz), width: 80 MHz\n@@ stations ap-mld 0\nStation aa:bb:cc:dd:ee:01 (on ap-mld)\n Link 7:\n signal: -42 [-43, -44] dBm\n tx bitrate: 1200.0 MBit/s 80MHz EHT-MCS 11\n Link 8:\n tx bitrate: 600.0 MBit/s 40MHz HE-MCS 5\n@@ hostapd ap-mld_link7 0\nstate=DFS\nfreq=5260\nchan_util_avg=128\ncac_time_left_seconds=37\n'}:spec.method==='freqlist'?{results:[{channel:13,mhz:2472,band:2,flags:[]},{channel:36,mhz:5180,band:5,flags:[]},{channel:40,mhz:5200,band:5,restricted:true,flags:['no_ir']},{channel:37,mhz:6135,band:6,flags:[]}]}:spec.method==='devices'?{devices:fixture?['wlan5','wlan5']:[]}:spec.method==='assoclist'?{results:[{mac:'aa:bb:cc:dd:ee:01',signal:-40,tx:{rate:1200000,he:true,mhz:80},rx:{rate:600000,he:true,mhz:80}}]}:spec.method==='info'?{frequency:5180,channel:36,txpower:25,htmode:'HE80',htmodes:['HE20','HE40','HE80']}:spec.method==='exec'?{code:1,stdout:''}:{};
 const denied=process.env.DENIED_TEST;
 try { upstream.handleCallReply({...spec,resolve,reject},{jsonrpc:'2.0',result:denied?[6]:[0,payload]}); } catch(e){reject(e);}
})};
const notices=[];
const telemetry=new Function('baseclass',fs.readFileSync(require('path').join(__dirname,'../htdocs/luci-static/resources/wifi7/telemetry.js'),'utf8'))({extend:x=>x});
const app=new Function('view','network','rpc','uci','ui','poll','document','E','_','cbi_update_table','telemetry',source)({extend:x=>x},network,rpc,uci,{addNotification:(...a)=>notices.push(a)},{add:f=>pollFn=f},document,E,x=>x,(t,rows)=>clientRows=rows,telemetry);


module.exports = { app, document, dom, uci, config, staged, writes, calls, notices, tick:()=>new Promise(r=>setImmediate(r)), poll:()=>pollFn(), counters:()=>({saves,applies,loads,diagnosticCalls}) };
