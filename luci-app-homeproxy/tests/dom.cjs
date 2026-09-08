const fs=require('fs'),assert=require('assert'),path=require('path');
const {JSDOM}=require(process.env.JSDOM_PATH||'/root/wifi7-audit-evidence/test-tools/node_modules/jsdom');
const base=process.env.LUCI_RESOURCES||'/root/wifi7-audit-evidence/luci/modules/luci-base/htdocs/luci-static/resources/';
const j=new JSDOM('<div id="view"></div>',{runScripts:'outside-only',url:'http://localhost/'}),w=j.window;
w._=s=>s; w.eval(fs.readFileSync(base+'cbi.js','utf8'));
w.eval(fs.readFileSync(base+'luci.js','utf8').replace('window.LuCI = LuCI;','window.LuCI = LuCI; window.__classes=classes;'));
w.L=Object.create(w.LuCI.prototype); w.E=w.__classes.dom.create.bind(w.__classes.dom);
const root=path.join(__dirname,'..','htdocs/luci-static/resources/view/homeproxy');
for(const name of ['client','server']){
 const s=fs.readFileSync(path.join(root,name+'.js'),'utf8'); const a=s.indexOf('function renderStatus('), b=s.indexOf('\n}',a)+2;
 const render=w.Function(s.slice(a,b)+';return renderStatus')();
 const node=render(true,'<img src=x onerror=alert(1)>','<script>attack</script>');
 assert.equal(node.querySelectorAll('img,script').length,0);
 assert(node.textContent.includes('<img'));
}
const s=fs.readFileSync(path.join(root,'node.js'),'utf8');
assert(!s.includes('status_widget.innerHTML'), 'latency status must be safe DOM');
console.log('PASS real LuCI DOM: untrusted version/node rendered as text');j.window.close();
