'use strict';
// Complete production status + native LuCI modules. Only RPC/files are fixtures.
const assert = require('assert/strict');
const {boot, tick} = require('../../tests/helpers/test_connection_lifecycle.cjs');
async function until(check) { const end=performance.now()+3000; while(!check()) { assert(performance.now()<end,'UI settled'); await new Promise(r=>setTimeout(r,5)); } }
(async()=>{
 const h=await boot();
 try {
  await h.settle({results:[]});
  for(const button of h.root().querySelectorAll('button'))assert.equal(button.type,'button','status actions must not submit a containing form');
  assert.equal(h.root().querySelectorAll('textarea').length,1,'one selected-source log viewer');
  const source=()=>h.root().querySelector('select[aria-label="Log source"]');
  assert(source(),'accessible source selector');
  assert.equal(source().value,'sing-box-c','client runtime is the default log source');
  assert.deepEqual([...source().options].map(o=>o.value),['homeproxy','sing-box-c','sing-box-s']);
  const reads=[]; let held;
  h.mods.fs.read_direct=async path=>{reads.push(path);return 'line one\nline two\nline three';};
  for(const poll of h.polls) await poll();
  assert.deepEqual(reads,['/var/run/homeproxy/sing-box-c.log'],'only selected log is read');
  const area=()=>h.root().querySelector('textarea');
  area().focus();area().setSelectionRange(2,7,'backward');area().scrollTop=12;area().scrollLeft=6;
  h.mods.fs.read_direct=async path=>{reads.push(path);return 'line one\nline two\nline three\nnew';};
  for(const poll of h.polls) await poll();
  assert.equal(area().selectionStart,2);assert.equal(area().selectionEnd,7);assert.equal(area().selectionDirection,'backward');assert.equal(area().scrollTop,12);assert.equal(area().scrollLeft,6);
  source().value='homeproxy';source().dispatchEvent(new h.w.Event('change',{bubbles:true}));await tick();await tick();
  assert.equal(reads.at(-1),'/var/run/homeproxy/homeproxy.log');
  assert(h.root().querySelector('[aria-label="Log level"]').hidden,'orchestration log has no core log-level control');
  source().value='sing-box-c';source().dispatchEvent(new h.w.Event('change',{bubbles:true}));await tick();await tick();
  assert.equal(reads.at(-1),'/var/run/homeproxy/sing-box-c.log');
  assert(!h.root().querySelector('[aria-label="Log level"]').hidden,'client source restores core log-level control');
  assert.equal(h.root().querySelectorAll('select[aria-label="Log level"]').length,1);
  h.mods.fs.read_direct=path=>{reads.push(path);return new Promise(r=>held=r);};
  const pending=Promise.all(h.polls.map(f=>f()));await tick();
  const old=area(),n=reads.length;
  source().value='sing-box-s';source().dispatchEvent(new h.w.Event('change',{bubbles:true}));
  const before=old.value;
  for(const poll of h.polls) await poll();assert.equal(reads.length,n,'source switching keeps the in-flight lock');
  const map=h.mods.dom.findClassInstance(h.root());await map.reset();await tick();
  assert.equal(source().value,'sing-box-s','reset retains selected log source');
  assert.equal(reads.length,n,'reset keeps the in-flight lock');
  h.mods.fs.read_direct=async path=>{reads.push(path);return 'server fresh';};held('STALE CLIENT');await pending;await until(()=>area().value==='server fresh');
  assert.equal(old.value,before,'stale response cannot write detached textarea');
  assert.equal(reads.at(-1),'/var/run/homeproxy/sing-box-s.log');
  const detached=h.root();detached.remove();await tick();assert.equal(h.polls.length,0);
  const fresh=await h.app.render();h.w.document.querySelector('#view').append(fresh);await tick();
  for(const poll of h.polls)await poll();assert.equal(h.root().querySelectorAll('textarea').length,1);assert.equal(h.polls.length,1);
  const table=h.root().querySelector('table');assert.equal(table.rows[0].cells.length,3,'URL merged into website name');
  assert.equal(table.rows[1].cells[0].querySelector('a').textContent,'Baidu');
  assert.equal(table.rows[1].cells[0].querySelector('a').href,'https://www.baidu.com/');
  console.log('PASS status: one selected log; source-only reads; selection/scroll; switch+reset in-flight lock; stale reply isolation; reentry; linked website name');
 } finally {h.w.close();}
 const ro=await boot([],{}, {readonly:true});
 try {
  await ro.settle({results:[]});
  assert(ro.button('Clean log').disabled,'readonly cannot clear logs');
  assert(ro.root().querySelector('[aria-label="Log level"]').disabled,'readonly cannot change log level');
  assert(!ro.root().querySelector('[aria-label="Log source"]').disabled,'readonly can inspect all sources');
  assert(!ro.button('Test all').disabled,'readonly may test connectivity');
  assert(ro.button('Update resources').disabled,'readonly cannot mutate resources');
  assert.equal([...ro.root().querySelectorAll('.hp-resources button')].filter(b=>['Download','Remove','Retry'].includes(b.textContent)).length,0,'status does not duplicate dashboard management');
  assert(ro.root().querySelector('.hp-resources a[href$="/client"]'),'status links to client dashboard');
  console.log('PASS status readonly: inspect logs/connectivity, no level/clean/resource writes; dashboard summary links to client');
 } finally {ro.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
