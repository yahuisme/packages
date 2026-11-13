// Production parent/telemetry + native LuCI RPC/DOM/UCI, private HTTP fixtures only.
'use strict';
const assert = require('node:assert/strict');
const { boot } = require('./integration.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
 const h = await boot();
 try {
  await h.poll();
  // Two independent PHYs may legitimately share the 5 GHz band.
  for (const config of [h.db().staged, h.db().committed]) config.radio2.band = '5g';
  h.mods.uci.unload('wireless'); await h.mods.uci.load('wireless');
  const node = h.mods.app.render(await h.mods.app.load());
  h.node.replaceWith(node); await tick(); await h.poll();
  const post = h.mods.request.post;
  let generation = 0, surveys = true, hostapd = '', failed = false, nativeOnly = false;
  const ordinary = {radio0:{up:true,interfaces:[]},
   radio1:{up:true,interfaces:[{section:'ap1',ifname:'wlan1'}]},
   radio2:{up:true,interfaces:[{section:'ap2',iwinfo:{ifname:'wlan2'}}]}};
  const copy = value => JSON.parse(JSON.stringify(value));
  let runtime = copy(ordinary);
  let devices = 'Interface wlan1\n channel 36 (5180 MHz), width: 80 MHz\n txpower 20.00 dBm\nInterface wlan2\n channel 100 (5500 MHz), width: 80 MHz\n txpower 22.00 dBm\n';
  const ordinaryDevices = devices;
  h.mods.request.post = async (url, req) => {
   const [,object,method,p] = req.params;
   if (failed && (object === 'luci-rpc' || object === 'file')) throw new Error('fixture telemetry outage');
   let value;
   if (object === 'luci-rpc' && method === 'getWirelessDevices') value = runtime;
   else if (object === 'iwinfo' && method === 'info') value = nativeOnly && p.device === 'wlan1' ? {frequency:5180,channel:36,htmode:'HE80',txpower:20} :
    nativeOnly && p.device === 'wlan2' ? {frequency:5500,channel:100,htmode:'HE80',txpower:22} : {};
   else if (object === 'iwinfo' && method === 'devices') value = {devices:['wlan1','wlan2']};
   else if (object === 'iwinfo' && method === 'assoclist') value = {results:[]};
   else if (object === 'file' && ['/usr/libexec/wifi7-status-summary','/usr/libexec/wifi7-status'].includes(p.command)) value = {code:0,stdout:'@@ devices 0\n' + devices +
    (surveys ? [[1,5180,20],[2,5500,30]].map(([id,f,busy]) => `@@ survey wlan${id} 0\n frequency: ${f} MHz [in use]\n channel active time: ${1000+100*generation} ms\n channel busy time: ${busy*10+busy*generation} ms\n`).join('') : '') + hostapd};
   else return post(url, req);
   return {ok:true,status:200,json:() => h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:[0,value]}))};
  };
  const values = () => [...node.querySelectorAll('.wifi7-card')].map(card => [...card.querySelectorAll('.wifi7-value')].map(v => v.textContent));
  await h.poll(); generation++; await h.poll();
  assert.deepEqual(values(), [['—','—','—'],['36 / 80 MHz','20 dBm','20%'],['100 / 80 MHz','22 dBm','30%']],
   'ordinary same-band interfaces retain verified native radio mapping for readings and survey deltas');
  assert.equal(h.writes().length, 0);
  console.log('PASS same-band ordinary-interface telemetry and survey attribution');
  surveys = false;
  hostapd = '@@ hostapd wlan1 0\nfreq=5180\nchan_util_avg=51\n@@ hostapd wlan2 0\nfreq=5500\nchan_util_avg=102\n';
  await h.poll();
  assert.deepEqual(values().map(v => v[2]), ['—','20%','40%'],
   'hostapd exact ordinary socket/iface mapping disambiguates same-band radios');
  console.log('PASS same-band verified hostapd socket attribution');
  hostapd = '@@ hostapd wlan1 0\nchan_util_avg=51\n';
  await h.poll();
  assert.deepEqual(values().map(v => v[2]), ['—','—','—'], 'hostapd fallback requires a verifiable frequency band');
  hostapd = '@@ hostapd wlan1_link7 0\nfreq=5180\nchan_util_avg=255\n@@ hostapd unknown 0\nfreq=5500\nchan_util_avg=255\n';
  await h.poll();
  assert.deepEqual(values().map(v => v[2]), ['—','—','—'], 'do not guess hostapd link suffixes or unknown sockets');
  hostapd = '@@ hostapd wlan1 0\nfreq=5180\nchan_util_avg=51\n';
  runtime = copy(ordinary); runtime.radio0.interfaces = runtime.radio1.interfaces; runtime.radio1.interfaces = [];
  await h.poll();
  assert.deepEqual(values()[1], ['—','—','—'], 'ordinary mapping with a different band is not evidence');
  runtime = copy(ordinary); runtime.radio2.interfaces.push(...copy(runtime.radio1.interfaces));
  await h.poll();
  assert.deepEqual(values()[1], ['—','—','—'], 'an interface shared by two same-band parents remains unknown');
  // Native MLO markers and collector link evidence must never become ordinary mappings.
  for (const marker of [{mld:true},{mld_links:[{},{}]},{links:[{},{}]},{config:{mlo:'1'}}]) {
   runtime = copy(ordinary); Object.assign(runtime.radio1.interfaces[0], marker);
   await h.poll();
   assert.deepEqual(values()[1], ['—','—','—'], 'MLO mapping stays ambiguous: ' + JSON.stringify(marker));
  }
  runtime = copy(ordinary);
  h.mods.uci.add('wireless', 'wifi-iface', 'ap1'); h.mods.uci.set('wireless', 'ap1', 'mlo', '1');
  await h.poll(); assert.deepEqual(values()[1], ['—','—','—'], 'configured MLO also forbids parent fallback');
  h.mods.uci.remove('wireless', 'ap1');
  devices = 'Interface wlan1\n - link ID 7 link addr aa:bb:cc:dd:ee:01\n channel 36 (5180 MHz), width: 80 MHz\n txpower 20.00 dBm\n';
  await h.poll(); assert.deepEqual(values()[1], ['—','—','—'], 'collector link evidence forbids parent fallback without runtime MLO flags');
  // Unique-band frequency attribution wins even over a mismatched MLO parent.
  devices = 'Interface wlan1\n - link ID 9 link addr aa:bb:cc:dd:ee:02\n channel 1 (2412 MHz), width: 20 MHz\n txpower 0.00 dBm\n';
  hostapd = '';
  await h.poll(); assert.deepEqual(values()[0], ['1 / 20 MHz','0 dBm','—']);
  assert.deepEqual(values()[1], ['—','—','—']);
  console.log('PASS band validation, unknown sockets, shared/MLO ambiguity and unique-band precedence');
  devices = ordinaryDevices; surveys = true; hostapd = '';
  runtime = copy(ordinary); runtime.radio1.interfaces[0].mld = true;
  await h.poll(); generation++; await h.poll();
  assert.equal(values()[1][2], '—', 'same-band MLO survey deltas remain ambiguous');
  runtime = copy(ordinary); runtime.radio2.interfaces.push(...copy(runtime.radio1.interfaces));
  generation++; await h.poll();
  assert.equal(values()[1][2], '—', 'shared ordinary ifname cannot assign survey deltas either');
  devices = ordinaryDevices; runtime = copy(ordinary); surveys = true;
  await h.poll(); generation++; await h.poll();
  assert.deepEqual(values().map(v => v[2]), ['—','20%','30%']);
  failed = true; await h.poll();
  assert(values().every(v => v.every(value => value === '—')), 'failed sources clear prior metrics');
  assert([...node.querySelectorAll('.wifi7-status-badge')].every(n => /Unknown/.test(n.textContent)));
  failed = false; generation++; await h.poll();
  assert.deepEqual(values().map(v => v[2]), ['—','—','—'], 'outage discards old survey deltas');
  generation++; await h.poll(); assert.deepEqual(values().map(v => v[2]), ['—','20%','30%']);
  runtime = {}; devices = ''; surveys = false; await h.poll();
  assert(values().every(v => v.every(value => value === '—')), 'empty sources also clear metrics');
  runtime = copy(ordinary); nativeOnly = true;
  node.querySelector('.cbi-tabmenu').children[3].querySelector('a').click();
  await h.poll(); await h.poll();
  assert.deepEqual(values(), [['—','—','—'],['36 / 80 MHz','20 dBm','—'],['100 / 80 MHz','22 dBm','—']],
   'native ordinary interface info also disambiguates same-band radios when collector/radio info is missing');
  assert.equal(h.writes().length, 0);
  console.log('PASS same-band failure/empty unknown cleanup and fresh-delta recovery without UCI writes');
 } finally { h.w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
