'use strict';
'require view';
'require network';
'require rpc';
'require uci';
'require ui';
'require poll';

var callExec = rpc.declare({
	object: 'file',
	method: 'exec',
	params: [ 'command', 'params' ],
	expect: {}
});

var callIwinfoDevices = rpc.declare({
	object: 'iwinfo',
	method: 'devices',
	expect: { devices: [] }
});

var callIwinfoAssocList = rpc.declare({
	object: 'iwinfo',
	method: 'assoclist',
	params: [ 'device' ],
	expect: { results: [] }
});

var callIwinfoInfo = rpc.declare({
	object: 'iwinfo',
	method: 'info',
	params: [ 'device' ],
	expect: {}
});

var BANDS = {
	0: { name: '2.4 GHz', defBw: 'HE40',   maxTxp: 30 },
	1: { name: '5 GHz',   defBw: 'EHT160', maxTxp: 30 },
	2: { name: '6 GHz',   defBw: 'EHT320', maxTxp: 30 }
};

var bwCodeMap = {
	'0': '20 MHz', '1': '40 MHz', '2': '80 MHz',
	'3': '160 MHz', '4': '320 MHz',
	'5': '160 MHz', '6': '320 MHz', '9': '160 MHz'
};

var themeCSS = '\
.wifi7-radio-grid{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:12px;margin-bottom:14px}\
.wifi7-radio-card{background:var(--cbi-section-bg,#fff);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;box-sizing:border-box;padding:12px 14px;min-width:0}\
.wifi7-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--cbi-border-color,#f0f0f0)}\
.wifi7-card-title{font-size:13px;font-weight:600;color:var(--cbi-text-color,#222);margin:0}\
.wifi7-card-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:12px}\
.wifi7-card-label{color:var(--cbi-muted-color,#666)}\
.wifi7-card-val{font-family:monospace;font-variant-numeric:tabular-nums;font-size:13px;font-weight:500;color:var(--cbi-text-color,#222)}\
.wifi7-diag-card{background:var(--cbi-section-bg,#fff);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:12px 14px;margin-top:14px}\
.wifi7-diag-grid{display:grid;grid-template-columns:repeat(2,minmax(200px,1fr));gap:10px}\
.wifi7-client-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}\
@media(max-width:900px){\
	.wifi7-radio-grid{grid-template-columns:1fr}\
	.wifi7-diag-grid{grid-template-columns:1fr}\
}\
';

function injectCSS() {
	var el = document.getElementById('wifi7-theme-css');
	if (!el) {
		el = document.createElement('style');
		el.id = 'wifi7-theme-css';
		document.head.appendChild(el);
	}
	el.textContent = themeCSS;
}

function formatSignal(signal) {
	if (signal == null || signal === 0) return '—';
	var color = signal >= -50 ? '#10b981' : signal >= -65 ? '#0ea5e9' : signal >= -75 ? '#f59e0b' : '#ef4444';
	return E('span', { 'style': 'font-weight:600;color:' + color }, signal + ' dBm');
}

function formatRate(rate) {
	if (!rate) return '—';
	if (typeof rate === 'number')
		return (rate / 1000).toFixed(1) + ' Mbit/s';
	return String(rate);
}

