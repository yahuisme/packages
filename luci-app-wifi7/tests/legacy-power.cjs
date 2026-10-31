const assert = require('node:assert/strict');
const {boot} = require('./integration.cjs');
const pause = () => new Promise(r => setTimeout(r, 40));
(async () => { const h = await boot(); try {
 h.db().staged.radio0.txpower = '33'; h.db().committed.radio0.txpower = '33';
 h.mods.uci.unload('wireless'); await h.mods.uci.load('wireless');
 const n = await h.mods.app.render(await h.mods.app.load()); h.node.replaceWith(n); await pause();
 const power = n.querySelector('#wifi7-radio0-power'), edit = n.querySelector('#wifi7-radio1-power');
 assert.equal(power.value, '33'); assert.equal(power.max, '30');
 assert(n.textContent.includes('Existing power outside 0–30 dBm is retained unchanged. Use Wireless to manage it, or enter a new value within this range.'));
 const save = async () => { n.querySelector('.cbi-button-apply').click(); await pause(); for(let i=0;i<150 && n.querySelector('.cbi-button-apply').disabled;i++) await pause(); };
 edit.value = '24'; await save();
 assert.equal(h.db().committed.radio1.txpower, '24', 'unchanged legacy 33 must not block unrelated changes');
 assert.equal(h.db().committed.radio0.txpower, '33');
 for (const value of ['31', '-1', '1.5']) {
  power.value = value; const count = h.writes().length;
  n.querySelector('.cbi-button-apply').click(); await pause();
  assert.equal(h.writes().length, count, 'new invalid power ' + value + ' rejected');
 }
 power.value = '0'; await save();
 assert.equal(h.db().committed.radio0.txpower, '0');
 assert(!n.textContent.includes('Existing power outside 0–30 dBm is retained unchanged.'),'legacy notice clears after bounded replacement');
 console.log('PASS unchanged legacy power retained; all new values remain bounded 0–30 integer');
} finally {h.w.close();} })().catch(e => {console.error(e);process.exitCode=1;});
