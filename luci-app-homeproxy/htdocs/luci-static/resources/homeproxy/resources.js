'use strict';
'require baseclass';
'require homeproxy.lifecycle as lifecycle';
'require rpc';
'require uci';
'require ui';

// One session/lock survives native Map resets and route changes.
const resourceSession = { busy: false, revision: 0, results: {}, views: new Set() };
const callResStatus = rpc.declare({ object: 'luci.homeproxy', method: 'resources_get', expect: { '': {} }, reject: true });
const callResUpdate = rpc.declare({ object: 'luci.homeproxy', method: 'resources_update', params: ['scope'], expect: { '': {} }, reject: true });
const callDashboard = rpc.declare({ object: 'luci.homeproxy', method: 'dashboard_manage', params: ['action'], expect: { '': {} }, reject: true });
function openDashboard() {
	return L.resolveDefault(callResStatus(), {}).then((res) => {
		const dashboard = Array.isArray(res.resources) ? res.resources.find((r) => r?.type === 'dashboard') : null;
		if (dashboard?.installed !== true) {
			ui.addNotification(null, E('p', {}, [ dashboard?.installed === false ? _('Not installed') : _('Status unavailable') ]), 'warning');
			return;
		}
		let host = window.location.hostname;
		if (host.includes(':') && !host.startsWith('[')) host = '[' + host + ']';
		window.open('http://' + host + ':' + (uci.get('homeproxy', 'config', 'dashboard_port') || '9095') + '/dashboard/', '_blank', 'noopener,noreferrer');
	});
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

function getResources(o, types) {
	const state = resourceSession;
	const buttons = [];
	const resourceResults = {};
	let root;
	const sync = () => buttons.forEach((b) => {
		b.disabled = state.busy || (o.map.readonly && b.dataset.readOnly !== 'true');
	});
	const refresh = () => getResources(o, types).then((fresh) => {
		if (root.isConnected) root.replaceWith(fresh);
	});
	const setResourceResult = (type, text, status) => {
		state.results[type] = { text, status };
		const element = resourceResults[type];
		if (element) {
			element.textContent = text;
			element.dataset.status = status;
		}
	};
	const showResult = (type, res, action) => {
		let text, status = 'error';
		if (res.rollback_failed)
			text = _('Recovery failed. Check the log and retained backup before retrying.');
		else if (res.apply_failed)
			text = _('HomeProxy failed to reload. The previous resources were restored.');
		else if (res.status === 0) {
			text = action === 'remove' ? _('Deleted') : action === 'download' ? _('Downloaded') : _('Updated');
			status = 'success';
		} else if (res.status === 3) {
			text = action === 'remove' ? _('Not installed') : _('Already at the latest version.');
			status = action === 'remove' ? 'neutral' : 'success';
		} else if (res.status === 2) {
			text = _('Update already in progress.');
			status = 'neutral';
		} else
			text = _('Update failed.');
		setResourceResult(type, text, status);
	};
	const run = (scope, action) => {
		if (state.busy) return;
		state.busy = true;
		state.views.forEach((view) => view.sync());
		const targets = scope === 'status' ? [] : scope === 'manual' ? ['geoip_cn', 'geosite_cn'] :
			[scope === 'geoip' ? 'geoip_cn' : scope === 'geosite' ? 'geosite_cn' : 'dashboard'];
		// Manual participation comes from the locked backend transaction, not the DOM.
		if (scope === 'manual') {
			resources.forEach((r) => setResourceResult(r.type, '', 'neutral'));
		} else targets.forEach((type) => setResourceResult(type, _('Updating…'), 'pending'));
		return L.resolveDefault(scope === 'status' ? Promise.resolve({}) :
			scope === 'dashboard' ? callDashboard(action === 'remove' ? 'remove' : 'update') : callResUpdate(scope), {}).then((res) => {
			if (scope === 'manual' && Array.isArray(res.resources) && res.resources.length) {
				res.resources.forEach((item) => {
					if (item && resources.some((r) => r.type === item.type))
						showResult(item.type, Object.assign({}, item, {
							apply_failed: res.apply_failed, rollback_failed: res.rollback_failed
						}));
				});
			} else {
				// No per-item evidence (e.g. lock/transport failure): never claim success.
				targets.forEach((type) => showResult(type, scope === 'manual' ?
					{ status: res.status === 2 ? 2 : 1, apply_failed: res.apply_failed, rollback_failed: res.rollback_failed } : res, action));
			}
			// Invalidate reads begun before this transaction settled, including detached
			// widgets still being rendered by a concurrent native Map.reset().
			state.revision++;
			// Refresh only resource widgets, including a replacement created during the RPC.
			// Never reset unrelated, unsaved client settings.
			return Promise.all(Array.from(state.views, (view) => view.refresh()));
		}).finally(() => {
			state.busy = false;
			// Reset recreates all buttons while the shared lock is still held.
			state.views.forEach((view) => view.sync());
		});
	};
	const runDashboard = (action) => run('dashboard', action);
	const rulesButton = (label, scope) => {
		const button = E('button', { 'type': 'button',
			'class': 'btn cbi-button cbi-button-action',
			'disabled': state.busy || (o.map.readonly && scope !== 'status') ? '' : null,
			'data-read-only': scope === 'status' ? 'true' : 'false',
			'click': ui.createHandlerFn(this, () => { if (!o.map.readonly || scope === 'status') return run(scope); })
		}, [ label ]);
		buttons.push(button);
		return button;
	};
	const openButton = () => {
		const button = E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-apply',
			'data-read-only': 'true', disabled: state.busy ? '' : null,
			click: ui.createHandlerFn(this, openDashboard) }, _('Open dashboard'));
		buttons.push(button);
		return button;
	};
	const dashboardButton = (label, action, result) => {
		const button = E('button', { 'type': 'button',
			'class': 'btn cbi-button ' + (action === 'remove' ? 'cbi-button-negative' : 'cbi-button-action'),
			'disabled': state.busy || o.map.readonly ? '' : null,
			'click': ui.createHandlerFn(this, () => {
				if (o.map.readonly) return;
				if (action !== 'remove') return runDashboard(action, result);
				ui.showModal(_('Remove dashboard?'), [
					E('style', {}, [ '#modal_overlay > .hp-resource-modal { max-width: 100%; }' ]),
					E('p', {}, [ _('Dashboard files will be removed and the running service reloaded. Settings are retained. Rule sets are not affected.') ]),
					E('div', { 'class': 'right' }, [
						E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, [ _('Cancel') ]),
						E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, () => {
							ui.hideModal(); return runDashboard('remove', result);
						}) }, [ _('Remove') ])
					])
				], 'hp-resource-modal');
			})
		}, [ label ]);
		buttons.push(button);
		return button;
	};
	const revision = state.revision;
	return L.resolveDefault(callResStatus(), {}).then((result) => {
		if (revision !== state.revision) return getResources(o, types);
		const status = {};
		(Array.isArray(result.resources) ? result.resources : []).forEach((resource) => {
			if (resource && typeof resource.type === 'string')
				status[resource.type] = resource;
		});
		const table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Name')),
				E('th', { 'class': 'th' }, _('Version')),
				E('th', { 'class': 'th' }, _('Actions'))
			])
		]);
		const rows = resources.filter((r) => types.includes(r.type)).map((resource) => {
			const resourceStatus = status[resource.type] || {};
			const available = resourceStatus.version;
			const source = resourceStatus.source;
			const dashboard = resource.type === 'dashboard';
			const manageDashboard = types.length === 1;
			const known = typeof resourceStatus.installed === 'boolean';
			const installed = resourceStatus.installed === true;
			const result = E('span', { 'class': 'hp-resource-result', 'aria-live': 'polite' }, []);
			resourceResults[resource.type] = result;
			const saved = state.results[resource.type];
			if (saved) setResourceResult(resource.type, saved.text, saved.status);

			return [
				source ? E('a', { 'href': source, 'target': '_blank', 'rel': 'noreferrer noopener' }, [ resource.name ]) : resource.name,
				E('span', { 'class': 'hp-resource-version', 'style': 'display:block;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere' }, [ dashboard && !known ? _('Status unavailable') : dashboard && !installed ? _('Not installed') : available || _('Unknown version') ]),
				dashboard && !manageDashboard ? E('div', { 'class': 'hp-resource-actions' }, [
					E('a', { href: L.url('admin/services/homeproxy/client') }, _('Dashboard')), result
				]) : dashboard ? E('div', { 'class': 'hp-resource-actions' }, !known ? [ rulesButton(_('Retry'), 'status'), result ] : installed ? [ dashboardButton(_('Update'), 'update', result), dashboardButton(_('Remove'), 'remove', result), ...(uci.get('homeproxy', 'config', 'dashboard_enabled') === '1' ? [ openButton() ] : []), result ] : [ dashboardButton(_('Download'), 'download', result), result ]) :
				E('div', { 'class': 'hp-resource-actions' }, [ rulesButton(_('Update'), resource.type === 'geoip_cn' ? 'geoip' : 'geosite', result), result ])

			];
		});
		cbi_update_table(table, rows);

		root = E('div', { 'class': 'cbi-map hp-resources' }, [
			E('style', {}, [ '.hp-resources .hp-resource-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.hp-resources .hp-resource-result{color:inherit}.hp-resources .hp-resource-result[data-status="success"]{color:var(--success,var(--success-color-high,light-dark(#15803d,#16a34a)))}.hp-resources .hp-resource-result[data-status="error"]{color:var(--danger,var(--error-color-high,light-dark(#b91c1c,#dc2626)))}.hp-resources button{min-height:32px;font-weight:500}.hp-resources h3{flex-wrap:wrap;gap:8px}.hp-resources td{overflow-wrap:anywhere}.hp-resources .table>.tr>.td{min-width:0;overflow-wrap:anywhere}.hp-resources .table{width:100%;table-layout:fixed}' ]),
	E('h3', { 'name': 'content', 'style': 'align-items:center;display:flex;flex-wrap:wrap;gap:8px' }, [
				types.includes('geoip_cn') ? _('Resource Management') : _('Dashboard'),
				...(types.includes('geoip_cn') ? [ rulesButton(_('Update resources'), 'manual') ] : [])
			]),
			E('div', { 'class': 'cbi-section' }, [ table ])
		]);
		const view = { sync, refresh };
		lifecycle.watch(root, () => { state.views.add(view); sync(); }, () => state.views.delete(view));
		return root;
	});
}

return baseclass.extend({ render: getResources });
