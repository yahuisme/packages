'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/settings.js'), 'utf8');
async function scenario(undoFailure, readFailure = false) {
 let map, options = {}, calls = [], notices = [];
 const state = { cpu_governor: 'performance', cpu_max_freq: 1000000 };
 function Map() { map = this; this.section = () => ({ option: (_, name) => options[name] = { value() {}, formvalue() { return ({ governor: 'schedutil', frequency: '800000' })[name]; } } }); this.lookupOption = n => [options[n]]; this.render = () => Promise.resolve({ classList: { add() {} }, prepend() {} }); }
 const rpc = { declare: spec => (...args) => {
  calls.push([spec.method, ...args]);
  if (spec.method === 'getStatus') return readFailure ? Promise.reject(new Error('read failed')) : Promise.resolve({...state});
  assert(!spec.method.includes('Flow'), 'CPU settings must not call flow RPCs');
  if (spec.method === 'setGovernor') { if (undoFailure && args[0] === 'performance') return Promise.reject(new Error('undo failed')); state.cpu_governor = args[0]; }
  if (spec.method === 'setMaxFreq') return Promise.resolve({result:'error',error:'write_failed'});
  return Promise.resolve({ result:'ok' });
 } };
 const document = { getElementById: () => true };
 // Compile only the trusted checked-out LuCI source; no user input is code.
 const view = new Function('L','view','form','rpc','ui','document','_','E',source)({hasViewPermission:()=>true},{extend:x=>x},{JSONMap:Map},rpc,{addNotification:(_,node)=>notices.push(node)},document,x=>x,(_,__,text)=>text);
 await view.render([{governors:'performance schedutil',frequencies:'1000000 800000'}, {...state}]);
 assert.deepStrictEqual(Object.keys(options), ['governor', 'frequency']);
 await assert.rejects(map.save(), /Previous settings were restored/);
 assert(calls.some(c=>c[0]==='setGovernor' && c[1]==='performance'), 'must attempt all undo operations');
 assert(calls.some(c=>c[0]==='getStatus'), 'rollback must read back actual state');
 assert(notices.at(-1).includes(undoFailure || readFailure ? 'recovery could not be verified' : 'Previous settings were restored'), 'must distinguish verified recovery');
}
(async()=>{await scenario(false);await scenario(true);await scenario(false,true);console.log('PASS CPU rollback, readback and failed recovery without flow RPCs');})().catch(e=>{console.error(e);process.exit(1);});
