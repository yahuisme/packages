'use strict';
'require view';
'require network';
'require rpc';
'require uci';
'require ui';
'require poll';
'require wifi7.telemetry as telemetry';

var devices = rpc.declare({ object: 'iwinfo', method: 'devices', expect: { devices: [] }, raise: true });
var assoc = rpc.declare({ object: 'iwinfo', method: 'assoclist', params: ['device'], expect: { results: [] }, raise: true });
var info = rpc.declare({ object: 'iwinfo', method: 'info', params: ['device'], raise: true });
var probe = rpc.declare({ object: 'file', method: 'exec', params: ['command', 'params'], raise: true });
var frequencies = rpc.declare({ object: 'iwinfo', method: 'freqlist', params: ['device'], expect: { results: [] }, raise: true });
var names = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' };

function settled(promise) {
	return promise.then(function(value) { return { ok: true, value: value }; }, function() { return { ok: false }; });
}
function rate(value) {
	var match = typeof value === 'string' && value.match(/^\s*([\d.]+)\s*Mbit\/s\b/i);
	var mbits = match ? Number(match[1]) : value && typeof value === 'object' ? value.rate / 1000 : NaN;
	return Number.isFinite(mbits) && mbits > 0 ? mbits.toFixed(1) + ' Mbit/s' : '—';
}
function standard(value) {
	if (typeof value === 'string') {
		var tag = /EHT/.test(value) ? 'Wi-Fi 7' : /HE/.test(value) ? 'Wi-Fi 6' : /VHT/.test(value) ? 'Wi-Fi 5' : /HT/.test(value) ? 'Wi-Fi 4' : _('Legacy');
		var bw = value.match(/(\d+)\s*MHz/);
		return tag + (bw ? ' / ' + bw[1] + ' MHz' : '');
	}
	return value ? (value.eht ? 'Wi-Fi 7' : value.he ? 'Wi-Fi 6' : value.vht ? 'Wi-Fi 5' : value.ht ? 'Wi-Fi 4' : _('Legacy')) + (value.mhz ? ' / ' + value.mhz + ' MHz' : '') : '—';
}
function select(id, values, current) {
	values = values.slice();
	if (current && values.indexOf(String(current)) < 0) values.push(String(current));
	var el = E('select', { id: id, name: id, 'class': 'cbi-input-select' }, values.map(function(v) {
		return E('option', { value: v }, v === 'auto' || v === '' ? _('Auto') : v);
	}));
	el.value = current || values[0];
	return el;
}
function channelSelect(id, result, radio) {
	var choices = result && result.ok ? result.value.filter(function(f) {
		return telemetry.band(f.mhz) === radio.band && !(f.restricted && (!f.flags || f.flags.indexOf('no_ir') !== -1));
	}) : [];
	var el = select(id, ['auto'].concat(choices.map(function(f) { return String(f.channel); })), radio.channel || 'auto');
	Array.from(el.options).forEach(function(o) {
		var f = choices.find(function(f) { return String(f.channel) === o.value; });
		if (f) o.textContent = f.channel + ' (' + f.mhz + ' MHz)';
	});
	return el;
}
function field(label, input, description) {
	return E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', 'for': input.id }, label),
		E('div', { 'class': 'cbi-value-field' }, [input, description ? E('div', { 'class': 'cbi-value-description' }, description) : '']) ]);
}

