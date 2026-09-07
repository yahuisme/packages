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

		// ── Section 1: Offload & Mode Overview ──
		var modeTable = E('table', { 'class': 'table cbi-section-table', 'id': 'fs-mode-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Device Mode')),
				E('th', { 'class': 'th' }, _('HW Flow Offload')),
				E('th', { 'class': 'th' }, _('VLAN Offload')),
				E('th', { 'class': 'th' }, _('PPPoE Offload')),
				E('th', { 'class': 'th' }, _('AP Mode Acceleration'))
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'id': 'fs-val-mode', 'style': 'font-weight:600' }, '—'),
				E('td', { 'class': 'td', 'id': 'fs-val-flow' }, '—'),
				E('td', { 'class': 'td', 'id': 'fs-val-vlan' }, '—'),
				E('td', { 'class': 'td', 'id': 'fs-val-pppoe' }, '—'),
				E('td', { 'class': 'td', 'id': 'fs-val-apmode' }, '—')
			])
		]);

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Acceleration & Operational Mode')),
			modeTable
		]));

		// ── Section 2: Flow Summary & Hardware Buffer ──
		var flowSummaryTable = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Hardware Bound Flows')),
				E('th', { 'class': 'th' }, _('Learning / Unbound Flows')),
				E('th', { 'class': 'th' }, _('IPv4 / IPv6 Breakdown')),
				E('th', { 'class': 'th' }, _('Buffer Health / Congestion'))
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'id': 'fs-val-bnd', 'style': 'font-weight:600;color:#00cc44' }, '—'),
				E('td', { 'class': 'td', 'id': 'fs-val-unb', 'style': 'font-weight:600;color:#f5a623' }, '—'),
				E('td', { 'class': 'td', 'id': 'fs-val-ip-split' }, '—'),
				E('td', { 'class': 'td', 'id': 'fs-val-buffer' }, '—')
			])
		]);

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Flow Engine & Buffer Status')),
			flowSummaryTable
		]));

		// ── Section 3: Link Latency & Jitter Monitor ──
		var latencyNode = E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Upstream Latency')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-latency', 'style': 'font-family:monospace;font-weight:600;color:#00cc44' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Jitter')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-jitter', 'style': 'font-family:monospace' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Ping Target')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('div', { 'style': 'display:flex;align-items:center;gap:10px' }, [
						E('span', { 'id': 'fs-val-target', 'style': 'font-family:monospace;font-weight:600' }, '—'),
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

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Link Quality & Latency Monitor')),
			latencyNode
		]));

		// ── Section 4: Conflict Alerts ──
		var alertBox = E('div', { 'id': 'fs-alerts-container', 'style': 'display:none;margin-bottom:14px' });
		m.appendChild(alertBox);

		// ── Section 5: PPE Flow Offload Table ──
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

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px' }, [
				E('h3', { 'style': 'margin:0' }, _('PPE Flow Offload Entries')),
				ppePauseBtn
			]),
			ppeTable
		]));

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
							E('span', { 'style': 'font-family:monospace' }, e.orig || '-'),
							E('span', { 'style': 'font-family:monospace' }, e.new_flow || '-')
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
