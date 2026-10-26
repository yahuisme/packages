const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<body/>'),document=dom.window.document;
const src=fs.readFileSync(path.join(__dirname,'../luci-app-homeproxy/htdocs/luci-static/resources/view/homeproxy/client.js'),'utf8');
String.prototype.format=function(...a){let i=0;return this.replace(/%s/g,()=>a[i++]);};
const start=src.indexOf("\t\tdro = domainRoutes.option(form.ListValue, 'node'");
assert(start>=0,'production diversion option exists');
const end=src.indexOf("\n\t\tdro = domainRoutes.option(form.TextValue",start);
assert(end>start,'production diversion option boundary exists');
let option,selected='gone';
const choices=new Map();
function E(tag,attrs,children){const node=document.createElement(tag);node.append(...children);return node;}
try {
 // Evaluate only trusted local production source; no user data is evaluated.
 new Function('domainRoutes','form','proxy_nodes','uci','_','E','let dro;'+src.slice(start,end))(
  {option:()=>option={value(key,label){choices.set(key,label);},cfgvalue:()=>selected}},
  {ListValue:{}},{good:'<img src=x onerror=evil()> & Good node'},
  {sections:(_c,_t,cb)=>cb({node:'gone'}),get:()=> '1'},s=>s,E);
 assert.equal(option.textvalue('route'),'Node unavailable; using the main node.');
 selected='good';
 const label=option.textvalue('route');
 assert.equal(label.textContent,'<img src=x onerror=evil()> & Good node');
 assert.equal(label.querySelectorAll('img').length,0,'node labels remain literal text');
 assert.equal(choices.get('good').textContent,label.textContent);
 selected='tailscale';
 assert.equal(option.textvalue('route'),'[Tailscale] Tailscale');
 assert.equal(option.validate, undefined);
 assert.equal((src.match(/domainMatchDescription/g)||[]).length,4);
 console.log('PASS: diversion unknown/known/Tailscale labels, literal DOM choices and shared domain help');
} finally {dom.window.close();}
