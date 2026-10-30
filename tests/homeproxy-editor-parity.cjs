'use strict';
// Capture the complete pre-redesign native form definitions, not regex matches.
// The frozen fixture is regenerated only with --write, never during acceptance.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { execFileSync } = require('child_process');
process.env.PACKAGES_ROOT = path.resolve(__dirname, '..');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const COMMIT = 'b2642d41adfd1da7307359d5b8b283531e6c56b5';
const PREFIX = 'luci-app-homeproxy/htdocs/luci-static/resources/';
const FEATURES = {with_quic:true,with_wireguard:true,with_gvisor:true,with_utls:true,with_grpc:true,with_acme:true,hp_has_tcp_brutal:true};
const fixturePath = path.join(__dirname, 'fixtures/homeproxy-editor-options.json');
function walk(section) {
 return Array.from(section.children || []).flatMap(o => o.subsection ? walk(o.subsection) : o.children?.length ? walk(o) : [o]);
}
function describe(option) {
 const result = {option:option.option};
 for (const key of ['keylist','vallist','deps','datatype','default','rmempty','optional','modalonly','editable','password','multiple','noaliases']) {
  const value = option[key];
  if (value !== undefined) result[key] = value;
 }
 return JSON.parse(JSON.stringify(result, (_, value) => Object.prototype.toString.call(value) === '[object RegExp]' ? {regexp:value.source,flags:value.flags} : value));
}
function evaluate(h, source) {
 const deps = [...source.matchAll(/'require ([^';]+)';/g)].map(m=>m[1].split(' as '));
 const C = h.w.Function(...deps.map(([name, alias])=>alias || name.split('.').at(-1)), source)(...deps.map(([name])=>h.mods[name]));
 return typeof C === 'function' ? Object.create(C.prototype) : C;
}
async function capture(name, baseline) {
 const h = await pageBoot(name);
 try {
  h.root().remove();
  if (baseline) {
   const read = file => execFileSync('git',['show',COMMIT+':'+PREFIX+file],{cwd:process.env.PACKAGES_ROOT,encoding:'utf8'});
   h.mods.homeproxy = evaluate(h, read('homeproxy.js'));
   h.app = evaluate(h, read('view/homeproxy/'+name+'.js'));
  }
  const rendered = await h.app.render(['homeproxy', FEATURES]);
  h.w.document.querySelector('#view').append(rendered);
  const map = h.mods.dom.findClassInstance(h.root());
  const grid = walk(map).find(o=>o.option==='type' && o.section.sectiontype===name).section;
  return Array.from(grid.children, describe);
 } finally {h.w.close();}
}
async function main() {
 if (process.argv.includes('--write')) {
  const fixture = {baseline:COMMIT,features:FEATURES,node:await capture('node',true),server:await capture('server',true)};
  fs.writeFileSync(fixturePath,JSON.stringify(fixture,null,2)+'\n');
  console.log('WROTE immutable baseline fixture '+COMMIT+' native node='+fixture.node.length+' server='+fixture.server.length);
 } else {
  const fixture = require(fixturePath);
  assert.equal(fixture.baseline,COMMIT);
  for (const name of ['node','server']) {
   assert.deepEqual(await capture(name,true),fixture[name],name+' frozen fixture must match the real pre-redesign complete form');
   assert.deepEqual(await capture(name,false),fixture[name],name+' preserves every option, ordered choice, dependency, datatype, default and form flag');
   console.log('PASS '+name+' all-option native baseline parity: '+fixture[name].length+' complete option descriptors');
  }
 }
}
module.exports = {walk,describe,FEATURES};
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1;});
