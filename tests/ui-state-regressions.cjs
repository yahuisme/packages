// Native LuCI Map/DOM/UI/RPC with private transport fixtures; no router or browser.
const assert = require('assert/strict');
const { boot, tick } = require('./helpers/test_connection_lifecycle.cjs');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');

async function until(check, message) {
	const deadline = performance.now() + 3000;
	while (!check()) {
		assert(performance.now() < deadline, message);
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

async function nodeTabs() {
	const h = await pageBoot('node');
	try {
		const actions = h.w.document.querySelector('.cbi-page-actions');
		const bulk = () => actions.querySelector('.hp-bulk-latency-test');
		await until(bulk, 'native footer receives bulk button');
		const select = async (tab, visible) => {
			h.root().querySelector('.cbi-tabmenu li[data-tab' + tab + '] a').click();
			await tick();
			assert.equal(bulk().style.display, visible ? '' : 'none', 'bulk visibility follows active tab');
		};
		await select('^="sub_"', true);
		await select('="subscription"', false);
		for (let i = 0; i < 3; i++) {
			await h.mods.dom.findClassInstance(h.root()).reset();
			await select('^="sub_"', true);
			await select('="subscription"', false);
			assert.equal(actions.querySelectorAll('.hp-bulk-latency-test').length, 1);
		}
		for (let i = 0; i < 2; i++) {
			const old = h.root(), oldButton = bulk();
			old.remove();
			await tick();
			assert.equal(bulk(), null, 'leaving removes the old footer button');
			// UCI is already loaded; native load can return [] on reentry.
			const data = await h.app.load();
			data[0] = 'homeproxy';
			const fresh = await h.app.render(data);
			h.w.document.querySelector('#view').append(fresh);
			await until(bulk, 'reentry attaches fresh footer button');
			assert.notEqual(bulk(), oldButton);
			await select('^="sub_"', true);
			old.querySelector('.cbi-tabmenu').setAttribute('class', 'detached-menu');
			await tick();
			assert.equal(bulk().style.display, '', 'detached menu cannot affect current footer');
			await select('="subscription"', false);
		}
		console.log('PASS node tabs: native footer, three resets, two reentries, detached-menu isolation');
	} finally { h.w.close(); }
}

function response(h, req, value, code = 0) {
	return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({
		jsonrpc: '2.0', id: req.id, result: [code, value]
	})) };
}

async function resourceStatus() {
	for (const initial of [undefined, true, false]) {
		const resources = initial === undefined ? [] : [{ type: 'dashboard', installed: initial, version: initial ? '20260901000000' : null }];
		const h = await boot(resources);
		try {
			await h.settle({ results: [] });
			const original = h.mods.request.post;
			let mode = 'transport', writes = 0, reads = 0;
			h.mods.request.post = async (url, req) => {
				if (['dashboard_manage', 'resources_update'].includes(req.params[2])) {
					writes++;
					return response(h, req, { status: 3 });
				}
				if (req.params[2] !== 'resources_get') return original(url, req);
				reads++;
				if (mode === 'transport') throw Error('<img src=x onerror=alert(1)>');
				if (mode === 'ubus') return response(h, req, {}, 6);
				if (mode === 'malformed') return response(h, req, { resources: {} });
				if (mode === 'missing') return response(h, req, { resources: [] });
				return response(h, req, { resources: [{ type: 'dashboard', installed: mode === 'installed', version: mode === 'installed' ? '20260902000000' : null }] });
			};
			const row = () => [...h.root().querySelector('.hp-resources table').rows].at(-1);
			const labels = () => [...row().querySelectorAll('button')].map(b => b.textContent);
			const unknown = () => {
				assert.match(row().textContent, /Status unavailable/);
				assert.doesNotMatch(row().textContent, /Not installed|2026090/);
				assert.deepEqual(labels(), ['Retry']);
				assert.equal(row().querySelector('img'), null);
			};
			if (initial === undefined) unknown();
			else assert.deepEqual(labels(), initial ? ['Update', 'Remove'] : ['Download']);
			const map = h.mods.dom.findClassInstance(h.root());
			for (const failure of ['transport', 'ubus', 'malformed', 'missing']) {
				mode = failure;
				await map.reset(); await tick(); unknown();
				assert.equal(writes, 0, 'status reads must not mutate resources');
				mode = 'installed';
				const before = reads;
				row().querySelector('button').click();
				await until(() => labels().includes('Remove'), 'retry recovers installed dashboard');
				assert.equal(reads, before + 1);
				assert.match(row().textContent, /20260902000000/);
			}
			mode = 'absent'; await map.reset();
			assert.match(row().textContent, /Not installed/);
			assert.deepEqual(labels(), ['Download']);
			mode = 'transport';
			h.button('Update resources').click();
			await until(() => /Status unavailable/.test(row().textContent), 'write refresh can fail safely');
			await until(() => !row().querySelector('button').disabled, 'retry released after resource action');
			unknown(); assert.equal(writes, 1);
			mode = 'absent'; row().querySelector('button').click();
			await until(() => labels().includes('Download'), 'retry recovers absent dashboard');
			assert(!row().querySelector('button').disabled);
		} finally { h.w.close(); }
	}
	console.log('PASS resource status: initial unknown/installed/absent, transport/ubus/malformed/missing, read-only retry, recovery and busy release');
}

