const assert = require('assert/strict');
// Never inherit another checkout from an audit shell.
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const watchdog = setTimeout(() => { console.error('FAIL subscription UI stalled'); process.exit(1); }, 30000);
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');

const UPDATE = 'Save and update subscriptions';
const REMOVE = 'Remove 1 nodes';

function deferred() {
	let resolve, reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

async function settleUntil(predicate, message) {
	for (let i = 0; i < 80; i++) {
		await tick();
		if (predicate())
			return;
	}
	assert.fail(message);
}

async function fixture() {
	const h = await pageBoot('node');
	const calls = [];
	const notices = [];
	const beforeReset = [];
	const mutations = [];
	const gates = { save: null, apply: null, confirm: null, exec: null };
	const failures = { save: null, apply: null, confirm: null, exec: null };
	const originalPost = h.mods.request.post;
	const originalTimeout = h.w.setTimeout;
	const nativeRemove = h.mods.uci.remove.bind(h.mods.uci);
	const nativeSet = h.mods.uci.set.bind(h.mods.uci);
	h.mods.uci.remove = (...args) => { mutations.push([ 'remove', ...args ]); return nativeRemove(...args); };
	h.mods.uci.set = (...args) => { mutations.push([ 'set', ...args ]); return nativeSet(...args); };

	h.mods.request.post = async (url, req) => {
		const [, object, method] = req.params;
		if (object === 'uci' && (method === 'apply' || method === 'confirm')) {
			calls.push(method);
			if (gates[method])
				await gates[method].promise;
			if (failures[method] === 'reject')
				throw Error(`injected ${method} transport failure`);
			if (failures[method] === 'status' || failures[method] === 'no-data')
				return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({
					jsonrpc: '2.0', id: req.id, result: [ failures[method] === 'no-data' ? 5 : 6 ]
				})) };
			return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({
				jsonrpc: '2.0', id: req.id, result: [ 0, failures[method] === 'payload' ? 6 : 0 ]
			})) };
		}
		return originalPost(url, req);
	};
	h.mods.fs.exec = async path => {
		calls.push('exec');
		assert.equal(path, '/etc/homeproxy/scripts/update_subscriptions.sh');
		if (gates.exec)
			await gates.exec.promise;
		if (failures.exec === 'status')
			return { code: 1, stderr: 'injected updater status' };
		if (failures.exec)
			throw failures.exec;
		return { code: 0, stdout: '', stderr: '' };
	};
	const nativeNotification = Object.getPrototypeOf(h.mods.ui).addNotification;
	h.mods.ui.addNotification = (title, node, level) => {
		const el = nativeNotification.call(h.mods.ui, title, node, level);
		notices.push({ text: node.textContent, level, el });
		return el;
	};
	h.mods.ui.changes.setIndicator = n => { if (calls.at(-1) !== 'save' && calls.at(-1) !== 'reset') calls.push(`indicator:${n}`); };
	h.w.console.error = () => {};
	h.w.setTimeout = (fn, ms, ...args) => ms === 1000 ? originalTimeout(fn, 0, ...args) : originalTimeout(fn, ms, ...args);

	const map = h.map;
	const nativeSave = map.save;
	map.save = async function(cb, silent) {
		calls.push('save');
		if (gates.save) await gates.save.promise;
		if (failures.save) throw Error('injected save failure');
		return nativeSave.call(this, cb, silent).then(value => {
			calls.push('saved');
			return value;
		});
	};
	const nativeReset = map.reset;
	map.reset = function() {
		calls.push('reset');
		beforeReset.push({ main: h.mods.uci.get('homeproxy', 'config', 'main_node') });
		return nativeReset.call(this);
	};

	const button = text => [...h.root().querySelectorAll('button')].find(el => el.textContent.trim() === text);
	const updateButton = button(UPDATE);
	assert(updateButton, 'current node.js update button must render through native form.Button');
	const updateOption = h.mods.dom.findClassInstance(updateButton.closest('.cbi-value'));
	assert(updateOption, 'native update form.Button option must be discoverable');
	const removeButton = button('No subscription node');
	const removeOption = h.mods.dom.findClassInstance(removeButton.closest('.cbi-value'));
	let pending;
	const nativeClick = updateOption.onclick;
	updateOption.onclick = function(...args) {
		assert.equal(this, updateOption, 'native Button binds option, not DOM');
		return pending = nativeClick.apply(this, args);
	};
	return { ...h, calls, notices, beforeReset, mutations, gates, failures, map, button, updateOption, removeButton, removeOption,
		close: () => h.w.close(),
		update: () => { button(UPDATE)?.click(); return pending; } };
}

