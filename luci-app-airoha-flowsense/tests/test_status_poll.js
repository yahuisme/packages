'use strict';
// Production view + native LuCI Poll/RPC/Request/DOM; only XHR is isolated.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const resources = process.env.LUCI_RESOURCE_DIR;
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_flowsense/status.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function overview(uptime) { return { timestamp:1000+uptime, uptime, interfaces:[{device:'wan',ifindex:7,carrier:1,speed:1000,stats:{rx_bytes:uptime*125000,tx_bytes:0,rx_errors:0,tx_errors:0}}] }; }
function acceleration(enabled) { return {hardware:{supported:true,enabled,configured:enabled}}; }
(async () => {
 for (const held of ['getOverview', 'getAcceleration']) {
  const j = new JSDOM('<body><div id="view"></div></body>', {runScripts:'outside-only'}), w=j.window;
  try {
   w.eval(fs.readFileSync(path.join(resources,'luci.js'),'utf8').replace('window.LuCI = LuCI;', 'window.LuCI = LuCI; window.mods=classes; window.environment=env; window.setRPCURL=value=>{rpcBaseURL=value;};'));
   w._=s=>s; w.E=w.mods.dom.create.bind(w.mods.dom);
   const frames=[], calls=[], requests={getOverview:[],getAcceleration:[]};
   w.requestAnimationFrame=fn=>frames.push(fn);
   w.setInterval=()=>1;w.clearInterval=()=>{};
   w.L=Object.create(w.LuCI.prototype);
   Object.assign(w.environment,{scriptname:'/cgi-bin/luci',sessionid:'fixture'});
   w.setRPCURL(w.L.url('admin/ubus'));
   // Retain Request's actual batching and RPC parsing; only XHR is isolated.
   w.XMLHttpRequest=class {
    open(){} setRequestHeader(){} getAllResponseHeaders(){return '';}
    send(raw){
     const body=w.JSON.parse(raw), batch=Array.isArray(body), messages=batch?body:[body], replies=[];
     const respond=()=>{if(replies.filter(Boolean).length!==messages.length)return;this.status=200;this.statusText='OK';this.responseText=JSON.stringify(batch?replies:replies[0]);this.readyState=4;this.onreadystatechange();};
     messages.forEach((message,index)=>{
      const method=message.params[2];calls.push(method);
      requests[method].push({resolve(value){replies[index]={jsonrpc:'2.0',id:message.id,result:[0,value]};respond();},reject(){replies[index]={jsonrpc:'2.0',id:message.id,result:[6]};respond();}});
     });
    }
   };
   const Rpc=w.Function('baseclass','request',fs.readFileSync(path.join(resources,'rpc.js'),'utf8'))(w.mods.baseclass,w.mods.request);
   w.mods.rpc=new Rpc();
   const app=w.Function('view','rpc','poll',source)({extend:x=>x},w.mods.rpc,w.mods.poll);
   async function settle(){for(let i=0;i<5;i++){await flush();for(const frame of frames.splice(0))frame();}}
   const node=app.render([overview(100),acceleration(false)]);
   w.document.querySelector('#view').append(node);await settle();
   const poll=w.mods.poll;
   async function tick(time) { poll.tick=time;poll.step();await settle(); }
   await tick(0);
   assert.equal(requests.getOverview.length,1,'positive control: initial overview query runs');
   assert.equal(requests.getAcceleration.length,1,'positive control: initial acceleration query runs');
   const other=held==='getOverview'?'getAcceleration':'getOverview';
   requests[other][0].resolve(other==='getOverview'?overview(105):acceleration(true));await settle();
   await tick(5);
   assert.equal(requests[held].length,1,'held source stays single-flight');
   assert.equal(requests[other].length,2,'a stalled '+held+' must not block independent '+other+' polling');
   requests[other][1].resolve(other==='getOverview'?overview(110):acceleration(false));await settle();
   if(other==='getOverview') assert.equal(node.querySelectorAll('.flowsense-port-metric dd')[1].textContent,'1.0 Mbit/s / 0.00 Mbit/s','independent overview paints fresh counter deltas while acceleration stalls');
   else assert.equal(node.querySelector('.flowsense-acceleration-state').textContent,'Not enabled');
   requests[held][0].reject(Error('expected stalled-source failure'));await settle();
   await tick(10);
   assert.equal(requests[held].length,2,'failed source retries on the next unchanged five-second tick');
   assert.equal(requests[other].length,3,'independent source continues after the other fails');
   requests.getOverview.at(-1).resolve(overview(115));requests.getAcceleration.at(-1).resolve(acceleration(true));await settle();
   assert.equal(node.querySelector('.flowsense-acceleration-state').textContent,'Enabled');
   assert.equal(node.querySelector('.flowsense-port-name').textContent,'WAN');
   Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});
   const before=calls.length;await tick(15);assert.equal(calls.length,before,'background page skips both sources');
   Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});
   await tick(20);assert.equal(calls.length,before+2,'foreground resumes both sources');
   const markup=node.outerHTML;
   node.remove();await settle();assert.equal(poll.queue.length,0,'detach unregisters without another tick');
   requests.getOverview.at(-1).resolve(overview(120));requests.getAcceleration.at(-1).reject(Error('expected detached failure'));await settle();
   assert.equal(node.outerHTML,markup,'late success/error must not mutate a detached view');
  } finally {w.close();}
 }
 console.log('PASS native Poll: independent five-second sources, single flight, failure/retry, hidden/resume and detach');
})().catch(error=>{console.error(error);process.exitCode=1;});
