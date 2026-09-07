'use strict';
'require baseclass';

function band(frequency) {
	var f = Number(frequency);
	return f >= 2400 && f < 2500 ? '2g' : f >= 4900 && f < 5925 ? '5g' : f >= 5925 && f <= 7125 ? '6g' : null;
}

function utilization(value) {
	if (value == null || value === '') return null;
	var n = Number(value);
	return Number.isFinite(n) && n >= 0 && n <= 255 ? Math.round(n * 100 / 255) : null;
}

function delta(current, previous) {
	if (!previous || !current || current.busy == null || previous.busy == null) return null;
	var active = current.active - previous.active, busy = current.busy - previous.busy;
	return active > 0 && busy >= 0 && busy <= active ? Math.round(100 * busy / active) : null;
}

function dfs(states) {
	var relevant = states.filter(function(s) { return band(s.freq) === '5g'; });
	if (relevant.some(function(s) { return s.state === 'DFS'; })) return 'cac';
	if (relevant.length && relevant.every(function(s) { return s.state === 'ENABLED'; })) return 'active';
	return 'unknown';
}

function parse(raw) {
	var out = { devices: {}, stations: {}, surveys: {}, hostapd: [], firmware: '', devicesOK: false };
	var section = '', name = '', ok = false, device = null, link = null, station = null, record = null, status = null;
	function flush() {
		if (record && record.inUse && record.active != null && record.busy != null)
			(out.surveys[name] || (out.surveys[name] = [])).push(record);
		record = null;
	}
	String(raw || '').split('\n').forEach(function(line) {
		var marker = line.match(/^@@ (\w+)(?: ([\w.:-]+))? (\d+)$/);
		if (marker) {
			flush(); section = marker[1]; name = marker[2] || ''; ok = marker[3] === '0';
			device = link = station = status = null;
			if (section === 'devices') out.devicesOK = ok;
			if (section === 'stations' && ok) out.stations[name] = [];
			if (section === 'survey' && ok) out.surveys[name] = [];
			if (section === 'hostapd' && ok) { status = { socket: name }; out.hostapd.push(status); }
			return;
		}
		if (!ok) return;
		var text = line.trim(), m;
		if (section === 'devices') {
			if ((m = text.match(/^Interface (\S+)$/))) {
				device = { links: {} }; out.devices[m[1]] = device; link = device;
			} else if (device && (m = text.match(/^- link ID\s+(\d+)/))) {
				link = {}; device.links[m[1]] = link;
			} else if (link && (m = text.match(/^channel (\d+) \((\d+) MHz\)(?:, width: ([^,]+))?/))) {
				link.channel = Number(m[1]); link.frequency = Number(m[2]); link.width = m[3] || '';
			} else if (link && (m = text.match(/^txpower ([\d.]+) dBm/))) link.txpower = Number(m[1]);
		} else if (section === 'stations') {
			if (!out.stations[name]) return;
			if ((m = text.match(/^Station ([0-9a-f:]{17})\b/i))) {
				station = { mac: m[1].toLowerCase(), links: {}, signal: null }; link = station;
				out.stations[name].push(station);
			} else if (station && (m = text.match(/^Link (\d+):/))) {
				link = { signal: null }; station.links[m[1]] = link;
			} else if (station && (m = text.match(/^connected time:\s+(\d+)/))) station.connected = Number(m[1]);
			else if (link && (m = text.match(/^signal:\s*(-?\d+)(?:\s+\[[^\]]*\])?\s+dBm/))) link.signal = Number(m[1]);
			else if (link && (m = text.match(/^(tx|rx) bitrate:\s*(.*)$/))) link[m[1]] = m[2];
		} else if (section === 'survey') {
			if ((m = text.match(/^frequency:\s+(\d+) MHz(.*)/))) {
				flush(); record = { frequency: Number(m[1]), inUse: m[2].indexOf('[in use]') !== -1 };
			} else if (record && (m = text.match(/^channel (active|busy) time:\s+(\d+)/))) record[m[1]] = Number(m[2]);
		} else if (status) {
			var eq = text.indexOf('=');
			if (eq > 0) status[text.slice(0, eq)] = text.slice(eq + 1);
		} else if (section === 'firmware' && !out.firmware && /mt7996.*firmware.*version/i.test(text)) out.firmware = text.replace(/^.*?mt7996[^:]*:\s*/i, '');
	});
	flush();
	return out;
}

return baseclass.extend({ parse: parse, band: band, utilization: utilization, delta: delta, dfs: dfs });
