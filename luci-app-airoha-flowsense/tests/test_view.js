// Real LuCI view constructor and RPC declaration/reply handling; transport is isolated.
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), { JSDOM } = require('jsdom');
const resources = process.env.LUCI_RESOURCE_DIR;
if (!resources) throw Error('Set LUCI_RESOURCE_DIR to local upstream LuCI resources');
const dom = new JSDOM('<body><div id="maincontent"><div id="view"></div></div></body>', {url:'http://router.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w._=s=>s;w.N_=(n,a,b)=>n===1?a:b;
w.eval(fs.readFileSync(path.join(resources,'cbi.js'),'utf8'));
w.eval(fs.readFileSync(path.join(resources,'luci.js'),'utf8').replace('window.LuCI = LuCI;','window.LuCI = LuCI; window.classes=classes; window.environment=env;'));
const mods=w.classes,L=w.L=Object.create(w.LuCI.prototype);
Object.assign(w.environment,{resource:'/resources',scriptname:'/cgi-bin/luci',sessionid:'fixture'});
L.loaded=true;L.require=n=>Promise.resolve(mods[n]);w.E=mods.dom.create.bind(mods.dom);
const calls=[],polls=new Map();let overviewError=false,waitOverview=null,waitPpe=null;
const sample={timestamp:1000,uptime:100,configured_hw:true,configured_sw:false,monitor:{target:'example.com',enabled:true},jitter:{last_ping:12,deviation:3,loss:4},interfaces:[{device:'lan1',speed:2500,carrier:1,stats:{rx_bytes:10,tx_bytes:20,rx_errors:7,tx_errors:9}}]};
const ppeSample={available:true,total:1,entries:[{index:'abcd',state:'BND',type:'IPv4'}]};
mods.request.post=async(url,req)=>{
 const method=req.params[2];calls.push(method);
 if(method==='getOverview'&&waitOverview)await waitOverview.promise;
 if(method==='getPpeEntries'&&waitPpe)await waitPpe.promise;
 const result=method==='getOverview'?(overviewError?[6]:[0,sample]):method==='getPpeEntries'?[0,ppeSample]:[6];
 return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result}))};
};
function load(name,source){source=source||fs.readFileSync(path.join(resources,name+'.js'),'utf8');const deps=[...source.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);const C=w.Function(...deps,source)(...deps.map(n=>mods[n]));return mods[name]=new C();}
load('rpc');mods.ui={addNotification:()=>{}};mods.poll.add=(fn,seconds)=>polls.set(seconds,fn);mods.poll.remove=fn=>{for(const [key,value] of polls)if(value===fn)polls.delete(key)};
load('app',fs.readFileSync(path.join(__dirname,'../htdocs/luci-static/resources/view/airoha_flowsense/status.js'),'utf8'));
const settle=()=>new Promise(r=>setTimeout(r,25));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function count(name){return calls.filter(n=>n===name).length;}
(async()=>{
 await settle();await settle();const root=w.document.querySelector('.flowsense-dashboard');assert(root);assert(polls.has(5));
 assert.equal(count('getOverview'),1,'load data reused without duplicate RPC');assert.equal(count('getPpeEntries'),0);
 assert(root.textContent.includes('12 ms'));assert.equal(root.querySelector('#flowsense-target').labels.length,1);assert.equal(root.querySelector('#flowsense-enabled').labels.length,1);
 const overview=polls.get(5),ppePoll=polls.get(30),details=root.querySelector('details');
 await ppePoll();assert.equal(count('getPpeEntries'),0,'closed detail must not scan PPE');
 waitPpe=deferred();details.open=true;await settle();const p1=ppePoll(),p2=ppePoll();assert.equal(count('getPpeEntries'),1,'toggle and poll share PPE request');
 await overview();assert.equal(count('getOverview'),2,'overview independent of blocked PPE');
 overviewError=true;await overview();assert(root.textContent.includes('previous readings cleared'));
 for(const old of ['12 ms','3 ms','4%','2500 Mbit/s','lan1'])assert(!root.textContent.includes(old),'stale '+old);
 assert.equal(root.querySelector('.flowsense-summary').children.length,0);
 waitPpe.resolve();await Promise.all([p1,p2]);waitPpe=null;assert(!root.textContent.includes('abcd'),'late PPE must not resurrect cleared values');
 overviewError=false;await overview();await ppePoll();assert(root.textContent.includes('abcd'));
 details.open=false;await settle();assert(!root.textContent.includes('abcd'));
 waitPpe=deferred();details.open=true;await settle();details.open=false;await settle();waitPpe.resolve();await ppePoll();await settle();waitPpe=null;assert(!root.textContent.includes('abcd'),'closed disclosure ignores late data');
 waitOverview=deferred();const o1=overview(),o2=overview();assert.equal(count('getOverview'),5,'overview requests single-flight');
 waitPpe=deferred();details.open=true;await settle();const pendingPpe=ppePoll();root.remove();await settle();assert.equal(polls.size,0,'removal unregisters both pollers');const html=root.innerHTML;
 waitOverview.resolve();waitPpe.resolve();await Promise.all([o1,o2,pendingPpe]);assert.equal(root.innerHTML,html,'detached replies cannot mutate DOM');
 console.log('PASS real view/RPC errors, initial reuse, all stale metrics cleared, labels, independent single-flight, closed and detached late replies');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
