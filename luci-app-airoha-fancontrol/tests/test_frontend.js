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

// A malformed edit must disappear, never turn into a plausible zero curve.
let fields = {};
for (let i = 1; i <= 5; i++) {
 fields['point'+i+'_temp'] = {value:String(i*10)};
 fields['point'+i+'_pwm'] = {value:String(i===5?255:i*40)};
}
let preview = {document:{querySelector:selector=>fields[selector.match(/data-name="([^"]+)/)[1]]}};
vm.createContext(preview);
vm.runInContext(source.slice(source.indexOf('function validPoints'),source.indexOf('function drawCurveCanvas')),preview);
vm.runInContext(source.slice(source.indexOf('function readCustomPoints'),source.indexOf('return view.extend')),preview);
assert.strictEqual(preview.readCustomPoints().length,5);
fields.point2_temp.value='20.5';
assert.strictEqual(preview.readCustomPoints(),null);
for (const bad of ['', '020', '20x', '-1', '101']) {
 fields.point2_temp.value=bad;
 assert.strictEqual(preview.readCustomPoints(),null,bad);
}
fields.point2_temp.value='10';
assert.strictEqual(preview.readCustomPoints(),null);
fields.point2_temp.value='20'; fields.point5_pwm.value='254';
assert.strictEqual(preview.readCustomPoints(),null);

let clock=1000000;
let telemetry={Date:{now:()=>clock},history:[],HISTORY_WINDOW_MS:120000,persistHistory:()=>{}};
vm.createContext(telemetry);
vm.runInContext(status.slice(status.indexOf('function appendHistory'),status.indexOf('function chartScale')),telemetry);
telemetry.appendHistory({temp_board:null,fan_pwm:0,fan_rpm:1234});
assert.strictEqual(telemetry.history.length,1);
assert.strictEqual(telemetry.history[0].temperature,null);
assert.strictEqual(telemetry.history[0].pwm,0);
assert.strictEqual(telemetry.history[0].rpm,1234);
clock+=125000; telemetry.appendHistory({});
assert.strictEqual(telemetry.history.length,1);
assert.strictEqual(telemetry.history[0].time,clock);
assert.strictEqual(telemetry.history[0].rpm,null);

vm.runInContext(status.slice(status.indexOf('function tempColor'),status.indexOf('function modeInfo')),ctx);
assert.strictEqual(ctx.tempColor(50),'#f59e0b');
assert.strictEqual(ctx.tempColor(-12),'#10b981');
assert.strictEqual(ctx.tempColor(NaN),'inherit');
assert.strictEqual(ctx.tempColor(151),'inherit');
/* Keep test asserts aligned with current implementation */
assert.strictEqual(cards[3].title,'Configured Curve');
assert(!source.includes('getAllCurves'));
assert(source.includes('Stopping the fan may cause overheating.'));
assert(status.includes('poll.add(fetchData, 5)'));
for (const js of [source,status]) {
 assert(js.includes('ResizeObserver'));
 assert(js.includes('.disconnect()'));
}

let operations=[];
let canvasContext=new Proxy({}, {get:(_o,key)=>(...args)=>operations.push([key,...args]),set:()=>true});
let plot={Date:{now:()=>clock},HISTORY_WINDOW_MS:120000,TIME_GRID_INTERVAL_MS:10000,
 TIME_LABEL_INTERVAL_MS:30000,VALUE_GRID_DIVISIONS:4,window:{devicePixelRatio:1},getComputedStyle:()=>({color:'black',getPropertyValue:()=>''})};
vm.createContext(plot);
vm.runInContext(status.slice(status.indexOf('function chartScale'),status.indexOf('function chartCard')),plot);
let canvas={clientWidth:300,clientHeight:110,getContext:()=>canvasContext};
plot.drawChart(canvas,[{time:clock-10000,rpm:1000},{time:clock-5000,rpm:null},{time:clock,rpm:1500}], 'rpm',
 {minMax:1000,step:500,format:String,lineColor:'green'});
let finalPath=operations.slice(operations.map(x=>x[0]).lastIndexOf('beginPath'));
assert.strictEqual(finalPath.filter(x=>x[0]==='lineTo').length,0,'missing reading must break the line');
