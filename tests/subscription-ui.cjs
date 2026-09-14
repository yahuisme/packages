const assert = require('assert/strict');
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
	const gates = { apply: null, confirm: null, exec: null };
	const failures = { apply: null, confirm: null, exec: null };
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
			if (failures[method])
				return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({
					jsonrpc: '2.0', id: req.id, result: [ 6 ]
				})) };
			return { ok: true, status: 200, json: () => h.w.JSON.parse(JSON.stringify({
				jsonrpc: '2.0', id: req.id, result: [ 0, 0 ]
			})) };
		}
		return originalPost(url, req);
	};
	h.mods.fs.exec = async path => {
		calls.push('exec');
		assert.equal(path, '/etc/homeproxy/scripts/update_subscriptions.sh');
		if (gates.exec)
			await gates.exec.promise;
		if (failures.exec)
			throw failures.exec;
		return { code: 0, stdout: '', stderr: '' };
	};
	h.mods.ui.addNotification = (_title, node, level) => notices.push({ text: node.textContent, level });
	h.w.console.error = () => {};
	h.w.setTimeout = (fn, ms, ...args) => ms === 1000 ? originalTimeout(fn, 0, ...args) : originalTimeout(fn, ms, ...args);

	const map = h.map;
	const nativeSave = map.save;
	map.save = function(cb, silent) {
		calls.push('save');
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
	return { ...h, calls, notices, beforeReset, mutations, gates, failures, map, button, updateOption, removeButton, removeOption,
		close: () => h.w.close(),
		update: () => updateOption.onclick.call(updateOption) };
}

(async () => {
	let h = await fixture();
	try {
		h.update();
		await settleUntil(() => h.calls.includes('reset'), 'successful update did not finish');
		assert.deepEqual(h.calls, [ 'save', 'saved', 'exec', 'reset' ]);
		assert(!h.calls.includes('apply') && !h.calls.includes('confirm'),
			'subscription import must not invoke the unrelated UCI apply transaction');
	} finally { h.close(); }

	h = await fixture();
	try {
		h.gates.exec = deferred();
		const pending = h.update();
		await settleUntil(() => h.calls.includes('exec'), 'update did not reach subscription import');
		h.update();
		await tick();
		assert.equal(h.calls.filter(x => x === 'save').length, 1, 'second click must not start another save');
		h.gates.exec.resolve();
		await pending;
		assert(h.calls.includes('reset'), 'single-flight update did not finish');
	} finally { h.close(); }

	for (const stage of [ 'exec' ]) {
		h = await fixture();
		try {
			h.failures[stage] = Error(`injected ${stage} failure`);
			await h.update();
			assert(h.calls.includes('reset'), `${stage} failure did not settle`);
			assert.equal(h.notices.length, 1, `${stage} failure must notify once`);
			assert.equal(h.notices[0].level, 'error');
			assert(!h.calls.includes('exec') || stage === 'exec', 'save failure must abort exec');
		}
		finally { h.close(); }
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

	console.log('PASS current node.js saves then imports subscriptions without UCI apply/confirm; failures, cancellation and single-flight');
})().catch(err => {
	console.error(err);
	process.exitCode = 1;
});
