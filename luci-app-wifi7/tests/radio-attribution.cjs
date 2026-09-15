// Real LuCI view/RPC with single-wiphy transport fixtures; no router access.
const assert = require('assert/strict');
const { boot } = require('./integration.cjs');
(async () => {
 const h = await boot();
 try {
  const original = h.mods.request.post;
  let summary = '@@ devices 0\nInterface ap-mld\n - link ID 7 link addr aa:bb:cc:dd:ee:03\n channel 36 (5180 MHz), width: 80 MHz\n txpower 23.00 dBm\n';
  let reading = { frequency: 2462, channel: 11, htmode: 'HE20', txpower: 25 };
  h.mods.network.getWifiDevices = async () => ['radio0', 'radio1', 'radio2'].map(id => ({ getName: () => id, isUp: () => id !== 'radio2' }));
  h.mods.request.post = async (url, req) => {
   const [, object, method, p] = req.params;
   let value;
   if (object === 'iwinfo' && method === 'info') value = reading;
   else if (object === 'file' && method === 'exec' && p.command === '/usr/libexec/wifi7-status-summary') value = { code: 0, stdout: summary };
   else return original(url, req);
   return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: [0, value] })) };
  };
  const values = () => [...h.node.querySelectorAll('.wifi7-card')].map(n => [...n.querySelectorAll('.wifi7-value')].slice(0, 2).map(v => v.textContent));
  await h.poll();
  assert.deepEqual(values(), [['11 / 20 MHz', '25 dBm'], ['36 / 80 MHz', '23 dBm'], ['—', '—']], 'repeated 2g radio queries must not overwrite the 5g MLO link or populate disabled 6g');
  // Even a matching-band radio query is only a fallback, not a link override.
  reading = { frequency: 5200, channel: 40, htmode: 'HE40', txpower: 19 };
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['36 / 80 MHz', '23 dBm'], ['—', '—']]);
  // No interface data: accept a matching-band fallback, never UCI settings.
  summary = '';
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['40 / 40 MHz', '19 dBm'], ['—', '—']]);
  reading = { channel: 11, htmode: 'HE20', txpower: 25 };
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['—', '—']], 'frequency-less results cannot establish a band');
  // Ordinary interfaces are attributed by frequency, not their parent radio.
  summary = '@@ devices 0\nInterface ap-mld\n channel 37 (6135 MHz), width: 160 MHz\n txpower 0.00 dBm\n';
  h.mods.network.getWifiDevices = async () => [];
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['37 / 160 MHz', '0 dBm']]);
  assert.deepEqual([...h.node.querySelectorAll('.wifi7-status-badge')].map(n => n.textContent), ['—Unknown', '—Unknown', '—Unknown']);
  summary = '';
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['—', '—']], 'missing radios and readings must clear prior metrics');
  assert.equal(h.writes().length, 0);
  console.log('PASS radio frequency attribution, MLO precedence, fallback and missing frequency');
 } finally { h.w.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
