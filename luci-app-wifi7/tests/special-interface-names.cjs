// Execute production parent/parser with real LuCI; only RPC transport is isolated.
const assert = require('node:assert/strict');
const { boot } = require('./integration.cjs');
(async () => {
 for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
  const h = await boot();
  try {
   const original = h.mods.request.post;
   let available = true;
   h.mods.request.post = async (url, req) => {
    const [, object, method, p] = req.params;
    let result;
    if (object === 'luci-rpc') result = [0, {radio0:{up:true, interfaces:[]}, radio1:{up:true, interfaces: available ? [{section:'wlan',ifname:name,config:{ssid:'Special interface'}}] : []}, radio2:{up:true,interfaces:[]}}];
    else if (object === 'iwinfo' && method === 'devices') result = [0, {devices: available ? [name] : []}];
    else if (object === 'file' && method === 'exec' && /wifi7-status/.test(p.command)) result = [0, {code:0, stdout: available ? `@@ devices 0\nInterface ${name}\n channel 36 (5180 MHz), width: 80 MHz\n@@ stations ${name} 0\nStation aa:bb:cc:dd:ee:01 (on ${name})\n signal: -42 dBm\n tx bitrate: 1200.0 MBit/s 80MHz EHT-MCS 11\n@@ survey ${name} 0\n frequency: 5180 MHz [in use]\n channel active time: 1000 ms\n channel busy time: 200 ms\n` : '@@ devices 0\n'}];
    if (!result) return original(url, req);
    const body = h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result}));
    return {ok:true,status:200,json:()=>body};
   };
   await h.tab(3); await h.poll();
   assert.equal(h.q('.wifi7-notice').textContent, '', name + ': processing must not throw');
   const detail = h.q('details');
   assert.ok(detail, name + ': connected client must render');
   assert.match(detail.textContent, /Special interface/);
   assert.match(detail.textContent, /-42 dBm/);
   await h.poll();
   assert.equal(h.q('details'), detail, name + ': stable client DOM identity');
   available = false; await h.poll();
   assert.equal(h.q('details'), null, name + ': vanished client must be removed');
   assert.equal(h.q('.wifi7-notice').textContent, '', name + ': empty recovery must not inherit entries');
   available = true; await h.poll();
   assert.ok(h.q('details'), name + ': client must recover');
   console.log('PASS special interface ' + name + ': render/reuse/removal/recovery');
  } finally { h.j.window.close(); }
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
