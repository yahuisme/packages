'use strict';
// Real upstream LuCI RPC parser; only HTTP transport and page bootstrap are fixtures.
// NODE_PATH=$(npm root -g) LUCI_RESOURCE_DIR=... node tests/test_status_rpc.js
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<body></body>').window,polls=[];
const good={fan_rpm:1500,fan_pwm:95,fan_percentage:37,fan_mode:2,uci_mode:'auto',uci_preset:'balanced',temp_cpu:54,temp_board:42,temp_phy1:48,temp_phy2:49,wifi_24g:51,wifi_5g:58,wifi_6g:61};
let response=good,networkFailure=false;
const ctx={console,Promise,Number,document:w.document,MutationObserver:w.MutationObserver,requestAnimationFrame:()=>{},_:s=>s,
 E:(tag,attrs,children)=>{const n=w.document.createElement(tag);Object.entries(attrs||{}).forEach(([k,v])=>n.setAttribute(k,v));for(const c of Array.isArray(children)?children:[children])if(c!=null)n.append(c);return n;},
 L:{env:{},url:()=>'/rpc',bind:(f,t,...a)=>f.bind(t,...a),isObject:o=>o&&typeof o==='object',raise:()=>{throw Error('RPCError');}},baseclass:{extend:x=>x},
 request:{post:()=>networkFailure?Promise.reject(Error('offline')):Promise.resolve({ok:true,json:()=>({jsonrpc:'2.0',result:typeof response==='number'?[response]:[0,response]})})},view:{extend:x=>x},poll:{add:f=>polls.push(f),remove:()=>{}}};
vm.createContext(ctx);
ctx.rpc=vm.runInContext('(function(){'+fs.readFileSync(path.join(process.env.LUCI_RESOURCE_DIR,'rpc.js'),'utf8')+'})()',ctx);
const app=vm.runInContext('(function(){'+fs.readFileSync(path.join(__dirname,'../htdocs/luci-static/resources/view/fan/status.js'),'utf8')+'})()',ctx);
(async()=>{try{
 const n=app.render(await app.load());w.document.body.append(n);
 for(const [mode,configured] of [[2,'auto'],[1,'manual'],[1,'auto']]){
  response={...good,fan_mode:mode,uci_mode:configured};await polls[0]();
  assert.equal(n.querySelector('#fan-summary-preset .fan-card-sub').textContent,'Configured profile for automatic mode');
  assert(!n.textContent.includes('Active fan curve profile'));
  if(mode===1&&configured==='auto')assert(n.textContent.includes('Configured mode differs from hardware'));
 }
 for(const failure of ['ubus','network']){
  response=good;networkFailure=false;await polls[0]();assert(n.textContent.includes('1500 RPM'));
  response=6;networkFailure=failure==='network';await polls[0]();
  assert.deepEqual([...n.querySelectorAll('.fan-card-sub')].map(e=>e.textContent),Array(4).fill('Read failed'));
  assert.deepEqual([...n.querySelectorAll('.fan-temp-value')].map(e=>e.textContent),Array(7).fill('—'));
  assert([...n.querySelectorAll('.fan-temp-fill')].every(e=>e.style.width==='0%'));
  for(const id of ['rpm','pwm'])assert.equal(n.querySelector('#fan-summary-'+id+' .fan-card-value').textContent,'—');
  assert.deepEqual(Object.keys(await app.load()),[],'initial RPC failure returns unavailable data');
 }
 networkFailure=false;response=good;await polls[0]();assert(n.textContent.includes('1500 RPM'));assert(n.textContent.includes('54°C'));
 console.log('PASS real LuCI RPC: ubus rejection, network failure, initial failure, all metrics cleared, recovery; auto/manual/mismatch configured semantics');
}finally{w.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
