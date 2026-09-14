const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../luci-app-homeproxy/htdocs/luci-static/resources/view/homeproxy/client.js'),'utf8');
String.prototype.format=function(...a){let i=0;return this.replace(/%s/g,()=>a[i++]);};
const start=src.indexOf("\t\tdro = domainRoutes.option(form.ListValue, 'node'");
let option;
// Evaluate only trusted local production source; no user data is evaluated.
new Function('domainRoutes','form','proxy_nodes','uci','_','let dro;'+src.slice(start,src.indexOf("\n\t\tdro = domainRoutes.option(form.TextValue",start)))({option:()=>option={value(){},cfgvalue:()=> 'gone'}},{ListValue:{}},{good:'Good node'},{sections:(_c,_t,cb)=>cb({node:'gone'})},s=>s);
assert.equal(option.textvalue('route'),'Node unavailable; using the main node.');
assert.equal(option.validate, undefined);
assert.equal((src.match(/domainMatchDescription/g)||[]).length,4);
console.log('PASS: unavailable diversion node label/validation and shared domain help');
