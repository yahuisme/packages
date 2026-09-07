const fs = require('fs'), vm = require('vm'), assert = require('assert');
const base = require('path').join(__dirname, '../htdocs/luci-static/resources/view/fan/');
let source = fs.readFileSync(base + 'settings.js', 'utf8');
let start = source.indexOf('function validateCurve('), end = source.indexOf('\n\t\tvar defaults', start);
assert(start >= 0 && end > start);
let values = {};
for (let i=1;i<=5;i++) { values['point'+i+'_temp']=String(i*10); values['point'+i+'_pwm']=String(i===5?255:i*40); }
values.mode='auto'; values.curve_preset='custom';
const context = { _: s=>s, uci:{get:(_c,_s,k)=>values[k]}, m:{lookupOption:(k)=>[{formvalue:()=>values[k]}]} };
vm.createContext(context);
vm.runInContext(source.slice(start,end) + ';this.validateCurve=validateCurve;',context);
assert.strictEqual(context.validateCurve.call({option:'point1_temp'},'custom','10'),true);
assert.notStrictEqual(context.validateCurve.call({option:'point1_temp'},'custom','010'),true);
values.mode='manual'; values.point2_temp='bad';
assert.strictEqual(context.validateCurve.call({option:'point1_temp'},'custom','10'),true);
values.mode='auto'; values.point2_temp='20';
// Initial rendering: other widgets do not yet exist; use stored UCI values.
context.m.lookupOption=k=>null;
assert.strictEqual(context.validateCurve.call({option:'point1_temp'},'custom','10'),true);
assert(source.includes("o.cfgvalue = function() { return '255'; }"));
assert(source.includes('o.forcewrite = true'));
assert.strictEqual(source.split("o.depends({ 'fan.settings.mode': 'auto', 'fan.settings.curve_preset': 'custom' })").length-1,2);
assert(source.includes("o.write = function(sectionId) { uci.set('fan', sectionId, 'point5_pwm', '255'); }"));
let status = fs.readFileSync(base+'status.js','utf8');
let ctx={_:s=>s, view:{extend:x=>x},rpc:{declare:()=>()=>{}},poll:{},L:{},window:{}};
vm.createContext(ctx);
vm.runInContext('(function(){'+status+'})();',ctx);
// Evaluate helpers separately (LuCI module wrapper scopes them).
vm.runInContext(status.slice(status.indexOf('function modeInfo'),status.indexOf('function renderSummary')),ctx);
let cards=ctx.summaryData({fan_mode:1,uci_mode:'auto',fan_rpm:null,fan_pwm:null,fan_percentage:null});
assert.strictEqual(cards[2].value,'Manual');
assert(cards[0].value.includes('—')); assert(cards[1].value.includes('—'));
assert.notStrictEqual(cards[2].sub,'固定 PWM 输出');
console.log('frontend validator lifecycle, rescue mode, fixed PWM5, actual mode and unknown data: PASS');
