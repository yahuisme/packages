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
		await select('="node"', true);
		await select('="subscription"', false);
		for (let i = 0; i < 3; i++) {
			await h.mods.dom.findClassInstance(h.root()).reset();
			await select('="node"', true);
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
			await select('="node"', true);
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
		const h = await pageBoot('client', {}, {resources});
		h.button = text => [...h.root().querySelectorAll('button')].find(b => b.textContent === h.w._(text));
		try {
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
				if (mode === 'null') return response(h, req, null);
				if (mode === 'wrong-type') return response(h, req, []);
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
			for (const failure of ['transport', 'ubus', 'null', 'wrong-type', 'malformed', 'missing']) {
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
			h.button('Download').click();
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
		const map=h.mods.dom.findClassInstance(h.root());
		clean().click();await until(()=>calls===6,'clear starts before reset');
		await map.reset();await tick();
		assert(clean().disabled,'replacement clean button retains the shared lock');
		clean().click();await tick();assert.equal(calls,6,'reset cannot start a duplicate clear');
		pending.resolve({result:true});await until(()=>!clean().disabled,'replacement button releases after clear');
		console.log('PASS log clear: business/transport/malformed/truthy failures, concise Chinese notification, no untrusted HTML, success, reset single-flight and retry button state');
	} finally { h.w.close(); }
}

async function logClearRace() {
	for (const scenario of ['same', 'reset', 'reentry', 'reset-read', 'reentry-read', 'switch-back', 'other-source']) {
		const h = await boot();
		try {
			await h.settle({results: []});
			const area = () => h.root().querySelector('textarea');
			const source = () => h.root().querySelector('[aria-label="Log source"]');
			const choose = value => { source().value=value; source().dispatchEvent(new h.w.Event('change',{bubbles:true})); };
			h.mods.fs.read_direct = async () => 'confirmed before clear';
			for (const poll of h.polls) await poll();
			const reads = [], clears = [], original = h.mods.request.post;
			h.mods.fs.read_direct = path => new Promise((resolve,reject)=>reads.push({path,resolve,reject}));
			h.mods.request.post = async (url,req) => {
				if (req.params[2] !== 'log_clean') return original(url,req);
				return response(h,req,await new Promise(resolve=>clears.push({source:req.params[3].type,resolve})));
			};
			const replacementRead = scenario.endsWith('-read');
			let pendingRead;
			if (!replacementRead) {
				pendingRead = Promise.all(h.polls.map(poll=>poll()));
				await until(()=>reads.length===1,'pre-clear read starts');
			}
			h.button('Clean log').click();
			await until(()=>clears.length===1,'native clear RPC starts');
			assert.equal(clears[0].source,'sing-box-c','clear captures invocation source');
			assert.equal(area().value,'confirmed before clear','no optimistic clearing');
			const old=area();
			if (scenario.startsWith('reset')) await h.mods.dom.findClassInstance(h.root()).reset();
			if (scenario.startsWith('reentry')) {
				h.root().remove();await tick();
				h.w.document.querySelector('#view').append(await h.app.render());
			}
			if (scenario==='switch-back' || scenario==='other-source') choose('sing-box-s');
			if (scenario==='switch-back') choose('sing-box-c');
			await tick();
			if (replacementRead) {
				pendingRead = Promise.all(h.polls.map(poll=>poll()));
				await until(()=>reads.length===1,'replacement viewer starts read before clear completes');
			}
			assert(h.button('Clean log').disabled,'global clear lock survives source/reset/reentry');
			h.button('Clean log').click();await tick();assert.equal(clears.length,1);
			const oldText=old.value, before=area().value;
			clears[0].resolve({result:true});
			await until(()=>!h.button('Clean log').disabled,'clear releases shared lock');
			assert.equal(area().value,before,'successful clear awaits confirmed bytes');
			assert.equal(reads.length,1,'pre-clear read remains single flight');
			reads[0].resolve('STALE PRE-CLEAR BYTES');await pendingRead;
			assert.equal(area().value,before,'pre-clear reply cannot paint after successful clear');
			assert.equal(old.value,oldText,'invalidated or detached textarea stays untouched');
			await until(()=>reads.length===2,'completion refreshes attached viewer without a poll tick');
			assert.equal(reads[1].path,'/var/run/homeproxy/'+source().value+'.log');
			reads[1].resolve(scenario==='other-source'?'fresh server':'');
			await until(()=>area().value===(scenario==='other-source'?'fresh server':h.w._('Log is empty.')),'post-clear bytes are displayed');
			assert.equal(reads.length,2,'exactly one catch-up read');
			// No outstanding read: success must request fresh bytes immediately.
			const count=reads.length, clearCount=clears.length, retained=area().value;
			h.button('Clean log').click();await until(()=>clears.length===clearCount+1,'second native clear starts');
			clears.at(-1).resolve({result:true});
			await until(()=>reads.length===count+1,'successful clear refreshes without polling');
			assert.equal(area().value,retained,'no optimistic empty on immediate refresh');
			reads.at(-1).resolve('new after clear');await until(()=>area().value==='new after clear','fresh post-clear data');
			console.log('PASS native log clear race: '+scenario+'; stale read rejected, captured source, single-flight, attached catch-up, confirmed bytes');
		} finally {h.w.close();}
	}
}

const tests = { node: nodeTabs, resources: resourceStatus, logs: logClean, 'log-race': logClearRace };
const watchdog = setTimeout(() => { console.error('FAIL UI-state watchdog'); process.exit(1); }, 30000);
(async () => {
	const selected = process.argv[2];
	if (selected) { assert(tests[selected], 'known test selector'); await tests[selected](); }
	else for (const test of Object.values(tests)) await test();
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
