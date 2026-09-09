/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';
'require dom';
'require form';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

/* Thanks to luci-app-aria2 */
const css = '				\
.homeproxy-status {					\
	--hp-font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
	--hp-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;\
}					\
.homeproxy-status #log_textarea {				\
	padding: 12px;			\
	border: 1px solid var(--cbi-border-color, #e0e0e0);\
	border-radius: 6px;		\
	background: var(--cbi-section-bg, transparent);\
	box-sizing: border-box;		\
	text-align: left;		\
}					\
.homeproxy-status #log_textarea pre {			\
	font-family: var(--hp-font-mono);\
	font-size: 12px;		\
	line-height: 1.5;		\
	padding: 0;			\
	word-wrap: break-word;		\
	overflow-wrap: anywhere;		\
	margin: 0;			\
}					\
.homeproxy-status .hp-status-grid {			\
	display: grid;			\
	grid-template-columns: repeat(4, minmax(0, 1fr));\
	gap: 10px;			\
	margin-bottom: 12px;		\
}					\
.homeproxy-status .hp-card {				\
	background: var(--cbi-section-bg, transparent);\
	border: 1px solid var(--cbi-border-color, #e0e0e0);\
	border-radius: 6px;		\
	padding: 10px 14px;		\
	box-sizing: border-box;		\
	display: flex;			\
	flex-direction: column;		\
	justify-content: space-between;	\
	min-height: 76px;		\
	-webkit-font-smoothing: antialiased;\
	text-rendering: optimizeLegibility;\
}					\
.homeproxy-status .hp-card-header {			\
	display: flex;			\
	justify-content: space-between;	\
	align-items: center;		\
	margin-bottom: 6px;		\
}					\
.homeproxy-status .hp-card-title {			\
	font-size: 13px;		\
	font-weight: 500;		\
	color: var(--cbi-text-color, inherit);\
}					\
.homeproxy-status .hp-card-link {				\
	font-size: 11px;		\
	font-family: var(--hp-font-mono);\
	font-variant-numeric: tabular-nums;\
	color: var(--cbi-muted-color, #888);\
	text-decoration: none;		\
	overflow: hidden;		\
	text-overflow: ellipsis;	\
	white-space: nowrap;		\
	max-width: 120px;		\
}					\
.homeproxy-status .hp-card-link:hover {			\
	text-decoration: underline;	\
	color: var(--cbi-link-color, #0069d9);\
}					\
.homeproxy-status .hp-card-body {				\
	display: flex;			\
	align-items: baseline;		\
	justify-content: space-between;	\
	gap: 8px;			\
	margin-top: auto;		\
}					\
.homeproxy-status .hp-card-state {			\
	font-size: 12px;		\
	font-weight: 600;		\
}					\
.homeproxy-status .hp-card-latency {			\
	font-size: 12px;		\
	font-weight: 600;		\
	font-family: var(--hp-font-mono);\
	font-variant-numeric: tabular-nums;\
	color: var(--cbi-text-color, inherit);\
}					\
.homeproxy-status .hp-badge {				\
	display: inline-flex;		\
	align-items: center;		\
	padding: 2px 8px;		\
	border-radius: 4px;		\
	font-size: 11px;		\
	font-weight: 600;		\
	font-family: var(--hp-font-mono);\
	font-variant-numeric: tabular-nums;\
	border: 1px solid transparent;	\
	line-height: 1.4;		\
}					\
.homeproxy-status .hp-badge-success {			\
	background: rgba(16,185,129,0.10);\
	color: var(--cbi-success-color, #10b981);\
	border-color: rgba(16,185,129,0.30);\
}					\
.homeproxy-status .hp-badge-danger {			\
	background: rgba(239,68,68,0.10);\
	color: var(--cbi-error-color, #ef4444);\
	border-color: rgba(239,68,68,0.30);\
}					\
.homeproxy-status .cbi-button-action {			\
	height: 32px;			\
	padding: 0 16px;		\
	border-radius: 4px;		\
	font-size: 12px;		\
	font-weight: 500;		\
}					\
@media (max-width: 1050px) {		\
	.homeproxy-status .hp-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\
}					\
@media (max-width: 540px) {		\
	.homeproxy-status .hp-status-grid { grid-template-columns: 1fr; }\
}					\
';

const connectionSites = [
	{ type: 'baidu', name: _('Baidu'), url: 'https://www.baidu.com/' },
	{ type: 'bilibili', name: _('Bilibili'), url: 'https://www.bilibili.com/' },
	{ type: 'jd', name: _('JD'), url: 'https://www.jd.com/' },
	{ type: 'taobao', name: _('Taobao'), url: 'https://www.taobao.com/' },
	{ type: 'google', name: _('Google'), url: 'https://www.google.com/' },
	{ type: 'github', name: _('GitHub'), url: 'https://github.com/' },
	{ type: 'youtube', name: _('YouTube'), url: 'https://www.youtube.com/' },
	{ type: 'cloudflare', name: _('Cloudflare'), url: 'https://www.cloudflare.com/' }
];

const connectionTestTimeout = 10000;

function getConnectionStatus() {
	const callConnStat = rpc.declare({
		object: 'luci.homeproxy',
		method: 'connection_check',
		params: ['site'],
		expect: { '': {} }
	});

	const statusElements = {};
	const grid = E('div', { 'class': 'hp-status-grid' }, connectionSites.map((site) => {
		const state = E('span', { 'class': 'hp-card-state', 'style': 'color:var(--cbi-muted-color,#888);' }, '-');
		const latency = E('span', { 'class': 'hp-card-latency' }, '-');
		statusElements[site.type] = { state, latency };

		return E('div', { 'class': 'hp-card' }, [
			E('div', { 'class': 'hp-card-header' }, [
				E('span', { 'class': 'hp-card-title' }, site.name),
				E('a', {
					'class': 'hp-card-link',
					'href': site.url,
					'target': '_blank',
					'rel': 'noreferrer noopener',
					'title': site.url
				}, site.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))
			]),
			E('div', { 'class': 'hp-card-body' }, [
				E('span', {}, [ _('Connection'), ': ', state ]),
				E('span', {}, [ _('Latency'), ': ', latency ])
			])
		]);
	}));

	let running = false;
	let generation = 0;
	let testButton;

	const updateResult = (site, result) => {
		const elements = statusElements[site];
		if (!elements)
			return;

		if (result?.result) {
			elements.state.style.color = 'var(--cbi-success-color, #10b981)';
			dom.content(elements.state, _('Success'));
			dom.content(elements.latency, result.latency_ms + ' ms');
		} else {
			elements.state.style.color = 'var(--cbi-error-color, #ef4444)';
			dom.content(elements.state, result?.timed_out ? _('Timed out') : _('Failed'));
			dom.content(elements.latency, '-');
		}
	};

	const runAllTests = () => {
		if (running)
			return Promise.resolve();

		running = true;
		testButton.disabled = true;
		const currentGeneration = ++generation;
		connectionSites.forEach((site) => {
			const elements = statusElements[site.type];
			elements.state.style.color = 'var(--cbi-muted-color, #888)';
			dom.content(elements.state, _('Testing...'));
			dom.content(elements.latency, '-');
		});

		return new Promise((resolve) => {
			let settled = false;
			const finish = (result) => {
				if (settled)
					return;

				settled = true;
				resolve(result);
			};
			const timer = window.setTimeout(() => finish({ timed_out: true }), connectionTestTimeout);

			L.resolveDefault(callConnStat('all'), { results: [] }).then((result) => {
				window.clearTimeout(timer);
				finish(result);
			});
		}).then((result) => {
			if (currentGeneration !== generation)
				return;

			const results = {};
			(result.results || []).forEach((siteResult) => {
				results[siteResult.site] = siteResult;
			});
			connectionSites.forEach((site) => {
				updateResult(site.type, results[site.type] || {
					result: false,
					timed_out: !!result.timed_out
				});
			});
		}).finally(() => {
			if (currentGeneration === generation) {
				running = false;
				testButton.disabled = false;
			}
		});
	};

	testButton = E('button', {
		'class': 'btn cbi-button cbi-button-action',
		'style': 'margin-left:4px',
		'click': ui.createHandlerFn(this, runAllTests)
	}, [ _('Test all') ]);

	const view = E('div', { 'class': 'cbi-map homeproxy-status' }, [
		E('h3', { 'name': 'content', 'style': 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;' }, [
			_('Connection Status'),
			testButton
		]),
		E('div', { 'class': 'cbi-section' }, [ grid ])
	]);

	window.requestAnimationFrame(() => {
		runAllTests();
	});

	return view;
}

const resources = [
	{
		type: 'china_ip4',
		name: _('China IPv4 list')
	},
	{
		type: 'china_ip6',
		name: _('China IPv6 list')
	},
	{
		type: 'geosite_cn',
		name: _('China domain rule set')
	},
	{
		type: 'dashboard',
		name: _('Dashboard')
	}
];

function getResources(o) {
	const callResStatus = rpc.declare({
		object: 'luci.homeproxy',
		method: 'resources_get',
		expect: { '': {} }
	});

	const callResUpdate = rpc.declare({
		object: 'luci.homeproxy',
		method: 'resources_update',
		expect: { '': {} }
	});

	return L.resolveDefault(callResStatus(), { resources: [] }).then((result) => {
		const status = {};
		(result.resources || []).forEach((resource) => {
			status[resource.type] = resource;
		});
		const list = E('div', { 'class': 'hp-status-grid' }, resources.map((resource) => {
			const resourceStatus = status[resource.type] || {};
			const available = resourceStatus.version;
			const source = resourceStatus.source;

			return E('div', { 'class': 'hp-card' }, [
				E('div', { 'class': 'hp-card-header' }, [
					E('span', { 'class': 'hp-card-title' }, resource.name),
					E('span', {
						'class': 'hp-badge ' + (available ? 'hp-badge-success' : 'hp-badge-danger')
					}, [ available ? ('' + available) : _('Unavailable') ])
				]),
				source ? E('div', { 'style': 'margin-top:auto;padding-top:6px;' }, [
					E('a', {
						'class': 'hp-card-link',
						'href': source,
						'target': '_blank',
						'rel': 'noreferrer noopener',
						'title': source,
						'style': 'max-width:100%;display:block;'
					}, source.replace(/^https?:\/\//, ''))
				]) : ''
			]);
		}));

		return E('div', { 'class': 'cbi-map homeproxy-status' }, [
			E('h3', { 'name': 'content', 'style': 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;' }, [
				_('Resource Management'),
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, () => {
						return L.resolveDefault(callResUpdate(), {}).then((res) => {
							let message, severity = 'info';

							if (res.apply_failed) {
								message = _('Resources were updated, but HomeProxy failed to reload. Check the log for details.');
								severity = 'error';
							} else {
								switch (res.status) {
								case 0:
									message = _('Successfully updated.');
									break;
								case 1:
									message = _('Update failed.');
									severity = 'error';
									break;
								case 2:
									message = _('Update already in progress.');
									break;
								case 3:
									message = _('Already at the latest version.');
									break;
								case 4:
									message = _('Some resources failed to update. Check the log for details.');
									severity = 'warning';
									break;
								default:
									message = _('Unknown error.');
									severity = 'error';
									break;
								}
							}

							ui.addNotification(null, E('p', message), severity);
							return o.map.reset();
						});
					})
				}, [ _('Update all') ])
			]),
			E('div', { 'class': 'cbi-section' }, [ list ])
		]);
	});
}

function getRuntimeLog(o, name, _option_index, section_id, _in_table) {
	const filename = o.option.split('_')[1];

	let section, log_level_el;
	switch (filename) {
	case 'homeproxy':
		section = null;
		break;
	case 'sing-box-c':
		section = 'config';
		break;
	case 'sing-box-s':
		section = 'server';
		break;
	}

	if (section) {
		const selected = uci.get('homeproxy', section, 'log_level') || 'warn';
		const choices = {
			trace: _('Trace'),
			debug: _('Debug'),
			info: _('Info'),
			warn: _('Warn'),
			error: _('Error'),
			fatal: _('Fatal'),
			panic: _('Panic')
		};

		log_level_el = E('select', {
			'id': o.cbid(section_id),
			'class': 'cbi-input-select',
			'style': 'margin-left: 4px; width: 6em;',
			'change': ui.createHandlerFn(this, (ev) => {
				uci.set('homeproxy', section, 'log_level', ev.target.value);
				return o.map.save(null, true).then(() => {
					ui.changes.apply(true);
				});
			})
		});

		Object.keys(choices).forEach((v) => {
			log_level_el.appendChild(E('option', {
				'value': v,
				'selected': (v === selected) ? '' : null
			}, [ choices[v] ]));
		});
	}

	const callLogRead = rpc.declare({
		object: 'luci.homeproxy', method: 'log_read', params: ['type'],
		expect: { '': {} }, reject: true
	});

	const callLogClean = rpc.declare({
		object: 'luci.homeproxy',
		method: 'log_clean',
		params: ['type'],
		expect: { '': {} }
	});

	const log_textarea = E('div', { 'id': 'log_textarea' },
		E('img', {
			'src': L.resource('icons/loading.svg'),
			'alt': _('Loading'),
			'style': 'vertical-align:middle'
		}, _('Collecting data...'))
	);

	let log;
	poll.add(L.bind(() => {
		return callLogRead(filename)
		.then((res) => {
			if (res.error)
				throw new Error(res.error);
			log = E('pre', { 'wrap': 'pre' }, [
				(res.content || '').slice(-131072).trim() || _('Log is empty.')
			]);

			dom.content(log_textarea, log);
		}).catch((err) => {
			if (err.toString().includes('NotFoundError'))
				log = E('pre', { 'wrap': 'pre' }, [
					_('Log file does not exist.')
				]);
			else
				log = E('pre', { 'wrap': 'pre' }, [
					_('Unknown error: %s.').format(err)
				]);

			dom.content(log_textarea, log);
		});
	}));

	return E([
		E('style', [ css ]),
		E('div', {'class': 'cbi-map homeproxy-status'}, [
			E('h3', {'name': 'content', 'style': 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;'}, [
				_('%s Log').format(name),
				E('div', {'style': 'display:flex;align-items:center;gap:6px;'}, [
					log_level_el || '',
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': ui.createHandlerFn(this, () => {
						return L.resolveDefault(callLogClean(filename), {}).then((res) => {
							if (res.result === false)
								throw new Error(res.error || _('Failed to clean log.'));
							dom.content(log_textarea, E('pre', { 'wrap': 'pre' }, [ _('Log is empty.') ]));
							ui.addNotification(null, E('p', _('Log cleaned.')), 'info');
						}).catch((err) => {
							ui.addNotification(null, E('p', _('Failed to clean log: %s.').format(err.message || err)), 'error');
						});
					})
					}, [ _('Clean log') ])
				])
			]),
			E('div', {'class': 'cbi-section'}, [
				log_textarea,
				E('div', {'style': 'text-align:right'},
					E('small', {}, _('Refresh every %s seconds.').format(L.env.pollinterval))
				)
			])
		])
	]);
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
		o.render = L.bind(getResources, this, o);

		s = m.section(form.NamedSection, 'config', 'homeproxy');
		s.anonymous = true;

		o = s.option(form.DummyValue, '_homeproxy_logview');
		o.render = L.bind(getRuntimeLog, this, o, _('HomeProxy'));

		o = s.option(form.DummyValue, '_sing-box-c_logview');
		o.render = L.bind(getRuntimeLog, this, o, _('sing-box Client'));

		o = s.option(form.DummyValue, '_sing-box-s_logview');
		o.render = L.bind(getRuntimeLog, this, o, _('sing-box Server'));

		return m.render();
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