(async () => {
	let h;
	h = await fixture();
	try {
		h.failures.apply = 'no-data';
		await h.update();
		assert(h.calls.includes('exec'), 'uci/apply code 5 must still update unchanged subscriptions');
		assert(!h.calls.includes('confirm'), 'no-data apply must not confirm a nonexistent rollback');
		assert.equal(h.notices.filter(x => x.level === 'error').length, 0);
		assert(!h.notices[0].el.isConnected, 'no-data progress cleaned up');
	} finally { h.close(); }
	for (const stage of [ 'save', 'apply', 'confirm', 'exec' ]) {
		h = await fixture();
		try {
			h.gates[stage] = deferred();
			const pending = h.update();
			await settleUntil(() => h.calls.includes(stage), `did not reach ${stage}`);
			const busy = h.button('Updating subscriptions…');
			assert(busy?.disabled, `${stage}: native button must remain disabled`);
			assert.equal(busy.textContent, 'Updating subscriptions…');
			assert(h.notices[0].el.isConnected, 'progress is visible while pending');
			busy.click();
			await h.updateOption.onclick.call(h.updateOption, null, 'subscription');
			assert.equal(h.calls.filter(x => x === 'save').length, 1);
			assert(!h.calls.includes('exec') || stage === 'exec', 'import must wait for confirmation');
			h.gates[stage].resolve();
			await pending;
			assert.deepEqual(h.calls, [ 'save', 'saved', 'apply', 'confirm', 'indicator:0', 'exec' ]);
			assert(!h.notices[0].el.isConnected, 'progress removed on success');
			const reload = [...h.w.document.querySelectorAll('#modal_overlay button')].find(x => x.textContent === 'Reload page');
			assert(!reload, 'success requires no extra confirmation');
			assert(h.w.document.querySelector('#modal_overlay').textContent.includes('The page will reload automatically.'));
			assert.equal(h.navigationErrors.length, 0, 'no automatic navigation');
			await h.updateOption.onclick.call(h.updateOption, null, 'subscription');
			assert.equal(h.calls.filter(x => x === 'exec').length, 1, 'lock survives success until reload');
			await new Promise(resolve => setTimeout(resolve, 1300));
			assert.equal(h.navigationErrors.length, 1, 'success automatically reloads');
		} finally { h.close(); }
	}

	for (const [stage, modes] of Object.entries({ save: ['reject'], apply: ['status', 'payload', 'reject'], confirm: ['status', 'no-data', 'payload', 'reject'], exec: ['status', 'reject'] })) {
		for (const mode of modes) {
			h = await fixture();
			try {
				h.failures[stage] = mode;
				await h.update();
				assert(h.calls.includes('reset'), `${stage}/${mode} failure did not settle`);
				assert.equal(h.notices.filter(x => x.level === 'error').length, 1);
				assert(!h.notices[0].el.isConnected, 'failed progress cleaned up');
				assert(!h.calls.includes('exec') || stage === 'exec', 'failure must abort import');
				assert(!h.calls.includes('indicator:0') || stage === 'exec', 'failed apply/confirm must preserve indicator');
				assert(!h.calls.includes('confirm') || ['confirm', 'exec'].includes(stage));
				assert(!h.button(UPDATE).disabled, 'failure restores native button');
				h.failures[stage] = null;
				await h.update();
				assert.equal(h.calls.filter(x => x === 'save').length, 2, 'failure releases single-flight lock');
			} finally { h.close(); }
		}
	}

	h = await fixture();
	try {
		const hidden = h.w.document.getElementById(h.updateOption?.cbid?.('subscription') || '');
		const urlOption = h.mods.dom.findClassInstance([...h.root().querySelectorAll('.cbi-value')].find(el => el.textContent.includes('Subscription URLs')));
		assert(urlOption, 'subscription URL option must be discoverable');
		urlOption.formvalue = () => [];
		urlOption.onchange(null, 'subscription');
		const button = hidden?.previousElementSibling?.querySelector('button') || h.button(UPDATE);
		assert(button.disabled, 'clearing URLs must disable update immediately');
		urlOption.formvalue = () => [ 'https://example.invalid/changed' ];
		urlOption.onchange(null, 'subscription');
		assert(!button.disabled, 'adding a URL must re-enable update immediately');
		assert.equal(button.textContent, UPDATE, 'URL changes must retain the concise update label');
		assert.equal(h.button('Save current settings'), undefined, 'redundant subscription save button must not render');
	} finally { h.close(); }

	h = await fixture();
	try {
		const remove = h.removeButton;
		assert(remove, 'current remove button must render');
		const option = h.mods.dom.findClassInstance(remove.closest('.cbi-value'));
		assert(option, 'native remove form.Button option must be discoverable');
		const sid = h.mods.uci.add('homeproxy', 'node', 'fixture-sub-node');
		h.mods.uci.set('homeproxy', sid, 'grouphash', 'fixture');
		remove.textContent = option.inputtitle('subscription');
		assert.equal(remove.textContent, REMOVE);
		remove.disabled = false;
		remove.click();
		await tick();
		const cancel = [...h.w.document.querySelectorAll('#modal_overlay button')].find(el => el.textContent.trim() === 'Cancel');
		assert(cancel, 'removal confirmation must offer cancellation');
		cancel.click();
		await tick();
		assert.deepEqual(h.calls, [], 'cancellation must not save, apply, confirm, or execute');
	} finally { h.close(); }

	h = await fixture();
	try {
		const sid = 'n1';
		h.mods.uci.set('homeproxy', sid, 'grouphash', 'fixture');
		h.removeButton.textContent = h.removeOption.inputtitle('subscription');
		h.removeButton.disabled = false;
		h.removeButton.click();
		await tick();
		const confirm = [...h.w.document.querySelectorAll('#modal_overlay button')].find(el => el.textContent.trim() === 'Remove');
		assert(confirm, 'removal confirmation must offer destructive action');
		confirm.click();
		await settleUntil(() => h.calls.includes('reset'), 'confirmed removal did not settle');
		assert(h.mutations.some(call => call[0] === 'remove' && call[2] === sid), 'confirmed removal must delete subscription node');
		assert(h.mutations.some(call => call[0] === 'set' && call[2] === 'config' && call[3] === 'main_node' && call[4] === 'nil'),
			'confirmed removal must clear main node');
	} finally { h.close(); }

	h = await fixture();
	try {
		const sid = 'n1';
		h.mods.uci.set('homeproxy', sid, 'grouphash', 'fixture');
		h.map.parse = async () => { throw Error('injected validation failure'); };
		h.removeButton.textContent = h.removeOption.inputtitle('subscription');
		h.removeButton.disabled = false;
		h.removeButton.click();
		await tick();
		[...h.w.document.querySelectorAll('#modal_overlay button')].find(el => el.textContent.trim() === 'Remove').click();
		await settleUntil(() => h.calls.includes('reset'), 'failed removal did not settle');
		assert(!h.mutations.some(call => call[0] === 'remove'), 'save failure must not remove subscription nodes');
		assert(!h.mutations.some(call => call[0] === 'set' && call[3] === 'main_node'), 'save failure must not alter main node');
	} finally { h.close(); }

	console.log('PASS native LuCI Button/Map/UI/RPC: held save→apply→confirm→exec; status/payload/reject failures and retry; progress cleanup; acknowledged reload; cancellation and single-flight');
})().catch(err => {
	console.error(err);
	process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
