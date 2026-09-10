const fs=require('fs'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/../htdocs/luci-static/resources/view/homeproxy/status.js','utf8');
const expression=source.match(/const available = (.*);/)[1];
const display=Function('resourceStatus','return '+expression);
for(const v of ['20260908094002','2026-09-08'])assert.equal(display({version:v}),v);
for(const v of ['a'.repeat(40),'20260908094002 '+ 'a'.repeat(40),'<img src=x>'])assert.equal(display({version:v}),null);
console.log('PASS: timestamp/date display, reject hash and unsafe strings');
