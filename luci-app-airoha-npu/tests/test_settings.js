'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/settings.js'), 'utf8');
async function scenario(unknown, undoFailure) {
 let map, options = {}, calls = [], notices = [];
 const state = { cpu_governor: 'performance', cpu_max_freq: 1000000 };
 const flow = unknown ? {} : { enabled: false };
 function Map() { map = this; this.section = () => ({ option: (_, name) => options[name] = { value() {}, formvalue() { return ({ governor: 'schedutil', frequency: '800000', flow: '1' })[name]; } } }); this.lookupOption = n => [options[n]]; this.render = () => Promise.resolve({ classList: { add() {} }, prepend() {} }); }
 const rpc = { declare: spec => (...args) => {
  calls.push([spec.method, ...args]);
  if (spec.method === 'getStatus') return Promise.resolve({...state});
  if (spec.method === 'getFlowOffload') return Promise.resolve({...flow});
  if (spec.method === 'setFlowOffload') return Promise.resolve({result:'error',error:'write_failed'});
  if (spec.method === 'setGovernor') state.cpu_governor = args[0];
  if (spec.method === 'setMaxFreq') { if (undoFailure && args[0] === '1000000') return Promise.reject(new Error('undo failed')); state.cpu_max_freq = Number(args[0]); }
  return Promise.resolve({ result:'ok' });
 } };
 const document = { getElementById: () => true };
 // Compile only the trusted checked-out LuCI source; no user input is code.
 const view = new Function('L','view','form','rpc','ui','document','_','E',source)({hasViewPermission:()=>true},{extend:x=>x},{JSONMap:Map},rpc,{addNotification:(_,node)=>notices.push(node)},document,x=>x,(_,__,text)=>text);
 await view.render([{governors:'performance schedutil',frequencies:'1000000 800000'}, {...state}, flow]);
 if (unknown) { assert.strictEqual(options.flow.readonly, true, 'unknown flow must be read-only'); return; }
 await assert.rejects(map.save(), /Previous settings were restored/);
 assert(calls.some(c=>c[0]==='setGovernor' && c[1]==='performance'), 'must attempt all undo operations');
 assert(calls.some(c=>c[0]==='getStatus'), 'rollback must read back actual state');
 assert(calls.some(c=>c[0]==='getFlowOffload'), 'rollback must read back flow');
 assert(notices.at(-1).includes(undoFailure ? 'recovery could not be verified' : 'Previous settings were restored'), 'must distinguish verified recovery');
}
(async()=>{await scenario(true,false);await scenario(false,false);await scenario(false,true);console.log('PASS unknown read-only, complete rollback, readback and failed recovery');})().catch(e=>{console.error(e);process.exit(1);});
