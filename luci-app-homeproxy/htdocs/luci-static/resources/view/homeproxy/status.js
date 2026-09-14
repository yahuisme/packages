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
'require rpc';
'require uci';
'require ui';
'require view';

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
const visuallyHiddenStyle = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

function getConnectionStatus() {
	const callConnStat = rpc.declare({
		object: 'luci.homeproxy',
		method: 'connection_check',
		params: ['site'],
		expect: { '': {} }
	});

	const table = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Website')),
			E('th', { 'class': 'th' }, _('URL')),
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

	testButton = E('button', {
		'class': 'btn cbi-button cbi-button-action',
		'style': 'margin-left:4px',
		'click': ui.createHandlerFn(this, runAllTests)
	}, [ _('Test all') ]);

	const view = E('div', { 'class': 'cbi-map' }, [
		E('h3', { 'name': 'content', 'style': 'align-items:center;display:flex' }, [
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
	const callResStatus = rpc.declare({
		object: 'luci.homeproxy',
		method: 'resources_get',
		expect: { '': {} }
	});

	const callResUpdate = rpc.declare({
		object: 'luci.homeproxy',
		method: 'resources_update',
		params: ['scope'],
		expect: { '': {} }
	});

	const callDashboard = rpc.declare({
		object: 'luci.homeproxy', method: 'dashboard_manage', params: ['action'], expect: { '': {} }
	});
	const state = this.resourceSession || (this.resourceSession = { busy: false });
	const buttons = [];
	const runDashboard = (action) => {
		if (state.busy) return;
		state.busy = true;
		buttons.forEach((b) => { b.disabled = true; });
		return L.resolveDefault(callDashboard(action), {}).then((res) => {
			const ok = res.status === 0 || res.status === 3;
			const message = res.rollback_failed ? _('Recovery failed. Check the log and retained backup before retrying.') :
				res.apply_failed ? _('HomeProxy failed to reload. The previous dashboard was restored.') :
				res.status === 2 ? _('Update already in progress.') :
				res.status === 3 ? _('No changes needed.') :
				ok ? _('Dashboard operation completed.') : _('Dashboard operation failed. Check the log for details.');
			ui.addNotification(null, E('p', {}, [ message ]), ok ? 'info' : 'error');
		}).finally(() => {
			state.busy = false;
			buttons.forEach((b) => { b.disabled = false; });
		}).then(() => o.map.reset());
	};
	const rulesButton = (label, scope) => {
		const button = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'disabled': state.busy ? '' : null,
			'click': ui.createHandlerFn(this, () => {
				if (state.busy) return;
				state.busy = true;
				buttons.forEach((b) => { b.disabled = true; });
				return L.resolveDefault(callResUpdate(scope), {}).then((res) => {
					let message, severity = 'info';

					if (res.rollback_failed) {
						message = _('Recovery failed. Check the log and retained backup before retrying.');
						severity = 'error';
					} else if (res.apply_failed) {
						message = _('HomeProxy failed to reload. The previous resources were restored.');
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
				}).finally(() => {
					state.busy = false;
					buttons.forEach((b) => { b.disabled = false; });
				}).then(() => o.map.reset());
			})
		}, [ label ]);
		buttons.push(button);
		return button;
	};
	const dashboardButton = (label, action) => {
		const button = E('button', {
			'class': 'btn cbi-button ' + (action === 'remove' ? 'cbi-button-negative' : 'cbi-button-action'),
			'disabled': state.busy ? '' : null,
			'click': ui.createHandlerFn(this, () => {
				if (action !== 'remove') return runDashboard(action);
				ui.showModal(_('Remove dashboard?'), [
					E('p', {}, [ _('Dashboard files will be removed and the running service reloaded. Settings are retained. Rule sets are not affected.') ]),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Cancel') ]),
						E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, () => {
							ui.hideModal(); return runDashboard('remove');
						}) }, [ _('Remove') ])
					])
				]);
			})
		}, [ label ]);
		buttons.push(button);
		return button;
	};
	return L.resolveDefault(callResStatus(), { resources: [] }).then((result) => {
		const status = {};
		(result.resources || []).forEach((resource) => {
			status[resource.type] = resource;
		});
		const table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Name')),
				E('th', { 'class': 'th' }, _('Version')),
				E('th', { 'class': 'th' }, _('Actions'))
			])
		]);
		const rows = resources.map((resource) => {
			const resourceStatus = status[resource.type] || {};
			const available = resourceStatus.version;
			const source = resourceStatus.source;
			const dashboard = resource.type === 'dashboard';
			const installed = resourceStatus.installed === true;

			return [
				source ? E('a', { 'href': source, 'target': '_blank', 'rel': 'noreferrer noopener' }, [ resource.name ]) : resource.name,
				E('span', {}, [ dashboard && !installed ? _('Not installed') : available || _('Unknown version') ]),
				dashboard ? E('div', { 'class': 'hp-resource-actions' }, installed ? [ dashboardButton(_('Update'), 'update'), dashboardButton(_('Remove'), 'remove') ] : [ dashboardButton(_('Download'), 'update') ]) :
				rulesButton(_('Update'), resource.type === 'geoip_cn' ? 'geoip' : 'geosite')

			];
		});
		cbi_update_table(table, rows);

		return E('div', { 'class': 'cbi-map hp-resources' }, [
			E('style', {}, [ '.hp-resources .hp-resource-actions{display:flex;flex-wrap:wrap;gap:8px}.hp-resources button{min-height:32px;font-weight:500}.hp-resources h3{flex-wrap:wrap;gap:8px}.hp-resources td{overflow-wrap:anywhere}.hp-resources .table{width:100%;table-layout:fixed}' ]),
			E('h3', { 'name': 'content', 'style': 'align-items:center;display:flex' }, [
				_('Resource Management'),
				rulesButton(_('Update resources'), 'manual')
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
			'style': 'width: 6em;',
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
		'class': 'cbi-input-textarea',
		'aria-label': _('%s Log').format(name),
		'readonly': true,
		'wrap': 'off',
		'spellcheck': 'false',
		'rows': 20,
		'style': 'width:100%; font-family:monospace; white-space:pre; overflow:auto;'
	}, [ _('Collecting data...') ]);

	const log_status = E('span', {
		'role': 'status',
		'aria-live': 'polite',
		'aria-atomic': 'true',
		'style': visuallyHiddenStyle
	}, '');

	function updateLog(result) {
		const content = result.content;
		if (log_textarea.value === content)
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
		dom.content(log_status, result.status === 'unavailable' ? _('Log unavailable.') :
			result.status === 'empty' ? _('Log is empty.') : _('Log updated.'));
	}

	lifecycle.poll(log_textarea, 'log:' + filename, () => {
		return fs.read_direct(String.format('%s/%s.log', hp_dir, filename), 'text')
		.then((res) => res ? { status: 'updated', content: res } :
			{ status: 'empty', content: _('Log is empty.') }).catch((err) => {
			return { status: 'unavailable', content: err?.name === 'NotFoundError'
				? _('Log file does not exist.') : _('Unknown error: %s.').format(err) };
		});
	}, updateLog);

	return E([
		E('div', {'class': 'cbi-map'}, [
			E('h3', {'name': 'content', 'style': 'align-items: center; display: flex; flex-wrap: wrap; gap: 8px;'}, [
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
				log_status,
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
