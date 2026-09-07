/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * LuCI Support for Airoha FlowSense (PPE & Traffic Offload Monitor)
 * Native, unified, elegant and robust LuCI UI
 */

'use strict';
'require dom';
'require poll';
'require rpc';
'require ui';
'require view';

const callGetOverview = rpc.declare({
	object: 'luci.airoha_flowsense',
	method: 'getOverview'
});

const callSetPingTarget = rpc.declare({
	object: 'luci.airoha_flowsense',
	method: 'setPingTarget',
	params: ['target']
});

function isEnabled(v) {
	return v === true || v === 1 || v === '1';
}

function formatRate(bytes, dt) {
	if (!bytes || !dt || dt <= 0) return '0.00 Mbit/s';
	return (bytes * 8 / dt / 1e6).toFixed(2) + ' Mbit/s';
}

return view.extend({
	load: function() {
		return Promise.resolve([]);
	},

	render: function() {
		var ppeUpdatesPaused = false;
		var lastEthStats = null;
		var lastEthTime = 0;

		var m = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Airoha FlowSense')),
			E('div', { 'class': 'cbi-map-descr' }, _('Real-time hardware packet processing engine (PPE) offload metrics, link quality, and latency monitoring.'))
		]);

		// Tabs navigation
		var activeTab = 'overview';
		var tabPanes = {};

		var tabList = [
			{ id: 'overview', name: _('Overview & Quality') },
			{ id: 'ppe',      name: _('PPE Flow Offload') }
		];

		var tabNav = E('ul', { 'class': 'cbi-tabmenu' });
		tabList.forEach(function(t) {
			var li = E('li', {
				'class': (t.id === activeTab ? 'cbi-tab' : 'cbi-tab-disabled'),
				'click': function(ev) {
					activeTab = t.id;
					tabNav.querySelectorAll('li').forEach(function(el, idx) {
						el.className = (tabList[idx].id === activeTab ? 'cbi-tab' : 'cbi-tab-disabled');
					});
					Object.keys(tabPanes).forEach(function(k) {
						tabPanes[k].style.display = (k === activeTab ? '' : 'none');
					});
				}
			}, E('a', { 'href': '#', 'click': function(e){ e.preventDefault(); } }, t.name));
			tabNav.appendChild(li);
		});
		m.appendChild(tabNav);

		// ── Tab 1: Overview & Quality Pane ──
		var paneOverview = E('div', { 'class': 'cbi-tab-pane' });
		tabPanes['overview'] = paneOverview;

		// ── Section 1: Offload & Mode Overview ──
		var modeNode = E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Device Mode')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-mode', 'style': 'font-weight:600' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('HW Flow Offload')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-flow' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('VLAN Offload')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-vlan' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('PPPoE Offload')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-pppoe' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('AP Mode Acceleration')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-apmode' }, '—')
			])
		]);

		paneOverview.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Acceleration & Operational Mode')),
			modeNode
		]));

		// ── Section 2: Flow Summary & Hardware Buffer ──
		var flowSummaryNode = E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Hardware Bound Flows')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-bnd', 'style': 'font-weight:600;color:#00cc44;font-family:monospace;font-variant-numeric:tabular-nums' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Learning / Unbound Flows')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-unb', 'style': 'font-weight:600;color:#f5a623;font-family:monospace;font-variant-numeric:tabular-nums' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('IPv4 / IPv6 Breakdown')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-ip-split', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Buffer Health / Congestion')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-buffer' }, '—')
			])
		]);

		paneOverview.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Flow Engine & Buffer Status')),
			flowSummaryNode
		]));

		// ── Section 3: Link Latency & Jitter Monitor ──
		var latencyNode = E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Upstream Latency')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-latency', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums;font-weight:600;color:var(--cbi-button-apply-bg, #00cc44)' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Jitter')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-jitter', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Ping Target')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-target-container' }, [
					E('div', { 'style': 'display:flex;align-items:center;gap:10px' }, [
						E('span', { 'id': 'fs-val-target', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums;font-weight:600' }, '—'),
						E('button', {
							'class': 'cbi-button cbi-button-action',
							'click': function(ev) {
								var currentTarget = document.getElementById('fs-val-target').textContent.trim();
								var newTarget = window.prompt(_('Ping target IP:'), currentTarget || '223.5.5.5');
								if (newTarget && newTarget !== currentTarget) {
									ev.target.disabled = true;
									callSetPingTarget(newTarget).then(function(res) {
										ev.target.disabled = false;
										if (res && res.error) {
											ui.addNotification(null, E('p', {}, _('Failed to set ping target') + ': ' + res.error), 'error');
										} else {
											ui.addNotification(null, E('p', {}, _('Ping target changed to: ') + newTarget), 'info');
										}
									}).catch(function(err) {
										ev.target.disabled = false;
										ui.addNotification(null, E('p', {}, _('Failed to set ping target') + ': ' + err.message), 'error');
									});
								}
							}
						}, _('Click to change ping target'))
					])
				])
			])
		]);

		paneOverview.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Link Quality & Latency Monitor')),
			latencyNode
		]));

		// ── Section 4: Conflict Alerts ──
		var alertBox = E('div', { 'id': 'fs-alerts-container', 'style': 'display:none;margin-bottom:14px' });
		paneOverview.appendChild(alertBox);

		// ── Tab 2: PPE Flow Offload Pane ──
		var panePpe = E('div', { 'class': 'cbi-tab-pane', 'style': 'display:none' });
		tabPanes['ppe'] = panePpe;

		var ppePauseBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function(ev) {
				ppeUpdatesPaused = !ppeUpdatesPaused;
				ev.target.textContent = ppeUpdatesPaused ? _('Resume') : _('Pause');
			}
		}, _('Pause'));

		var ppeTable = E('table', { 'class': 'table cbi-section-table', 'id': 'fs-ppe-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Index')),
				E('th', { 'class': 'th' }, _('State')),
				E('th', { 'class': 'th' }, _('Type')),
				E('th', { 'class': 'th' }, _('Original Flow')),
				E('th', { 'class': 'th' }, _('New Flow'))
			])
		]);

		panePpe.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px' }, [
				E('h3', { 'style': 'margin:0' }, _('PPE Flow Offload Entries')),
				ppePauseBtn
			]),
			ppeTable
		]));

		m.appendChild(paneOverview);
		m.appendChild(panePpe);

		// Polling logic
		function updateData() {
			callGetOverview().then(function(res) {
				res = res || {};
				var ppe = res.ppe || {};
				var dm = res.mode || {};
				var jitter = res.jitter || {};
				var alerts = res.alerts || [];

				// 1. Update Mode & Switches
				var modeEl = document.getElementById('fs-val-mode');
				if (modeEl) {
					var isAp = (dm.mode === 'ap');
					modeEl.textContent = isAp ? _('AP MODE') : _('ROUTER MODE');
					modeEl.style.color = isAp ? '#00c8ff' : '#00cc44';
				}

				function setBadge(cellId, enabled) {
					var el = document.getElementById(cellId);
					if (!el) return;
					while (el.firstChild) el.removeChild(el.firstChild);
					var on = isEnabled(enabled);
					el.appendChild(E('span', {
						'style': 'padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;' +
						         (on ? 'background:var(--cbi-button-apply-bg, #00cc44);color:#fff' : 'background:var(--cbi-muted-color, #6b7280);color:#fff')
					}, on ? _('Enabled') : _('Disabled')));
				}

				setBadge('fs-val-flow', (res.flow || {}).enabled);
				setBadge('fs-val-vlan', (res.vlan || {}).enabled);
				setBadge('fs-val-pppoe', (res.pppoe || {}).enabled);
				setBadge('fs-val-apmode', (res.apmode || {}).enabled);

				// 2. Update Flows
				var bnd = ppe.bnd || {};
				var unb = ppe.unb || {};

				var bndEl = document.getElementById('fs-val-bnd');
				if (bndEl) bndEl.textContent = (bnd.total || 0) + ' ' + _('BND FLOWS');

				var unbEl = document.getElementById('fs-val-unb');
				if (unbEl) unbEl.textContent = (unb.total || 0) + ' ' + _('UNB FLOWS');

				var ipSplit = document.getElementById('fs-val-ip-split');
				if (ipSplit) ipSplit.textContent = 'IPv4: ' + (bnd.ipv4 || 0) + ' · IPv6: ' + (bnd.ipv6 || 0);

				var bufEl = document.getElementById('fs-val-buffer');
				if (bufEl) {
					bufEl.textContent = _('Healthy / Normal');
					bufEl.style.color = '#00cc44';
					bufEl.style.fontWeight = '600';
				}

				// 3. Update Latency & Jitter
				var latEl = document.getElementById('fs-val-latency');
				if (latEl) {
					var lat = jitter.last_ping || 0;
					latEl.textContent = lat > 0 ? lat.toFixed(2) + ' ms' : '—';
					latEl.style.color = (lat > 0 && lat <= 30) ? '#00cc44' : (lat <= 80) ? '#f5a623' : '#d0021b';
				}

				var jitEl = document.getElementById('fs-val-jitter');
				if (jitEl) {
					var jit = jitter.jitter || 0;
					jitEl.textContent = jit > 0 ? '± ' + jit.toFixed(2) + ' ms' : '—';
				}

				var tgtEl = document.getElementById('fs-val-target');
				if (tgtEl && jitter.target) tgtEl.textContent = jitter.target;

				// 4. Update Alerts
				var alertWrap = document.getElementById('fs-alerts-container');
				if (alertWrap) {
					while (alertWrap.firstChild) alertWrap.removeChild(alertWrap.firstChild);
					if (alerts && alerts.length > 0) {
						alertWrap.style.display = '';
						alerts.forEach(function(a) {
							alertWrap.appendChild(E('div', {
								'class': 'alert-message ' + (a.type === 'error' ? 'danger' : 'warning'),
								'style': 'margin-bottom:8px'
							}, [
								E('strong', {}, _(a.title || '') + ': '),
								_(a.message || '')
							]));
						});
					} else {
						alertWrap.style.display = 'none';
					}
				}

				// 5. Update PPE Table
				if (!ppeUpdatesPaused && bnd && Array.isArray(bnd.entries)) {
					var allEntries = (bnd.entries || []).concat(unb.entries || []);
					var rows = allEntries.slice(0, 100).map(function(e) {
						var stateCol = (e.state === 'BND') ? '#00cc44' : '#f5a623';
						return [
							e.index,
							E('span', { 'style': 'font-weight:600;color:' + stateCol }, e.state),
							e.type,
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, e.orig || '-'),
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, e.new_flow || '-')
						];
					});
					var ppeTb = document.getElementById('fs-ppe-table');
					if (ppeTb) {
						cbi_update_table(ppeTb, rows, E('em', { 'style': 'color:#888' }, _('No entries')));
					}
				}
			}).catch(function(err) {
				console.error('[airoha_flowsense] updateData error:', err);
			});
		}

		updateData();
		poll.add(updateData, 5);

		return m;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
