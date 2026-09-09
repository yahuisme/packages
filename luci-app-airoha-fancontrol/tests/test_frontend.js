const fs = require('fs'), vm = require('vm'), assert = require('assert');
const path = require('path');
const base = path.join(__dirname, '../htdocs/luci-static/resources/view/fan/');
const settings = fs.readFileSync(base + 'settings.js', 'utf8');
const start = settings.indexOf('function validPoints(');
const end = settings.indexOf('\n\nreturn view.extend', start);
assert(start >= 0 && end > start);
const context = {};
vm.createContext(context);
vm.runInContext(settings.slice(start, end) + ';this.validPoints=validPoints;', context);
function points(lastPwm = 255) {
 const result = [];
 for (let i = 1; i <= 5; i++) result.push({ temp: String(i * 10), pwm: String(i === 5 ? lastPwm : i * 40) });
 return result;
}
assert.strictEqual(context.validPoints(points()), true);
for (const bad of [points(254), points().map((p, i) => i === 1 ? {...p, temp:'010'} : p), points().map((p, i) => i === 2 ? {...p, temp:'10'} : p), points().map((p, i) => i === 2 ? {...p, pwm:'20'} : p)]) {
 assert.strictEqual(context.validPoints(bad), false);
}
assert(settings.includes("option.forcewrite = true"));
assert(settings.includes("option.write = function(sectionId) { uci.set('fan', sectionId, 'point5_pwm', '255'); }"));
assert(settings.includes("option.depends({ 'fan.settings.mode': 'auto', 'fan.settings.curve_preset': 'custom' })"));

const status = fs.readFileSync(base + 'status.js', 'utf8');
const statusContext = { _: s => s, view: { extend: x => x }, rpc: { declare: () => () => {} }, poll: {}, L: {} };
vm.createContext(statusContext);
vm.runInContext('(function(){' + status + '})();', statusContext);
vm.runInContext(status.slice(status.indexOf('function validNumber'), status.indexOf('function presetInfo')), statusContext);
assert.strictEqual(statusContext.validTemp(50), true);
assert.strictEqual(statusContext.validTemp(151), false);
assert.strictEqual(statusContext.validTemp(NaN), false);
console.log('frontend validation and status value guards: PASS');
