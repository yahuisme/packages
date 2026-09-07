/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * LuCI Support for Airoha NPU Status
 * Native, unified, elegant and robust LuCI UI
 */

'use strict';
'require dom';
'require poll';
'require rpc';
'require ui';
'require view';

const callNpuStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus' });
const callPpeEntries = rpc.declare({ object: 'luci.airoha_npu', method: 'getPpeEntries' });
const callTokenInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getTokenInfo' });
const callFrameEngine = rpc.declare({ object: 'luci.airoha_npu', method: 'getFrameEngine' });
const callSetGovernor = rpc.declare({ object: 'luci.airoha_npu', method: 'setGovernor', params: ['governor'] });
const callSetMaxFreq = rpc.declare({ object: 'luci.airoha_npu', method: 'setMaxFreq', params: ['freq'] });
const callSetOverclock = rpc.declare({ object: 'luci.airoha_npu', method: 'setOverclock', params: ['freq_mhz'] });
const callGetVlanOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'getVlanOffload' });
const callSetVlanOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'setVlanOffload', params: ['enabled'] });
const callGetPppoeOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'getPppoeOffload' });
const callSetPppoeOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'setPppoeOffload', params: ['enabled'] });
const callGetFlowOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'getFlowOffload' });
const callSetFlowOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'setFlowOffload', params: ['enabled'] });
const callGetApModeOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'getApModeOffload' });
const callSetApModeOffload = rpc.declare({ object: 'luci.airoha_npu', method: 'setApModeOffload', params: ['enabled'] });

function isEnabled(value) {
	return value === true || value === 1 || value === '1';
}

function fmtFreq(khz) {
	if (!khz || khz === 0) return 'N/A';
	return (khz / 1000).toFixed(0) + ' MHz';
}

function governorLabel(governor) {
	var labels = {
		conservative: _('Conservative'),
		ondemand: _('On Demand'),
		performance: _('Performance'),
		powersave: _('Powersave'),
		schedutil: _('Schedutil'),
		userspace: _('Userspace')
	};
	return labels[governor] || (governor ? _(governor) : '');
}

function calcTotalMem(regions) {
	var t = 0;
	(regions || []).forEach(function(r) {
		var m = (r.size || '').match(/(\d+)\s*(KiB|MiB|GiB)/i);
		if (m) {
			var s = parseInt(m[1]);
			var u = m[2][0].toUpperCase();
			t += u === 'G' ? s * 1048576 : u === 'M' ? s * 1024 : s;
		}
	});
	return t >= 1024 ? (t / 1024).toFixed(0) + ' MiB' : t + ' KiB';
}

function createToggleSwitch(checked, onChange) {
	var input = E('input', {
		'type': 'checkbox',
		'checked': checked,
		'style': 'cursor:pointer'
	});
	input.addEventListener('change', function(ev) {
		onChange(ev.target.checked ? 1 : 0, input);
	});
	return input;
}