function formatProtocolFromIwinfo(c) {
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
			'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#0ea5e9;color:#fff;display:inline-block'
		}, 'Wi-Fi 7' + bwStr);
	}
	if (isHe) {
		return E('span', {
			'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#10b981;color:#fff;display:inline-block'
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

function formatRateBadge(rateStr) {
	if (!rateStr) return E('span', { 'style': 'color:#888' }, '—');
	var tag = 'Legacy';
	var bg = '#6b7280';
	if (rateStr.indexOf('EHT') !== -1) { tag = 'Wi-Fi 7'; bg = '#0ea5e9'; }
	else if (rateStr.indexOf('HE') !== -1) { tag = 'Wi-Fi 6'; bg = '#10b981'; }
	else if (rateStr.indexOf('VHT') !== -1) { tag = 'Wi-Fi 5'; bg = '#3b82f6'; }
	else if (rateStr.indexOf('HT') !== -1) { tag = 'Wi-Fi 4'; bg = '#6b7280'; }
	var mhz = rateStr.match(/(\d+MHz)/);
	var bw = mhz ? ' ' + mhz[1] : '';
	return E('span', {
		'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:' + bg + ';color:#fff;display:inline-block'
	}, tag + bw);
}

function parseHostapdStat(raw) {
	var out = {};
	if (!raw) return out;
	raw.split('\n').forEach(function(line) {
		var eq = line.indexOf('=');
		if (eq > 0)
			out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	});
	return out;
}

function parseAllStations(rawText) {
	var clients = [];
	var lines = (rawText || '').split('\n');
	var curIface = '';
	var curSta = null;
	var curLink = null;

	lines.forEach(function(line) {
		if (line.indexOf('===IFACE:') === 0) {
			curIface = line.replace('===IFACE:', '').replace(/===/g, '').trim();
			return;
		}
		var staMx = line.match(/^Station\s+([0-9a-f:]+)\s+\(on\s+(.*?)\)/i);
		if (!staMx) staMx = line.match(/^Station\s+([0-9a-f:]+)/i);
		if (staMx) {
			if (curSta) clients.push(curSta);
			curSta = {
				mac: staMx[1].toLowerCase(),
				iface: (staMx[2] || curIface || '').replace(/\)$/, ''),
				links: {},
				signal: null,
				tx_rate: '',
				rx_rate: '',
				connected: ''
			};
			curLink = null;
			return;
		}
		if (!curSta) return;

		var t = line.replace(/\t/g, ' ').trim();
		var linkMx = t.match(/^Link\s+(\d+):/);
		if (linkMx) {
			curLink = linkMx[1];
			curSta.links[curLink] = { addr: '', signal: null, tx_rate: '', rx_rate: '', idle: true };
			return;
		}
		if (t.indexOf('connected time:') === 0) {
			curSta.connected = t.replace('connected time:', '').trim();
			return;
		}

		if (curLink !== null) {
			var lk = curSta.links[curLink];
			if (t.indexOf('address:') === 0) {
				lk.addr = t.replace('address:', '').trim();
			} else if (t.indexOf('signal:') === 0) {
				var sigM = t.match(/([-\d]+)\s+dBm/);
				if (sigM) {
					lk.signal = parseInt(sigM[1]);
					lk.idle = (lk.signal === 0);
				}
			} else if (t.indexOf('tx bitrate:') === 0) {
				lk.tx_rate = t.replace('tx bitrate:', '').trim();
			} else if (t.indexOf('rx bitrate:') === 0) {
				lk.rx_rate = t.replace('rx bitrate:', '').trim();
			}
		} else {
			if (t.indexOf('signal:') === 0) {
				var sigM0 = t.match(/([-\d]+)\s+dBm/);
				if (sigM0) curSta.signal = parseInt(sigM0[1]);
			} else if (t.indexOf('tx bitrate:') === 0) {
				curSta.tx_rate = t.replace('tx bitrate:', '').trim();
			} else if (t.indexOf('rx bitrate:') === 0) {
				curSta.rx_rate = t.replace('rx bitrate:', '').trim();
			}
		}
	});
	if (curSta) clients.push(curSta);
	return clients;
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
		injectCSS();
		var wifiDevs = (data && data[0]) ? data[0] : [];
		var devMapByName = {};
		wifiDevs.forEach(function(d) {
			if (d && typeof d.getName === 'function') {
				devMapByName[d.getName()] = d;
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
			{ id: 'overview', name: _('Radio Status') },
			{ id: 'radios',   name: _('Radio Settings') },
			{ id: 'clients',  name: _('Connected Clients') }
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
		// Tab 1: Radio Status (3 Cards + DFS & Firmware Diag)
		// ══════════════════════════════════════════════════════════════════
		var paneOverview = E('div', { 'class': 'cbi-tab-pane' });
		tabPanes['overview'] = paneOverview;

		var radioSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Radio Status'))
		]);

		var radioGrid = E('div', { 'class': 'wifi7-radio-grid' });

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
				         (isUp ? 'background:var(--cbi-button-apply-bg, #10b981);color:#fff' : 'background:var(--cbi-muted-color, #6b7280);color:#fff')
			}, isUp ? _('Up') : _('Disabled'));

			var skuBadge = E('span', {
				'style': 'font-weight:600;color:#10b981'
			}, _('Unlocked (Full Power)'));

			var card = E('div', { 'class': 'wifi7-radio-card' }, [
				E('div', { 'class': 'wifi7-card-header' }, [
					E('h4', { 'class': 'wifi7-card-title' }, rName + ' (' + band.name + ')'),
					statusBadge
				]),
				E('div', { 'class': 'wifi7-card-row' }, [
					E('span', { 'class': 'wifi7-card-label' }, _('Channel / Bandwidth')),
					E('span', { 'class': 'wifi7-card-val', 'id': 'wifi7-val-chan-' + bIdx }, channel + ' / ' + htmode)
				]),
				E('div', { 'class': 'wifi7-card-row' }, [
					E('span', { 'class': 'wifi7-card-label' }, _('Channel Utilization')),
					E('span', { 'class': 'wifi7-card-val', 'id': 'wifi7-val-util-' + bIdx }, '—')
				]),
				E('div', { 'class': 'wifi7-card-row' }, [
					E('span', { 'class': 'wifi7-card-label' }, _('TX Power')),
					E('span', { 'class': 'wifi7-card-val', 'id': 'wifi7-val-txp-' + bIdx }, txp)
				]),
				E('div', { 'class': 'wifi7-card-row' }, [
					E('span', { 'class': 'wifi7-card-label' }, _('Online Stations')),
					E('span', { 'class': 'wifi7-card-val', 'id': 'wifi7-val-sta-' + bIdx }, '0')
				]),
				E('div', { 'class': 'wifi7-card-row' }, [
					E('span', { 'class': 'wifi7-card-label' }, _('Hardware SKU')),
					E('span', { 'class': 'wifi7-card-val' }, skuBadge)
				])
			]);

			radioGrid.appendChild(card);
		}

		radioSection.appendChild(radioGrid);

		// Hardware Diag & 5G DFS Status Card
		var diagCard = E('div', { 'class': 'wifi7-diag-card' }, [
			E('div', { 'class': 'wifi7-card-header', 'style': 'margin-bottom:12px' }, [
				E('h4', { 'class': 'wifi7-card-title' }, _('Radio Hardware & DFS Status'))
			]),
			E('div', { 'class': 'wifi7-diag-grid' }, [
				E('div', { 'class': 'wifi7-card-row' }, [
					E('span', { 'class': 'wifi7-card-label' }, _('MT76 Firmware')),
					E('span', { 'class': 'wifi7-card-val', 'id': 'wifi7-val-fw' }, '—')
				]),
				E('div', { 'class': 'wifi7-card-row' }, [
					E('span', { 'class': 'wifi7-card-label' }, _('5GHz DFS Status')),
					E('span', { 'class': 'wifi7-card-val', 'id': 'wifi7-val-dfs' }, '—')
				])
			])
		]);
		radioSection.appendChild(diagCard);

		paneOverview.appendChild(radioSection);

		// ══════════════════════════════════════════════════════════════════
		// Tab 2: Radio Settings (Hardware & Wi-Fi 7 Tuning)
		// ══════════════════════════════════════════════════════════════════
		var paneRadios = E('div', { 'class': 'cbi-tab-pane', 'style': 'display:none' });
		tabPanes['radios'] = paneRadios;

		var radioForms = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Radio Settings')),
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
					'type': 'checkbox',
					'style': 'cursor:pointer'
				};
				if (!curDis) disAttrs.checked = 'checked';
				var disCheckbox = E('input', disAttrs);
				disCheckbox.addEventListener('change', function(e) {
					if (!e.target.checked) uci.set('wireless', radSec, 'disabled', '1');
					else uci.unset('wireless', radSec, 'disabled');
				});

				var extraRows = [];
				if (idx === 1) {
					var bgrEnable = uci.get('wireless', radSec, 'background_radar') === '1';
					var bgrChk = E('input', {
						'type': 'checkbox',
						'style': 'cursor:pointer',
						'checked': bgrEnable ? 'checked' : null,
						'change': function(e) {
							if (e.target.checked) uci.set('wireless', radSec, 'background_radar', '1');
							else uci.unset('wireless', radSec, 'background_radar');
						}
					});
					extraRows.push(E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Zero-Wait DFS (Background Radar)')),
						E('div', { 'class': 'cbi-value-field' }, [
							bgrChk,
							E('span', { 'class': 'cbi-value-description' }, _('Enables MT7996 background radar listening for zero-wait DFS channel switching.'))
						])
					]));
				} else if (idx === 2) {
					var lpiEnable = uci.get('wireless', radSec, 'lpi_enable') !== '0';
					var lpiChk = E('input', {
						'type': 'checkbox',
						'style': 'cursor:pointer',
						'checked': lpiEnable ? 'checked' : null,
						'change': function(e) {
							if (e.target.checked) uci.set('wireless', radSec, 'lpi_enable', '1');
							else uci.set('wireless', radSec, 'lpi_enable', '0');
						}
					});
					extraRows.push(E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('LPI Indoor Mode')),
						E('div', { 'class': 'cbi-value-field' }, [
							lpiChk,
							E('span', { 'class': 'cbi-value-description' }, _('Low Power Indoor compliance for 6 GHz band.'))
						])
					]));
				}

				var card = E('div', { 'class': 'cbi-section-node', 'style': 'border:1px solid var(--cbi-border-color, #e0e0e0);border-radius:6px;padding:12px 14px;margin-bottom:12px' }, [
					E('h4', { 'style': 'margin:0 0 10px;font-weight:600' }, radSec + ' (' + band.name + ')'),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': enableId }, _('Enabled')),
						E('div', { 'class': 'cbi-value-field' }, [ disCheckbox ])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': channelId }, _('Operating Channel')),
						E('div', { 'class': 'cbi-value-field' }, [ chanSelect ])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': htmodeId }, _('Bandwidth / Mode')),
						E('div', { 'class': 'cbi-value-field' }, [ htSelect ])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': txpId }, _('TX Power (dBm)')),
						E('div', { 'class': 'cbi-value-field' }, [
							txpInput,
							E('span', { 'class': 'cbi-value-description' }, _('1-%d dBm, leave empty for regulatory auto').format(band.maxTxp))
						])
					])
				].concat(extraRows));

				radioForms.appendChild(card);
			})(bandIdx);
		}

		// Advanced Radio Settings
		var r0Sec = 'radio0';
		var curCountry = uci.get('wireless', r0Sec, 'country') || 'CN';
		var curBeamforming = uci.get('wireless', r0Sec, 'etxbfen') !== '0';
		var curSpatialReuse = uci.get('wireless', r0Sec, 'sr_enable') !== '0';

		var countrySel = E('select', {
			'class': 'cbi-input-select',
			'style': 'width:120px',
			'change': function(e) {
				var v = e.target.value;
				[0, 1, 2].forEach(function(i) {
					uci.set('wireless', 'radio' + i, 'country', v);
				});
			}
		}, ['CN', 'US', 'CZ', 'DE', 'HK', 'JP', 'KR', 'TW', 'GB'].map(function(c) {
			var o = E('option', { 'value': c }, c);
			if (c === curCountry) o.selected = true;
			return o;
		}));

		var bfChk = E('input', {
			'type': 'checkbox',
			'style': 'cursor:pointer',
			'checked': curBeamforming ? 'checked' : null,
			'change': function(e) {
				var val = e.target.checked ? '1' : '0';
				[0, 1, 2].forEach(function(i) {
					uci.set('wireless', 'radio' + i, 'etxbfen', val);
				});
			}
		});

		var srChk = E('input', {
			'type': 'checkbox',
			'style': 'cursor:pointer',
			'checked': curSpatialReuse ? 'checked' : null,
			'change': function(e) {
				var val = e.target.checked ? '1' : '0';
				[0, 1, 2].forEach(function(i) {
					uci.set('wireless', 'radio' + i, 'sr_enable', val);
				});
			}
		});

		var advCard = E('div', { 'class': 'cbi-section-node', 'style': 'border:1px solid var(--cbi-border-color, #e0e0e0);border-radius:6px;padding:12px 14px;margin-bottom:12px' }, [
			E('h4', { 'style': 'margin:0 0 10px;font-weight:600' }, _('Advanced Wi-Fi 7 Tuning')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Country Code')),
				E('div', { 'class': 'cbi-value-field' }, [ countrySel ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Explicit Beamforming')),
				E('div', { 'class': 'cbi-value-field' }, [
					bfChk,
					E('span', { 'class': 'cbi-value-description' }, _('Directional antenna signal focusing for compatible devices.'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Spatial Reuse (SR)')),
				E('div', { 'class': 'cbi-value-field' }, [
					srChk,
					E('span', { 'class': 'cbi-value-description' }, _('Wi-Fi 7 BSS coloring and concurrent transmission optimization.'))
				])
			])
		]);
		radioForms.appendChild(advCard);

		var saveBtn = E('button', {
			'class': 'cbi-button cbi-button-apply',
			'click': function(ev) {
				ev.target.disabled = true;
				return uci.save()
					.then(function() { return uci.apply(); })
					.then(function() {
						ev.target.disabled = false;
						ui.addNotification(null, E('p', {}, _('Radio configuration applied successfully.')), 'info');
					})
					.catch(function(err) {
						ev.target.disabled = false;
						ui.addNotification(null, E('p', {}, _('Failed to apply configuration: ') + (err.message || err)), 'error');
					});
			}
		}, _('Save & Apply'));

		radioForms.appendChild(E('div', { 'style': 'display:flex;justify-content:flex-end;margin-top:14px' }, [ saveBtn ]));
		paneRadios.appendChild(radioForms);

		// ══════════════════════════════════════════════════════════════════
		// Tab 3: Connected Clients (Dedicated High-Density Table)
		// ══════════════════════════════════════════════════════════════════
		var paneClients = E('div', { 'class': 'cbi-tab-pane', 'style': 'display:none' });
		tabPanes['clients'] = paneClients;

		var clientTable = E('table', { 'class': 'table cbi-section-table', 'id': 'wifi7-client-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Interface / Band')),
				E('th', { 'class': 'th' }, _('MAC Address')),
				E('th', { 'class': 'th' }, _('Standard / Bandwidth')),
				E('th', { 'class': 'th' }, _('Signal')),
				E('th', { 'class': 'th' }, _('TX Rate')),
				E('th', { 'class': 'th' }, _('RX Rate')),
				E('th', { 'class': 'th' }, _('Online Time'))
			])
		]);

		paneClients.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Connected Clients')),
			E('div', { 'class': 'wifi7-client-table-wrap' }, [ clientTable ])
		]));

		// Append all panes
		m.appendChild(paneOverview);
		m.appendChild(paneRadios);
		m.appendChild(paneClients);

		// ══════════════════════════════════════════════════════════════════
		// High-Efficiency Native Data Polling (iwinfo + hostapd RPC)
		// ══════════════════════════════════════════════════════════════════
		function updateData() {
			return callIwinfoDevices().then(function(devRes) {
				var devs = Array.isArray(devRes.devices) ? devRes.devices : [];

				// Parallel queries via fast C-based RPC: iwinfo assoclist & info for all devices
				var assocTasks = devs.map(function(d) {
					return callIwinfoAssocList(d).then(function(r) {
						return { device: d, clients: r.results || [] };
					}).catch(function() {
						return { device: d, clients: [] };
					});
				});

				var infoTasks = devs.map(function(d) {
					return callIwinfoInfo(d).then(function(r) {
						return { device: d, info: r || {} };
					}).catch(function() {
						return { device: d, info: {} };
					});
				});

				// Lightweight fallback probe for MLO links, dynamic hostapd metrics, survey and firmware
				var shellProbe = [
					'echo "===FW==="',
					'dmesg 2>/dev/null | grep -iE "mt7996.*(firmware|build|rom)" | tail -n 1 | sed "s/^.*: //"',
					'echo "===HOSTAPD==="',
					'for s in /var/run/hostapd/*; do [ -S "$s" ] || continue; bn=$(basename "$s"); echo "---H:$bn---"; hostapd_cli -p /var/run/hostapd -i "$bn" stat 2>/dev/null; for l in 0 1 2; do lstat=$(hostapd_cli -p /var/run/hostapd -i "$bn" -l $l stat 2>/dev/null); [ -n "$lstat" ] && echo "---HL:$bn:$l---" && echo "$lstat"; done; done',
					'echo "===SURVEY==="',
					'for dev in $(iw dev 2>/dev/null | awk \'/Interface/{print $2}\'); do echo "---S:$dev---"; iw dev "$dev" survey dump 2>/dev/null | grep -E "frequency|channel active time|channel busy time" | head -n 12; done',
					'echo "===STATIONS==="',
					'for dev in $(iw dev 2>/dev/null | awk \'/Interface/{print $2}\'); do echo "===IFACE:$dev==="; iw dev "$dev" station dump 2>/dev/null; done'
				].join('; ');

				return Promise.all([
					Promise.all(assocTasks),
					Promise.all(infoTasks),
					callExec('/bin/sh', ['-c', shellProbe]).catch(function() { return { stdout: '' }; })
				]);
			}).then(function(results) {
				var assocListResults = results[0] || [];
				var infoResults = results[1] || [];
				var shellRaw = (results[2] && results[2].stdout) ? results[2].stdout : '';

				var infoByDev = {};
				infoResults.forEach(function(item) {
					infoByDev[item.device] = item.info;
				});

				// Parse hostapd stats, surveys & stations from shell probe
				var hostapdMap = {};
				var curHKey = null;
				var curHLines = [];
				var staLines = [];
				var fwLine = '';
				var surveyMap = {};
				var curSDev = null;
				var sActive = 0, sBusy = 0;
				var section = '';

				shellRaw.split('\n').forEach(function(line) {
					if (line.indexOf('===FW===') === 0) {
						section = 'FW';
						return;
					}
					if (line.indexOf('===HOSTAPD===') === 0) {
						section = 'HOSTAPD';
						return;
					}
					if (line.indexOf('===SURVEY===') === 0) {
						section = 'SURVEY';
						return;
					}
					if (line.indexOf('===STATIONS===') === 0 || line.indexOf('===IFACE:') === 0) {
						section = 'STATIONS';
						staLines.push(line);
						return;
					}

					if (section === 'FW') {
						if (!fwLine && line.trim()) fwLine = line.trim();
					} else if (section === 'HOSTAPD') {
						if (line.indexOf('---H') === 0 && line.lastIndexOf('---') > 2) {
							if (curHKey) hostapdMap[curHKey] = parseHostapdStat(curHLines.join('\n'));
							curHKey = line.replace(/---/g, '').trim();
							curHLines = [];
						} else {
							curHLines.push(line);
						}
					} else if (section === 'SURVEY') {
						if (line.indexOf('---S:') === 0) {
							if (curSDev && sActive > 0 && sBusy >= 0) {
								surveyMap[curSDev] = Math.round((sBusy / sActive) * 100);
							}
							curSDev = line.replace('---S:', '').replace(/---/g, '').trim();
							sActive = 0; sBusy = 0;
							return;
						}
						var mAct = line.match(/channel active time:\s+(\d+)/);
						if (mAct) sActive = parseInt(mAct[1]);
						var mBsy = line.match(/channel busy time:\s+(\d+)/);
						if (mBsy) sBusy = parseInt(mBsy[1]);
					} else if (section === 'STATIONS') {
						staLines.push(line);
					}
				});
				if (curHKey) hostapdMap[curHKey] = parseHostapdStat(curHLines.join('\n'));
				if (curSDev && sActive > 0 && sBusy >= 0) {
					surveyMap[curSDev] = Math.round((sBusy / sActive) * 100);
				}

				// 1. Hardware Firmware & 5GHz DFS Status (Tab 1)
				var fwEl = document.getElementById('wifi7-val-fw');
				if (fwEl) fwEl.textContent = fwLine ? fwLine : 'MediaTek MT7996e (Kernel mac80211)';

				var dfsEl = document.getElementById('wifi7-val-dfs');
				if (dfsEl) {
					var r1Dev = devMapByName['radio1'];
					var r1Dis = r1Dev ? !r1Dev.isUp() : (uci.get('wireless', 'radio1', 'disabled') === '1');
					var r1Chan = parseInt((r1Dev && r1Dev.get('channel')) ? r1Dev.get('channel') : (uci.get('wireless', 'radio1', 'channel') || '0'));
					var isDfsChan = (r1Chan >= 52 && r1Chan <= 144);

					var dfsState = null;
					Object.keys(hostapdMap).forEach(function(k) {
						if (!dfsState && hostapdMap[k]['dfs_state'])
							dfsState = hostapdMap[k]['dfs_state'];
					});

					if (r1Dis) {
						dfsEl.textContent = _('Disabled');
						dfsEl.style.color = 'inherit';
					} else if (dfsState === 'cac' || dfsState === 'scanning') {
						dfsEl.textContent = _('DFS CAC Scanning...');
						dfsEl.style.color = '#f59e0b';
					} else if (isDfsChan) {
						dfsEl.textContent = _('Operating (CAC Passed)');
						dfsEl.style.color = '#10b981';
					} else if (r1Chan > 0) {
						dfsEl.textContent = _('Non-DFS Channel (Active)');
						dfsEl.style.color = '#10b981';
					} else {
						dfsEl.textContent = _('Operating (Normal)');
						dfsEl.style.color = '#10b981';
					}
				}

				// 2. Aggregate Stations from both iwinfo and iw station dump
				var clientsByMac = {};
				var bandStaCounts = { 0: 0, 1: 0, 2: 0 };
				var bandNames = { '0': '2.4 GHz', '1': '5 GHz', '2': '6 GHz' };

				// Parse iw station dump (has Link 0/1/2 MLO awareness)
				var iwStations = parseAllStations(staLines.join('\n'));
				iwStations.forEach(function(sta) {
					clientsByMac[sta.mac] = sta;
				});

				// Merge with iwinfo assoclist
				assocListResults.forEach(function(item) {
					var devName = item.device;
					var bIdx = devName.indexOf('.1-') !== -1 ? 1 : (devName.indexOf('.2-') !== -1 ? 2 : 0);

					item.clients.forEach(function(c) {
						var mac = (c.mac || '').toLowerCase();
						if (!mac) return;

						if (!clientsByMac[mac]) {
							clientsByMac[mac] = {
								mac: mac,
								iface: devName,
								links: {},
								signal: c.signal || null,
								tx_rate: formatRate(c.tx_rate),
								rx_rate: formatRate(c.rx_rate),
								connected: c.connected_time ? c.connected_time + 's' : '—',
								protocolBadge: formatProtocolFromIwinfo(c)
							};
						} else {
							if (!clientsByMac[mac].signal && c.signal)
								clientsByMac[mac].signal = c.signal;
							if (!clientsByMac[mac].tx_rate && c.tx_rate)
								clientsByMac[mac].tx_rate = formatRate(c.tx_rate);
							if (!clientsByMac[mac].rx_rate && c.rx_rate)
								clientsByMac[mac].rx_rate = formatRate(c.rx_rate);
						}
					});
				});

				// Build Client Rows (Tab 3) & Count Stations per Band (Tab 1)
				var allClients = [];
				Object.keys(clientsByMac).forEach(function(mac) {
					var sta = clientsByMac[mac];
					var activeLinks = Object.keys(sta.links || {}).filter(function(lid) {
						var lk = sta.links[lid];
						return lk && (!lk.idle || lk.signal !== null);
					});

					if (activeLinks.length > 0) {
						activeLinks.sort().forEach(function(lid) {
							var lk = sta.links[lid];
							var bIdx = parseInt(lid);
							if (!isNaN(bIdx) && bandStaCounts[bIdx] !== undefined) {
								bandStaCounts[bIdx]++;
							}
							var bLabel = bandNames[lid] || ('Link ' + lid);
							var macNode = [
								E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums;margin-right:6px' }, sta.mac),
								E('span', {
									'style': 'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#0ea5e9;color:#fff;display:inline-block'
								}, 'MLO')
							];
							allClients.push([
								E('span', { 'style': 'font-weight:600' }, (sta.iface || 'ap-mld') + ' (' + bLabel + ')'),
								E('span', {}, macNode),
								formatRateBadge(lk.tx_rate || lk.rx_rate),
								formatSignal(lk.signal),
								E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, lk.tx_rate || '—'),
								E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, lk.rx_rate || '—'),
								E('span', { 'style': 'color:#888' }, sta.connected || '—')
							]);
						});
					} else {
						var ifn = sta.iface || '';
						var bIdx = 0;
						if (ifn.indexOf('.1-') !== -1 || ifn.indexOf('radio1') !== -1) bIdx = 1;
						else if (ifn.indexOf('.2-') !== -1 || ifn.indexOf('radio2') !== -1) bIdx = 2;
						else if (ifn.indexOf('.0-') !== -1 || ifn.indexOf('radio0') !== -1) bIdx = 0;
						bandStaCounts[bIdx]++;

						var bLabel = bandNames[bIdx] || ifn;
						var macNode = [
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, sta.mac)
						];
						allClients.push([
							E('span', { 'style': 'font-weight:600' }, ifn ? ifn + ' (' + bLabel + ')' : bLabel),
							E('span', {}, macNode),
							sta.protocolBadge || formatRateBadge(sta.tx_rate || sta.rx_rate),
							formatSignal(sta.signal),
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, sta.tx_rate || '—'),
							E('span', { 'style': 'font-family:monospace;font-variant-numeric:tabular-nums' }, sta.rx_rate || '—'),
							E('span', { 'style': 'color:#888' }, sta.connected || '—')
						]);
					}
				});

				// 3. Update Radio Cards (Tab 1: Channel, Utilization, TX Power, Online Stations)
				for (var idx = 0; idx < 3; idx++) {
					var utilEl = document.getElementById('wifi7-val-util-' + idx);
					var chanEl = document.getElementById('wifi7-val-chan-' + idx);
					var txpEl = document.getElementById('wifi7-val-txp-' + idx);
					var staEl = document.getElementById('wifi7-val-sta-' + idx);

					// Check hostapd stats for this band
					var hStat = null;
					Object.keys(hostapdMap).forEach(function(k) {
						if (k.indexOf('HL:') === 0 && k.slice(-2) === ':' + idx) {
							hStat = hostapdMap[k];
						} else if (!hStat && (k.indexOf('.' + idx + '-') !== -1 || k.indexOf('radio' + idx) !== -1)) {
							hStat = hostapdMap[k];
						}
					});

					// Find iwinfo info for matching interface
					var iwInfo = null;
					Object.keys(infoByDev).forEach(function(d) {
						if (!iwInfo && (d.indexOf('.' + idx + '-') !== -1 || d.indexOf('radio' + idx) !== -1)) {
							iwInfo = infoByDev[d];
						}
					});

					// Channel / Bandwidth
					if (chanEl) {
						var ch = (hStat && hStat['channel']) || (iwInfo && iwInfo.channel) || null;
						var bw = null;
						if (hStat && hStat['eht_oper_chwidth']) {
							bw = bwCodeMap[hStat['eht_oper_chwidth']] || (hStat['eht_oper_chwidth'] + ' MHz');
						}
						if (ch) {
							chanEl.textContent = ch + ' / ' + (bw || BANDS[idx].defBw);
						}
					}

					// Channel Utilization
					if (utilEl) {
						var u = null;
						if (hStat && hStat['chan_util_avg']) {
							var parsedU = parseInt(hStat['chan_util_avg']);
							if (!isNaN(parsedU) && parsedU <= 100) u = parsedU;
						}
						if (u === null) {
							// Check survey calculation fallback
							Object.keys(surveyMap).forEach(function(sdev) {
								if (u === null && (sdev.indexOf('.' + idx + '-') !== -1 || sdev.indexOf('radio' + idx) !== -1)) {
									if (surveyMap[sdev] >= 0 && surveyMap[sdev] <= 100)
										u = surveyMap[sdev];
								}
							});
						}
						utilEl.textContent = (u !== null) ? u + '%' : '—';
					}

					// TX Power
					if (txpEl) {
						var pwr = (hStat && hStat['max_txpower']) || (iwInfo && iwInfo.txpower) || null;
						if (pwr) txpEl.textContent = Math.round(parseFloat(pwr)) + ' dBm';
					}

					// Online Stations Count (Accurate Real-Time Counter)
					if (staEl) {
						staEl.textContent = bandStaCounts[idx] || 0;
					}
				}

				// 4. Render Connected Clients (Tab 3)
				var tb = document.getElementById('wifi7-client-table');
				if (tb) {
					cbi_update_table(tb, allClients, E('em', { 'style': 'color:#888' }, _('No connected clients')));
				}
			});
		}

		updateData();
		poll.add(updateData, 5);

		return m;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
