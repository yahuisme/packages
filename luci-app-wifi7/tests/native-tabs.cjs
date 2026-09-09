// Actual LuCI view/DOM/form/ui; isolated transport, no router writes.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {boot}=require('./integration.cjs');
(async()=>{
 const h=await boot(),nav=h.q(':scope > .cbi-tabmenu');
 const labels=[...nav.querySelectorAll('a')].map(a=>a.textContent);
 assert.equal(labels.length,4);
 assert.deepEqual([...h.q('style').textContent.matchAll(/([^{}]*\.cbi-tab[^{}]*)\{([^{}]*)\}/g)].map(m=>[m[1].trim(),m[2].trim()]),[['.wifi7-map .cbi-tabmenu','margin-bottom:16px;']],'keep original spacing only, no tab skin override');
 assert.equal(h.q(':scope > h2').textContent,'WiFi 7','retain original page title');
 const description=h.q(':scope > .cbi-map-descr');
 assert.equal(description.textContent,'Wi-Fi 7 (802.11be)  & Multi-Link Operation Settings');
 assert.equal(h.q(':scope > h2').nextElementSibling,description);
 assert.equal(description.nextElementSibling,nav);
 assert.equal(description.getAttribute('style'),null,'native description without custom styling');
 const E=(tag,attrs,children)=>h.w.E(tag,h.w.JSON.parse(JSON.stringify(attrs)),h.w.Array.from(children||[]));
 const reference=E('div',{id:'native-reference','class':'cbi-map'});
 const group=E('div',{},labels.map((label,i)=>E('div',{'data-tab':'reference-'+i,'data-tab-title':label,'data-tab-active':i?'false':'true'},['Reference content'])));
 reference.append(group);h.node.after(reference);h.mods.ui.tabs.initTabGroup(group.children);
 const refNav=reference.querySelector('.cbi-tabmenu');
 const panes=[...nav.parentNode.children].slice([...nav.parentNode.children].indexOf(nav)+1);
 assert.equal(panes.length,4);
 const expensive=c=>c.method==='assoclist'||c.params.command==='/usr/libexec/wifi7-status';
 const mlo=c=>c.method==='getWirelessDevices';
 assert.equal(h.calls.filter(expensive).length,0);assert.equal(h.calls.filter(mlo).length,0);
 const out=process.env.TAB_OUT;if(out)fs.mkdirSync(out,{recursive:true});
 for(const i of [0,1,2,3,0,2,1,3,0]){
  await h.tab(i);refNav.children[i].querySelector('a').click();
  assert.equal([...nav.children].filter(n=>n.className==='cbi-tab').length,1);
  assert.equal(nav.children[i].className,'cbi-tab');
  assert.deepEqual([...nav.children].map(n=>n.className),[...refNav.children].map(n=>n.className));
  panes.forEach((p,n)=>assert.equal(p.style.display,n===i?'':'none'));
  const before=h.calls.length;await h.poll();const fresh=h.calls.slice(before);
  assert.equal(fresh.some(expensive),i===3,'client diagnostics only while clients active');
  assert.equal(fresh.some(mlo),i===2,'MLO runtime only while MLO active');
  if(i===2)assert(h.q('.mlo-map'),'embedded real form stays mounted');
  assert(h.node.isConnected);
  if(out)fs.writeFileSync(path.join(out,'tab-'+i+'.html'),h.j.serialize());
 }
 assert.equal(h.polls.size,2);h.node.remove();await new Promise(r=>setImmediate(r));assert.equal(h.polls.size,0,'both poll callbacks removed on detach');
 h.w.close();console.log('PASS native ui.tabs parity, all four panes, lazy client/MLO polling, revisit and detach');
})().catch(e=>{console.error(e);process.exitCode=1});
