/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';
'require dom';
'require form';
'require fs';
'require homeproxy.lifecycle as lifecycle';
'require homeproxy.resources as resources';
'require rpc';
'require uci';
'require ui';
'require view';

const hp_dir = '/var/run/homeproxy';

/* Declared once: these views re-render on Map reset/save, and declaring inside
 * a render function rebuilds the RPC wrappers on every redraw. */
const callConnStat = rpc.declare({
	object: 'luci.homeproxy',
	method: 'connection_check',
	params: ['site'],
	expect: { '': {} }
});
const callLogClean = rpc.declare({
	object: 'luci.homeproxy',
	method: 'log_clean',
	params: ['type'],
	expect: { '': {} }
});

const connectionSites = [
	{ type: 'baidu', name: _('Baidu'), url: 'https://www.baidu.com/' },
	{ type: 'bilibili', name: _('Bilibili'), url: 'https://www.bilibili.com/' },
	{ type: 'jd', name: _('JD'), url: 'https://www.jd.com/' },
	{ type: 'google', name: _('Google'), url: 'https://www.google.com/' },
	{ type: 'github', name: _('GitHub'), url: 'https://github.com/' },
	{ type: 'youtube', name: _('YouTube'), url: 'https://www.youtube.com/' }
];

const connectionTestTimeout = 10000;
const visuallyHiddenStyle = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

function getConnectionStatus() {
	const table = E('table', { 'class': 'table', 'style': 'width:100%;table-layout:fixed' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Website')),
			E('th', { 'class': 'th' }, _('Connectivity')),
			E('th', { 'class': 'th' }, _('Latency'))
		])
	]);
	const statusElements = {};
	const rows = connectionSites.map((site) => {
		const state = E('strong', {
			'role': 'status',
			'aria-live': 'polite',
			'aria-atomic': 'true',
			'style': 'color:var(--cbi-muted-color, var(--text-muted, gray))'
		}, '-');
		const latency = E('span', {
			'role': 'status',
			'aria-live': 'polite',
			'aria-atomic': 'true'
		}, '-');
		statusElements[site.type] = { state, latency };

		return [
			E('a', {
				'href': site.url,
				'target': '_blank',
				'rel': 'noreferrer noopener'
			}, site.name),
			state,
			latency
		];
	});
	cbi_update_table(table, rows);

	const session = this.connectionSession || (this.connectionSession = {
		running: false, results: null, testing: false, generation: 0
	});
	let testButton;
	let alive;
	const paint = () => {
		testButton.disabled = session.running;
		connectionSites.forEach((site) => {
			if (session.testing) {
				const elements = statusElements[site.type];
				elements.state.style.setProperty('color', 'var(--cbi-primary-color, var(--primary, #0a84ff))');
				dom.content(elements.state, _('Testing...'));
				dom.content(elements.latency, '-');
			} else if (session.results) {
				updateResult(site.type, session.results[site.type]);
			}
		});
	};

	const updateResult = (site, result) => {
		const elements = statusElements[site];
		if (!elements)
			return;

		if (result?.result === true && Number.isFinite(result.latency_ms) && result.latency_ms >= 0) {
			elements.state.style.setProperty('color', 'var(--success, light-dark(#15803d, #16a34a))');
			dom.content(elements.state, _('Success'));
			dom.content(elements.latency, _('%s ms').format(result.latency_ms));
		} else {
			elements.state.style.setProperty('color', 'var(--danger, light-dark(#b91c1c, #dc2626))');
			dom.content(elements.state, result?.timed_out ? _('Timed out') : _('Failed'));
			dom.content(elements.latency, '-');
		}
	};

	const notify = () => {
		if (session.paint)
			session.paint();
	};
	const runAllTests = () => {
		if (!alive() || session.running)
			return;
		session.running = true;
		session.testing = true;
		const generation = session.generation;
		let timedOut = false;
		notify();
		const finish = (result) => {
			if (generation !== session.generation)
				return;
			const results = {};
			if (Array.isArray(result?.results))
				result.results.forEach((entry) => {
					if (entry && typeof entry.site === 'string')
						results[entry.site] = entry;
				});
			session.results = {};
			connectionSites.forEach((site) => {
				session.results[site.type] = results[site.type] || { timed_out: timedOut };
			});
			session.testing = false;
			notify();
		};
		const timer = window.setTimeout(() => {
			timedOut = true;
			finish({});
		}, connectionTestTimeout);
		// A display timeout does not cancel the RPC or release its lock.
		Promise.resolve().then(() => callConnStat('all')).catch(() => ({})).then((result) => {
			if (!timedOut)
				finish(result);
		}).finally(() => {
			window.clearTimeout(timer);
			session.running = false;
			notify();
			if (session.autoRun)
				session.autoRun();
		});
	};

	testButton = E('button', { 'type': 'button',
		'class': 'btn cbi-button cbi-button-action',
		'style': 'margin-left:4px',
		'click': ui.createHandlerFn(this, runAllTests)
	}, [ _('Test all') ]);

	const view = E('div', { 'class': 'cbi-map' }, [
		E('h3', { 'name': 'content', 'style': 'align-items:center;display:flex;flex-wrap:wrap;gap:8px' }, [
			_('Connection Status'),
			testButton
		]),
		E('div', { 'class': 'cbi-section' }, [ table ])
	]);

	alive = lifecycle.watch(view, () => {
		session.paint = () => { if (alive()) paint(); };
		// Retry once on transport completion, never with a polling timer.
		session.autoRun = () => {
			if (alive() && !session.autoStarted && !session.running) {
				session.autoStarted = true;
				runAllTests();
			}
		};
		paint();
		session.autoRun();
	}, () => {});
	paint();
	return view;
}

