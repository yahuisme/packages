const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, tick } = require('./helpers/test_connection_lifecycle.cjs');

const packageRoot = path.join(__dirname, '..', 'luci-app-homeproxy');
const pot = fs.readFileSync(path.join(packageRoot, 'po/templates/homeproxy.pot'), 'utf8');
const po = fs.readFileSync(path.join(packageRoot, 'po/zh_Hans/homeproxy.po'), 'utf8');
for (const message of [ 'Log updated.', 'Log unavailable.' ]) {
	assert(pot.includes(`msgid "${message}"`), `POT must include ${message}`);
	assert(po.includes(`msgid "${message}"`), `zh_Hans catalog must include ${message}`);
}

(async () => {
	const h = await boot();
	try {
		const cells = h.root().querySelector('table').rows[1].cells;
		for (const cell of [ cells[2], cells[3] ]) {
			const live = cell.firstElementChild;
			assert.equal(live.getAttribute('role'), 'status');
			assert.equal(live.getAttribute('aria-live'), 'polite');
			assert.equal(live.getAttribute('aria-atomic'), 'true');
		}

		await h.settle({ results: [{ site: 'baidu', result: true, latency_ms: 18 }] });
		assert.match(cells[2].textContent, /Success/);
		assert.match(cells[3].textContent, /18 ms/);

		h.mods.fs.read_direct = async () => 'first log line\nsecond log line with private diagnostic details';
		for (const poll of h.polls)
			await poll();
		const log = h.root().querySelector('textarea');
		const liveLog = log.nextElementSibling;
		assert.equal(liveLog.getAttribute('role'), 'status');
		assert.equal(liveLog.getAttribute('aria-live'), 'polite');
		assert.equal(liveLog.getAttribute('aria-atomic'), 'true');
		assert.notEqual(liveLog.className, 'hidden', 'live status must remain in the accessibility tree');
		assert.match(liveLog.getAttribute('style') || '', /clip|width:\s*1px/, 'live status must use theme-independent visual hiding');
		assert(!liveLog.textContent.includes(log.value), 'live region must not repeat the full log');
		assert.match(liveLog.textContent, /updated|empty|unavailable/i);

		const cases = [
			{ read: async () => '', expected: 'Log is empty.' },
			{ read: async () => { throw Object.assign(Error('missing'), { name: 'NotFoundError' }); }, expected: 'Log unavailable.' },
			{ read: async () => { throw Error('未知错误：磁盘故障'); }, expected: 'Log unavailable.' },
			{ read: async () => '中文日志内容', expected: 'Log updated.' }
		];
		for (const item of cases) {
			h.mods.fs.read_direct = item.read;
			for (const poll of h.polls)
				await poll();
			assert.equal(liveLog.textContent, item.expected);
		}
		console.log('PASS connectivity, latency and concise log updates expose polite atomic status regions');
	} finally {
		h.j.window.close();
	}
})().catch(err => {
	console.error(err);
	process.exitCode = 1;
});