return view.extend({
	load: function() {
		return Promise.all([uci.load('wireless').then(function() {
			return Promise.all(uci.sections('wireless', 'wifi-device').map(function(r) {
				return Promise.all([settled(frequencies(r['.name'])), settled(info(r['.name']))]).then(function(result) {
					return { id: r['.name'], result: result[0], capabilities: result[1] };
				});
			}));
		}), settled(probe('/usr/libexec/wifi7-firmware', []))]);
	},
	render: function(data) {
		var radios = uci.sections('wireless', 'wifi-device');
		var cells = {}, controls = [], previous = {}, busy = false, channelLists = {}, clientNodes = {};
		var activeTab = 0, clientCache = { rows: [], empty: _('Client data unavailable') };
		var saving = false, readonly = !L.hasViewPermission();
		(data[0] || []).forEach(function(item) { channelLists[item.id] = item; });
		var notice = E('div', { 'class': 'cbi-section-descr' });
		var grid = E('div', { 'class': 'wifi7-grid' });
		var settings = E('div', { 'class': 'cbi-section' });
		radios.forEach(function(r) {
			var id = r['.name'], band = r.band, prefix = 'wifi7-' + id + '-';
			var c = cells[id] = {};
			var badge = c.state = E('span', { 'class': 'wifi7-status-badge' }, '—');
			var header = E('div', { 'class': 'wifi7-card-header' }, [
				E('div', { 'class': 'wifi7-card-title' }, [
					E('span', { 'class': 'wifi7-band-name' }, names[band] || id),
					E('span', { 'class': 'wifi7-device-tag' }, id)
				]),
				E('div', { 'class': 'wifi7-status-wrap' }, [
					E('span', { 'class': 'wifi7-status-label' }, _('Status')),
					badge
				])
			]);
			var body = E('div', { 'class': 'wifi7-card-body' });
			[[ 'channel', _('Channel / Bandwidth')], ['power', _('TX Power')], ['util', _('Channel Utilization')], ['count', _('Online Stations')]].forEach(function(item) {
				c[item[0]] = E('span', { 'class': 'wifi7-value' }, '—');
				body.appendChild(E('div', { 'class': 'wifi7-row' }, [ E('span', { 'class': 'wifi7-label' }, item[1]), c[item[0]] ]));
			});
			grid.appendChild(E('div', { 'class': 'wifi7-card' }, [ header, body ]));
			var enabled = E('input', { type: 'checkbox', id: prefix + 'enabled', name: prefix + 'enabled' });
			enabled.checked = r.disabled !== '1';
			var discovery = channelLists[id], channelResult = discovery && discovery.result;
			var choices = channelResult && channelResult.ok ? channelResult.value.filter(function(f) {
				return telemetry.band(f.mhz) === band && !(f.restricted && (!f.flags || f.flags.indexOf('no_ir') !== -1));
			}) : [];
			var channel = channelSelect(prefix + 'channel', channelResult, r);
			// iwinfo.info reports supported htmodes (network.WifiDevice.getHTModes).
			var capabilities = discovery && discovery.capabilities;
			var modes = capabilities && capabilities.ok && Array.isArray(capabilities.value.htmodes) ? capabilities.value.htmodes.filter(function(mode) {
				var width = Number((mode.match(/(\d+)$/) || [])[1]);
				return (band !== '2g' || width <= 40) && (band === '6g' || width !== 320);
			}) : [];
			if (!r.htmode) modes.unshift('');
			var width = select(prefix + 'width', modes, r.htmode);
			var power = E('input', { id: prefix + 'power', name: prefix + 'power', type: 'number', min: '1', max: '30', step: '1', value: r.txpower || '', placeholder: _('Auto'), 'class': 'cbi-input-text wifi7-narrow-input' });
			var country = E('input', { id: prefix + 'country', name: prefix + 'country', value: r.country || '', maxlength: '2', pattern: '[A-Za-z0-9]{2}', placeholder: _('Auto'), 'class': 'cbi-input-text wifi7-narrow-input' });
			country.addEventListener('change', function() {
				channel.value = controls.find(function(c) { return c.id === id; }).original.channel || 'auto';
				lockControls();
			});
			var box = E('div', { 'class': 'cbi-section-node wifi7-settings-card' }, [ E('h4', {}, id + (names[band] ? ' (' + names[band] + ')' : '')),
				field(_('Enabled'), enabled), field(_('Operating Channel'), channel, choices.length ? _('Channels reported by the driver; current configuration is preserved.') : _('Channel discovery unavailable; only the current setting is preserved.')),
				field(_('Bandwidth / Mode'), width), field(_('TX Power (dBm)'), power, _('1-%d dBm, leave empty for regulatory auto').format(30)), field(_('Country Code'), country, _('After changing country, apply and reload to refresh permitted channels.')) ]);
			var radar = null;
			if (band === '5g') {
				radar = E('input', { type: 'checkbox', id: prefix + 'radar', name: prefix + 'radar' });
				radar.checked = r.background_radar === '1';
				box.appendChild(field(_('Background Radar'), radar, _('Requires driver support; channel availability checks may still be required.')));
			}
			controls.push({ original: Object.assign({}, r), id: id, enabled: enabled, channel: channel, width: width, power: power, country: country, radar: radar });
			settings.appendChild(box);
		});
		var firmware = data[1];
		var fw = E('span', {}, firmware.ok && firmware.value.code === 0 && firmware.value.stdout.trim() ? firmware.value.stdout.trim() : _('Unavailable')), dfs = E('span', {}, _('Unknown'));
		var overview = E('div', {}, [notice, grid, E('div', { 'class': 'cbi-section-node wifi7-system-info' }, [
			E('div', { 'class': 'wifi7-info-row' }, [ E('span', { 'class': 'wifi7-info-label' }, _('MT76 Firmware')), E('span', { 'class': 'wifi7-info-value' }, fw) ]),
			E('div', { 'class': 'wifi7-info-row' }, [ E('span', { 'class': 'wifi7-info-label' }, _('5GHz DFS Status')), E('span', { 'class': 'wifi7-info-value' }, dfs) ]) ]) ]);
		var clients = E('div', { 'class': 'cbi-section' });
		var download = E('button', { 'class': 'cbi-button', click: function() {
			if (!window.confirm(_('Diagnostic output includes SSIDs and MAC addresses. Review before sharing. Continue?'))) return;
			download.disabled = true;
			return probe('/usr/libexec/wifi7-diagnostics', []).then(function(result) {
				if (result.code !== 0 || !result.stdout) throw new Error(_('Diagnostic collection failed'));
				var url = URL.createObjectURL(new Blob([result.stdout], { type: 'text/plain;charset=utf-8' }));
				var anchor = E('a', { href: url, download: 'wifi7-diagnostics.txt' });
				document.body.appendChild(anchor); anchor.click(); anchor.remove();
				window.setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
			}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); })
				.finally(function() { download.disabled = false; });
		} }, _('Export wireless diagnostics'));
		overview.appendChild(download);
		var panes = [overview, settings, clients];
		var nav = E('ul', { 'class': 'cbi-tabmenu' });
		[_('Radio Status'), _('Radio Settings'), _('Connected Clients')].forEach(function(label, i) {
			panes[i].style.display = i ? 'none' : '';
			nav.appendChild(E('li', { 'class': i ? 'cbi-tab-disabled' : 'cbi-tab' }, E('a', { href: '#', click: function(ev) {
				ev.preventDefault(); activeTab = i;
				if (i === 2) renderClients();
				panes.forEach(function(p, n) { p.style.display = n === i ? '' : 'none'; nav.children[n].className = n === i ? 'cbi-tab' : 'cbi-tab-disabled'; });
			} }, label)));
		});
		var save = E('button', { 'class': 'cbi-button cbi-button-apply', click: function() {
			if (saving || readonly) return;
			if (controls.some(function(c) { return !c.channel.reportValidity() || !c.power.reportValidity() || !c.country.reportValidity(); })) return;
			var changes = [];
			controls.forEach(function(c) {
				if (c.missing) return;
				var values = { disabled: c.enabled.checked ? '0' : '1', channel: c.channel.value,
					htmode: c.width.value, txpower: c.power.value, country: c.country.value.toUpperCase() };
				if (c.radar) values.background_radar = c.radar.checked ? '1' : '0';
				Object.keys(values).forEach(function(key) {
					var original = c.original[key] || (key === 'disabled' || key === 'background_radar' ? '0' : key === 'channel' ? 'auto' : '');
					if (key === 'country') original = original.toUpperCase();
					var pending = c.pending && c.pending.has(key);
					if (values[key] !== original || pending)
						changes.push({ id: c.id, key: key, value: values[key] === original ? (c.original[key] || '') : values[key] });
				});
			});
			if (!changes.length) return;
			var disruptive = changes.some(function(change) {
				return ['channel', 'htmode', 'country'].indexOf(change.key) !== -1 || change.key === 'disabled' && change.value === '1';
			});
			if (disruptive && !window.confirm(_('These changes may interrupt wireless connections, including MLO links. Apply?'))) return;
			changes.forEach(function(change) {
				// Failed applies may leave server-side deltas; overwrite them on retry.
				var control = controls.find(function(c) { return c.id === change.id; });
				if (!control.pending) control.pending = new Set();
				control.pending.add(change.key);
				if (change.value) uci.set('wireless', change.id, change.key, change.value);
				else uci.unset('wireless', change.id, change.key);
			});
			saving = true;
			lockControls();
			return uci.save().then(function() { return uci.apply(); }).then(function() {
				uci.unload('wireless');
				return uci.load('wireless');
			}).then(function() {
				var fresh = uci.sections('wireless', 'wifi-device');
				return Promise.all(controls.map(function(c) {
					var original = fresh.find(function(r) { return r['.name'] === c.id; });
					c.missing = !original;
					if (!original) return;
					var changedCountry = c.original.country !== original.country;
					c.original = Object.assign({}, original);
					c.pending = null;
					c.enabled.checked = original.disabled !== '1';
					c.channel.value = original.channel || 'auto';
					c.width.value = original.htmode || '';
					c.power.value = original.txpower || '';
					c.country.value = original.country || '';
					if (c.radar) c.radar.checked = original.background_radar === '1';
					if (!changedCountry) return;
					return settled(frequencies(c.id)).then(function(result) {
						var replacement = channelSelect(c.channel.id, result, original);
						c.channel.replaceChildren.apply(c.channel, Array.from(replacement.options));
						c.channel.value = original.channel || 'auto';
					});
				}));
			}).then(function() {
				ui.addNotification(null, E('p', {}, _('Configuration applied. Runtime status will refresh.')), 'info');
				return update();
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, _('Failed to apply configuration: %s').format(err && err.message != null ? err.message : String(err))), 'error');
			}).finally(function() { saving = false; lockControls(); });
		} }, _('Save & Apply'));
		settings.appendChild(E('div', { 'class': 'wifi7-save-bar' }, save));
		function lockControls() {
			save.disabled = saving || readonly;
			controls.forEach(function(c) {
				['enabled', 'channel', 'width', 'power', 'country', 'radar'].forEach(function(key) { if (c[key]) c[key].disabled = saving || readonly || c.missing; });
				c.channel.disabled = saving || readonly || c.missing || c.country.value.toUpperCase() !== (c.original.country || '').toUpperCase();
			});
		}

		lockControls();

		function update() {
			if (busy) return busy;
			busy = Promise.all([
				settled(network.flushCache().then(function() { return Promise.all([network.getWifiDevices(), network.getWifiNetworks()]); })),
				settled(devices().then(function(list) { return Promise.all(Array.from(new Set(list)).map(function(d) { return Promise.all([settled(assoc(d)), settled(info(d))]).then(function(r) { return { name: d, stations: r[0], info: r[1] }; }); })); })),
				settled(probe('/usr/libexec/wifi7-status', []))
			]).then(function(result) {
				var runtime = result[0], native = result[1], shell = result[2];
				var parsed = telemetry.parse(shell.ok && shell.value.code === 0 ? shell.value.stdout : '');
				var ssids = {}, ifaceRadio = {}, runtimeRadios = {}, nativeByName = {}, stats = {}, rows = [], nextPrevious = {};
				if (runtime.ok) {
					runtime.value[0].forEach(function(d) { runtimeRadios[d.getName()] = d; });
					runtime.value[1].forEach(function(n) { ifaceRadio[n.getIfname()] = n.getWifiDeviceName(); ssids[n.getIfname()] = n.getSSID(); });
				}
				if (native.ok) native.value.forEach(function(n) { nativeByName[n.name] = n; });
				radios.forEach(function(r) { stats[r['.name']] = { count: 0, known: false, failed: false, util: null, current: null }; });
				function radioFor(iface, frequency) {
					var b = telemetry.band(frequency), matches = radios.filter(function(r) { return b && r.band === b; });
					return matches.length === 1 ? matches[0]['.name'] : !b ? ifaceRadio[iface] : null;
				}
				var ifaces = Array.from(new Set(Object.keys(parsed.devices).concat(Object.keys(nativeByName), Object.keys(ifaceRadio))));
				var anyKnown = false, anyFailed = false;
				ifaces.forEach(function(iface) {
					var n = nativeByName[iface], dev = parsed.devices[iface] || {}, ni = n && n.info.ok ? n.info.value : {};
					var frequency = dev.frequency || ni.frequency, radio = radioFor(iface, frequency);
					var known = Object.prototype.hasOwnProperty.call(parsed.stations, iface) || !!(n && n.stations.ok && !Object.keys(dev.links || {}).length);
					anyKnown = anyKnown || known; anyFailed = anyFailed || !known;
					var mapped = new Set();
					if (radio) mapped.add(radio);
					Object.keys(dev.links || {}).forEach(function(lid) { var r = radioFor(iface, dev.links[lid].frequency); if (r) mapped.add(r); });
					mapped.forEach(function(r) { stats[r].known = stats[r].known || known; stats[r].failed = stats[r].failed || !known; });
					function measurement(data) {
						var r = radioFor(iface, data.frequency);
						if (r && data.frequency) stats[r].current = data;
					}
					var htwidth = String(ni.htmode || '').match(/^(?:HT|VHT|HE|EHT)(20|40|80|160|320)$/);
					measurement(Object.assign({}, ni, { width: htwidth ? htwidth[1] + ' MHz' : null }, dev));
					Object.keys(dev.links || {}).forEach(function(lid) { measurement(dev.links[lid]); });
					(parsed.surveys[iface] || []).forEach(function(s) {
						var key = iface + ':' + s.frequency, r = radioFor(iface, s.frequency);
						if (r) stats[r].util = telemetry.delta(s, previous[key]);
						nextPrevious[key] = s;
					});
					var merged = {};
					if (n && n.stations.ok) n.stations.value.forEach(function(s) { merged[s.mac.toLowerCase()] = { mac: s.mac, signal: s.signal, tx: s.tx, rx: s.rx, connected: s.connected_time, links: {} }; });
					(parsed.stations[iface] || []).forEach(function(s) {
						var old = merged[s.mac] || {};
						if (s.signal == null) s.signal = old.signal;
						merged[s.mac] = Object.assign(old, s);
					});
					Object.keys(merged).forEach(function(mac) {
						var s = merged[mac], linkIds = Object.keys(s.links || {});
						function row(value, lid) {
							var f = lid != null ? ((dev.links || {})[lid] || {}).frequency : linkIds.length ? null : frequency, r = linkIds.length && lid == null ? null : radioFor(iface, f), b = telemetry.band(f);
							if (r) stats[r].count++;
							rows.push({ clientKey: iface + '/' + mac, linkKey: lid == null ? 'station' : String(lid), ssid: ssids[iface] || '',
								label: iface + (lid != null ? ' / MLO ' + lid : '') + ' (' + (names[b] || _('Unknown')) + ')', mac: mac,
								standard: standard(value.tx || value.rx), signal: value.signal < 0 ? value.signal + ' dBm' : '—',
								tx: rate(value.tx), rx: rate(value.rx), connected: s.connected != null ? s.connected + ' s' : '—' });
						}
						if (linkIds.some(function(lid) { return !(s.links[lid].signal < 0) || !((dev.links || {})[lid] || {}).frequency; }))
							mapped.forEach(function(r) { stats[r].failed = true; });
						if (linkIds.length) linkIds.forEach(function(lid) { row(s.links[lid], lid); }); else row(s, null);
					});
				});
				previous = nextPrevious;
				parsed.hostapd.forEach(function(h) { var r = radioFor('', h.freq), u = telemetry.utilization(h.chan_util_avg); if (r && u != null) stats[r].util = u; });
				radios.forEach(function(r) {
					var id = r['.name'], s = stats[id], c = cells[id], d = runtimeRadios[id];
					var isUp = d && d.isUp();
					var isDis = d && !d.isUp();
					c.state.textContent = d ? (isUp ? _('Up') : _('Disabled')) : _('Unknown');
					c.state.className = 'wifi7-status-badge' + (isUp ? ' wifi7-badge-up' : isDis ? ' wifi7-badge-disabled' : '');
					c.count.textContent = s.known && !s.failed ? String(s.count) : '—';
					c.util.textContent = s.util == null ? '—' : s.util + '%';
					c.channel.textContent = s.current && s.current.channel ? s.current.channel + ' / ' + (s.current.width || '—') : '—';
					c.power.textContent = s.current && s.current.txpower != null ? s.current.txpower + ' dBm' : '—';
				});
				var state = telemetry.dfs(parsed.hostapd);
				var remaining = parsed.hostapd.filter(function(h) { return telemetry.band(h.freq) === '5g' && h.state === 'DFS'; }).map(function(h) { return /^\d+$/.test(h.cac_time_left_seconds || '') ? Number(h.cac_time_left_seconds) : null; });
				dfs.textContent = state === 'cac' ? _('DFS CAC in progress') + (remaining.length && remaining.every(function(n) { return n !== null; }) ? ' · ' + _('%d seconds remaining').format(Math.max.apply(null, remaining)) : '') : state === 'active' ? _('Operating') : _('Unknown');
				notice.textContent = '';
				clientCache = { rows: rows, empty: anyKnown && !anyFailed ? _('No connected clients') : _('Client data unavailable') };
				if (activeTab === 2) renderClients();
			}).catch(function() {
				notice.textContent = _('Telemetry update failed');
				Object.keys(cells).forEach(function(id) { Object.keys(cells[id]).forEach(function(k) { cells[id][k].textContent = '—'; }); });
				dfs.textContent = _('Unknown');
				clientCache = { rows: [], empty: _('Client data unavailable') };
				if (activeTab === 2) renderClients();
			}).finally(function() { busy = null; });
			return busy;
		}
		var clientSummary = E('div', { 'class': 'cbi-section-descr' });
		function text(node, value) {
			if (node.textContent !== value) node.textContent = value;
		}
		function renderClients() {
			var groups = {};
			clientCache.rows.forEach(function(row) { (groups[row.clientKey] || (groups[row.clientKey] = [])).push(row); });
			var keys = Object.keys(groups);
			if (!clientSummary.parentNode) clients.appendChild(clientSummary);
			text(clientSummary, keys.length ? _('%d client associations').format(keys.length) : clientCache.empty);
			Object.keys(clientNodes).forEach(function(key) {
				if (!groups[key]) { clientNodes[key].detail.remove(); delete clientNodes[key]; }
			});
			keys.forEach(function(key) {
				var entries = groups[key], first = entries[0], node = clientNodes[key];
				if (!node) {
					var summary = E('summary', { 'class': 'wifi7-client-summary' });
					var detail = E('details', { 'class': 'cbi-section-node wifi7-client-details', 'data-client': key }, summary);
					node = clientNodes[key] = { detail: detail, summary: summary, links: {} };
					clients.appendChild(detail);
				}
				text(node.summary, first.mac + (first.ssid ? ' · ' + first.ssid : '') + ' · ' + first.standard + ' · ' + first.connected);
				var linkKeys = new Set(entries.map(function(row) { return row.linkKey; }));
				Object.keys(node.links).forEach(function(key) {
					if (!linkKeys.has(key)) { node.links[key].box.remove(); delete node.links[key]; }
				});
				entries.forEach(function(row) {
					var link = node.links[row.linkKey];
					if (!link) {
						link = node.links[row.linkKey] = { box: E('div', { 'class': 'wifi7-link-box' }), label: E('div', { 'class': 'wifi7-link-label' }) };
						link.box.appendChild(link.label);
						[['standard', _('Standard / Bandwidth')], ['signal', _('Signal')], ['tx', _('TX Rate')], ['rx', _('RX Rate')]].forEach(function(field) {
							link[field[0]] = E('span', { 'class': 'wifi7-value' });
							link.box.appendChild(E('div', { 'class': 'wifi7-row' }, [E('span', {}, field[1]), link[field[0]]]));
						});
						node.detail.appendChild(link.box);
					}
					['label', 'standard', 'signal', 'tx', 'rx'].forEach(function(key) { text(link[key], row[key]); });
				});
			});
		}

		poll.add(update, 5);
		update();
		return E('div', { 'class': 'cbi-map wifi7-map' }, [ E('style', {}, `
			.wifi7-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; margin-bottom:16px; }
			.wifi7-card { border:1px solid var(--cbi-border-color, var(--hairline, rgba(128,128,128,0.2))); border-radius:6px; padding:14px 16px; min-width:0; background:var(--cbi-section-bg, rgba(128,128,128,0.03)); display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; }
			.wifi7-card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--cbi-border-color, rgba(128,128,128,0.12)); }
			.wifi7-card-title { display:flex; align-items:baseline; gap:8px; }
			.wifi7-band-name { font-size:15px; font-weight:600; color:var(--cbi-text-color, inherit); }
			.wifi7-device-tag { font-size:11px; color:var(--cbi-muted-color, #888); font-family:ui-monospace, monospace; }
			.wifi7-status-wrap { display:flex; align-items:center; gap:6px; }
			.wifi7-status-label { font-size:12px; color:var(--cbi-muted-color, #888); }
			.wifi7-status-badge { display:inline-flex; align-items:center; padding:2px 8px; font-size:12px; font-weight:500; border-radius:4px; border:1px solid var(--cbi-border-color, rgba(128,128,128,0.2)); color:var(--cbi-muted-color, #666); }
			.wifi7-badge-up { border-color:var(--cbi-success-color, #2ea44f); color:var(--cbi-success-color, #2ea44f); background:rgba(46,164,79,0.08); }
			.wifi7-badge-up::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; background:currentColor; margin-right:5px; }
			.wifi7-badge-disabled { border-color:var(--cbi-border-color, rgba(128,128,128,0.2)); color:var(--cbi-muted-color, #888); opacity:0.75; }
			.wifi7-card-body { display:flex; flex-direction:column; gap:2px; }
			.wifi7-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:5px 0; font-size:13px; }
			.wifi7-row:not(:last-child) { border-bottom:1px dashed var(--cbi-border-color, rgba(128,128,128,0.08)); }
			.wifi7-label { color:var(--cbi-muted-color, #666); font-size:12px; }
			.wifi7-value { font-variant-numeric:tabular-nums; text-align:right; font-weight:500; color:var(--cbi-text-color, inherit); }
			.wifi7-system-info { background:var(--cbi-section-bg, rgba(128,128,128,0.03)); border:1px solid var(--cbi-border-color, var(--hairline, rgba(128,128,128,0.2))); border-radius:6px; padding:12px 16px; margin:16px 0; }
			.wifi7-info-row { display:flex; align-items:center; padding:8px 0; font-size:13px; }
			.wifi7-info-row:not(:last-child) { border-bottom:1px dashed var(--cbi-border-color, rgba(128,128,128,0.12)); }
			.wifi7-info-label { width:160px; flex:0 0 160px; font-weight:500; color:var(--cbi-muted-color, #666); font-size:13px; }
			.wifi7-info-value { flex:1; min-width:0; font-weight:500; font-family:ui-monospace, monospace; color:var(--cbi-text-color, inherit); overflow-wrap:anywhere; }
			.wifi7-narrow-input { width:110px !important; }
			.wifi7-settings-card { background:var(--cbi-section-bg, rgba(128,128,128,0.03)); border:1px solid var(--cbi-border-color, var(--hairline, rgba(128,128,128,0.2))); border-radius:6px; padding:16px 20px; margin-bottom:16px; }
			.wifi7-settings-card h4 { margin:0 0 16px; padding-bottom:8px; border-bottom:1px solid var(--cbi-border-color, rgba(128,128,128,0.12)); font-size:15px; font-weight:600; color:var(--cbi-text-color, inherit); }
			.wifi7-settings-card .cbi-input-select { max-width:320px; }
			.wifi7-save-bar { display:flex; justify-content:flex-end; padding-top:12px; margin-top:8px; }
			.wifi7-client-details { margin-bottom:12px; border:1px solid var(--cbi-border-color, var(--hairline, rgba(128,128,128,0.2))); border-radius:6px; padding:10px 16px; background:var(--cbi-section-bg, rgba(128,128,128,0.03)); }
			.wifi7-client-summary { cursor:pointer; padding:6px 0; font-weight:500; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:13px; user-select:none; outline:none; }
			.wifi7-client-summary:focus-visible { outline:2px solid var(--cbi-primary-color, #0069d9); border-radius:4px; }
			.wifi7-link-box { padding:8px 0; }
			.wifi7-link-box:not(:last-child) { border-bottom:1px dashed var(--cbi-border-color, rgba(128,128,128,0.12)); }
			.wifi7-link-label { font-size:12px; font-weight:600; color:var(--cbi-muted-color, #888); margin-bottom:4px; }
			.wifi7-link-box .wifi7-row { max-width:640px; }
			@media (max-width: 640px) {
				.wifi7-grid { grid-template-columns:1fr; gap:12px; }
				.wifi7-card { padding:12px 14px; }
				.wifi7-settings-card { padding:12px 14px; }
				.wifi7-system-info { padding:10px 14px; }
				.wifi7-info-row { flex-direction:column; align-items:flex-start; gap:4px; }
				.wifi7-info-label { width:auto; flex:none; }
				.wifi7-save-bar { justify-content:stretch; }
				.wifi7-save-bar .cbi-button { width:100%; }
			}
		`), E('h2', {}, _('WiFi 7')), nav ].concat(panes));
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
