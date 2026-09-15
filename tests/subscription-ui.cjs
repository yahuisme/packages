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
	const started = performance.now();
	// setImmediate iteration counts are not a clock: 80 turns can finish
	// before even the fixture's setTimeout(0) becomes runnable.
	while (performance.now() - started < 2000) {
		if (predicate())
			return;
		await new Promise(resolve => setTimeout(resolve, 1));
	}
	assert.fail(`${message}; elapsed=${(performance.now() - started).toFixed(3)}ms`);
}

async function fixture(translations = {}, realTimers = false) {
	const h = await pageBoot('node', translations);
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
	if (!realTimers)
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
		const tabNames = () => [...h.root().querySelectorAll('.cbi-tabmenu > li')].map(el => el.getAttribute('data-tab'));
		const before = tabNames();
		h.root().querySelector('.cbi-tabmenu li[data-tab="subscription"] a').click();
		assert.equal(h.mods.ui.tabs.getActiveTabState().paths.subscription, 2, 'native click persists the settings tab index');
		for (let i = 0; i < 2; i++) {
			h.gates.exec = deferred();
			const pending = h.update();
			await settleUntil(() => h.calls.filter(call => call === 'exec').length === i + 1, 'save/apply did not reach held exec');
			assert.equal(h.root().querySelector('[data-tab-title][data-tab-active="true"]').dataset.tab, 'subscription', 'native Map.save rerender must also retain settings');
			h.gates.exec.resolve();
			await pending;
			assert.deepEqual(tabNames(), before, 'unchanged subscription tabs must retain their original order');
			assert.equal(h.root().querySelector('[data-tab-title][data-tab-active="true"]').getAttribute('data-tab'), 'subscription', 'settings tab must remain active');
			assert.equal(h.button(UPDATE).closest('[data-tab-title]').getAttribute('data-tab-active'), 'true', 'button and inline success must be in the visible pane');
			assert.equal(h.root().querySelector('.hp-subscription-result').textContent, 'Subscriptions updated successfully.');
		}
		console.log('PASS native settings-tab click: stable order and visible inline result across repeated updates');
	} finally { h.close(); }
	h = await fixture();
	try {
		const urls = ['https://example.invalid/sub#Renamed', 'https://example.invalid/second#Second'];
		const original = h.mods.request.post;
		h.mods.request.post = async (url, req) => {
			const response = await original(url, req);
			if (req.params[1] === 'uci' && req.params[2] === 'get') {
				const body = await response.json();
				body.result[1].values.subscription.subscription_url = [...urls];
				return { ...response, json: () => body };
			}
			return response;
		};
		const names = () => [...h.root().querySelectorAll('.cbi-tabmenu > li')].map(el => [el.dataset.tab, el.textContent]);
		const check = () => {
			const expected = [['node', 'Nodes'], ...urls.map(url => ['sub_' + h.mods.homeproxy.calcStringMD5(url.split('#')[0]), 'Sub (' + url.split('#')[1] + ')']), ['subscription', 'Subscriptions']];
			assert.deepEqual(names(), expected, 'dynamic groups must follow initial-render URL order, before settings');
			assert.equal(h.root().querySelector('[data-tab-title][data-tab-active="true"]').dataset.tab, 'subscription');
			assert.equal(h.mods.ui.tabs.getActiveTabState().paths.subscription, expected.length - 1, 'native stored index follows the same settings pane');
		};
		h.root().querySelector('.cbi-tabmenu li[data-tab="subscription"] a').click();
		await h.update(); check();
		urls.reverse();
		await h.update(); check();
		urls.pop();
		await h.update(); check();
		await h.update(); check();
		await h.map.reset(); check();
		const beforeFresh = names();
		h.root().remove();
		const fresh = await h.app.render(['homeproxy', ...(await h.app.load()).slice(1)]);
		h.w.document.querySelector('#view').append(fresh);
		assert.deepEqual(names(), beforeFresh, 'fresh page render has identical names and order');
		console.log('PASS native dynamic tabs: rename/add/reorder/remove/repeat/reset/fresh-render retain canonical order');
	} finally { h.close(); }
	// Exercise the production 1s delay without acceleration. A held confirm
	// must still block exec after the real timer, not just in a fast fixture.
	h = await fixture({}, true);
	try {
		h.gates.apply = deferred();
		h.gates.confirm = deferred();
		const pending = h.update();
		await settleUntil(() => h.calls.includes('apply'), 'real timer: apply not reached');
		const started = performance.now();
		h.gates.apply.resolve();
		await new Promise(resolve => setTimeout(resolve, 100));
		assert(!h.calls.includes('confirm'), 'confirm must wait for the production settling delay');
		await settleUntil(() => h.calls.includes('confirm'), 'real timer: confirm not reached');
		const elapsed = performance.now() - started;
		assert(elapsed >= 990, `production settling delay unexpectedly shortened: ${elapsed}ms`);
		assert(!h.calls.includes('exec'), 'held confirmation must block updater');
		h.gates.confirm.resolve();
		await pending;
		assert(h.calls.includes('exec'));
		console.log(`PASS unmodified production timer: confirm after ${elapsed.toFixed(1)}ms; held confirm blocks exec`);
	} finally { h.close(); }
	h = await fixture();
	try {
		h.failures.apply = 'no-data';
		await h.update();
		assert(h.calls.includes('exec'), 'uci/apply code 5 must still update unchanged subscriptions');
		assert(!h.calls.includes('confirm'), 'no-data apply must not confirm a nonexistent rollback');
		assert.equal(h.notices.filter(x => x.level === 'error').length, 0);
		assert.equal(h.notices.length, 0, 'subscription update must not create system notifications');
		assert.equal(h.root().querySelector('.hp-subscription-result')?.textContent, 'Subscriptions updated successfully.');
		assert(!h.button(UPDATE).disabled, 'inline success releases the action lock');
		await h.map.reset();
		assert.equal(h.root().querySelector('.hp-subscription-result')?.textContent, 'Subscriptions updated successfully.');
	} finally { h.close(); }
	h = await fixture();
	try {
		const original = h.mods.request.post;
		let updated = false;
		h.mods.fs.exec = async () => { updated = true; return { code: 0 }; };
		h.mods.request.post = async (url, req) => {
			const response = await original(url, req);
			if (updated && req.params[1] === 'uci' && req.params[2] === 'get') {
				const body = await response.json();
				body.result[1].values.config.main_node = 'newnode';
				body.result[1].values.subscription.subscription_url = ['https://example.invalid/new#New'];
				body.result[1].values.newnode = { '.name': 'newnode', '.type': 'node', type: 'socks', label: 'NEW SUB NODE', address: 'example.invalid', port: '1080', grouphash: h.mods.homeproxy.calcStringMD5('https://example.invalid/new') };
				return { ...response, json: () => body };
			}
			return response;
		};
		h.root().querySelector('.cbi-tabmenu li[data-tab="subscription"] a').click();
		await h.update();
		assert.equal(h.button(UPDATE).closest('[data-tab-title]').getAttribute('data-tab-active'), 'true', 'updated nodes must not auto-switch away from settings');
		assert.equal(h.root().querySelector('.hp-subscription-result').textContent, 'Subscriptions updated successfully.');
		assert.deepEqual([...h.root().querySelectorAll('.cbi-tabmenu > li')].map(el => el.textContent), ['Nodes', 'Sub (New)', 'Subscriptions']);
		assert(h.root().textContent.includes('NEW SUB NODE'), 'fresh backend node must appear without page reload');
		assert(h.root().textContent.includes('Sub (New)'), 'new URL must rebuild subscription tabs');
		const newRow = h.root().querySelector('[data-sid="newnode"]');
		assert(newRow && [...newRow.querySelectorAll('button')].some(button => button.textContent.trim() === 'Applied' && button.disabled),
			'refreshed primary node must show Applied');
		assert(!h.button('Remove 1 nodes').disabled, 'refreshed removal button must unlock too');
		assert(!h.root().textContent.includes('Sub (示例订阅)'), 'old subscription tab must be removed');
		const listPane = newRow.closest('[data-tab-title]');
		assert.notEqual(listPane.getAttribute('data-tab-active'), 'true', 'refreshed list stays hidden until user selects it');
		h.root().querySelector('.cbi-tabmenu li[data-tab="' + listPane.dataset.tab + '"] a').click();
		assert.equal(listPane.getAttribute('data-tab-active'), 'true', 'manual native tab click reveals refreshed node row');
		assert(listPane.textContent.includes('NEW SUB NODE'));
		console.log('PASS native settings update → inline success → manual list-tab click reveals new Applied node');
		assert(h.root().querySelector('.hp-subscription-result').getAttribute('style').includes('--success-color'));
		await h.map.reset();
		assert(h.root().textContent.includes('NEW SUB NODE'));
	} finally { h.close(); }
	for (const stage of ['load', 'reset']) {
		h = await fixture();
		try {
			const native = h.map[stage];
			const gate = deferred();
			h.map[stage] = async function(...args) {
				if (h.calls.includes('exec')) {
					h.calls.push('refresh:' + stage);
					await gate.promise;
				}
				return native.apply(this, args);
			};
			const pending = h.update();
			await settleUntil(() => h.calls.includes('refresh:' + stage), 'refresh stage not reached');
			assert(h.button('Updating subscriptions…').disabled);
			await h.updateOption.onclick(null, 'subscription');
			assert.equal(h.calls.filter(x => x === 'exec').length, 1);
			gate.resolve();
			await pending;
			assert(!h.button(UPDATE).disabled);
			assert.equal(h.root().querySelector('.hp-subscription-result').textContent, 'Subscriptions updated successfully.');
		} finally { h.close(); }
	}
	for (const stage of ['get', 'load', 'reset']) {
		h = await fixture();
		try {
			if (stage === 'get') {
				const native = h.mods.request.post;
				h.mods.request.post = (url, req) => {
					if (h.calls.includes('exec') && req.params[1] === 'uci' && req.params[2] === 'get')
						throw Error('<img src=x onerror=alert(1)>');
					return native(url, req);
				};
			} else {
				const native = h.map[stage];
				h.map[stage] = function(...args) {
					if (h.calls.includes('exec')) throw Error('injected refresh failure');
					return native.apply(this, args);
				};
			}
			await h.update();
			assert.equal(h.root().querySelector('.hp-subscription-result').textContent, 'Subscriptions updated, but unable to refresh the node list.');
			assert(!h.root().querySelector('.hp-subscription-result img'));
			assert.equal(h.notices.length, 0);
			assert(!h.button(UPDATE).disabled);
		} finally { h.close(); }
	}
	for (const stage of [ 'save', 'apply', 'confirm', 'exec' ]) {
		h = await fixture();
		try {
			h.gates[stage] = deferred();
			const pending = h.update();
			await settleUntil(() => h.calls.includes(stage), `did not reach ${stage}`);
			const busy = h.button('Updating subscriptions…');
			assert(busy?.disabled, `${stage}: native button must remain disabled`);
			assert.equal(busy.textContent, 'Updating subscriptions…');
			assert(h.root().querySelector('.hp-subscription-result').textContent.includes('Saving settings'), 'inline progress visible');
			busy.click();
			await h.updateOption.onclick.call(h.updateOption, null, 'subscription');
			assert.equal(h.calls.filter(x => x === 'save').length, 1);
			assert(!h.calls.includes('exec') || stage === 'exec', 'import must wait for confirmation');
			h.gates[stage].resolve();
			await pending;
			assert.deepEqual(h.calls, [ 'save', 'saved', 'apply', 'confirm', 'indicator:0', 'exec', 'indicator:0', 'reset' ]);
			assert.equal(h.notices.length, 0);
			assert.equal(h.root().querySelector('.hp-subscription-result').textContent, 'Subscriptions updated successfully.');
			assert(!h.w.document.querySelector('#modal_overlay').textContent.includes('The page will reload automatically.'));
			await new Promise(resolve => setTimeout(resolve, 1300));
			assert.equal(h.navigationErrors.length, 0, 'success never navigates');
		} finally { h.close(); }
	}

	for (const [stage, modes] of Object.entries({ save: ['reject'], apply: ['status', 'payload', 'reject'], confirm: ['status', 'no-data', 'payload', 'reject'], exec: ['status', 'reject'] })) {
		for (const mode of modes) {
			h = await fixture();
			try {
				h.failures[stage] = mode;
				await h.update();
				assert.equal(h.notices.length, 0);
				assert(h.root().querySelector('.hp-subscription-result').textContent.startsWith('Unable to '));
				assert(h.root().querySelector('.hp-subscription-result').getAttribute('style').includes('--error-color'));
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
		const widget = urlOption.getUIElement('subscription');
		widget.setValue([]);
		urlOption.onchange(null, 'subscription');
		await h.updateOption.onclick(null, 'subscription');
		assert.deepEqual(h.calls, [], 'even direct invocation without URLs must not save or execute');
		assert.equal(h.root().querySelector('.hp-subscription-result').textContent, 'Add a subscription URL first.');
		assert(!h.root().querySelector('.hp-subscription-result').getAttribute('style').includes('color:'));
		const button = hidden?.previousElementSibling?.querySelector('button') || h.button(UPDATE);
		assert(button.disabled, 'clearing URLs must disable update immediately');
		widget.setValue([ 'https://example.invalid/changed' ]);
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

 let committed = null, deltas = {}, updates = [];
 h = await fixture();
 try {
 for (const stage of ['initial-default-save','unchanged-repeat','edited-url','unchanged-after-edit']) {
  {
   if (!committed) committed = JSON.parse(JSON.stringify(Object.fromEntries(h.mods.uci.sections('homeproxy').map(s=>[s['.name'],s]))));
   const previous = h.mods.request.post;
   const statuses=[]; let confirms=0;
   h.mods.request.post = async(url,req)=>{
    const [,obj,method,p] = req.params;
    if(obj!=='uci') return previous(url,req);
    let value={}, code=0;
    if(method==='get') value={values:committed};
    else if(method==='set') { for(const [key,val] of Object.entries(p.values)) if(JSON.stringify(committed[p.section][key])!==JSON.stringify(val)) {deltas[p.section]??={}; deltas[p.section][key]=val;} }
    else if(method==='apply') {
     code=Object.keys(deltas).length ? 0 : 5; statuses.push(code);
     if(code===0) {for(const [sid,v] of Object.entries(deltas))Object.assign(committed[sid],v);deltas={};}
    }
    else if(method==='confirm') {confirms++; assert.equal(statuses.at(-1),0);}
    else if(method==='changes') value={changes:{}};
    else return previous(url,req);
    return {ok:true,status:200,json:()=>h.w.JSON.parse(JSON.stringify({jsonrpc:'2.0',id:req.id,result:code?[code]:[0,method==='apply'||method==='confirm'?0:value]}))};
   };

   if(stage==='edited-url') {
    const container=h.root().querySelector('[data-name="subscription_url"]');
    const option=h.mods.dom.findClassInstance(container);
    const widget=option.getUIElement('subscription');
    assert(widget && typeof widget.setValue==='function');
    widget.setValue(['https://example.invalid/changed']);
    assert.deepEqual(Array.from(option.formvalue('subscription')),['https://example.invalid/changed']);
   }
   h.mods.fs.exec=async path=>{assert.equal(path,'/etc/homeproxy/scripts/update_subscriptions.sh');updates.push(JSON.parse(JSON.stringify(committed.subscription)));return {code:0};};
   await h.update();
   assert.equal(h.notices.filter(n=>n.level==='error').length,0);
   assert.equal(updates.length,['initial-default-save','unchanged-repeat','edited-url','unchanged-after-edit'].indexOf(stage)+1);
   const expected=stage.startsWith('unchanged')?5:0;
   assert.deepEqual(statuses,[expected]); assert.equal(confirms,expected===0?1:0);
   assert.deepEqual(updates.at(-1).subscription_url,[stage==='edited-url'||stage==='unchanged-after-edit'?'https://example.invalid/changed':'https://example.invalid/sub#示例订阅']);
   console.log(`PASS ${stage}: apply=${expected}, confirm=${confirms}, updater sees saved URL`);
  }
 }
 } finally {h.close();}
	console.log('PASS native LuCI Button/Map/UI/RPC: held save→apply→confirm→exec; status/payload/reject failures and retry; inline results across reset; refreshed UCI nodes/tabs; refresh failure; no navigation; cancellation and single-flight');
})().catch(err => {
	console.error(err);
	process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