async function logClean() {
	const fs = require('fs'), path = require('path');
	const translations = {};
	const po = fs.readFileSync(path.join(__dirname, '../luci-app-homeproxy/po/zh_Hans/homeproxy.po'), 'utf8');
	for (const match of po.matchAll(/^msgid "([^"\n]*)"\nmsgstr "([^"\n]*)"/gm))
		if (match[2]) translations[match[1]] = match[2];
	const h = await boot([], translations);
	try {
		await h.settle({ results: [] });
		const original = h.mods.request.post, notices = [];
		let pending, calls = 0, contents = 'retained log contents';
		h.mods.fs.read_direct = async () => contents;
		h.mods.ui.addNotification = (_title, message, kind) => {
			notices.push({ message, kind });
			h.w.document.body.append(message);
		};
		h.mods.request.post = async (url, req) => {
			if (req.params[2] !== 'log_clean') return original(url, req);
			calls++;
			const value = await new Promise((resolve, reject) => { pending = { resolve, reject }; });
			return response(h, req, value);
		};
		const clean = () => h.button('Clean log');
		const textarea = () => h.root().querySelector('textarea');
		for (const poll of h.polls) await poll();
		for (const mode of ['business', 'transport', 'malformed', 'truthy', 'success']) {
			const before = notices.length, count = calls;
			clean().click();
			await until(() => calls === count + 1, 'log clean RPC starts');
			assert(clean().disabled, 'native handler disables button while pending');
			clean().click(); await tick();
			assert.equal(calls, count + 1, 'disabled button does not repeat request');
			assert.equal(textarea().value, contents, 'no optimistic clearing');
			if (mode === 'transport') pending.reject(Error('<img src=x onerror=alert(1)>'));
			else pending.resolve(mode === 'success' ? { result: true } :
				mode === 'malformed' ? {} : mode === 'truthy' ? { result: 'true' } :
				{ result: false, error: 'failed to clean log file <img src=x onerror=alert(1)>' });
			await until(() => !clean().disabled, 'clean button releases for retry');
			assert.equal(notices.length, before + (mode === 'success' ? 0 : 1), 'failed clear must notify exactly once');
			assert.equal(textarea().value, contents, 'retain log until poll confirms fresh bytes');
			if (mode !== 'success') {
				assert.equal(notices.at(-1).kind, 'error');
				assert.equal(notices.at(-1).message.textContent, '日志清除失败');
				assert.equal(notices.at(-1).message.querySelector('img'), null);
			}
		}
		contents = '';
		for (const poll of h.polls) await poll();
		assert.equal(textarea().value, h.w._('Log is empty.'));
		assert.equal(calls, 5);
		console.log('PASS log clear: business/transport/malformed/truthy failures, concise Chinese notification, no untrusted HTML, success and retry button state');
	} finally { h.w.close(); }
}

const tests = { node: nodeTabs, resources: resourceStatus, logs: logClean };
const watchdog = setTimeout(() => { console.error('FAIL UI-state watchdog'); process.exit(1); }, 30000);
(async () => {
	const selected = process.argv[2];
	if (selected) { assert(tests[selected], 'known test selector'); await tests[selected](); }
	else for (const test of Object.values(tests)) await test();
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
