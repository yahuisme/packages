'use strict';
// Native editor option help must describe its actual TLS cipher-suite values.
const assert = require('assert/strict');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const { walk } = require('./homeproxy-editor-parity.cjs');
(async () => {
  for (const name of ['node', 'server']) {
    const h = await pageBoot(name);
    try {
      const option = walk(h.map).find(o => o.option === 'tls_cipher_suites');
      assert(option, name + ' cipher suites exist');
      assert.equal(option.description, 'The cipher suites to use, in order of preference. If empty, the default will be used.');
      assert(option.keylist.every(value => value.startsWith('TLS_')), name + ' choices are cipher suites, not elliptic curves');
      console.log('PASS ' + name + ' TLS cipher-suite help matches native field choices');
    } finally { h.w.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