function getRuntimeLog(o) {
	const session = this.logSession || (this.logSession = { source: 'homeproxy', busy: false, revision: 0 });
	const sources = {
		homeproxy: { name: _('HomeProxy') },
		'sing-box-c': { name: _('sing-box Client'), section: 'config' },
		'sing-box-s': { name: _('sing-box Server'), section: 'server' }
	};
	let alive;
	const log_status = E('span', { role: 'status', 'aria-live': 'polite',
		'aria-atomic': 'true', style: visuallyHiddenStyle }, '');
	const textarea = E('textarea', {
		'class': 'cbi-input-textarea', readonly: true, wrap: 'off', spellcheck: 'false', rows: 20,
		style: 'width:100%;font-family:monospace;white-space:pre;overflow:auto'
	}, _('Collecting data...'));
	const level = E('select', { 'class': 'cbi-input-select', 'aria-label': _('Log level'),
		disabled: o.map.readonly ? '' : null,
		change: ui.createHandlerFn(this, (ev) => {
			const section = sources[session.source].section;
			if (!section || o.map.readonly) return;
			uci.set('homeproxy', section, 'log_level', ev.target.value);
			return o.map.save(null, true).then(() => ui.changes.apply(true));
		})
	});
	const choices = { trace: _('Trace'), debug: _('Debug'), info: _('Info'), warn: _('Warn'),
		error: _('Error'), fatal: _('Fatal'), panic: _('Panic') };
	Object.keys(choices).forEach((value) => level.appendChild(E('option', { value }, choices[value])));
	const source = E('select', { 'class': 'cbi-input-select', 'aria-label': _('Log source'),
		change: (ev) => {
			if (!sources[ev.target.value]) return;
			session.source = ev.target.value;
			session.revision++;
			configure();
			refresh();
		}
	}, Object.keys(sources).map((value) => E('option', { value,
		selected: value === session.source ? '' : null }, sources[value].name)));
	const configure = () => {
		const selected = sources[session.source];
		textarea.id = session.source + '-log';
		textarea.setAttribute('aria-label', _('%s Log').format(selected.name));
		textarea.value = _('Collecting data...');
		const section = selected.section;
		level.hidden = !section;
		level.style.display = section ? '' : 'none';
		level.value = section ? uci.get('homeproxy', section, 'log_level') || 'warn' : 'warn';
	};
	const update = (result) => {
		if (textarea.value !== result.content) {
			const focused = document.activeElement === textarea;
			const start = textarea.selectionStart, end = textarea.selectionEnd, direction = textarea.selectionDirection;
			const top = textarea.scrollTop, left = textarea.scrollLeft;
			textarea.value = result.content;
			if (focused) textarea.setSelectionRange(start, end, direction);
			textarea.scrollTop = top;
			textarea.scrollLeft = left;
		}
		dom.content(log_status, result.status === 'unavailable' ? _('Log unavailable.') :
			result.status === 'empty' ? _('Log is empty.') : _('Log updated.'));
	};
	const refresh = () => {
		if (!alive() || document.visibilityState === 'hidden' || session.busy) return Promise.resolve();
		const selected = session.source, requestRevision = session.revision;
		session.busy = true;
		return fs.read_direct('%s/%s.log'.format(hp_dir, selected), 'text').then((content) =>
			content ? { status: 'updated', content } : { status: 'empty', content: _('Log is empty.') }
		).catch((err) => ({ status: 'unavailable', content: err?.name === 'NotFoundError' ?
			_('Log file does not exist.') : _('Unknown error: %s.').format(err) })).then((result) => {
			if (alive() && requestRevision === session.revision) update(result);
		}).finally(() => {
			session.busy = false;
			// Only the newest attached viewer can resume a source switch/reset.
			if (session.refresh && (session.refresh !== refresh || requestRevision !== session.revision)) session.refresh();
		});
	};
	const clean = E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action',
		disabled: o.map.readonly || session.cleaning ? '' : null,
		click: ui.createHandlerFn(this, () => {
			if (o.map.readonly || session.cleaning) return;
			session.cleaning = true;
			const selected = session.source;
			return L.resolveDefault(callLogClean(selected), {}).then((result) => {
				if (result.result !== true)
					ui.addNotification(null, E('p', [ _('Unable to clear log.') ]), 'error');
				else if (session.source === selected) {
					// Reject pre-clear bytes, including reads begun by a replacement viewer.
					session.revision++;
					if (session.refresh) session.refresh();
				}
			}).finally(() => {
				session.cleaning = false;
				if (session.paintClean) session.paintClean();
			});
		})
	}, _('Clean log'));
	const root = E('div', { 'class': 'cbi-map hp-runtime-log' }, [
		E('h3', { style: 'display:flex;align-items:center;flex-wrap:wrap;gap:8px' }, [
			_('Runtime log'), source, level, clean
		]),
		E('div', { 'class': 'cbi-section' }, [ textarea, log_status,
			E('div', { style: 'text-align:right' }, E('small', {}, _('Refresh every %s seconds.').format(L.env.pollinterval)))
		])
	]);
	configure();
	alive = lifecycle.watch(root, () => {
		session.refresh = refresh;
		session.paintClean = () => { if (alive()) clean.disabled = o.map.readonly || !!session.cleaning; };
		session.paintClean();
	}, () => {
		if (session.refresh === refresh) { session.refresh = null; session.paintClean = null; }
	});
	lifecycle.poll(root, 'runtime-log', refresh, () => {});
	return root;
}

return view.extend({
	render() {
		let m, s, o;

		m = new form.Map('homeproxy');

		s = m.section(form.NamedSection, 'config', 'homeproxy');
		s.anonymous = true;

		o = s.option(form.DummyValue, '_connection_status');
		o.render = L.bind(getConnectionStatus, this);

		o = s.option(form.DummyValue, '_resources');
		o.render = function() { return resources.render(this, ['geoip_cn', 'geosite_cn', 'dashboard']); };

		s = m.section(form.NamedSection, 'config', 'homeproxy');
		s.anonymous = true;

		o = s.option(form.DummyValue, '_runtime_logview');
		o.render = L.bind(getRuntimeLog, this, o);

		return m.render().then((root) => {
			const session = this.connectionSession;
			lifecycle.watch(root, () => {}, () => {
				session.generation++;
				session.autoStarted = false;
				session.autoRun = null;
				session.testing = false;
				session.results = null;
				session.paint = null;
			});
			return root;
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
