const fs=require('fs'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..'), read=p=>fs.readFileSync(path.join(root,p),'utf8');
for(const name of ['client','server']) {
 const s=read('htdocs/luci-static/resources/view/homeproxy/'+name+'.js');
 assert(!s.includes('view.innerHTML'),'status must use DOM nodes');
}
const s=read('htdocs/luci-static/resources/view/homeproxy/status.js');
assert(!s.includes('setTimeout(runAllTests'), 'external tests must be opt-in');
assert(!s.includes('fs.read_direct'), 'log reads must be bounded at backend');
const client=read('htdocs/luci-static/resources/view/homeproxy/client.js');
const secret=client.slice(client.indexOf("'dashboard_secret'"),client.indexOf("'_open_dashboard'"));
assert(secret.includes("depends('dashboard_enabled', '1')"));
assert(secret.includes('validate'));
console.log('PASS UI safety source contracts');
