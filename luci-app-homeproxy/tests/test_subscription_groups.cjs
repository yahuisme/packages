// Production helper and full views in native LuCI/jsdom; private UCI transport.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pageBoot, tick } = require('../../tests/helpers/test_page_lifecycle.cjs');
const md5 = value => crypto.createHash('md5').update(value).digest('hex');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/homeproxy.js'), 'utf8');
let urls;
// Only trusted repository source is executed; input values remain arguments.
const hp = new Function('baseclass', 'rpc', 'form', 'uci', '_', source)(
  { extend: x => x }, { declare: () => () => {} },
  { DynamicList: { extend: x => x } }, { get: () => urls }, x => x
);
const cases = [
  [undefined, []],
  ['https://EXAMPLE.invalid/sub#%E4%B8%AD%E6%96%87%F0%9F%9A%80', [{ hash: md5('https://EXAMPLE.invalid/sub'), title: '中文🚀' }]],
  [['https://one.invalid/sub#First', 'https://one.invalid/sub#Second',
    'https://TWO.invalid/sub', 'https://three.invalid/sub#%ZZ', 'invalid subscription'],
   [{ hash: md5('https://one.invalid/sub'), title: 'First' },
    { hash: md5('https://TWO.invalid/sub'), title: 'two.invalid' },
    { hash: md5('https://three.invalid/sub'), title: '%ZZ' },
    { hash: md5('invalid subscription'), title: 'invalid subscription' }]]
];
for (const [input, expected] of cases) {
  urls = input;
  assert.deepEqual(hp.getSubscriptionGroups('homeproxy'), expected);
}
urls = ['https://one.invalid/sub#Changed'];
assert.equal(hp.getSubscriptionGroups('homeproxy')[0].title, 'Changed', 'never cache edited titles');
console.log('PASS subscription groups: absent/scalar/list, UTF-8, dedup, hostname, malformed fragment/URL, fresh title');

function options(parent, name, result = []) {
  for (const child of parent.children || []) {
    if (child.option === name) result.push(child);
    options(child, name, result);
    if (child.subsection) options(child.subsection, name, result);
  }
  return result;
}
const watchdog = setTimeout(() => { console.error('subscription group UI stalled'); process.exit(1); }, 20000);
(async () => {
  const h = await pageBoot('client');
  try {
    const url = 'https://example.invalid/sub';
    const group = '<b>订阅🚀</b>';
    const label = '<img src=x onerror="evil()"> & node';
    h.mods.uci.set('homeproxy', 'subscription', 'subscription_url', [url + '#' + encodeURIComponent(group)]);
    h.mods.uci.set('homeproxy', 'n1', 'grouphash', md5(url));
    h.mods.uci.set('homeproxy', 'n1', 'label', label);
    h.root().remove();
    await tick();
    const root = await h.app.render(['homeproxy', await h.mods.homeproxy.getBuiltinFeatures(), { hosts: {} }]);
    h.w.document.querySelector('#view').append(root);
    await tick();
    const mapRoot = root.matches?.('#cbi-homeproxy') ? root : root.querySelector('#cbi-homeproxy');
    const map = h.mods.dom.findClassInstance(mapRoot);
    assert(map, 'native Map instance found inside view wrapper');
    const expected = `<${group}> [socks] ${label}`;
    for (const name of ['main_node', 'main_urltest_nodes', 'node']) {
      const option = options(map, name).find(o => Array.from(o.keylist || []).includes('n1'));
      assert(option, name + ' native option exists');
      const value = option.vallist[option.keylist.indexOf('n1')];
      assert.equal(value.nodeType, 1, name + ' uses a literal DOM label');
      assert.equal(value.textContent, expected, name + ' includes group and protocol');
      assert.equal(value.querySelectorAll('b,img,script').length, 0, name + ' rejects HTML interpretation');
    }
    assert.equal(root.querySelectorAll('img[onerror]').length, 0);
    h.setHandler((object, method) => method === 'current_node_get' ?
      { mode: 'urltest', active: { id: 'n1', label, type: 'socks' } } : undefined);
    await Promise.all(h.polls().map(f => f()));
    await tick();
    assert(root.querySelector('#service_status').textContent.includes('URLTest: ' + expected));
    assert.equal(root.querySelector('#service_status').querySelectorAll('b,img,script').length, 0);
    // Retain user configuration controls; apply the same uint16 bound in native LuCI.
    assert.equal(options(map, 'main_urltest_interval')[0].placeholder, '120');
    const datatype = options(map, 'main_urltest_tolerance')[0].datatype;
    assert.equal(datatype, 'and(uinteger,range(0,65535))');
    const input = h.w.document.createElement('input');
    root.append(input);
    const validator = h.mods.validation.create(input, datatype, true);
    for (const [value, valid] of [['0', true], ['65535', true], ['60', true],
                                  ['-1', false], ['65536', false], ['1.5', false], ['1e3', false]]) {
      input.value = value;
      assert.equal(validator.validate(), valid, 'native tolerance validation: ' + value);
    }
    input.remove();
    console.log('PASS native client main/URLTest/diversion choices and current protocol/group; literal labels; retained controls and uint16 datatype');
  } finally { h.w.close(); }
  const n = await pageBoot('node');
  try {
    n.mods.uci.set('homeproxy', 'subscription', 'subscription_url',
      'https://example.invalid/sub#' + encodeURIComponent('Scalar 中文🚀'));
    n.root().remove();
    await tick();
    const root = await n.app.render(['homeproxy', await n.mods.homeproxy.getBuiltinFeatures()]);
    n.w.document.querySelector('#view').append(root);
    await tick();
    assert(root.querySelector('.hp-node-source select').textContent.includes('Scalar 中文🚀'), 'node sources accept a scalar subscription URL');
    console.log('PASS native node view uses shared group parser for scalar Unicode subscription URLs');
  } finally { n.w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
