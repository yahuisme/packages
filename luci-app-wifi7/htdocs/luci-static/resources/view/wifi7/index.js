'use strict';
'require view';
'require network';
'require rpc';
'require uci';
'require ui';
'require poll';

const callIwinfoDevices = rpc.declare({
	object: 'iwinfo',
	method: 'devices',
	expect: { devices: [] }
});

const callIwinfoAssocList = rpc.declare({
	object: 'iwinfo',
	method: 'assoclist',
	params: [ 'device' ],
	expect: { results: [] }
});

const BANDS = {
	0: { name: '2.4 GHz', defBw: 'HE40',   maxTxp: 30 },
	1: { name: '5 GHz',   defBw: 'EHT160', maxTxp: 30 },
	2: { name: '6 GHz',   defBw: 'EHT320', maxTxp: 30 }
};

function formatSignal(signal) {
	if (signal == null || signal === 0) return '—';
	var color = signal >= -50 ? '#00cc44' : signal >= -65 ? '#00c8ff' : signal >= -75 ? '#f5a623' : '#d0021b';
	return E('span', { 'style': 'font-weight:600;color:' + color }, signal + ' dBm');
}

function formatProtocolBadge(c) {
	var rx = c.rx || {};
	var tx = c.tx || {};
	var isEht = rx.eht || tx.eht;
	var isHe = rx.he || tx.he;
	var isVht = rx.vht || tx.vht;
	var isHt = rx.ht || tx.ht;

	var mhz = rx.mhz || tx.mhz;
	var bwStr = mhz ? ' ' + mhz + 'MHz' : '';

	if (isEht) {
		return E('span', {
			'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#00c8ff;color:#000;display:inline-block'
		}, 'Wi-Fi 7' + bwStr);
	}
	if (isHe) {
		return E('span', {
			'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#00cc44;color:#fff;display:inline-block'
		}, 'Wi-Fi 6' + bwStr);
	}
	if (isVht) {
		return E('span', {
			'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#3b82f6;color:#fff;display:inline-block'
		}, 'Wi-Fi 5' + bwStr);
	}
	if (isHt) {
		return E('span', {
			'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#6b7280;color:#fff;display:inline-block'
		}, 'Wi-Fi 4' + bwStr);
	}
	return E('span', { 'style': 'color:#888' }, 'Legacy' + bwStr);
}

function formatRate(rate) {
	if (!rate) return '—';
	return (rate / 1000).toFixed(1) + ' Mbit/s';
}

