'use strict';
// Decode real po2lmo output; native cbi.js performs every lookup.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
module.exports = function(w) {
 if (!process.env.NPU_ZH) return;
 const root = process.env.LUCI_RESOURCE_DIR;
 const base = path.resolve(root, '../../..');
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'npu-lmo-'));
 try {
  w.TR = {};
  for (const po of [path.join(base, 'po/zh_Hans/base.po'), path.join(__dirname, '../po/zh_Hans/luci-app-airoha-npu.po')]) {
   const actual = po;
   execFileSync(process.env.PO2LMO || path.join(base, 'src/po2lmo'), [actual, path.join(temp, 'catalog.lmo')]);
   const b = fs.readFileSync(path.join(temp, 'catalog.lmo'));
   for (let i = b.readUInt32BE(b.length - 4); i < b.length - 4; i += 16) {
    const key = b.readUInt32BE(i).toString(16).padStart(8, '0');
    w.TR[key] = b.subarray(b.readUInt32BE(i + 8), b.readUInt32BE(i + 8) + b.readUInt32BE(i + 12)).toString();
   }
  }
  if (w._('Save') !== '保存' || w._('Unknown') === 'Unknown') throw Error('Native Chinese catalog did not load');
 } finally { fs.rmSync(temp, { recursive: true, force: true }); }
};
