// Complete production helper; UCI transport is private and no router is touched.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/homeproxy.js'), 'utf8');
const values = {
  config: { main_node: 'selected', main_urltest_nodes: ['selected'] },
  subscription: { subscription_url: ['https://example.invalid/😀?token=🚀#label'] },
  selected: { '.name': 'selected', '.type': 'node', label: 'selected',
    grouphash: crypto.createHash('md5').update('https://example.invalid/😀?token=🚀').digest('hex') }
};
const removed = [];
const uci = {
  get: (c, s, o) => values[s]?.[o],
  set: (c, s, o, v) => { values[s][o] = v; },
  remove: (c, s) => { removed.push(s); delete values[s]; },
  sections: (c, type, cb) => Object.values(values).filter(s => s['.type'] === type).forEach(cb)
};
// Execute only the repository's trusted module source, never user-provided code.
const hp = new Function('baseclass', 'rpc', 'form', 'uci', '_', source)(
  { extend: x => x }, { declare: () => () => {} },
  { DynamicList: { extend: x => x } }, uci, x => x
);
hp.reconcileUrltestNodes('homeproxy');
assert.deepEqual(removed, [], 'Unicode subscription URLs must not orphan backend-hashed nodes');
assert.equal(values.config.main_node, 'selected');
assert.deepEqual(values.config.main_urltest_nodes, ['selected']);
for (const input of ['', 'abc', 'https://example.invalid/测试',
                     'https://example.invalid/😀?token=🚀', 'a'.repeat(64), '😀'.repeat(64),
                     '\u{10000}\u{10ffff}', '\ud800', '\udfff']) {
  assert.equal(hp.calcStringMD5(input), crypto.createHash('md5').update(input).digest('hex'), input);
}
console.log('PASS UTF-8 MD5 and subscription selection preservation with supplementary characters');

// Native Map.save reaches the same cleanup helper before uci.save.
const watchdog = setTimeout(() => { console.error('Unicode Map.save stalled'); process.exit(1); }, 15000);
(async () => {
  const { pageBoot, tick } = require('../../tests/helpers/test_page_lifecycle.cjs');
  const h = await pageBoot('node');
  try {
    const url = 'https://example.invalid/😀?token=🚀';
    const group = crypto.createHash('md5').update(url).digest('hex');
    h.mods.uci.set('homeproxy', 'subscription', 'subscription_url', [url + '#Unicode']);
    h.mods.uci.set('homeproxy', 'n1', 'grouphash', group);
    h.mods.uci.set('homeproxy', 'config', 'main_urltest_nodes', ['n1']);
    const saved = JSON.parse(JSON.stringify(Object.fromEntries(
      h.mods.uci.sections('homeproxy').map(section => [section['.name'], section]))));
    const post = h.mods.request.post;
    h.mods.request.post = async (url, req) => {
      const [, object, method, params] = req.params;
      if (object !== 'uci' || !['get', 'set', 'delete'].includes(method))
        return post(url, req);
      let value = {};
      if (method === 'get') value = { values: saved };
      else if (method === 'set') Object.assign(saved[params.section], params.values);
      else if (params.options) params.options.forEach(option => delete saved[params.section][option]);
      else delete saved[params.section];
      return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({
        jsonrpc: '2.0', id: req.id, result: [0, value]
      })) };
    };
    await h.map.load();
    await h.map.reset();
    await tick();
    await h.map.save(null, true);
    assert.equal(h.mods.uci.get('homeproxy', 'n1', 'grouphash'), group);
    assert.equal(h.mods.uci.get('homeproxy', 'config', 'main_node'), 'n1');
    assert.deepEqual(Array.from(h.mods.uci.get('homeproxy', 'config', 'main_urltest_nodes')), ['n1']);
    console.log('PASS native LuCI Map.save preserves backend-hashed Unicode subscription nodes and references');
  } finally { h.w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
