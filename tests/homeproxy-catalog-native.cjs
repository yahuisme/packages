'use strict';
// Existing native po2lmo binary + actual LuCI gettext; no target build/browser.
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const app = path.resolve(__dirname, '../luci-app-homeproxy');
(async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-catalog-'));
 let h;
 try {
  const po = path.join(app, 'po/zh_Hans/homeproxy.po'), lmo = path.join(dir, 'homeproxy.zh-cn.lmo');
  const tool = process.env.PO2LMO || 'po2lmo';
  execFileSync(tool, [po, lmo]);
  const messages = JSON.parse(execFileSync('python3', ['-c',
   'import json,sys;sys.path.insert(0,sys.argv[1]);from test_catalog import catalog;print(json.dumps(catalog(__import__("pathlib").Path(sys.argv[2]))))',
   path.join(app, 'tests'), po], {encoding:'utf8'}));
  h = await pageBoot('server');
  const bytes = fs.readFileSync(lmo), offset = bytes.readUInt32BE(bytes.length - 4);
  assert(offset < bytes.length - 4 && (bytes.length - 4 - offset) % 16 === 0, 'native LMO index is valid');
  h.w.TR = {};
  for (let i = offset; i < bytes.length - 4; i += 16) {
   const key = bytes.readUInt32BE(i).toString(16).padStart(8, '0');
   const start = bytes.readUInt32BE(i + 8), length = bytes.readUInt32BE(i + 12);
   assert(start + length <= offset, 'LMO value lies before the index');
   h.w.TR[key] = bytes.subarray(start, start + length).toString('utf8');
  }
  for (const [message, translated] of Object.entries(messages))
   assert.equal(h.w._(message), translated, 'native LMO/gettext: ' + message);
  for (const message of ['Generation failed.', 'Unable to start the generator.', 'Incomplete generator output.'])
   assert.notEqual(h.w._(message), message, 'new diagnostics have native Chinese lookup');
  const menu = JSON.parse(fs.readFileSync(path.join(app, 'root/usr/share/luci/menu.d/luci-app-homeproxy.json'), 'utf8'));
  for (const entry of Object.values(menu)) if (entry.title) assert(messages[entry.title], 'menu title has Chinese translation: ' + entry.title);
  console.log('PASS native po2lmo + LuCI gettext for ' + Object.keys(messages).length + ' complete HomeProxy messages, new generator diagnostics and menu titles');
 } finally { h?.w.close(); fs.rmSync(dir, {recursive:true, force:true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
