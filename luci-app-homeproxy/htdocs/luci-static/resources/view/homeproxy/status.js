/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';
'require dom';
'require form';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

const css = `
.homeproxy-status h3 {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}
.homeproxy-status h3 .cbi-button,
.homeproxy-status h3 select {
	box-sizing: border-box;
	height: 32px;
	min-height: 32px;
	margin: 0;
}
.homeproxy-status h3 select { width: auto; }
.homeproxy-status .hp-connection-success { color: #16803c; }
.homeproxy-status .homeproxy-log {
	box-sizing: border-box;
	height: 256px;
	overflow: auto;
	padding: 8px;
	text-align: left;
}
.homeproxy-status .homeproxy-log pre {
	padding: 0;
	margin: 0;
	border: 0;
	background: none;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
`;

const hp_dir = '/var/run/homeproxy';

const connectionSites = [
	{ type: 'baidu', name: _('Baidu'), url: 'https://www.baidu.com/' },
	{ type: 'bilibili', name: _('Bilibili'), url: 'https://www.bilibili.com/' },
	{ type: 'jd', name: _('JD'), url: 'https://www.jd.com/' },
	{ type: 'google', name: _('Google'), url: 'https://www.google.com/' },
	{ type: 'github', name: _('GitHub'), url: 'https://github.com/' },
	{ type: 'youtube', name: _('YouTube'), url: 'https://www.youtube.com/' }
];

const connectionTestTimeout = 10000;

function getConnectionStatus() {
	const session = this.connectionSession;
	const callConnStat = rpc.declare({
		object: 'luci.homeproxy',
		method: 'connection_check',
		params: ['site'],
		reject: true,
		expect: { '': {} }
	});

	const table = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Website')),
			E('th', { 'class': 'th' }, _('URL')),
			E('th', { 'class': 'th' }, _('Connection')),
			E('th', { 'class': 'th' }, _('Latency'))
		])
	]);
	const statusElements = {};
	const rows = connectionSites.map((site) => {
		const state = E('span', {}, '-');
		const latency = E('span', {}, '-');
		statusElements[site.type] = { state, latency };

		return [
			site.name,
			E('a', {
				'href': site.url,
				'target': '_blank',
				'rel': 'noreferrer noopener',
				'style': 'word-break:break-all'
			}, site.url),
			state,
			latency
		];
	});
	cbi_update_table(table, rows);

	let testButton;

	const updateResult = (site, result) => {
		const elements = statusElements[site];
		if (!elements)
			return;

		elements.state.classList.toggle('hp-connection-success', result?.result === true);
		if (result?.result === true) {
			dom.content(elements.state, _('Success'));
			dom.content(elements.latency, [ typeof result.latency_ms === 'number' && Number.isFinite(result.latency_ms) && result.latency_ms >= 0 ? result.latency_ms + ' ms' : '-' ]);
		} else {
			dom.content(elements.state, result?.timed_out ? _('Timed out') : _('Failed'));
			dom.content(elements.latency, '-');
		}
	};

	// Keep the model on the view, not on widgets recreated by Map.reset().
	const paint = () => {
		testButton.disabled = session.running;
		connectionSites.forEach((site) => {
			if (session.running && !session.results) {
				const elements = statusElements[site.type];
				elements.state.classList.remove('hp-connection-success');
				dom.content(elements.state, _('Testing...'));
				dom.content(elements.latency, '-');
			} else if (session.results) {
				updateResult(site.type, session.results[site.type]);
			}
		});
	};
	const refresh = () => {
		if (session.active && session.root?.isConnected)
			session.paint();
	};
	const runAllTests = () => {
		if (!session.active || !session.root?.isConnected || session.running)
			return Promise.resolve();

		session.running = true;
		session.results = null;
		refresh();
		let settled = false;
		const finish = (result) => {
			if (settled || !session.active || !session.root.isConnected)
				return;
			settled = true;
			window.clearTimeout(session.timer);
			const results = Object.create(null);
			(Array.isArray(result?.results) ? result.results : []).forEach((entry) => {
				if (entry && typeof entry.site === 'string')
					results[entry.site] = entry;
			});
			session.results = Object.create(null);
			connectionSites.forEach((site) => {
				session.results[site.type] = results[site.type] || {
					result: false, timed_out: result?.timed_out === true
				};
			});
			refresh();
		};
		session.timer = window.setTimeout(() => finish({ timed_out: true }), connectionTestTimeout);
		// A UI timeout must not release single-flight while transport is pending.
		return Promise.resolve().then(() => callConnStat('all'))
			.then(finish, () => finish({})).finally(() => {
				window.clearTimeout(session.timer);
				session.running = false;
				refresh();
			});
	};

	testButton = E('button', {
		'class': 'btn cbi-button cbi-button-action',
		'click': ui.createHandlerFn(this, runAllTests)
	}, [ _('Test all') ]);

	const view = E('div', { 'class': 'cbi-map' }, [
		E('h3', { 'name': 'content' }, [
			_('Connection Status'),
			testButton
		]),
		E('div', { 'class': 'cbi-section' }, [ table ])
	]);

	session.paint = paint;
	session.run = runAllTests;
	paint();
	return view;
}

