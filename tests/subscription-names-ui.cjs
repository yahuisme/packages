// Full production node view, native LuCI Map/UI/UCI/RPC; transport only is private.
const assert = require('assert/strict');
const crypto = require('crypto');
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const watchdog = setTimeout(() => { console.error('FAIL subscription names stalled'); process.exit(1); }, 30000);
const raw = 'HTTPS://ExAmPlE.invalid:443/a%2fb?token=A%2Bb&x=%25&x=2';
const md5 = value => crypto.createHash('md5').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture(options = {}) {
 const h = await pageBoot('node', {}, { ...options, values: {
  subscription: { subscription_url: [raw + '#Old%20name'] },
  n1: { grouphash: md5(raw) },
  config: { main_node: 'n1', main_urltest_nodes: ['n1'], routing_mode: 'custom' },
  divert: { '.type': 'routing_node', label: 'Diversion', node: 'n1' }
 } });
 const persisted = clone(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s => [s['.name'], s])));
 const post = h.mods.request.post;
 h.mods.request.post = async (url, req) => {
  const [, object, method, p] = req.params;
  let value;
  if (object === 'uci' && method === 'get') value = { values: persisted };
  else if (object === 'uci' && method === 'set') { Object.assign(persisted[p.section], p.values); value = {}; }
  else if (object === 'uci' && method === 'delete') { for (const key of p.options || []) delete persisted[p.section][key]; value = {}; }
  else return post(url, req);
  return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: [0, value] })) };
 };
 const option = () => h.mods.dom.findClassInstance(h.root().querySelector('[data-name="subscription_url"]'));
 const widget = () => option().getUIElement('subscription');
 const list = () => h.w.document.getElementById(option().cbid('subscription'));
 const edit = (input, value) => { input.value = value; input.dispatchEvent(new h.w.Event('input', { bubbles: true })); input.dispatchEvent(new h.w.Event('change', { bubbles: true })); };
 return Object.assign(h, { persisted, option, widget, list, edit });
}
(async () => {
 const h = await fixture();
 try {
  const name = h.list().querySelector('.item .hp-subscription-name');
  assert(name, 'existing remote link has a separate editable group name');
  const editor=h.root().querySelector('.hp-subscription-editor');
  assert.equal(editor.querySelectorAll('.hp-subscription-columns').length,1,'one shared desktop column header');
  assert.equal(editor.querySelector('.hp-subscription-columns').getAttribute('aria-hidden'),'true','visual header does not duplicate accessible labels');
  for(const input of editor.querySelectorAll('label>input')) {
   assert(input.parentElement.querySelector('.hp-subscription-label'),'each input retains its wrapping accessible label');
  }
  assert.equal(h.list().querySelectorAll(':scope>.item').length,1,'shared header is outside sortable rows');
  assert.equal(name.value, 'Old name');
  assert.equal(h.list().querySelector('.item .hp-subscription-url').value, raw);
  const literal = '中文 🚀 # 100% <img src=x onerror=alert(1)>';
  h.edit(name, literal);
  const expected = raw + '#' + encodeURIComponent(literal);
  assert.deepEqual(Array.from(h.option().formvalue('subscription')), [expected]);
  const identity = clone({ node: h.persisted.n1, config: h.persisted.config, diversion: h.persisted.divert });
  await h.map.save(null, true);
  assert.deepEqual(Array.from(h.persisted.subscription.subscription_url), [expected]);
  for (const [key, value] of Object.entries(identity)) assert.deepEqual(h.persisted[{ node: 'n1', config: 'config', diversion: 'divert' }[key]], value, key + ' identity/reference preserved');
  assert.equal(h.mods.homeproxy.getSubscriptionGroups('homeproxy')[0].hash, md5(raw));
  assert.equal(h.mods.homeproxy.getSubscriptionGroups('homeproxy')[0].title, literal);
  await h.map.load(); await h.map.reset();
  assert.equal(h.list().querySelector('.item .hp-subscription-name').value, literal);
  assert.equal(h.list().querySelectorAll('img,script').length, 0, 'names are literal text');
  const namedURL = 'https://b.invalid/sub?token=A%2Fb#New';
  h.edit(h.list().querySelector('.item .hp-subscription-name'), 'Old');
  h.edit(h.list().querySelector('.item .hp-subscription-url'), namedURL);
  assert.deepEqual(Array.from(h.option().formvalue('subscription')), ['https://b.invalid/sub?token=A%2Fb#Old'], 'existing row uses the explicit name, not two fragments');
  await h.map.save(null, true); await h.map.load(); await h.map.reset();
  assert.equal(h.list().querySelector('.item .hp-subscription-name').value, 'Old');
  assert.equal(h.list().querySelector('.item .hp-subscription-url').value, 'https://b.invalid/sub?token=A%2Fb');
  console.log('PASS native paired existing name edit → Map.save/load/reset: exact URL/hash, node ID, main/URLTest/diversion references and literal Unicode/HTML; pasted fragment does not duplicate explicit name');
 } finally { h.w.close(); }
 const a = await fixture();
 try {
  const add = () => a.list().querySelector('.add-item');
  const url = () => add().querySelector('.hp-subscription-url');
  const name = () => add().querySelector('.hp-subscription-name');
  assert(name(), 'new links have a separate optional name before adding');
  const second = 'https://other.invalid/s?token=%2f%2F';
  a.edit(name(), '新增 # %'); a.edit(url(), second);
  assert.deepEqual(Array.from(a.option().formvalue('subscription')), [raw + '#Old%20name', second + '#' + encodeURIComponent('新增 # %')], 'pending pair participates in native save');
  add().querySelector('.cbi-button-add').click();
  assert.equal(a.list().querySelectorAll('.item').length, 2);
  assert.equal(url().value, ''); assert.equal(name().value, '');
  a.edit(name(), '新增 # %'); a.edit(url(), second);
  url().dispatchEvent(new a.w.KeyboardEvent('keydown', { bubbles: true, keyCode: 13 }));
  assert.equal(a.list().querySelectorAll('.item').length, 2, 'native exact-value duplicate suppression');
  const firstName = () => a.list().querySelector('.item .hp-subscription-name');
  firstName().dispatchEvent(new a.w.KeyboardEvent('keydown', { bubbles: true, keyCode: 8 }));
  assert.equal(a.list().querySelectorAll('.item').length, 2, 'backspace edits text, not the list item');
  a.edit(firstName(), '');
  assert.equal(a.option().formvalue('subscription')[0], raw, 'empty name clears only the fragment');
  a.edit(a.list().querySelector('.item .hp-subscription-url'), 'invalid URL');
  a.option().triggerValidation('subscription');
  await assert.rejects(a.map.save(null, true), /invalid/i, 'native save rejects edited invalid URLs');
  a.edit(a.list().querySelector('.item .hp-subscription-url'), raw);
  a.option().triggerValidation('subscription');
  a.list().querySelectorAll('.item')[1].querySelector('button').click();
  assert.equal(a.list().querySelectorAll('.item').length, 1, 'remove deletes only its own pair');
  await a.map.save(null, true); await a.map.load(); await a.map.reset();
  assert.deepEqual(Array.from(a.persisted.subscription.subscription_url), [raw]);
  assert.equal(a.mods.homeproxy.getSubscriptionGroups('homeproxy')[0].title, 'example.invalid', 'empty name falls back to hostname');
  a.edit(name(), '保存草稿'); a.edit(url(), second);
  await a.map.save(null, true); await a.map.load(); await a.map.reset();
  assert.equal(a.list().querySelectorAll('.item').length, 2, 'save includes a draft without pressing add');
  assert.equal(a.list().querySelectorAll('.item .hp-subscription-name')[1].value, '保存草稿');
  a.edit(url(), 'invalid pending URL');
  a.option().triggerValidation('subscription');
  await assert.rejects(a.map.save(null, true), /invalid/i, 'invalid unadded draft must block save');
  a.option().triggerValidation('subscription');
  await assert.rejects(a.map.save(null, true), /invalid/i, 'repeat validation must not silently omit invalid draft');
  a.edit(url(), ''); a.option().triggerValidation('subscription');
  const style = a.root().querySelector('.hp-subscription-editor style').textContent;
  assert(style.includes('@media(max-width:600px)'), 'paired controls wrap at phone width');
  assert(style.includes('@container(max-width:480px)'), 'sidebar-constrained tablet uses actual editor width');
  assert(style.includes('.hp-subscription-links'), 'layout remains app scoped after reset');
  console.log('PASS native add/Enter/dedup/backspace/remove/blank-name/hostname/draft-save/invalid-URL; reset retains scoped phone-wrap layout');
 } finally { a.w.close(); }
 const d = await fixture();
 try {
  const name = d.list().querySelector('.add-item .hp-subscription-name');
  d.edit(name, 'Name without URL');
  await assert.rejects(d.map.save(null, true), /invalid/i, 'name-only draft must not be silently discarded');
  d.edit(name, '');
  const existing = d.list().querySelector('.item .hp-subscription-url');
  d.edit(existing, 'broken URL');
  await assert.rejects(d.map.save(null, true), /invalid/i, 'existing URL input event blocks save without manually triggering validation');
  d.edit(d.list().querySelector('.item .hp-subscription-name'), '');
  d.edit(existing, '');
  await assert.rejects(d.map.save(null, true), /invalid/i, 'clearing existing URL must not save a nameless empty row');
  d.edit(existing, raw);
  const lone = String.fromCharCode(0xD800);
  d.edit(d.list().querySelector('.item .hp-subscription-name'), lone);
  await assert.rejects(d.map.save(null, true), /invalid/i, 'unpaired surrogate name rejects save without throwing URIError');
  d.edit(d.list().querySelector('.item .hp-subscription-name'), 'Valid');
  const inputURL = d.list().querySelector('.add-item .hp-subscription-url');
  d.edit(inputURL, raw + '#Another');
  await assert.rejects(d.map.save(null, true), /invalid/i, 'same exact base URL cannot introduce a second named identity');
  d.list().querySelector('.add-item .cbi-button-add').click();
  assert.equal(d.list().querySelectorAll('.item').length, 1);
  assert.equal(inputURL.value, raw + '#Another', 'invalid duplicate draft remains editable');
  d.edit(inputURL, 'https://space.invalid/sub');
  d.edit(name, 'Keyboard');
  const space = new d.w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: 32 });
  d.list().querySelector('.add-item .cbi-button-add').dispatchEvent(space);
  assert(space.defaultPrevented, 'Space add prevents page scroll');
  assert.equal(d.list().querySelectorAll('.item').length, 2, 'Space activates native add control');
  assert.equal(d.list().querySelector('.item button').type, 'button', 'remove cannot submit form');
  d.widget().setValue([raw + '#Bad%0Aname']);
  await assert.rejects(d.map.save(null, true), /invalid/i, 'encoded multiline name rejects save');
  d.widget().setValue([raw + '#%ZZ']);
  await d.map.save(null, true);
  assert.equal(d.persisted.subscription.subscription_url[0], raw + '#%ZZ', 'untouched malformed fragment retained exactly');
  console.log('PASS name-only/invalid-existing/lone-surrogate/multiline/base-duplicate reject native saves; malformed legacy fragment retained; Space-add/remove button semantics');
 } finally { d.w.close(); }
 const reorder = await fixture();
 try {
  const values = [raw + '#First', 'https://second.invalid/sub#Second', 'https://third.invalid/sub#Third'];
  reorder.widget().setValue(values);
  const items = () => [...reorder.list().querySelectorAll('.item')];
  items()[2].dispatchEvent(new reorder.w.Event('dragstart', { bubbles: true }));
  items()[0].querySelector('.hp-subscription-name').dispatchEvent(new reorder.w.Event('drop', { bubbles: true, cancelable: true }));
  items()[0].dispatchEvent(new reorder.w.Event('dragend', { bubbles: true }));
  assert.deepEqual(Array.from(reorder.option().formvalue('subscription')), [values[2], values[0], values[1]], 'dropping onto the editable name moves before its row, not to the end');
  await reorder.map.save(null, true); await reorder.map.load(); await reorder.map.reset();
  assert.deepEqual(Array.from(reorder.persisted.subscription.subscription_url), [values[2], values[0], values[1]], 'native save/reload retains paired-row drag order');
  const beforeTouch = Array.from(reorder.option().formvalue('subscription'));
  items()[0].querySelector('.hp-subscription-url').dispatchEvent(new reorder.w.Event('touchstart', { bubbles: true }));
  assert.equal(reorder.list().querySelectorAll('.placeholder').length, 0, 'editing touch does not begin dragging');
  items()[0].dispatchEvent(new reorder.w.Event('touchstart', { bubbles: true }));
  assert.equal(reorder.list().querySelectorAll('.placeholder').length, 1);
  const target = items()[2];
  target.getBoundingClientRect = () => ({ top: 100, bottom: 140 });
  Object.defineProperty(target, 'offsetHeight', { configurable: true, value: 40 });
  const move = new reorder.w.Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(move, 'touches', { value: [{ clientY: 135 }] });
  reorder.list().dispatchEvent(move);
  reorder.list().dispatchEvent(new reorder.w.Event('touchend', { bubbles: true }));
  assert.deepEqual(Array.from(reorder.option().formvalue('subscription')), [beforeTouch[1], beforeTouch[2], beforeTouch[0]], 'touch reorder moves the full pair');
  assert.equal(reorder.list().querySelectorAll('.placeholder,.dragging').length, 0);
  await reorder.map.reset();
  assert.deepEqual(Array.from(reorder.option().formvalue('subscription')), beforeTouch, 'reset discards unsaved touch reorder');
  items()[0].dispatchEvent(new reorder.w.Event('touchstart', { bubbles: true }));
  const cancelTarget=items()[2];
  cancelTarget.getBoundingClientRect=()=>({top:100,bottom:140});
  Object.defineProperty(cancelTarget,'offsetHeight',{configurable:true,value:40});
  const cancelMove=new reorder.w.Event('touchmove',{bubbles:true,cancelable:true});
  Object.defineProperty(cancelMove,'touches',{value:[{clientY:135}]});
  reorder.list().dispatchEvent(cancelMove);
  reorder.list().dispatchEvent(new reorder.w.Event('touchcancel', { bubbles: true }));
  assert.equal(reorder.list().querySelectorAll('.placeholder,.dragging').length, 0, 'cancelled touch cleans up temporary cloned inputs');
  assert.deepEqual(Array.from(reorder.option().formvalue('subscription')), beforeTouch, 'cancelled touch retains original order');
  items()[0].focus();
  items()[0].dispatchEvent(new reorder.w.KeyboardEvent('keydown', { bubbles: true, keyCode: 46 }));
  assert.equal(items().length, 2, 'Delete on row removes a pair, not input text');
  console.log('PASS paired nested drop/save/reload order; touch edit guard/reorder/cleanup; reset; keyboard row deletion');
 } finally { reorder.w.close(); }
 const r = await fixture({ readonly: true });
 try {
  const before = Array.from(r.option().formvalue('subscription'));
  for (const input of r.list().querySelectorAll('input[type="text"],button')) assert(input.disabled, 'all visible editable controls are disabled');
  const item = r.list().querySelector('.item');
  item.dispatchEvent(new r.w.KeyboardEvent('keydown', { bubbles: true, keyCode: 46 }));
  r.list().querySelector('.add-item .cbi-button-add').click();
  assert.deepEqual(Array.from(r.option().formvalue('subscription')), before);
  assert.equal(item.draggable, false, 'readonly links cannot reorder via native drag/drop');
  await r.map.save(null, true); await r.map.reset();
  assert.deepEqual(Array.from(r.persisted.subscription.subscription_url), before);
  console.log('PASS readonly native controls, delete/add/drag protection and Map.save/reset retain URLs');
 } finally { r.w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
