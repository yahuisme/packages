// Actual node view and native LuCI modal/save/reset; only RPC storage is private.
const assert = require('assert/strict');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');

(async () => {
 const h = await pageBoot('node');
 try {
  const { w, mods } = h;
  const originalPost = mods.request.post;
  const persisted = {};
  const notices = [];
  mods.ui.addNotification = (_title, body, severity) => notices.push({ text: body.textContent, severity });
  let finishAdd, pendingAdds = 0, rejectedAdds = 0, writes = 0;
  const gate = new Promise(resolve => { finishAdd = resolve; });
  async function until(condition, message) {
   const deadline = Date.now() + 5000;
   while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
   assert(condition(), message);
  }
  mods.request.post = async (url, req) => {
   const [, object, method, params] = req.params;
   const response = (value, code = 0) => ({ ok: true, status: 200, json: () => w.JSON.parse(JSON.stringify({jsonrpc:'2.0', id:req.id, result:[code,value]})) });
   if (object === 'uci' && method === 'get') {
    const result = await originalPost(url, req);
    const data = result.json();
    Object.assign(data.result[1].values, persisted);
    return response(data.result[1]);
   }
   if (object === 'uci' && method === 'add') {
    if (params.values.label === 'rejected') {
     rejectedAdds++;
     return response({}, 6);
    }
    pendingAdds++;
    await gate;
    const name = 'imported' + Object.keys(persisted).length;
    persisted[name] = { '.name': name, '.type': params.type, ...params.values };
    return response({ section: name });
   }
   if (object === 'uci' && method === 'set') {
    writes++;
    if (persisted[params.section]) Object.assign(persisted[params.section], params.values);
    return response({});
   }
   if (object === 'uci' && method === 'order') return response({});
   return originalPost(url, req);
  };
  async function openImport() {
   const button = [...h.root().querySelectorAll('button')].find(b => b.textContent === 'Import share links');
   assert(button);
   button.click(); await tick();
   const modal = w.document.querySelector('.modal');
   const input = modal.querySelector('textarea');
   const submit = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Import');
   assert(input && submit);
   return (value) => {
    input.value = value;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    submit.click();
   };
  }
  const inlineError = () => {
   const el = w.document.querySelector('.modal [role="alert"]');
   return el && w.getComputedStyle(el).display !== 'none' ? el.textContent : '';
  };
  const submit = await openImport();
  submit([
   'trojan://secret@example.com:443?ech=AP%2BA#binary-ech',
   'vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&ech=udp://resolver.example:5353#query-ech'
  ].join('\n'));
  await until(() => pendingAdds === 2, 'both native adds reached the held RPC transport');
  assert.deepEqual(notices, [], 'import must not announce success before UCI responds');
  finishAdd();
  await until(() => !w.document.body.classList.contains('modal-overlay-active'), 'native import completes and closes modal');
  assert.match(notices[0].text, /Successfully imported 2 nodes of total 2/);
  const nodes = Object.values(persisted);
  assert.equal(nodes.length, 2);
  assert.deepEqual(Array.from(nodes.find(n => n.label === 'binary-ech').tls_ech_config),
   ['-----BEGIN ECH CONFIGS-----', 'AP+A', '-----END ECH CONFIGS-----']);
  assert.equal(nodes.find(n => n.label === 'query-ech').tls_ech_query_server, 'udp://resolver.example:5353');
  assert(h.root().textContent.includes('binary-ech'));
  assert(h.root().textContent.includes('query-ech'));
  const submitAgain = await openImport();
  mods.uci.set('homeproxy', 'n1', 'label', 'Unsaved label');
  const beforeInvalid = writes;
  submitAgain('not a share link');
  await tick();
  assert.match(inlineError() || '', /No valid share link found/, 'validation is visible in the active modal');
  assert.equal(writes, beforeInvalid, 'an all-invalid submission must not save unrelated UCI edits');
  assert(w.document.body.classList.contains('modal-overlay-active'), 'invalid input remains editable');
  mods.uci.set('homeproxy', 'n1', 'label', '测试节点');
  submitAgain('trojan://fixture@example.com:443#rejected');
  await until(() => /Import could not be confirmed/.test(inlineError() || ''), 'native add rejection is visible in the modal');
  assert.equal(rejectedAdds, 1);
  assert.equal(notices.filter(n => n.text.includes('Successfully imported')).length, 1);
  assert.equal(Object.keys(persisted).length, 2, 'rejected add did not persist');
  assert(!mods.uci.sections('homeproxy', 'node').some(node => node.label === 'rejected'), 'rejected local draft cannot leak into a later save');
  assert(!h.root().textContent.includes('rejected'));
  w.document.querySelector('.modal .right button').click();
  await openImport();
  assert.match(inlineError(), /Import could not be confirmed/, 'reopening the dialog does not clear an uncertain write result');
  assert.equal(w.getComputedStyle([...w.document.querySelectorAll('.modal button')].find(b => b.textContent === 'Import')).display, 'none');
 } finally { h.w.close(); }
})().then(async () => {
 const h = await pageBoot('node');
 try {
  const { w, mods } = h;
  const post = mods.request.post;
  let adds = 0;
  const saved = { '.name': 'saved', '.type': 'node' };
  mods.request.post = async (url, req) => {
   const [, object, method, params] = req.params;
   if (object === 'uci' && method === 'add') { adds++; Object.assign(saved, params.values); }
   const response = await post(url, req);
   const body = response.json();
   if (object === 'uci' && method === 'add') body.result[1] = { section: 'saved' };
   if (object === 'uci' && method === 'get' && adds) body.result[1].values.saved = saved;
   return { ...response, json: () => body };
  };
  const open = () => [...h.root().querySelectorAll('button')].find(b => b.textContent === 'Import share links').click();
  const action = text => [...w.document.querySelectorAll('.modal button')].find(b => b.textContent === text);
  async function until(condition, message) {
   const deadline = Date.now() + 5000;
   while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
   assert(condition(), message);
  }
  const reset = h.map.reset.bind(h.map);
  let resetAttempts = 0;
  h.map.reset = () => {
   if (++resetAttempts === 1) return Promise.reject(Error('fixture render failed'));
   return reset();
  };
  open(); await tick();
  const input = w.document.querySelector('.modal textarea');
  input.value = 'trojan://fixture@example.com:443#saved-before-refresh';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  action('Import').click();
  await until(() => /saved.*refresh/i.test(w.document.querySelector('.modal [role="alert"]')?.textContent || ''), 'confirmed save with refresh failure has distinct feedback');
  action('Cancel').click();
  open(); await tick();
  const retry = action('Retry');
  assert(retry && w.document.querySelector('.modal textarea').disabled);
  retry.click();
  await until(() => !w.document.body.classList.contains('modal-overlay-active'), 'refresh-only retry closes the modal');
  assert.equal(resetAttempts, 2);
  assert.equal(adds, 1, 'refresh never resends a write');
  assert(h.root().textContent.includes('saved-before-refresh'));
  console.log('PASS native import waits for save, shows inline failures and retries refresh without adding duplicates');
 } finally { h.w.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