return view.extend({
	load: function() {
		return Promise.all([
			network.getWifiDevices(),
			network.getWifiNetworks(),
			uci.load('wireless')
		]);
	},

	render: function(data) {
		var wifiDevs = (data && data[0]) ? data[0] : [];
		var wifiNets = (data && data[1]) ? data[1] : [];
		var devMapByName = {};
		wifiDevs.forEach(function(d) {
			if (d && typeof d.getName === 'function') {
				devMapByName[d.getName()] = d;
			}
		});

		var netMapBySid = {};
		wifiNets.forEach(function(n) {
			if (n && n.sid) {
				netMapBySid[n.sid] = n;
			}
		});

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
			{ id: 'mlo',      name: _('Wireless Networks') }
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

		var radioSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Radio Status'))
		]);

		for (var bIdx = 0; bIdx < 3; bIdx++) {
			var band = BANDS[bIdx];
			var rName = 'radio' + bIdx;
			var dev = devMapByName[rName];

			var isUp = dev ? dev.isUp() : false;
			var channel = (dev && dev.get('channel')) ? dev.get('channel') : _('Auto');
			var htmode = (dev && dev.get('htmode')) ? dev.get('htmode') : band.defBw;
			var txpVal = (dev && dev.get('txpower')) ? dev.get('txpower') : null;
			var txp = txpVal ? txpVal + ' dBm' : _('Auto');

			var statusBadge = E('span', {
				'style': 'padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;display:inline-block;' +
				         (isUp ? 'background:var(--cbi-button-apply-bg, #00cc44);color:#fff' : 'background:var(--cbi-muted-color, #6b7280);color:#fff')
			}, isUp ? _('Up') : _('Disabled'));

			var skuBadge = E('span', {
				'style': 'font-weight:600;color:#00cc44'
			}, _('Unlocked (Full Power)'));

			var card = E('div', { 'class': 'cbi-section-node', 'style': 'border:1px solid var(--cbi-border-color, #e0e0e0);border-radius:6px;padding:12px 14px;margin-bottom:12px' }, [
				E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px' }, [
					E('h4', { 'style': 'margin:0;font-weight:600' }, rName + ' (' + band.name + ')'),
					statusBadge
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Channel / Bandwidth')),
					E('div', { 'class': 'cbi-value-field', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, channel + ' / ' + htmode)
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('TX Power')),
					E('div', { 'class': 'cbi-value-field', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, txp)
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Hardware SKU')),
					E('div', { 'class': 'cbi-value-field' }, skuBadge)
				])
			]);

			radioSection.appendChild(card);
		}

		paneOverview.appendChild(radioSection);

		var clientTable = E('table', { 'class': 'table cbi-section-table', 'id': 'wifi7-client-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Interface / Band')),
				E('th', { 'class': 'th' }, _('MAC Address')),
				E('th', { 'class': 'th' }, _('Standard / Bandwidth')),
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
		// Tab 2: Radio Settings (WCAG 2.1 & W3C Semantic Forms)
		// ══════════════════════════════════════════════════════════════════
		var paneRadios = E('div', { 'class': 'cbi-tab-pane', 'style': 'display:none' });
		tabPanes['radios'] = paneRadios;

		var radioForms = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Radio Hardware Settings')),
			E('div', { 'class': 'cbi-section-descr' }, _('Configure channels, bandwidth modes, and transmit powers for each physical band.'))
		]);

		for (var bandIdx = 0; bandIdx < 3; bandIdx++) {
			(function(idx) {
				var band = BANDS[idx];
				var radSec = 'radio' + idx;
				var curChan = uci.get('wireless', radSec, 'channel') || 'auto';
				var curHt = uci.get('wireless', radSec, 'htmode') || band.defBw;
				var curTxp = uci.get('wireless', radSec, 'txpower') || '';
				var curDis = uci.get('wireless', radSec, 'disabled') === '1';

				var enableId = 'wifi7-radio-' + idx + '-enable';
				var channelId = 'wifi7-radio-' + idx + '-channel';
				var htmodeId = 'wifi7-radio-' + idx + '-htmode';
				var txpId = 'wifi7-radio-' + idx + '-txpower';

				// Channel selector options
				var chanOpts = ['auto'];
				if (idx === 0) chanOpts = ['auto', '1', '6', '11'];
				else if (idx === 1) chanOpts = ['auto', '36', '40', '44', '48', '52', '56', '60', '64', '100', '149', '153', '157', '161'];
				else if (idx === 2) chanOpts = ['auto', '1', '5', '9', '13', '17', '21', '33', '37', '65', '97'];

				var chanSelect = E('select', {
					'id': channelId,
					'name': channelId,
					'class': 'cbi-input-select',
					'change': function(e) {
						uci.set('wireless', radSec, 'channel', e.target.value);
					}
				}, chanOpts.map(function(c) {
					var o = E('option', { 'value': c }, c === 'auto' ? _('Auto') : c);
					if (c === String(curChan)) o.selected = true;
					return o;
				}));

				// Bandwidth selector
				var htOpts = [];
				if (idx === 0) htOpts = ['HE20', 'HE40', 'EHT20', 'EHT40'];
				else if (idx === 1) htOpts = ['HE20', 'HE40', 'HE80', 'HE160', 'EHT80', 'EHT160'];
				else if (idx === 2) htOpts = ['EHT80', 'EHT160', 'EHT320'];

				var htSelect = E('select', {
					'id': htmodeId,
					'name': htmodeId,
					'class': 'cbi-input-select',
					'change': function(e) {
						uci.set('wireless', radSec, 'htmode', e.target.value);
					}
				}, htOpts.map(function(h) {
					var o = E('option', { 'value': h }, h);
					if (h === curHt) o.selected = true;
					return o;
				}));

				var txpInput = E('input', {
					'id': txpId,
					'name': txpId,
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

				var disAttrs = {
					'id': enableId,
					'name': enableId,
					'type': 'checkbox'
				};
				if (!curDis) disAttrs.checked = 'checked';
				var disCheckbox = E('input', disAttrs);
				disCheckbox.addEventListener('change', function(e) {
					if (!e.target.checked) uci.set('wireless', radSec, 'disabled', '1');
					else uci.unset('wireless', radSec, 'disabled');
				});

				var card = E('div', { 'class': 'cbi-section-node', 'style': 'border:1px solid var(--cbi-border-color, #e0e0e0);border-radius:6px;padding:12px 14px;margin-bottom:12px' }, [
					E('h4', { 'style': 'margin:0 0 10px;font-weight:600' }, radSec + ' (' + band.name + ')'),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': enableId }, _('Enabled')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('label', { 'for': enableId }, [
								disCheckbox,
								' ' + _('Enable Radio')
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': channelId }, _('Operating Channel')),
						E('div', { 'class': 'cbi-value-field' }, chanSelect)
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': htmodeId }, _('Bandwidth / Mode')),
						E('div', { 'class': 'cbi-value-field' }, htSelect)
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': txpId }, _('TX Power (dBm)')),
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
		// Tab 3: Wireless Networks & MLO Configurations
		// ══════════════════════════════════════════════════════════════════
		var paneMlo = E('div', { 'class': 'cbi-tab-pane', 'style': 'display:none' });
		tabPanes['mlo'] = paneMlo;

		var mloSec = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Wireless Networks & MLO')),
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

				// Check real device & network status
				var isRunning = false;
				var realIfname = ifc.ifname || null;
				var netInst = netMapBySid[ifc['.name']];

				if (netInst) {
					if (netInst.isUp()) isRunning = true;
					if (netInst.getIfname()) realIfname = netInst.getIfname();
				}

				if (!isRunning) {
					devList.forEach(function(d) {
						var rDev = devMapByName[d];
						if (rDev && rDev.isUp()) {
							isRunning = true;
						}
					});
				}

				var ifcState = isRunning
					? E('span', { 'class': 'badge label-success', 'style': 'font-size:11px;font-weight:600' }, _('Enabled'))
					: E('span', { 'class': 'badge label-danger', 'style': 'font-size:11px;font-weight:600' }, _('Disabled'));

				ifaceTable.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'style': 'font-weight:600' }, ifc.ssid || ifc['.name']),
					E('td', { 'class': 'td', 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, realIfname || ifc['.name']),
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

		// Dynamic station update via iwinfo devices & assoclist
		function updateStations() {
			callIwinfoDevices().then(function(res) {
				var devs = Array.isArray(res.devices) ? res.devices : [];
				if (!devs.length) {
					renderEmptyClients();
					return;
				}

				Promise.all(devs.map(function(d) {
					return callIwinfoAssocList(d).then(function(r) {
						var bLabel = d.indexOf('0.0') !== -1 ? '2.4 GHz' : (d.indexOf('0.1') !== -1 ? '5 GHz' : (d.indexOf('0.2') !== -1 ? '6 GHz' : d));
						return { ifname: d, label: bLabel + ' (' + d + ')', clients: r.results || [] };
					}).catch(function() {
						return { ifname: d, label: d, clients: [] };
					});
				})).then(function(results) {
					// Detect MLO multi-link clients across multiple bands
					var macBandCount = {};
					results.forEach(function(r) {
						r.clients.forEach(function(c) {
							var m = (c.mac || '').toLowerCase();
							if (!m) return;
							macBandCount[m] = (macBandCount[m] || 0) + 1;
						});
					});

					var allClients = [];
					results.forEach(function(r) {
						r.clients.forEach(function(c) {
							var m = (c.mac || '').toLowerCase();
							var isMloStation = (macBandCount[m] > 1);

							var macNode = [
								E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums;margin-right:6px' }, c.mac)
							];
							if (isMloStation) {
								macNode.push(E('span', {
									'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#00c8ff;color:#000;display:inline-block'
								}, 'MLO'));
							}

							allClients.push([
								E('span', { 'style': 'font-weight:600' }, r.label),
								E('span', {}, macNode),
								formatProtocolBadge(c),
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

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
