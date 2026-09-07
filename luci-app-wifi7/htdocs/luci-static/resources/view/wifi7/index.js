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
	return typeof value === 'string' ? value : value && value.rate ? (value.rate / 1000).toFixed(1) + ' Mbit/s' : '—';
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
		return E('option', { value: v }, v === 'auto' ? _('Auto') : v);
	}));
	el.value = current || values[0];
	return el;
}
function field(label, input, description) {
	return E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', 'for': input.id }, label),
		E('div', { 'class': 'cbi-value-field' }, [input, description ? E('div', { 'class': 'cbi-value-description' }, description) : '']) ]);
}

return view.extend({
	load: function() {
		return uci.load('wireless').then(function() {
			return Promise.all(uci.sections('wireless', 'wifi-device').map(function(r) {
				return settled(frequencies(r['.name'])).then(function(result) { return { id: r['.name'], result: result }; });
			}));
		});
	},
	render: function(channelData) {
		var radios = uci.sections('wireless', 'wifi-device');
		var cells = {}, controls = [], previous = {}, busy = false, channelLists = {}, expanded = {};
		(channelData || []).forEach(function(item) { channelLists[item.id] = item.result; });
		var notice = E('div', { 'class': 'cbi-section-descr' });
		var grid = E('div', { 'class': 'wifi7-grid' });
		var settings = E('div', { 'class': 'cbi-section' });
		radios.forEach(function(r) {
			var id = r['.name'], band = r.band, prefix = 'wifi7-' + id + '-';
			var c = cells[id] = {};
			var rows = [ E('h4', {}, id + (names[band] ? ' (' + names[band] + ')' : '')) ];
			[[ 'state', _('Status') ], ['channel', _('Channel / Bandwidth')], ['power', _('TX Power')], ['util', _('Channel Utilization')], ['count', _('Online Stations')]].forEach(function(item) {
				c[item[0]] = E('span', { 'class': 'wifi7-value' }, '—');
				rows.push(E('div', { 'class': 'wifi7-row' }, [ E('span', {}, item[1]), c[item[0]] ]));
			});
			grid.appendChild(E('div', { 'class': 'wifi7-card' }, rows));
			var enabled = E('input', { type: 'checkbox', id: prefix + 'enabled', name: prefix + 'enabled' });
			enabled.checked = r.disabled !== '1';
			var channelResult = channelLists[id];
			var choices = channelResult && channelResult.ok ? channelResult.value.filter(function(f) {
				return telemetry.band(f.mhz) === band && !(f.restricted && (!f.flags || f.flags.indexOf('no_ir') !== -1));
			}) : [];
			var channel = select(prefix + 'channel', ['auto'].concat(choices.map(function(f) { return String(f.channel); })), r.channel || 'auto');
			Array.from(channel.options).forEach(function(o) {
				var f = choices.find(function(f) { return String(f.channel) === o.value; });
				if (f) o.textContent = f.channel + ' (' + f.mhz + ' MHz)';
			});
			// Preserve all configured values; capability-specific choices belong to native Wireless.
			var modes = band === '2g' ? ['HE20', 'HE40', 'EHT20', 'EHT40'] : band === '6g' ? ['HE20', 'HE40', 'HE80', 'HE160', 'EHT20', 'EHT40', 'EHT80', 'EHT160', 'EHT320'] : ['HE20', 'HE40', 'HE80', 'HE160', 'EHT20', 'EHT40', 'EHT80', 'EHT160'];
			var width = select(prefix + 'width', modes, r.htmode);
			var power = E('input', { id: prefix + 'power', name: prefix + 'power', type: 'number', min: '1', max: '30', step: '1', value: r.txpower || '', placeholder: _('Auto'), 'class': 'cbi-input-text', style: 'width:96px' });
			var country = E('input', { id: prefix + 'country', name: prefix + 'country', value: r.country || '', maxlength: '2', pattern: '[A-Za-z]{2}', placeholder: _('Auto'), 'class': 'cbi-input-text', style: 'width:96px' });
			country.addEventListener('change', function() {
				channel.value = r.channel || 'auto';
				channel.disabled = country.value.toUpperCase() !== (r.country || '').toUpperCase();
			});
			var box = E('div', { 'class': 'cbi-section-node' }, [ E('h4', {}, id + (names[band] ? ' (' + names[band] + ')' : '')),
				field(_('Enabled'), enabled), field(_('Operating Channel'), channel, choices.length ? _('Channels reported by the driver; current configuration is preserved.') : _('Channel discovery unavailable; only the current setting is preserved.')),
				field(_('Bandwidth / Mode'), width), field(_('TX Power (dBm)'), power, _('1-%d dBm, leave empty for regulatory auto').format(30)), field(_('Country Code'), country, _('After changing country, apply and reload to refresh permitted channels.')) ]);
			var radar = null;
			if (band === '5g') {
				radar = E('input', { type: 'checkbox', id: prefix + 'radar', name: prefix + 'radar' });
				radar.checked = r.background_radar === '1';
				box.appendChild(field(_('Background Radar'), radar, _('Requires driver support; channel availability checks may still be required.')));
			}
			controls.push({ original: r, id: id, enabled: enabled, channel: channel, width: width, power: power, country: country, radar: radar });
			settings.appendChild(box);
		});
		var fw = E('span', {}, '—'), dfs = E('span', {}, _('Unknown'));
		var overview = E('div', {}, [notice, grid, E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'class': 'wifi7-row' }, [ E('span', {}, _('MT76 Firmware')), fw ]),
			E('div', { 'class': 'wifi7-row' }, [ E('span', {}, _('5GHz DFS Status')), dfs ]) ]) ]);
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
				ev.preventDefault(); panes.forEach(function(p, n) { p.style.display = n === i ? '' : 'none'; nav.children[n].className = n === i ? 'cbi-tab' : 'cbi-tab-disabled'; });
			} }, label)));
		});
		var save = E('button', { 'class': 'cbi-button cbi-button-apply', click: function() {
			if (controls.some(function(c) { return !c.channel.reportValidity() || !c.power.reportValidity() || !c.country.reportValidity(); })) return;
			var disruptive = controls.some(function(c) {
				return (!c.enabled.checked && c.original.disabled !== '1') ||
					c.channel.value !== (c.original.channel || 'auto') || c.width.value !== c.original.htmode ||
					c.country.value.toUpperCase() !== (c.original.country || '').toUpperCase();
			});
			if (disruptive && !window.confirm(_('These changes may interrupt wireless connections, including MLO links. Apply?'))) return;
			save.disabled = true;
			controls.forEach(function(c) {
				[['disabled', c.enabled.checked ? '0' : '1'], ['channel', c.channel.value], ['htmode', c.width.value], ['txpower', c.power.value], ['country', c.country.value.toUpperCase()]].forEach(function(pair) {
					if (pair[1]) uci.set('wireless', c.id, pair[0], pair[1]); else uci.unset('wireless', c.id, pair[0]);
				});
				if (c.radar) uci.set('wireless', c.id, 'background_radar', c.radar.checked ? '1' : '0');
			});
			return uci.save().then(function() { return uci.apply(); }).then(function() {
				ui.addNotification(null, E('p', {}, _('Configuration applied. Runtime status will refresh.')), 'info');
				return update();
			}).catch(function(err) { ui.addNotification(null, E('p', {}, _('Failed to apply configuration: ') + err.message), 'error'); }).finally(function() { save.disabled = false; });
		} }, _('Save & Apply'));
		settings.appendChild(E('div', { style: 'text-align:right' }, save));

		function update() {
			if (busy) return Promise.resolve();
			busy = true;
			return Promise.all([
				settled(network.flushCache().then(function() { return Promise.all([network.getWifiDevices(), network.getWifiNetworks()]); })),
				settled(devices().then(function(list) { return Promise.all(list.map(function(d) { return Promise.all([settled(assoc(d)), settled(info(d))]).then(function(r) { return { name: d, stations: r[0], info: r[1] }; }); })); })),
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
					measurement(Object.assign({}, ni, dev));
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
						var startRow = rows.length;
						var s = merged[mac], linkIds = Object.keys(s.links || {}), links = linkIds.filter(function(lid) { return s.links[lid].signal < 0; });
						function row(value, lid) {
							var f = lid != null ? (dev.links[lid] || {}).frequency : linkIds.length ? null : frequency, r = linkIds.length && lid == null ? null : radioFor(iface, f), b = telemetry.band(f);
							if (r) stats[r].count++;
							rows.push([iface + (lid != null ? ' / MLO ' + lid : '') + ' (' + (names[b] || _('Unknown')) + ')', mac,
								standard(value.tx || value.rx), value.signal < 0 ? value.signal + ' dBm' : '—', rate(value.tx), rate(value.rx), s.connected != null ? s.connected + ' s' : '—']);
						}
						if (linkIds.length !== links.length) mapped.forEach(function(r) { stats[r].failed = true; });
						if (links.length) links.forEach(function(lid) { row(s.links[lid], lid); }); else row(s, null);
						rows.slice(startRow).forEach(function(row) { row.clientKey = iface + '/' + mac; row.ssid = ssids[iface] || ''; });
					});
				});
				previous = nextPrevious;
				parsed.hostapd.forEach(function(h) { var r = radioFor('', h.freq), u = telemetry.utilization(h.chan_util_avg); if (r && u != null) stats[r].util = u; });
				radios.forEach(function(r) {
					var id = r['.name'], s = stats[id], c = cells[id], d = runtimeRadios[id];
					c.state.textContent = d ? (d.isUp() ? _('Up') : _('Disabled')) : _('Unknown');
					c.count.textContent = s.known && !s.failed ? String(s.count) : '—';
					c.util.textContent = s.util == null ? '—' : s.util + '%';
					c.channel.textContent = s.current && s.current.channel ? s.current.channel + ' / ' + (s.current.width || '—') : '—';
					c.power.textContent = s.current && s.current.txpower != null ? s.current.txpower + ' dBm' : '—';
				});
				fw.textContent = parsed.firmware || _('Unavailable');
				var state = telemetry.dfs(parsed.hostapd);
				var remaining = parsed.hostapd.filter(function(h) { return telemetry.band(h.freq) === '5g' && h.state === 'DFS'; }).map(function(h) { return /^\d+$/.test(h.cac_time_left_seconds || '') ? Number(h.cac_time_left_seconds) : null; });
				dfs.textContent = state === 'cac' ? _('DFS CAC in progress') + (remaining.length && remaining.every(function(n) { return n !== null; }) ? ' · ' + _('%d seconds remaining').format(Math.max.apply(null, remaining)) : '') : state === 'active' ? _('Operating') : _('Unknown');
				notice.textContent = anyFailed || !anyKnown ? _('Some telemetry is unavailable. Unknown values are not zero.') : '';
				renderClients(rows, anyKnown && !anyFailed ? _('No connected clients') : _('Client data unavailable'));
			}).catch(function() {
				notice.textContent = _('Telemetry update failed');
				Object.keys(cells).forEach(function(id) { Object.keys(cells[id]).forEach(function(k) { cells[id][k].textContent = '—'; }); });
				fw.textContent = dfs.textContent = _('Unknown');
				renderClients([], _('Client data unavailable'));
			}).finally(function() { busy = false; });
		}
		function renderClients(rows, emptyText) {
			Array.from(clients.querySelectorAll('details')).forEach(function(detail) { expanded[detail.dataset.client] = detail.open; });
			clients.replaceChildren();
			var groups = {};
			rows.forEach(function(row) { (groups[row.clientKey] || (groups[row.clientKey] = [])).push(row); });
			var keys = Object.keys(groups);
			if (!keys.length) { clients.appendChild(E('em', {}, emptyText)); return; }
			clients.appendChild(E('div', { 'class': 'cbi-section-descr' }, _('%d client associations').format(keys.length)));
			keys.forEach(function(key) {
				var entries = groups[key], first = entries[0];
				var detail = E('details', { 'class': 'cbi-section-node', 'data-client': key });
				detail.open = !!expanded[key];
				detail.appendChild(E('summary', { style: 'cursor:pointer;padding:8px 0' }, first[1] + (first.ssid ? ' · ' + first.ssid : '') + ' · ' + first[2] + ' · ' + first[6]));
				entries.forEach(function(row) {
					var box = E('div', { style: 'padding:8px 0' }, E('div', {}, row[0]));
					[_('Standard / Bandwidth'), _('Signal'), _('TX Rate'), _('RX Rate')].forEach(function(label, i) {
						box.appendChild(E('div', { 'class': 'wifi7-row' }, [E('span', {}, label), E('span', { 'class': 'wifi7-value' }, row[i + 2])]));
					});
					detail.appendChild(box);
				});
				clients.appendChild(detail);
			});
			Object.keys(expanded).forEach(function(key) { if (!groups[key]) delete expanded[key]; });
		}

		poll.add(update, 5);
		update();
		return E('div', { 'class': 'cbi-map' }, [ E('style', {}, '.wifi7-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:16px}.wifi7-card{border:1px solid var(--cbi-border-color,#ddd);border-radius:6px;padding:16px;min-width:0}.wifi7-card h4{margin:0 0 12px;font-weight:500}.wifi7-row{display:flex;justify-content:space-between;gap:16px;padding:6px 0}.wifi7-value{font-variant-numeric:tabular-nums;text-align:right}'), E('h2', {}, _('WiFi 7')), nav ].concat(panes));
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
