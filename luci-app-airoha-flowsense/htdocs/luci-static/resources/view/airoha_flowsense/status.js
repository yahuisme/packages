'use strict';
'require view';
'require rpc';
'require poll';

var getOverview = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getOverview', reject: true });
// Acceleration RPC contract: each key is {supported, enabled, configured},
// strictly boolean or null. enabled is runtime readback, configured is the edit
// baseline. Setter parameters are 0/1, or -1 to leave unknown/unsupported keys alone.
var accelerationKeys = ['hardware', 'vlan', 'pppoe', 'ap'];
var getAcceleration = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getAcceleration', reject: true });

var css = `
.flowsense-dashboard{--flowsense-gap:16px;box-sizing:border-box}
.flowsense-dashboard *{box-sizing:border-box}
.flowsense-dashboard .flowsense-status-message{text-align:right}
.flowsense-dashboard .flowsense-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--flowsense-gap);margin:16px 0}
.flowsense-dashboard .flowsense-card{min-width:0;min-height:96px;padding:8px 16px;display:flex;flex-direction:column;justify-content:center;gap:4px;line-height:1.5;overflow-wrap:anywhere;border:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0));border-radius:4px;background:var(--cbi-section-bg,transparent)}
.flowsense-dashboard .flowsense-label{color:var(--cbi-muted-color,var(--text-muted,inherit))}
.flowsense-dashboard .flowsense-value{display:block;font-size:1.125em;font-weight:600;font-variant-numeric:tabular-nums}
.flowsense-dashboard .flowsense-sub{color:var(--cbi-muted-color,var(--text-muted,inherit))}
.flowsense-dashboard .flowsense-status{display:inline-flex;align-items:center;gap:8px;color:inherit;white-space:nowrap}
.flowsense-dashboard .flowsense-status-arrow{color:inherit;font-weight:600}
.flowsense-dashboard .flowsense-up > span{color:var(--success,light-dark(var(--success-color-low,#15803d),var(--success-color-high,#16a34a)))}
.flowsense-dashboard .flowsense-port-name{font-size:1.125em;font-weight:600}
.flowsense-dashboard .flowsense-section{margin:16px 0}.flowsense-dashboard .flowsense-section .cbi-value{margin:0;padding:8px 0}
.flowsense-dashboard .flowsense-ports{container-type:inline-size}
.flowsense-dashboard .flowsense-port{display:grid;grid-template-columns:minmax(0,.7fr) repeat(3,minmax(0,1fr));gap:16px;align-items:start;margin:0;padding:16px 0;border-bottom:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0))}
.flowsense-dashboard .flowsense-port:last-child{border-bottom:0}.flowsense-dashboard .flowsense-port-title{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere}
.flowsense-dashboard .flowsense-port-metric{display:grid;gap:8px;min-width:0;margin:0;padding:0}
.flowsense-dashboard .flowsense-port-metric dt,.flowsense-dashboard .flowsense-port-metric dd{margin:0;padding:0;min-width:0;text-align:start;overflow-wrap:anywhere}
.flowsense-dashboard .flowsense-port-metric dd{font-variant-numeric:tabular-nums}
.flowsense-dashboard .flowsense-acceleration{container-type:inline-size;padding-inline:16px}
.flowsense-dashboard .flowsense-controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px var(--flowsense-gap);margin-inline:-17px}
.flowsense-dashboard .flowsense-controls .cbi-value{display:flex;flex-flow:row nowrap;align-items:flex-start;justify-content:space-between;gap:32px;min-width:0;margin:0;padding:8px 32px 8px 17px}
.flowsense-dashboard .flowsense-controls .cbi-value-title{float:none;width:auto;flex:0 0 auto;text-align:left;font-size:1.125em;font-weight:600;padding:8px 0;white-space:nowrap}
.flowsense-dashboard .flowsense-controls .cbi-value-field{display:flex;flex:0 0 auto;flex-direction:column;align-items:stretch;gap:8px;min-width:0;margin:0;padding:0}
.flowsense-dashboard .flowsense-acceleration-state{display:inline-flex;flex:0 0 auto;align-items:center;gap:8px;padding:8px 0;text-align:right;white-space:nowrap}
.flowsense-dashboard .flowsense-acceleration-dot{flex:0 0 6px;width:6px;height:6px;border-radius:50%;background:currentColor}
@container(min-width:1400px){.flowsense-dashboard .flowsense-controls .cbi-value{padding-right:128px}}
@container(max-width:520px){.flowsense-dashboard .flowsense-controls .cbi-value{padding-right:17px}}
.flowsense-dashboard .flowsense-active{color:var(--success,light-dark(var(--success-color-low,#15803d),var(--success-color-high,#16a34a)))}
@container(max-width:1000px){.flowsense-dashboard .flowsense-controls{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container(max-width:520px){.flowsense-dashboard .flowsense-controls{grid-template-columns:minmax(0,1fr)}}
@container(max-width:800px){.flowsense-dashboard .flowsense-port{grid-template-columns:repeat(3,minmax(0,1fr))}.flowsense-dashboard .flowsense-port-title{grid-column:1 / -1}}
@container(max-width:480px){.flowsense-dashboard .flowsense-port{grid-template-columns:minmax(0,1fr);gap:8px}.flowsense-dashboard .flowsense-port-metric{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px}}
.flowsense-dashboard .cbi-input-text,.flowsense-dashboard .cbi-button{min-height:32px;box-sizing:border-box}
@media(max-width:899px){.flowsense-dashboard .flowsense-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.flowsense-dashboard .flowsense-summary{grid-template-columns:1fr}}
`;


