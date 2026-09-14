'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/settings.js'), 'utf8');
async function scenario(failure) {
 let map, options = {}, calls = [], notices = [], pending = null;
 let permitted = true;
 const rpc = { declare: spec => async (...args) => {
  calls.push(spec.method);
  if (spec.method === 'saveSettings') {
   if (failure === 'save') return { error: 'storage' };
   pending = { governor: args[0], freq: args[1] };
   if (failure === 'revoke') permitted = false;
  }
  if (spec.method === 'getSettings') {
   if (failure === 'read') throw new Error('read failed');
   return { result: 'ok', pending: failure === 'mismatch' ? null : pending };
  }
  if (spec.method === 'applySettings' && failure === 'apply') return { error: 'rollback_failed' };
  if (spec.method === 'getStatus') return { cpu_governor: 'performance', cpu_max_freq: 1000000 };
  return { result: 'ok' };
 } };
 function Map() {
  map = this;
  this.section = () => ({ option: (_, name) => options[name] = { value() {}, formvalue() { return name === 'governor' ? 'schedutil' : '800000'; } } });
  this.lookupOption = n => [options[n]]; this.render = async () => ({});
 }
 // Compile trusted checked-out source only; RPC data is never executable.
 const view = new Function('L','view','form','rpc','ui','_','E',source)(
  {hasViewPermission:()=>permitted}, {extend:x=>x}, {JSONMap:Map}, rpc,
  {addNotification:(_,node)=>notices.push(node)}, x=>x, (_,__,text)=>text);
 await view.render([{governors:'performance schedutil',frequencies:'1000000 800000'},
  {cpu_governor:'performance',cpu_max_freq:1000000}, {result:'ok',pending:null}]);
 const first = map.save(true), duplicate = map.save(true);
 assert.equal(first, duplicate, 'concurrent actions share one operation');
 await assert.rejects(first);
 assert.equal(calls.filter(c=>c==='saveSettings').length, 1);
 assert.equal(calls.filter(c=>c==='applySettings').length, ['apply','runtime'].includes(failure) ? 1 : 0);
 assert(notices.length, 'failure must be notified');
 assert(!calls.some(c=>c==='setGovernor'||c==='setMaxFreq'));
 assert.equal(options.governor.default, ['apply','runtime','revoke'].includes(failure) ? 'schedutil' : 'performance', 'only verified saves advance Reset baseline');
}
(async()=>{for(const failure of ['save','read','mismatch','apply','runtime','revoke']) await scenario(failure); console.log('PASS save/readback/apply/runtime failures, duplicate actions, permission revocation and saved baseline');})().catch(e=>{console.error(e);process.exitCode=1;});
