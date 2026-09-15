// Real LuCI view/RPC with single-wiphy transport fixtures; no router access.
const assert = require('assert/strict');
const { boot } = require('./integration.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const collector = path.join(__dirname, '../root/usr/libexec/wifi7-status-summary');
(async () => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wifi7-summary-contract-'));
 let h;
 try {
  // Run the production shell collector; only device/hostapd boundaries are fake.
  fs.writeFileSync(path.join(temp, 'iw'), `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$*" = dev ]; then
 cat "$DEVICES"
 exit "$DEVICE_CODE"
fi
[ "$*" = 'dev ap-mld survey dump' ] || exit 99
printf 'Survey data from ap-mld\\n frequency: 5180 MHz [in use]\\n channel active time: 1000 ms\\n channel busy time: 0 ms\\n'
`, { mode: 0o755 });
  fs.writeFileSync(path.join(temp, 'hostapd_cli'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  function collect(devices, code = 0) {
   fs.writeFileSync(path.join(temp, 'devices'), devices);
   fs.writeFileSync(path.join(temp, 'calls'), '');
   const output = execFileSync('busybox', ['ash', collector], {
    encoding: 'utf8', env: { ...process.env, PATH: temp + ':/usr/bin:/bin',
     DEVICES: path.join(temp, 'devices'), CALLS: path.join(temp, 'calls'), DEVICE_CODE: String(code) }
   });
   assert.deepEqual(fs.readFileSync(path.join(temp, 'calls'), 'utf8').trim().split('\n'),
    code === 0 && devices ? ['dev', 'dev ap-mld survey dump'] : ['dev'],
    'one enumeration only; no extra interface queries or station scans');
   return output;
  }
  h = await boot();
  const original = h.mods.request.post;
  let summary = collect('phy#0\n Interface ap-mld\n - link ID 7 link addr aa:bb:cc:dd:ee:03\n channel 36 (5180 MHz), width: 80 MHz\n txpower 23.00 dBm\n');
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
  summary = collect('');
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['40 / 40 MHz', '19 dBm'], ['—', '—']]);
  reading = { channel: 11, htmode: 'HE20', txpower: 25 };
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['—', '—']], 'frequency-less results cannot establish a band');
  // Ordinary interfaces are attributed by frequency, not their parent radio.
  summary = collect('Interface ap-mld\n channel 37 (6135 MHz), width: 160 MHz\n txpower 0.00 dBm\n');
  h.mods.network.getWifiDevices = async () => [];
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['37 / 160 MHz', '0 dBm']]);
  assert.deepEqual([...h.node.querySelectorAll('.wifi7-status-badge')].map(n => n.textContent), ['—Unknown', '—Unknown', '—Unknown']);
  assert.match(summary, /^@@ devices 0\n/);
  const available = summary;
  summary = collect('Interface ap-mld\n channel 37 (6135 MHz), width: 160 MHz\n txpower 0.00 dBm\n', 1);
  assert.match(summary, /^@@ devices 1\n/);
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['—', '—']], 'failed enumeration must not publish partial readings');
  summary = available;
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['37 / 160 MHz', '0 dBm']], 'overview recovers without visiting clients');
  summary = collect('');
  await h.poll();
  assert.deepEqual(values(), [['—', '—'], ['—', '—'], ['—', '—']], 'missing radios and readings must clear prior metrics');
  assert.equal(h.writes().length, 0);
  console.log('PASS production summary contract: radio attribution, MLO precedence, fallback, zero power and missing frequency');
 } finally {
  if (h) h.w.close();
  fs.rmSync(temp, { recursive: true, force: true });
 }
})().catch(e => { console.error(e); process.exitCode = 1; });
