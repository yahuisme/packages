// Actual node view and native LuCI modal/save/reset; only RPC storage is private.
const assert = require('assert/strict');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');

(async () => {
 const h = await pageBoot('node');
 try {
  const { w, mods } = h;
  const originalPost = mods.request.post;
  const persisted = {};
  mods.request.post = async (url, req) => {
   const [, object, method, params] = req.params;
   const response = value => ({ ok: true, status: 200, json: () => w.JSON.parse(JSON.stringify({jsonrpc:'2.0', id:req.id, result:[0,value]})) });
   if (object === 'uci' && method === 'get') {
    const result = await originalPost(url, req);
    const data = result.json();
    Object.assign(data.result[1].values, persisted);
    return response(data.result[1]);
   }
   if (object === 'uci' && method === 'add') {
    const name = 'imported' + Object.keys(persisted).length;
    persisted[name] = { '.name': name, '.type': params.type, ...params.values };
    return response({ section: name });
   }
   if (object === 'uci' && method === 'set') {
    if (persisted[params.section]) Object.assign(persisted[params.section], params.values);
    return response({});
   }
   if (object === 'uci' && method === 'order') return response({});
   return originalPost(url, req);
  };
  const button = [...h.root().querySelectorAll('button')].find(b => b.textContent === 'Import share links');
  assert(button);
  button.click(); await tick();
  const modal = w.document.querySelector('.modal');
  const input = modal.querySelector('textarea');
  assert(input);
  input.value = [
   'trojan://secret@example.com:443?ech=AP%2BA#binary-ech',
   'vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&ech=udp://resolver.example:5353#query-ech'
  ].join('\n');
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  [...modal.querySelectorAll('button')].find(b => b.textContent === 'Import').click();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && w.document.body.classList.contains('modal-overlay-active'))
   await new Promise(resolve => setTimeout(resolve, 10));
  assert(!w.document.body.classList.contains('modal-overlay-active'), 'native import completes and closes modal');
  const nodes = Object.values(persisted);
  assert.equal(nodes.length, 2);
  assert.deepEqual(Array.from(nodes.find(n => n.label === 'binary-ech').tls_ech_config),
   ['-----BEGIN ECH CONFIGS-----', 'AP+A', '-----END ECH CONFIGS-----']);
  assert.equal(nodes.find(n => n.label === 'query-ech').tls_ech_query_server, 'udp://resolver.example:5353');
  assert(h.root().textContent.includes('binary-ech'));
  assert(h.root().textContent.includes('query-ech'));
  console.log('PASS native share-link modal imports binary/query ECH through UCI save, reload and Map.reset');
 } finally { h.w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
