'use strict';
// Production task + native LuCI; only task transport/timers are private.
const assert = require('assert/strict');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');
async function until(check, label) {
 const end = performance.now() + 4000;
 while (!check()) {
  assert(performance.now() < end, label);
  await new Promise(resolve => setTimeout(resolve, 5));
 }
}
async function taskFixture() {
 const h = await pageBoot('node');
 const timers = new Map(), nativeTimeout = h.w.setTimeout.bind(h.w), nativeClear = h.w.clearTimeout.bind(h.w);
 let serial = -1, starts = 0, status = 0, release, reject;
 h.w.setTimeout = (fn, ms, ...args) => {
  if (ms !== 1000) return nativeTimeout(fn, ms, ...args);
  const id = serial--;
  timers.set(id, () => fn(...args));
  return id;
 };
 h.w.clearTimeout = id => timers.has(id) ? timers.delete(id) : nativeClear(id);
 const post = h.mods.request.post;
 h.mods.request.post = async (url, req) => req.params[1] === 'uci' && req.params[2] === 'apply'
  ? {ok:true, status:200, json:() => h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0', id:req.id, result:[5]}))}
  : post(url, req);
 h.mods.fs.exec = async (_path, args) => {
  if (args[0] === '--start') { starts++; return {code:0, stdout:'{"state":"running"}'}; }
  if (!starts) return {code:0, stdout:'{"state":"idle"}'};
  status++;
  return new Promise((resolve, fail) => { release = resolve; reject = fail; });
 };
 const option = h.map.lookupOption('_update_subscriptions', 'subscription')[0];
 return Object.assign(h, {
  timers, run:() => option.onclick(null, 'subscription'), starts:() => starts, status:() => status,
  reply:value => release(value), fail:() => reject(Error('held task transport failure')),
  advance() { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); },
  visibility(value, dispatch = true) {
   Object.defineProperty(h.w.document, 'visibilityState', {configurable:true, value});
   if (dispatch) h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  }
 });
}
async function visibility() {
 const h = await taskFixture();
 try {
  const running = h.run();
  await until(() => h.timers.size, 'task schedules short status read');
  // A hidden transition may reach an already queued timer before its event.
  h.visibility('hidden', false); h.advance(); await tick(); await tick();
  assert.equal(h.status(), 0, 'hidden page must not read a subscription worker');
  h.visibility('visible');
  await until(() => h.timers.size, 'visible task resumes its existing waiter');
  h.advance(); await until(() => h.status(), 'visible task reads existing worker');
  assert.equal(h.starts(), 1, 'visibility never restarts worker');
  const old = h.root(); old.remove(); await tick(); const text = old.textContent;
  h.reply({code:0, stdout:'{"state":"done","code":0}'}); await running;
  assert.equal(old.textContent, text, 'late terminal success cannot paint detached view');
  assert.equal(h.status(), 1);
  console.log('PASS subscription hidden/visible task: no hidden read, same worker, detached late success ignored');
 } finally { h.w.close(); }
}
async function detach(outcome) {
 const h = await taskFixture();
 try {
  const running = h.run();
  await until(() => h.timers.size, 'task waits for status');
  if (outcome !== 'waiting') {
   h.advance(); await until(() => h.status(), 'status transport held');
  }
  const old = h.root(); old.remove(); await tick(); const text = old.textContent;
  h.mods.uci.set('homeproxy', 'subscription', 'subscription_url', []);
  h.w.document.querySelector('#view').append(await h.app.render(['homeproxy', await h.mods.homeproxy.getBuiltinFeatures()]));
  await tick();
  const fresh = h.root(), freshText = fresh.textContent;
  if (outcome === 'error') h.fail();
  if (outcome === 'running') h.reply({code:0, stdout:'{"state":"running"}'});
  await running;
  assert.equal(fresh.textContent, freshText, 'old task cannot alter replacement route action labels');
  assert(fresh.querySelector('[data-name="_update_subscriptions"] button').disabled, 'replacement without URLs stays disabled');
  assert.equal(h.timers.size, 0, 'detached wait cancels timer without a second task read');
  assert.equal(old.textContent, text, 'late ' + outcome + ' cannot paint detached view');
  assert.equal(h.status(), outcome === 'waiting' ? 0 : 1);
  console.log('PASS subscription detach ' + outcome + ': timer cleaned, no stale paint or duplicate read');
 } finally { h.w.close(); }
}
(async () => {
 await visibility();
 for (const outcome of ['error', 'running', 'waiting']) await detach(outcome);
})().catch(error => { console.error(error); process.exitCode = 1; });
