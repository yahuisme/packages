/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * LuCI WiFi 7 Manager for MT7996
 * Harmonious, robust and native LuCI UI (Overview, Radio Config, MLO Networks)
 */

'use strict';
'require dom';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

const callWirelessStatus = rpc.declare({
	object: 'network.wireless',
	method: 'status',
	expect: { '': {} }
});

const callIwinfoAssocList = rpc.declare({
	object: 'iwinfo',
	method: 'assoclist',
	params: [ 'device' ],
	expect: { results: [] }
});

const BANDS = {
	0: { name: '2.4 GHz', defBw: 'HE40',   maxTxp: 20 },
	1: { name: '5 GHz',   defBw: 'EHT160', maxTxp: 23 },
	2: { name: '6 GHz',   defBw: 'EHT320', maxTxp: 23 }
};

function parseTxPower(info) {
	if (!info) return null;
	var m = info.match(/Current TX Power:\s*([0-9.]+)\s*dBm/i);
	return m ? m[1] : null;
}

function formatSignal(signal) {
	if (signal == null || signal === 0) return '—';
	var color = signal >= -50 ? '#00cc44' : signal >= -65 ? '#00c8ff' : signal >= -75 ? '#f5a623' : '#d0021b';
	return E('span', { 'style': 'font-weight:600;color:' + color }, signal + ' dBm');
}

function formatRate(rate) {
	if (!rate) return '—';
	return (rate / 1000).toFixed(1) + ' Mbit/s';
}