function number(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null; }
function text(value) { return typeof value === 'string' ? value : ''; }
function rate(bytes, previous, seconds) {
	var current = number(bytes, 0, Number.MAX_SAFE_INTEGER), old = number(previous, 0, Number.MAX_SAFE_INTEGER);
	return current != null && old != null && seconds > 0 && current >= old ? (current - old) * 8 / seconds / 1000000 : null;
}
function formatRate(value) { return value == null ? '—' : (value < 1 ? value.toFixed(2) : value.toFixed(value < 10 ? 1 : 0)) + ' Mbit/s'; }
return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
	load: function() { return Promise.all([getOverview().catch(function() { return null; }), getAcceleration().catch(function() { return null; })]); },

	render: function(initial) {
		var initialAcceleration = Array.isArray(initial) ? initial[1] : null;
		initial = Array.isArray(initial) ? initial[0] : initial;
		var root = E('div', { 'class': 'cbi-map flowsense-dashboard' }, [
			E('style', {}, css),
			E('h2', {}, _('Airoha FlowSense')),
			E('div', { 'class': 'cbi-map-descr' }, _('View Ethernet traffic and link quality.'))
		]);
		var message = E('div', { 'class': 'cbi-map-descr flowsense-status-message' }, _('Waiting for data'));
		var summary = E('div', { 'class': 'flowsense-summary' });
		var interfaces = E('div', { 'class': 'flowsense-ports' });
		var quality = E('div', { 'class': 'flowsense-section cbi-section' });

		var previous = null, pending = null, accelerationPending = null;
		var acceleration = E('div', { 'class': 'cbi-section flowsense-section flowsense-acceleration' }, [E('h3', { 'class': 'cbi-section-title' }, _('Acceleration'))]);
		var accelerationNodes = [];
		function paintAcceleration(data) {
			if (!accelerationNodes.length) {
				var labels = [_('Hardware acceleration'), _('VLAN acceleration'), _('PPPoE acceleration'), _('Bridge compatibility mode')];
				acceleration.appendChild(E('div', { 'class': 'flowsense-controls' }, labels.map(function(label) {
					var value = E('span'), state = E('span', { 'class': 'flowsense-acceleration-state' }, [E('span', { 'class': 'flowsense-acceleration-dot', 'aria-hidden': 'true' }), value]);
					accelerationNodes.push({ state: state, value: value });
					return E('div', { 'class': 'cbi-value' }, [E('span', { 'class': 'cbi-value-title' }, [label]), state]);
				})));
			}
			accelerationKeys.forEach(function(key, i) {
				var state = data && data[key], value = state && state.supported === true ? state.enabled : null;
				var node = accelerationNodes[i], label = value === true ? _('Enabled') : value === false ? _('Not enabled') : _('Unknown');
				var cls = 'flowsense-acceleration-state' + (value === true ? ' flowsense-active' : '');
				if (node.state.className !== cls) node.state.className = cls;
				if (node.value.textContent !== label) node.value.textContent = label;
			});
		}
		function refreshAcceleration() {
			if (accelerationPending) return accelerationPending;
			accelerationPending = getAcceleration().then(function(data) { if (root.isConnected) paintAcceleration(data); }).catch(function() { if (root.isConnected) paintAcceleration(null); }).finally(function() { accelerationPending = null; });
			return accelerationPending;
		}
		var main = E('div', {}, [summary, acceleration, E('div', { 'class': 'cbi-section' }, [E('h3', { 'class': 'cbi-section-title' }, _('Ethernet Links')), interfaces]), quality]);
		root.append(message, main);
		function update() {
			if (!root.isConnected) {
				poll.remove(update);
				return Promise.resolve();
			}
			// Background tabs get no telemetry: this page forks ~30 helpers per tick.
			if (document.visibilityState === 'hidden') return Promise.resolve();
			if (pending) return pending;
			// Lightweight sibling query shares the existing tick, with its own guard.
			refreshAcceleration();
			pending = getOverview().then(function(data) {
				if (!root.isConnected) return;
				paint(data);
			}).catch(clear).finally(function() { pending = null; });
			return pending;
		}
		var portRows = {}, summaryCells = null, qualityCells = null, portOrder = '';
		function text(node, value) { if (node.textContent !== value) node.textContent = value; }
		function paintBadge(badge, carrier) {
			var up = carrier === 1 || carrier === true, down = carrier === 0 || carrier === false;
			var cls = 'flowsense-status' + (up ? ' flowsense-up' : down ? ' flowsense-down' : '');
			if (badge.className !== cls) badge.className = cls;
			text(badge.firstChild, up ? '↑' : down ? '↓' : '—');
			text(badge.lastChild, up ? _('Connected') : down ? _('Disconnected') : _('Unknown'));
		}
		function ensurePort(device) {
			if (portRows[device]) return portRows[device];
			var name = E('span', { 'class': 'flowsense-port-name' }, device.toUpperCase());
			var badge = E('span', { 'class': 'flowsense-status' }, [E('span', { 'class': 'flowsense-status-arrow', 'aria-hidden': 'true' }), E('span')]);
			var speed = E('dd'), rate = E('dd'), errors = E('dd');
			var row = E('div', { 'class': 'flowsense-port' }, [
				E('div', { 'class': 'flowsense-port-title' }, [name, badge]),
				E('dl', { 'class': 'flowsense-port-metric' }, [E('dt', {}, [ _('Speed') ]), speed]),
				E('dl', { 'class': 'flowsense-port-metric' }, [E('dt', {}, [ _('RX / TX rate') ]), rate]),
				E('dl', { 'class': 'flowsense-port-metric' }, [E('dt', {}, [ _('RX / TX errors') ]), errors])
			]);
			return portRows[device] = { row: row, name: name, badge: badge, speed: speed, rate: rate, errors: errors };
		}
		function ensureSummary() {
			if (summaryCells) return summaryCells;
			summaryCells = [ _('Total Port Receive Rate'), _('Total Port Transmit Rate'), _('Physical Ethernet Ports'), _('Network Quality') ].map(function(title) {
				var value = E('span', { 'class': 'flowsense-value' }), sub = E('span', { 'class': 'flowsense-sub' });
				summary.appendChild(E('div', { 'class': 'flowsense-card' }, [E('span', { 'class': 'flowsense-label' }, title), value, sub]));
				return { value: value, sub: sub };
			});
			return summaryCells;
		}
		function ensureQuality() {
			if (qualityCells) return qualityCells;
			quality.appendChild(E('h3', { 'class': 'cbi-section-title' }, _('Link Quality')));
			qualityCells = [ _('Latest RTT'), _('RTT mean absolute deviation'), _('Window packet loss') ].map(function(label) {
				var value = E('span');
				quality.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('span', { 'class': 'cbi-value-title' }, label),
					E('div', { 'class': 'cbi-value-field' }, value)
				]));
				return value;
			});
			return qualityCells;
		}
		function paint(data) {

				data = data && typeof data === 'object' ? data : {};
				var jitter = data.jitter && typeof data.jitter === 'object' ? data.jitter : null;
				var ports = Array.isArray(data.interfaces) ? data.interfaces.filter(function(port) { return port && typeof port.device === 'string' && port.device !== 'eth0'; }) : [];
				var priority = ['wan', 'lan2', 'lan3', 'lan4'];
				ports.sort(function(a, b) {
					var ai = priority.indexOf(a.device), bi = priority.indexOf(b.device);
					return (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi);
				});
				var uptime = number(data.uptime, 0, Number.MAX_SAFE_INTEGER);
				var seconds = previous && uptime != null && previous.time != null ? uptime - previous.time : null;
				var totalRx = 0, totalTx = 0, rxOk = 0, txOk = 0, keep = {}, order = [];
				ports.forEach(function(port) {
					var stats = port.stats && typeof port.stats === 'object' ? port.stats : {};
					var old = previous && previous.ports[port.device];
					if (old && (number(port.ifindex, 1, Number.MAX_SAFE_INTEGER) == null || old.ifindex !== port.ifindex)) old = null;
					var rx = rate(stats.rx_bytes, old && old.rx_bytes, seconds), tx = rate(stats.tx_bytes, old && old.tx_bytes, seconds);
					if (rx != null) { totalRx += rx; rxOk++; } if (tx != null) { totalTx += tx; txOk++; }
					var row = ensurePort(port.device);
					keep[port.device] = true; order.push(port.device);
					text(row.name, port.device.toUpperCase());
					paintBadge(row.badge, port.carrier);
					text(row.speed, number(port.speed, 0, 1000000) == null ? '—' : port.speed + ' Mbit/s');
					text(row.rate, formatRate(rx) + ' / ' + formatRate(tx));
					text(row.errors, (number(stats.rx_errors, 0, Number.MAX_SAFE_INTEGER) == null ? '—' : stats.rx_errors) + ' / ' + (number(stats.tx_errors, 0, Number.MAX_SAFE_INTEGER) == null ? '—' : stats.tx_errors));
				});
				// Detached ports disappear; unchanged order keeps the DOM untouched.
				Object.keys(portRows).forEach(function(device) {
					if (keep[device]) return;
					portRows[device].row.remove();
					delete portRows[device];
				});
				if (order.join() !== portOrder) {
					portOrder = order.join();
					order.forEach(function(device) { interfaces.appendChild(portRows[device].row); });
				}
				var cells = ensureSummary();
				text(cells[0].value, rxOk === ports.length && ports.length ? formatRate(totalRx) : '—');
				text(cells[0].sub, rxOk + ' / ' + ports.length);
				text(cells[1].value, txOk === ports.length && ports.length ? formatRate(totalTx) : '—');
				text(cells[1].sub, txOk + ' / ' + ports.length);
				text(cells[2].value, (Array.isArray(data.interfaces) && ports.every(function(port) { return port.carrier === 0 || port.carrier === 1 || typeof port.carrier === 'boolean'; }) ? ports.filter(function(port) { return port.carrier === 1 || port.carrier === true; }).length : '—') + ' / ' + (Array.isArray(data.interfaces) ? ports.length : '—'));
				text(cells[2].sub, _('Connected / Total'));
				text(cells[3].value, jitter && number(jitter.last_ping, 0, 60000) != null ? jitter.last_ping + ' ms' : '—');
				text(cells[3].sub, jitter && number(jitter.loss, 0, 100) != null ? _('Loss') + ': ' + jitter.loss + '%' : _('Probe data unavailable'));
				var quality_ = ensureQuality();
				text(quality_[0], jitter && number(jitter.last_ping, 0, 60000) != null ? jitter.last_ping + ' ms' : _('Probe data unavailable'));
				text(quality_[1], jitter && number(jitter.deviation, 0, 60000) != null ? jitter.deviation + ' ms' : '—');
				text(quality_[2], jitter && number(jitter.loss, 0, 100) != null ? jitter.loss + '%' : '—');
				previous = { time: uptime, ports: {} }; ports.forEach(function(port) { previous.ports[port.device] = { ifindex: port.ifindex, rx_bytes: port.stats && port.stats.rx_bytes, tx_bytes: port.stats && port.stats.tx_bytes }; });
				message.textContent = data.timestamp ? _('Last update') + ': ' + new Date(data.timestamp * 1000).toLocaleTimeString() : _('Data unavailable');
				}
		function clear() {
			if (!root.isConnected) return;
			previous = null;
			message.textContent = _('Data unavailable; previous readings cleared.');
			ensureSummary().forEach(function(cell) { text(cell.value, '—'); text(cell.sub, _('Data unavailable')); });
			ensureQuality().forEach(function(cell) { text(cell, '—'); });
			// Retain known port identities, not their stale telemetry or rate baseline.
			Object.keys(portRows).forEach(function(device) {
				var row = portRows[device];
				paintBadge(row.badge, null); text(row.speed, '—');
				text(row.rate, '— / —'); text(row.errors, '— / —');
			});
		}
		requestAnimationFrame(function() {
			if (!root.isConnected) return;
			// Only the view container is watched; a body-wide subtree observer
			// fired on every port/rate update this page writes itself.
			var removal = new MutationObserver(function() {
				if (root.isConnected) return;
				poll.remove(update);
				removal.disconnect();
			});
			removal.observe(root.parentNode || document.body, { childList: true });
			if (initial) paint(initial); else clear();
			paintAcceleration(initialAcceleration);
			poll.add(update, 5);
		});
		return root;
	}
});
