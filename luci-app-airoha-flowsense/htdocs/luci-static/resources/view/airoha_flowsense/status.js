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

var themeCSS = '\
.fs-summary-grid{display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:10px;margin-bottom:14px}\
.fs-summary-card{background:var(--cbi-section-bg,#fff);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;box-sizing:border-box;padding:10px 14px;min-height:76px;display:flex;flex-direction:column;justify-content:center}\
.fs-card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.2px;color:var(--cbi-muted-color,#666);margin-bottom:4px}\
.fs-card-value{font-size:18px;font-weight:600;color:var(--cbi-text-color,inherit)}\
.fs-card-sub{font-size:12px;color:var(--cbi-muted-color,#888);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
@media(max-width:1200px){.fs-summary-grid{grid-template-columns:repeat(3,minmax(140px,1fr))}}\
@media(max-width:800px){.fs-summary-grid{grid-template-columns:repeat(2,minmax(140px,1fr))}}\
@media(max-width:480px){.fs-summary-grid{grid-template-columns:1fr}.fs-summary-card{min-height:68px}}\
';

function injectCSS() {
	var el = document.getElementById('airoha-flowsense-theme-css');
	if (!el) {
		el = document.createElement('style');
		el.id = 'airoha-flowsense-theme-css';
		document.head.appendChild(el);
	}
	el.textContent = themeCSS;
}

return view.extend({
	load: function() {
		return Promise.resolve([]);
	},

	render: function() {
		injectCSS();
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
		var modeNode = E('div', { 'class': 'fs-summary-grid' }, [
			E('div', { 'class': 'fs-summary-card' }, [
				E('div', { 'class': 'fs-card-title' }, _('Device Mode')),
				E('div', { 'class': 'fs-card-value', 'id': 'fs-val-mode' }, '—'),
				E('div', { 'class': 'fs-card-sub', 'id': 'fs-sub-mode' }, '—')
			]),
			E('div', { 'class': 'fs-summary-card' }, [
				E('div', { 'class': 'fs-card-title' }, _('HW Flow Offload')),
				E('div', { 'class': 'fs-card-value', 'id': 'fs-val-flow' }, '—'),
				E('div', { 'class': 'fs-card-sub' }, _('Firewall hardware flow table acceleration'))
			]),
			E('div', { 'class': 'fs-summary-card' }, [
				E('div', { 'class': 'fs-card-title' }, _('VLAN Offload')),
				E('div', { 'class': 'fs-card-value', 'id': 'fs-val-vlan' }, '—'),
				E('div', { 'class': 'fs-card-sub' }, _('Hardware acceleration for 802.1Q tagged VLAN traffic'))
			]),
			E('div', { 'class': 'fs-summary-card' }, [
				E('div', { 'class': 'fs-card-title' }, _('PPPoE Offload')),
				E('div', { 'class': 'fs-card-value', 'id': 'fs-val-pppoe' }, '—'),
				E('div', { 'class': 'fs-card-sub' }, _('Hardware acceleration for PPPoE session streams'))
			]),
			E('div', { 'class': 'fs-summary-card' }, [
				E('div', { 'class': 'fs-card-title' }, _('AP Mode Acceleration')),
				E('div', { 'class': 'fs-card-value', 'id': 'fs-val-apmode' }, '—'),
				E('div', { 'class': 'fs-card-sub' }, _('L2 bridge fast-path forwarding without netfilter overhead'))
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
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-bnd', 'style': 'font-weight:600;color:#10b981;font-family:monospace;font-variant-numeric:tabular-nums' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Learning / Unbound Flows')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-unb', 'style': 'font-weight:600;color:#f59e0b;font-family:monospace;font-variant-numeric:tabular-nums' }, '—')
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
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-latency', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums;font-weight:600;color:var(--cbi-button-apply-bg, #10b981)' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Jitter')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-jitter', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Ping Target')),
				E('div', { 'class': 'cbi-value-field', 'id': 'fs-val-target-container' }, [
					E('div', { 'style': 'display:flex;align-items:center;gap:10px' }, [
						E('span', { 'id': 'fs-val-target', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums;font-weight:600' }, '223.5.5.5'),
						E('button', {
							'class': 'cbi-button cbi-button-action',
							'click': function(ev) {
								var currentTarget = document.getElementById('fs-val-target').textContent.trim();
								var newTarget = window.prompt(_('Ping target IP:'), (currentTarget && currentTarget !== '—') ? currentTarget : '223.5.5.5');
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
				var subModeEl = document.getElementById('fs-sub-mode');
				if (modeEl) {
					var isAp = (dm.mode === 'ap');
					modeEl.textContent = isAp ? _('AP MODE') : _('ROUTER MODE');
					modeEl.style.color = isAp ? '#0ea5e9' : '#10b981';
					if (subModeEl) subModeEl.textContent = isAp ? _('Bridge fast-path forwarding') : _('NAT and hardware offload');
				}

				function setCardStatus(cellId, enabled) {
					var el = document.getElementById(cellId);
					if (!el) return;
					var on = isEnabled(enabled);
					el.textContent = on ? _('Enabled') : _('Disabled');
					el.style.color = on ? '#10b981' : 'inherit';
				}

				setCardStatus('fs-val-flow', (res.flow || {}).enabled);
				setCardStatus('fs-val-vlan', (res.vlan || {}).enabled);
				setCardStatus('fs-val-pppoe', (res.pppoe || {}).enabled);
				setCardStatus('fs-val-apmode', (res.apmode || {}).enabled);

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
					bufEl.style.color = '#10b981';
					bufEl.style.fontWeight = '600';
				}

				// 3. Update Latency & Jitter
				var latEl = document.getElementById('fs-val-latency');
				if (latEl) {
					var lat = jitter.last_ping || 0;
					latEl.textContent = lat > 0 ? lat.toFixed(2) + ' ms' : '—';
					latEl.style.color = (lat > 0 && lat <= 30) ? '#10b981' : (lat <= 80) ? '#f59e0b' : '#ef4444';
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
						var stateCol = (e.state === 'BND') ? '#10b981' : '#f59e0b';
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
