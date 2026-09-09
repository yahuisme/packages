// Real LuCI RPC/DOM; only the service transport is simulated.
const fs = require('fs'), assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const root = process.env.LUCI_RESOURCE_DIR;
if (!root) throw Error('Set LUCI_RESOURCE_DIR to upstream LuCI resources');
const j = new JSDOM('<div id="view"></div>', { url:'http://localhost/', runScripts:'outside-only' });
const w=j.window;
w.eval(fs.readFileSync(root+'/luci.js','utf8').replace('window.LuCI = LuCI;', 'window.LuCI = LuCI; window.mods=classes; window.env=env;'));
const mods=w.mods, L=w.L=Object.create(w.LuCI.prototype);
Object.assign(w.env,{sessionid:'fixture',resource:'/luci-static/resources'});
w._=s=>({'RUNNING':'运行中','NOT RUNNING':'未运行','Status unavailable':'状态不可用'}[s]||s);
w.E=mods.dom.create.bind(mods.dom);
L.require=n=>Promise.resolve(mods[n]);
function load(n,source){const deps=[...source.matchAll(/'require ([^';]+)';/g)].map(m=>m[1]);const C=w.Function(...deps.map(n=>n.split('.').at(-1)),source)(...deps.map(n=>mods[n]));return mods[n]=typeof C==='function'?new C():C;}
load('rpc',fs.readFileSync(root+'/rpc.js','utf8'));
mods.form={DynamicList:{extend:()=>({})}};mods.fs={};mods.uci={};mods.ui={};
const hp=load('homeproxy',fs.readFileSync(__dirname+'/../htdocs/luci-static/resources/homeproxy.js','utf8'));
let payload,code=0,fail=false;
mods.request.post=async(_url,req)=>{if(fail)throw Error('transport failure');return {ok:true,status:200,json:()=>w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[code,payload]}))};};
(async()=>{
 for(const [data,expected] of [[{},false],[{homeproxy:{instances:{}}},false],[{homeproxy:{instances:{'sing-box-c':{running:true}}}},true],[{homeproxy:{instances:{'sing-box-c':{running:false}}}},false],[{homeproxy:{instances:{'sing-box-c':{running:'true'}}}},null],[{homeproxy:{}},null],[null,null],[[],null]]){
  payload=data;assert.equal(await hp.getServiceStatus('sing-box-c'),expected);
 }
 code=6;payload={};assert.equal(await hp.getServiceStatus('sing-box-c'),null);code=0;fail=true;assert.equal(await hp.getServiceStatus('sing-box-c'),null);
 const view=w.document.querySelector('#view');
 for(const [state,label] of [[true,'运行中'],[false,'未运行'],[null,'状态不可用']]){
  const n=hp.renderServiceStatus(state,'HomeProxy','1.14.0','<img src=x onerror=alert(1)>');view.replaceChildren(n);
  assert.equal(n.querySelector('[role=status]').textContent,label);assert.equal(n.querySelectorAll('img').length,0);
  assert.equal(n.querySelectorAll('style').length,1);assert.equal(w.document.head.querySelectorAll('style').length,0);
 }
 view.replaceChildren();assert.equal(w.document.querySelectorAll('style').length,0);
 for(const title of ['HomeProxy','HomeProxy Server']) for(const state of [true,false,null]) view.append(hp.renderServiceStatus(state,title,'1.14.0'));
 if(process.env.AUDIT_OUT)fs.writeFileSync(process.env.AUDIT_OUT,w.document.documentElement.outerHTML);
 console.log('PASS: real RPC success/absent/malformed/error states; safe real DOM; scoped style lifecycle; both status labels');j.window.close();
})().catch(e=>{console.error(e);j.window.close();process.exitCode=1;});