return view.extend({
	load: function() {
		return Promise.all([
			callWirelessStatus(),
			fs.read('/sys/kernel/debug/ieee80211/phy0/mt76/sku_disable').catch(function() { return null; }),
			fs.read('/sys/kernel/debug/ieee80211/phy0/mt76/band0/txpower_info').catch(function() { return null; }),
			fs.read('/sys/kernel/debug/ieee80211/phy0/mt76/band1/txpower_info').catch(function() { return null; }),
			fs.read('/sys/kernel/debug/ieee80211/phy0/mt76/band2/txpower_info').catch(function() { return null; }),
			uci.load('wireless')
		]);
	},

	render: function(data) {
		var wstatus = data[0] || {};
		var skuDisable = (data[1] || '').trim();
		var txInfos = [ data[2], data[3], data[4] ];

		var m = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('WiFi 7')),
			E('div', { 'class': 'cbi-map-descr' }, _('Advanced Wi-Fi 7 management: Tri-band physical radios, MLO multi-link aggregation, and live station metrics.'))
		]);

		// Tabs navigation
		var activeTab = 'overview';
		var tabPanes = {};

		var tabList = [
			{ id: 'overview', name: _('Overview & Clients') },
			{ id: 'radios',   name: _('Radio Settings') },
			{ id: 'mlo',      name: _('MLO Networks') }
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

		// ══════════════════════════════════════════════════════════════════
		// Tab 1: Overview & Connected Clients
		// ══════════════════════════════════════════════════════════════════
		var paneOverview = E('div', { 'class': 'cbi-tab-pane' });
		tabPanes['overview'] = paneOverview;

		var radioTable = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Radio Band')),
				E('th', { 'class': 'th' }, _('Status')),
				E('th', { 'class': 'th' }, _('Channel / Bandwidth')),
				E('th', { 'class': 'th' }, _('TX Power')),
				E('th', { 'class': 'th' }, _('Hardware SKU'))
			])
		]);

		for (var bIdx = 0; bIdx < 3; bIdx++) {
			var band = BANDS[bIdx];
			var rName = 'radio' + bIdx;
			var radStatus = wstatus[rName] || {};
			var isUp = radStatus.up === true;
			var radConfig = radStatus.config || {};
			var channel = radConfig.channel || _('Auto');
			var htmode = radConfig.htmode || band.defBw;
			var txp = parseTxPower(txInfos[bIdx]) || (radConfig.txpower ? radConfig.txpower + ' dBm' : _('Auto'));

			var statusBadge = E('span', {
				'style': 'padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;display:inline-block;' +
				         (isUp ? 'background:var(--cbi-button-apply-bg, #00cc44);color:#fff' : 'background:var(--cbi-muted-color, #6b7280);color:#fff')
			}, isUp ? _('Up') : _('Disabled'));

			var skuBadge = E('span', {
				'style': 'font-weight:600;' + (skuDisable === '0' ? 'color:#00cc44' : 'color:#f5a623')
			}, skuDisable === '0' ? _('Unlocked (Full Power)') : _('Standard / Locked'));

			radioTable.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'font-weight:600' }, band.name),
				E('td', { 'class': 'td' }, statusBadge),
				E('td', { 'class': 'td', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, channel + ' / ' + htmode),
				E('td', { 'class': 'td', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, (typeof txp === 'string' && txp.indexOf('dBm') === -1) ? txp + ' dBm' : txp),
				E('td', { 'class': 'td' }, skuBadge)
			]));
		}

		paneOverview.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Radio Status')),
			radioTable
		]));

		var clientTable = E('table', { 'class': 'table cbi-section-table', 'id': 'wifi7-client-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Interface')),
				E('th', { 'class': 'th' }, _('MAC Address')),
				E('th', { 'class': 'th' }, _('Signal')),
				E('th', { 'class': 'th' }, _('TX Rate')),
				E('th', { 'class': 'th' }, _('RX Rate'))
			])
		]);

		paneOverview.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Connected Clients')),
			clientTable
		]));

		// ══════════════════════════════════════════════════════════════════
		// Tab 2: Radio Settings (Fine-tuning Channels & TX Power)
		// ══════════════════════════════════════════════════════════════════
		var paneRadios = E('div', { 'class': 'cbi-tab-pane', 'style': 'display:none' });
		tabPanes['radios'] = paneRadios;

		var radioForms = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Physical Radio Configuration')),
			E('div', { 'class': 'cbi-section-descr' }, _('Configure channels, bandwidth modes, and transmit powers for each physical band.'))
		]);

		for (var bandIdx = 0; bandIdx < 3; bandIdx++) {
			(function(idx) {
				var radSec = 'radio' + idx;
				var band = BANDS[idx];
				var curChan = uci.get('wireless', radSec, 'channel') || 'auto';
				var curHt = uci.get('wireless', radSec, 'htmode') || band.defBw;
				var curTxp = uci.get('wireless', radSec, 'txpower') || '';
				var curDis = uci.get('wireless', radSec, 'disabled') === '1';

				var chanOpts = idx === 0 ? ['auto', '1', '6', '11']
				             : idx === 1 ? ['auto', '36', '40', '44', '48', '52', '56', '60', '64', '100', '149', '153', '157', '161']
				             : ['auto', '37', '53', '69', '85', '101', '117', '133', '149', '165', '181', '197', '213'];

				var htOpts = idx === 0 ? ['HE20', 'HE40', 'EHT40']
				           : idx === 1 ? ['HE20', 'HE40', 'HE80', 'HE160', 'EHT80', 'EHT160']
				           : ['EHT80', 'EHT160', 'EHT320'];

				var chanSelect = E('select', {
					'class': 'cbi-input-select',
					'change': function(e) { uci.set('wireless', radSec, 'channel', e.target.value); }
				}, chanOpts.map(function(c) {
					return E('option', { 'value': c, 'selected': (c === curChan ? '' : null) }, c === 'auto' ? _('Auto') : c);
				}));

				var htSelect = E('select', {
					'class': 'cbi-input-select',
					'change': function(e) { uci.set('wireless', radSec, 'htmode', e.target.value); }
				}, htOpts.map(function(h) {
					return E('option', { 'value': h, 'selected': (h === curHt ? '' : null) }, h);
				}));

				var txpInput = E('input', {
					'type': 'number',
					'class': 'cbi-input-text',
					'style': 'width:120px',
					'placeholder': 'auto',
					'min': 1,
					'max': band.maxTxp,
					'value': curTxp,
					'change': function(e) {
						var v = e.target.value.trim();
						if (v) uci.set('wireless', radSec, 'txpower', v);
						else uci.unset('wireless', radSec, 'txpower');
					}
				});

				var disCheckbox = E('input', {
					'type': 'checkbox',
					'checked': curDis,
					'change': function(e) {
						if (e.target.checked) uci.set('wireless', radSec, 'disabled', '1');
						else uci.unset('wireless', radSec, 'disabled');
					}
				});

				var card = E('div', { 'class': 'cbi-section-node', 'style': 'border:1px solid var(--cbi-border-color, #e0e0e0);border-radius:6px;padding:12px 14px;margin-bottom:12px' }, [
					E('h4', { 'style': 'margin:0 0 10px;font-weight:600' }, radSec + ' (' + band.name + ')'),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Enabled')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('label', {}, [
								E('input', {
									'type': 'checkbox',
									'checked': !curDis,
									'change': function(e) {
										if (!e.target.checked) uci.set('wireless', radSec, 'disabled', '1');
										else uci.unset('wireless', radSec, 'disabled');
									}
								}),
								' ' + _('Enable Radio')
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Operating Channel')),
						E('div', { 'class': 'cbi-value-field' }, chanSelect)
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Bandwidth / Mode')),
						E('div', { 'class': 'cbi-value-field' }, htSelect)
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('TX Power (dBm)')),
						E('div', { 'class': 'cbi-value-field' }, [
							txpInput,
							E('span', { 'class': 'cbi-value-description', 'style': 'margin-left:8px' }, _('1-%d dBm, leave empty for regulatory auto').format(band.maxTxp))
						])
					])
				]);

				radioForms.appendChild(card);
			})(bandIdx);
		}

		var saveApplyBtn = E('button', {
			'class': 'cbi-button cbi-button-action',
			'click': function(ev) {
				ev.target.disabled = true;
				uci.save().then(function() {
					return uci.apply();
				}).then(function() {
					ev.target.disabled = false;
					ui.addNotification(null, E('p', {}, _('Radio configuration applied successfully.')), 'info');
				}).catch(function(e) {
					ev.target.disabled = false;
					ui.addNotification(null, E('p', {}, _('Failed to apply configuration: ') + e.message), 'error');
				});
			}
		}, _('Save & Apply'));

		paneRadios.appendChild(radioForms);
		paneRadios.appendChild(E('div', { 'style': 'margin-top:14px;text-align:right' }, saveApplyBtn));

		// ══════════════════════════════════════════════════════════════════
		// Tab 3: MLO Networks & Multi-Link Configurations
		// ══════════════════════════════════════════════════════════════════
		var paneMlo = E('div', { 'class': 'cbi-tab-pane', 'style': 'display:none' });
		tabPanes['mlo'] = paneMlo;

		var mloSec = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Wi-Fi 7 Multi-Link (MLO) Networks')),
			E('div', { 'class': 'cbi-section-descr' }, _('Multi-Link Operation aggregates multiple bands (2.4GHz, 5GHz, 6GHz) into a unified high-throughput SSID.'))
		]);

		var ifaceTable = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('SSID')),
				E('th', { 'class': 'th' }, _('Interface')),
				E('th', { 'class': 'th' }, _('Bands / Device')),
				E('th', { 'class': 'th' }, _('Mode')),
				E('th', { 'class': 'th' }, _('Encryption')),
				E('th', { 'class': 'th' }, _('Status'))
			])
		]);

		var ifaces = uci.sections('wireless', 'wifi-iface');
		if (!ifaces.length) {
			ifaceTable.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'colspan': 6, 'style': 'text-align:center;color:#888' }, _('No wireless interfaces configured'))
			]));
		} else {
			ifaces.forEach(function(ifc) {
				var dev = ifc.device;
				var isMlo = Array.isArray(dev) || (typeof dev === 'string' && dev.indexOf(' ') !== -1);
				var devList = isMlo ? (Array.isArray(dev) ? dev : dev.split(/\s+/)) : [dev];
				var devStr = devList.map(function(d) {
					var idx = d ? d.replace('radio', '') : '';
					return BANDS[idx] ? BANDS[idx].name : d;
				}).join(' + ');

				var mloBadge = isMlo ? E('span', {
					'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#00c8ff;color:#000;margin-right:6px;display:inline-block'
				}, 'MLO') : null;

				var ifcState = (ifc.disabled === '1')
					? E('span', { 'class': 'badge label-danger', 'style': 'font-size:11px;font-weight:600' }, _('Disabled'))
					: E('span', { 'class': 'badge label-success', 'style': 'font-size:11px;font-weight:600' }, _('Enabled'));

				ifaceTable.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'style': 'font-weight:600' }, ifc.ssid || ifc['.name']),
					E('td', { 'class': 'td', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, ifc.ifname || ifc['.name']),
					E('td', { 'class': 'td' }, [ mloBadge, devStr ]),
					E('td', { 'class': 'td' }, (ifc.mode || 'ap').toUpperCase()),
					E('td', { 'class': 'td' }, ifc.encryption || _('None')),
					E('td', { 'class': 'td' }, ifcState)
				]));
			});
		}

		mloSec.appendChild(ifaceTable);
		paneMlo.appendChild(mloSec);

		// Append all panes
		m.appendChild(paneOverview);
		m.appendChild(paneRadios);
		m.appendChild(paneMlo);

		// Dynamic station update
		function updateStations() {
			var activeIfaces = ifaces.map(function(ifc) { return ifc.ifname; }).filter(Boolean);
			if (!activeIfaces.length) {
				renderEmptyClients();
				return;
			}

			Promise.all(activeIfaces.map(function(ifname) {
				return callIwinfoAssocList(ifname).then(function(res) {
					return { ifname: ifname, clients: res.results || [] };
				}).catch(function() {
					return { ifname: ifname, clients: [] };
				});
			})).then(function(results) {
				var allClients = [];
				results.forEach(function(r) {
					r.clients.forEach(function(c) {
						allClients.push([
							r.ifname,
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, c.mac),
							formatSignal(c.signal),
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, formatRate(c.tx_rate)),
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, formatRate(c.rx_rate))
						]);
					});
				});

				var tb = document.getElementById('wifi7-client-table');
				if (!tb) return;
				cbi_update_table(tb, allClients, E('em', { 'style': 'color:#888' }, _('No connected clients')));
			});
		}

		function renderEmptyClients() {
			var tb = document.getElementById('wifi7-client-table');
			if (!tb) return;
			cbi_update_table(tb, [], E('em', { 'style': 'color:#888' }, _('No connected clients')));
		}

		updateStations();
		poll.add(updateStations, 5);

		return m;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