const resources = [
	{
		type: 'geoip_cn',
		name: _('China IP rule set')
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
	const session = this.connectionSession;
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
		const table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Name')),
				E('th', { 'class': 'th' }, _('Version')),
				E('th', { 'class': 'th' }, _('Source'))
			])
		]);
		const rows = resources.map((resource) => {
			const resourceStatus = status[resource.type] || {};
			const available = /^(?:\d{14}|\d{4}-\d{2}-\d{2})$/.test(resourceStatus.version || '') ? resourceStatus.version : null;
			const source = /^https?:\/\//i.test(resourceStatus.source || '') ? resourceStatus.source : null;

			return [
				resource.name,
				E('span', {},
					[ available || '-' ]),
				source ? E('a', {
					'href': source,
					'target': '_blank',
					'rel': 'noreferrer noopener',
					'style': 'word-break:break-all'
				}, [ source ]) : '-'
			];
		});
		cbi_update_table(table, rows);

		return E('div', { 'class': 'cbi-map' }, [
			E('h3', { 'name': 'content' }, [
				_('Resource Management'),
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, () => {
						return L.resolveDefault(callResUpdate(), {}).then((res) => {
							if (!session.active || !session.root.isConnected)
								return;
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
			E('div', { 'class': 'cbi-section' }, [ table ])
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
			'aria-label': _('%s Log').format(name),
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

	const callLogClean = rpc.declare({
		object: 'luci.homeproxy',
		method: 'log_clean',
		params: ['type'],
		expect: { '': {} }
	});

	const log_textarea = E('textarea', {
		'id': filename + '-log',
		'class': 'cbi-input-textarea homeproxy-log',
		'aria-label': _('%s Log').format(name),
		'readonly': true,
		'wrap': 'off',
		'spellcheck': 'false',
		'rows': 20,
		'style': 'width:100%; font-family:monospace; white-space:pre; overflow:auto;'
	}, [ _('Collecting data...') ]);

	let active = true, mounted = false;

	function updateLog(content) {
		if (!active || !log_textarea.isConnected || log_textarea.value === content)
			return;
		const focused = document.activeElement === log_textarea;
		const start = log_textarea.selectionStart, end = log_textarea.selectionEnd;
		const direction = log_textarea.selectionDirection;
		const top = log_textarea.scrollTop, left = log_textarea.scrollLeft;
		log_textarea.value = content;
		if (focused)
			log_textarea.setSelectionRange(start, end, direction);
		log_textarea.scrollTop = top;
		log_textarea.scrollLeft = left;
	}

	const refreshLog = () => {
		if (!active || !log_textarea.isConnected)
			return Promise.resolve();

		return fs.read_direct(String.format('%s/%s.log', hp_dir, filename), 'text')
		.then((res) => {
			updateLog(res || _('Log is empty.'));
		}).catch((err) => {
			if (err.toString().includes('NotFoundError'))
				updateLog(_('Log file does not exist.'));
			else
				updateLog(_('Unknown error: %s.').format(err));
		});
	};

	// Map.reset() replaces widgets without leaving the status view.
	const observer = new MutationObserver(() => {
		if (log_textarea.isConnected) {
			mounted = true;
		} else if (mounted) {
			active = false;
			poll.remove(refreshLog);
			observer.disconnect();
		}
	});
	observer.observe(document.documentElement, { childList: true, subtree: true });
	poll.add(refreshLog);

	return E([
		E('div', {'class': 'cbi-map'}, [
			E('h3', {'name': 'content'}, [
				_('%s Log').format(name),
				log_level_el || '',
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, () => {
						return L.resolveDefault(callLogClean(filename), {});
					})
				}, [ _('Clean log') ])
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
		if (this.statusRender && this.connectionSession.active)
			return this.statusRender;

		const session = this.connectionSession = { active: true, running: false, results: null };
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

		return this.statusRender = m.render().then((node) => {
			const root = session.root = E('div', { 'class': 'homeproxy-status' }, [
				E('style', [ css ]), node
			]);
			let mounted = false;
			const observer = new MutationObserver(() => {
				if (root.isConnected) {
					if (!mounted) {
						mounted = true;
						session.run();
					}
				} else if (mounted) {
					session.active = false;
					window.clearTimeout(session.timer);
					observer.disconnect();
				}
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
			return root;
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
