const fs = require('fs'), assert = require('assert'), path = require('path');

let JSDOM;
try {
	JSDOM = require('jsdom').JSDOM;
} catch (e) {
	class Node {
		constructor(tagName = '') {
			this.tagName = tagName.toUpperCase();
			this.children = [];
			this.attributes = {};
			this.textContent = '';
			this.isConnected = false;
			this.style = {
				setProperty: () => {},
				getPropertyValue: () => ''
			};
			this.classList = {
				add: () => {},
				remove: () => {},
				contains: () => false
			};
		}
		get id() { return this.attributes.id || ''; }
		set id(v) { this.attributes.id = v; }
		get name() { return this.attributes.name || ''; }
		set name(v) { this.attributes.name = v; }
		get value() { return this.attributes.value !== undefined ? this.attributes.value : ''; }
		set value(v) { this.attributes.value = v; }
		get disabled() { return !!this.attributes.disabled; }
		set disabled(v) { this.attributes.disabled = v; }

		setAttribute(k, v) { this.attributes[k] = String(v); }
		getAttribute(k) { return this.attributes[k]; }
		appendChild(node) { this.append(node); return node; }
		append(...nodes) {
			for (const n of nodes) {
				if (typeof n === 'string' || typeof n === 'number') {
					const tn = new Node('#text');
					tn.textContent = String(n);
					tn.isConnected = this.isConnected;
					this.children.push(tn);
				} else if (n) {
					const setConn = (node, c) => {
						node.isConnected = c;
						for (const ch of node.children) setConn(ch, c);
					};
					setConn(n, this.isConnected);
					this.children.push(n);
				}
			}
			MockObserver._notify();
		}
		addEventListener() {}
		focus() {
			global.document.activeElement = this;
		}
		replaceChildren() {
			const removeConnected = (node) => {
				node.isConnected = false;
				for (const c of node.children) removeConnected(c);
			};
			for (const c of this.children) removeConnected(c);
			this.children = [];
			this.textContent = '';
			MockObserver._notify();
		}
		querySelector(selector) {
			return this.querySelectorAll(selector)[0] || null;
		}
		querySelectorAll(selector) {
			const res = [];
			const match = (node) => {
				let matched = false;
				if (selector.startsWith('#')) {
					matched = node.id === selector.slice(1);
				} else if (selector.startsWith('.')) {
					matched = (node.getAttribute('class') || '').split(/\s+/).includes(selector.slice(1));
				} else if (selector.startsWith('label[for="')) {
					const forId = selector.match(/for="([^"]+)"/)[1];
					matched = node.tagName === 'LABEL' && node.getAttribute('for') === forId;
				} else if (selector === 'select') {
					matched = node.tagName === 'SELECT';
				} else if (selector === 'table') {
					matched = node.tagName === 'TABLE';
				}
				if (matched) res.push(node);
				for (const c of node.children) match(c);
			};
			match(this);
			return res;
		}
	}

	class MockObserver {
		constructor(cb) {
			this.cb = cb;
			MockObserver.instances.push(this);
		}
		observe() {}
		disconnect() {
			this.disconnected = true;
			MockObserver.instances = MockObserver.instances.filter(i => i !== this);
		}
		static _notify() {
			MockObserver.instances.slice().forEach(i => i.cb());
		}
	}
	MockObserver.instances = [];

	const body = new Node('body');
	body.isConnected = true;
	const head = new Node('head');
	head.isConnected = true;
	const doc = {
		body,
		head,
		activeElement: null,
		createElement: tag => new Node(tag),
		getElementById: id => body.querySelector('#' + id) || head.querySelector('#' + id),
		querySelector: sel => body.querySelector(sel),
		querySelectorAll: sel => body.querySelectorAll(sel)
	};

	global.document = doc;
	global.window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		MutationObserver: MockObserver,
		devicePixelRatio: 1
	};
	global.MutationObserver = MockObserver;
}

if (JSDOM) {
	const dom = new JSDOM('<body></body>');
	global.document = dom.window.document;
	global.window = dom.window;
	global.MutationObserver = dom.window.MutationObserver;
}

function E(tag, attrs, children) {
	const e = document.createElement(tag);
	Object.entries(attrs || {}).forEach(([k, v]) => typeof v === 'function' ? e.addEventListener(k, v) : e.setAttribute(k, v));
	(Array.isArray(children) ? children : [children]).forEach(c => { if (c != null) e.append(c); });
	return e;
}

let callbacks = [], fail = false;
const status = { cpu_cur_freq: 500000, cpu_max_freq: 1200000, cpu_min_freq: 500000, cpu_governor: 'schedutil', cpu_count: 2, npu_clock: null, npu_bound: true };
const info = { soc_compat: 'airoha,test', governors: 'schedutil performance', frequencies: '500000 1200000 1400000' };
const declarations = [];

const rpc = {
	declare: spec => {
		declarations.push(spec);
		return () => new Promise((resolve, reject) => {
			if (fail) {
				reject(new Error('RPC failure'));
				return;
			}
			const result = spec.method === 'getStatus' ? status : spec.method === 'getInfo' ? info : spec.method === 'getFlowOffload' ? { enabled: false } : { result: 'ok' };
			resolve(result);
		});
	}
};

const poll = {
	add: f => callbacks.push(f),
	remove: f => callbacks = callbacks.filter(x => x !== f)
};
const L = {
	url: (...a) => '/' + a.join('/'),
	hasViewPermission: () => true
};

const statusSource = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/status.js'), 'utf8');
const statusView = new Function('view', 'rpc', 'poll', 'ui', 'E', 'L', '_', statusSource)({ extend: x => x }, rpc, poll, { addNotification: () => {} }, E, L, x => x);

(async () => {
	// 1. Test Status view (pure read-only dashboard)
	const statusNode = statusView.render(await statusView.load());
	document.body.append(statusNode);
	assert(!document.querySelector('table'), 'use native key/value rows');
	assert(declarations.every(x => x.reject === true));

	// Summary cards and gauge
	assert.equal(document.querySelectorAll('.npu-summary-card').length, 4);
	assert(document.querySelector('#npu-gauge-val'));
	assert(document.querySelector('#npu-gauge-fill'));

	// Polling and lifecycle
	const pending = callbacks[0]();
	assert(pending instanceof Promise);
	await pending;
	assert(document.querySelector('#npu-current').textContent.includes('500 MHz'));

	fail = true;
	await callbacks[0]();
	assert.equal(document.querySelector('#npu-current').textContent, 'Unknown');

	document.body.replaceChildren();
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(callbacks.length, 0);

	console.log('Status DOM: summary cards, gauge, polling lifecycle, failure fallback, and observer cleanup passed');
})().catch(e => {
	console.error(e);
	process.exitCode = 1;
});