return view.extend({
	load: function() {
		return Promise.resolve([]);
	},

	render: function(data) {
		var ppeUpdatesPaused = false;
		var latestPpeEntries = [];

		var m = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Airoha NPU & SoC Status')),
			E('div', { 'class': 'cbi-map-descr' }, _('Comprehensive overview of Airoha NPU hardware offload, CPU dynamic frequency / OPP overclocking, and Frame Engine performance.'))
		]);

		// ── Section 1: NPU Status & Metrics ──
		var npuSummaryTable = E('table', { 'class': 'table cbi-section-table', 'id': 'npu-summary-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('NPU Core Status')),
				E('th', { 'class': 'th' }, _('Clock / Cores')),
				E('th', { 'class': 'th' }, _('Offload Flows (Bound / Total)')),
				E('th', { 'class': 'th' }, _('Reserved Memory'))
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'id': 'npu-val-status' }, '—'),
				E('td', { 'class': 'td', 'id': 'npu-val-clock' }, '—'),
				E('td', { 'class': 'td', 'id': 'npu-val-flows' }, '—'),
				E('td', { 'class': 'td', 'id': 'npu-val-memory' }, '—')
			])
		]);

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('NPU Core Status')),
			npuSummaryTable
		]));

		// ── Section 2: Hardware Offload Acceleration Switches ──
		var offloadGrid = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Offload Feature')),
				E('th', { 'class': 'th' }, _('Description')),
				E('th', { 'class': 'th', 'style': 'text-align:right' }, _('State'))
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:600' }, _('HW Flow Offload')),
				E('td', { 'class': 'td', 'style': 'color:#888' }, _('Firewall hardware flow table acceleration')),
				E('td', { 'class': 'td', 'style': 'text-align:right', 'id': 'toggle-cell-flow' }, '—')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:600' }, _('VLAN Offload')),
				E('td', { 'class': 'td', 'style': 'color:#888' }, _('Hardware acceleration for 802.1Q tagged VLAN traffic')),
				E('td', { 'class': 'td', 'style': 'text-align:right', 'id': 'toggle-cell-vlan' }, '—')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:600' }, _('PPPoE Offload')),
				E('td', { 'class': 'td', 'style': 'color:#888' }, _('Hardware acceleration for PPPoE session streams')),
				E('td', { 'class': 'td', 'style': 'text-align:right', 'id': 'toggle-cell-pppoe' }, '—')
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:600' }, _('AP Mode Acceleration')),
				E('td', { 'class': 'td', 'style': 'color:#888' }, _('L2 bridge fast-path forwarding without netfilter overhead')),
				E('td', { 'class': 'td', 'style': 'text-align:right', 'id': 'toggle-cell-apmode' }, '—')
			])
		]);

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Hardware Acceleration')),
			offloadGrid
		]));

		// ── Section 3: CPU Frequency & Overclocking ──
		var cpuInfoNode = E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('CPU Information')),
				E('div', { 'class': 'cbi-value-field', 'id': 'cpu-info-val', 'style': 'font-weight:600' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Current Frequency')),
				E('div', { 'class': 'cbi-value-field', 'id': 'cpu-curfreq-val', 'style': 'font-family:monospace;font-size:14px;color:#00cc44;font-weight:700' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Governor')),
				E('div', { 'class': 'cbi-value-field', 'id': 'cpu-gov-field' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Max Freq')),
				E('div', { 'class': 'cbi-value-field', 'id': 'cpu-maxfreq-field' }, '—')
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('CPU OPP / Overclock (Max 1400 MHz)')),
				E('div', { 'class': 'cbi-value-field', 'id': 'cpu-oc-field' }, [
					E('div', { 'style': 'display:flex;align-items:center;gap:10px' }, [
						E('select', { 'id': 'cpu-oc-select', 'class': 'cbi-input-select', 'style': 'width:150px' }, [1200, 1250, 1300, 1350, 1400].map(function(f) {
							return E('option', { 'value': f, 'selected': (f === 1200 ? '' : null) }, f + ' MHz');
						})),
						E('button', {
							'class': 'cbi-button cbi-button-action',
							'click': function(ev) {
								var f = parseInt(document.getElementById('cpu-oc-select').value);
								if (f > 1200 && !confirm(_('Frequencies above 1200 MHz use extended DTS OPP entries and may increase heat or reduce stability. Continue?'))) return;
								ev.target.disabled = true;
								callSetOverclock(f).then(function(res) {
									ev.target.disabled = false;
									if (res && res.error) {
										ui.addNotification(null, E('p', {}, _('Failed: ') + res.error), 'error');
									} else {
										ui.addNotification(null, E('p', {}, _('CPU set to ') + res.actual_mhz + ' MHz'), 'info');
									}
								}).catch(function(err) {
									ev.target.disabled = false;
									ui.addNotification(null, E('p', {}, _('Failed: ') + err.message), 'error');
								});
							}
						}, _('Apply'))
					]),
					E('span', { 'class': 'cbi-value-description' }, _('Please select a preset frequency between 1200-1400 MHz'))
				])
			])
		]);

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('CPU Frequency & Overclocking')),
			cpuInfoNode
		]));

		// ── Section 4: PPE Flow Table ──
		var ppePauseBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function(ev) {
				ppeUpdatesPaused = !ppeUpdatesPaused;
				ev.target.textContent = ppeUpdatesPaused ? _('Resume') : _('Pause');
			}
		}, _('Pause'));

		var ppeTable = E('table', { 'class': 'table cbi-section-table', 'id': 'ppe-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Index')),
				E('th', { 'class': 'th' }, _('State')),
				E('th', { 'class': 'th' }, _('Type')),
				E('th', { 'class': 'th' }, _('Original Flow')),
				E('th', { 'class': 'th' }, _('New Flow')),
				E('th', { 'class': 'th' }, _('Ethernet'))
			])
		]);

		m.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px' }, [
				E('h3', { 'style': 'margin:0' }, _('PPE Flow Offload Entries')),
				ppePauseBtn
			]),
			ppeTable
		]));

		// Data polling & updates
		function updateData() {
			Promise.all([
				callNpuStatus(),
				callGetVlanOffload(),
				callGetPppoeOffload(),
				callGetFlowOffload(),
				callGetApModeOffload(),
				ppeUpdatesPaused ? Promise.resolve(null) : callPpeEntries()
			]).then(function(res) {
				var st = res[0] || {};
				var vo = res[1] || {};
				var ppo = res[2] || {};
				var flo = res[3] || {};
				var apo = res[4] || {};
				var ppe = res[5];

				// 1. Update NPU Summary
				var active = isEnabled(st.npu_loaded);
				var clock = st.npu_clock ? Math.round(st.npu_clock / 1000000) : 0;
				var bound = st.offload_bound || 0;
				var total = st.offload_total || 0;
				var mem = Array.isArray(st.memory_regions) ? st.memory_regions : [];

				var sStatus = document.getElementById('npu-val-status');
				if (sStatus) {
					while (sStatus.firstChild) sStatus.removeChild(sStatus.firstChild);
					sStatus.appendChild(E('span', {
						'style': 'font-weight:700;color:' + (active ? '#00cc44' : '#888')
					}, active ? _('Activated') : _('Not Activated')));
				}

				var sClock = document.getElementById('npu-val-clock');
				if (sClock) sClock.textContent = (clock ? clock + ' MHz' : 'N/A') + ' (' + (st.npu_cores || 0) + ' ' + _('Cores') + ')';

				var sFlows = document.getElementById('npu-val-flows');
				if (sFlows) sFlows.textContent = bound + ' / ' + total;

				var sMem = document.getElementById('npu-val-memory');
				if (sMem) sMem.textContent = calcTotalMem(mem);

				// 2. Update Switches
				function bindSwitch(cellId, enabled, callFn) {
					var cell = document.getElementById(cellId);
					if (!cell) return;
					while (cell.firstChild) cell.removeChild(cell.firstChild);
					var sw = createToggleSwitch(isEnabled(enabled), function(val, input) {
						input.disabled = true;
						callFn(val).then(function(r) {
							input.disabled = false;
							if (r && r.error) {
								input.checked = !val;
								ui.addNotification(null, E('p', {}, _('Error: ') + r.error), 'error');
							}
						}).catch(function() {
							input.checked = !val;
							input.disabled = false;
						});
					});
					cell.appendChild(sw);
				}

				bindSwitch('toggle-cell-flow', flo.enabled, callSetFlowOffload);
				bindSwitch('toggle-cell-vlan', vo.enabled, callSetVlanOffload);
				bindSwitch('toggle-cell-pppoe', ppo.enabled, callSetPppoeOffload);
				bindSwitch('toggle-cell-apmode', apo.enabled, callSetApModeOffload);

				// 3. Update CPU Info
				var cpuInfo = document.getElementById('cpu-info-val');
				if (cpuInfo) {
					cpuInfo.textContent = (st.soc_compat || 'Airoha SoC') + ' · ' + (st.cpu_arch || '') +
					                      (st.cpu_temp && st.cpu_temp !== 'N/A' ? ' (' + st.cpu_temp + ')' : '') +
					                      ' · ' + (st.cpu_count || 0) + ' ' + _('Cores');
				}

				var curFreq = document.getElementById('cpu-curfreq-val');
				if (curFreq) curFreq.textContent = fmtFreq(st.cpu_hw_freq || st.cpu_cur_freq);

				// Governor select
				var govField = document.getElementById('cpu-gov-field');
				if (govField && !govField.querySelector('select:focus')) {
					while (govField.firstChild) govField.removeChild(govField.firstChild);
					var gs = (st.cpu_avail_governors || '').trim().split(/\s+/).filter(Boolean);
					var sel = E('select', {
						'class': 'cbi-input-select',
						'style': 'width:180px',
						'change': function(ev) {
							var g = ev.target.value;
							ev.target.disabled = true;
							callSetGovernor(g).then(function() { ev.target.disabled = false; })
								.catch(function() { ev.target.disabled = false; });
						}
					}, gs.map(function(g) {
						return E('option', { 'value': g, 'selected': (g === st.cpu_governor ? '' : null) }, governorLabel(g));
					}));
					govField.appendChild(sel);
				}

				// Max freq select
				var maxFreqField = document.getElementById('cpu-maxfreq-field');
				if (maxFreqField && !maxFreqField.querySelector('select:focus')) {
					while (maxFreqField.firstChild) maxFreqField.removeChild(maxFreqField.firstChild);
					var fs = (st.cpu_avail_freqs || '').trim().split(/\s+/).filter(Boolean);
					var selF = E('select', {
						'class': 'cbi-input-select',
						'style': 'width:180px',
						'change': function(ev) {
							var f = ev.target.value;
							ev.target.disabled = true;
							callSetMaxFreq(parseInt(f)).then(function() { ev.target.disabled = false; })
								.catch(function() { ev.target.disabled = false; });
						}
					}, fs.map(function(f) {
						return E('option', { 'value': f, 'selected': (parseInt(f) === parseInt(st.cpu_max_freq) ? '' : null) }, fmtFreq(f));
					}));
					maxFreqField.appendChild(selF);
				}

				// 4. Update PPE Entries
				if (ppe && Array.isArray(ppe.entries)) {
					var rows = ppe.entries.slice(0, 100).map(function(e) {
						var eth = e.eth || '';
						if (eth === '00:00:00:00:00:00->00:00:00:00:00:00') eth = '-';
						return [
							e.index,
							E('span', { 'style': 'font-weight:700;color:' + (e.state === 'BND' ? '#00cc44' : '#888') }, e.state),
							e.type,
							E('span', { 'style': 'font-family:monospace' }, e.orig || '-'),
							E('span', { 'style': 'font-family:monospace' }, e.new_flow || '-'),
							E('span', { 'style': 'font-family:monospace' }, eth)
						];
					});
					var ppeTb = document.getElementById('ppe-table');
					if (ppeTb) {
						cbi_update_table(ppeTb, rows, E('em', { 'style': 'color:#888' }, _('No entries')));
					}
				}
			});
		}

		updateData();
		poll.add(updateData, 5);

		return m;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
