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
.flowsense-dashboard .flowsense-label{color:var(--cbi-muted-color,var(--text-muted,#666))}
.flowsense-dashboard .flowsense-value{display:block;font-size:1.125em;font-weight:600;font-variant-numeric:tabular-nums}
.flowsense-dashboard .flowsense-sub{color:var(--cbi-muted-color,var(--text-muted,#888))}
.flowsense-dashboard .flowsense-status{display:inline-flex;align-items:center;gap:8px;color:inherit;white-space:nowrap}
.flowsense-dashboard .flowsense-status-arrow{color:inherit;font-weight:600}
.flowsense-dashboard .flowsense-up > span{color:#16a34a}
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
.flowsense-dashboard .flowsense-active{color:#16a34a}
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
function metric(label, value) { return E('div', { 'class': 'cbi-value' }, [E(value && value.id ? 'label' : 'span', { 'class': 'cbi-value-title', 'for': value && value.id || null }, label), E('div', { 'class': 'cbi-value-field' }, value)]); }
function portMetric(label, value) { return E('dl', { 'class': 'flowsense-port-metric' }, [E('dt', {}, [label]), E('dd', {}, [value])]); }
function statusBadge(carrier) {
	var up = carrier === 1 || carrier === true, down = carrier === 0 || carrier === false;
	return E('span', { 'class': 'flowsense-status' + (up ? ' flowsense-up' : down ? ' flowsense-down' : '') }, [E('span', { 'class': 'flowsense-status-arrow', 'aria-hidden': 'true' }, [up ? '↑' : down ? '↓' : '—']), E('span', {}, [up ? _('Connected') : down ? _('Disconnected') : _('Unknown')])]);
}
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
		function paintAcceleration(data) {
			var labels = [_('Hardware acceleration'), _('VLAN acceleration'), _('PPPoE acceleration'), _('Bridge compatibility mode')];
			acceleration.replaceChildren(E('h3', { 'class': 'cbi-section-title' }, _('Acceleration')), E('div', { 'class': 'flowsense-controls' }, accelerationKeys.map(function(key, i) {
				var state = data && data[key], value = state && state.supported === true ? state.enabled : null;
				return E('div', { 'class': 'cbi-value' }, [E('span', { 'class': 'cbi-value-title' }, [labels[i]]), E('span', { 'class': 'flowsense-acceleration-state' + (value === true ? ' flowsense-active' : '') }, [E('span', { 'class': 'flowsense-acceleration-dot', 'aria-hidden': 'true' }), E('span', {}, [value === true ? _('Enabled') : value === false ? _('Not enabled') : _('Unknown')])])]);
			})));
		}
		function refreshAcceleration() {
			if (accelerationPending) return accelerationPending;
			accelerationPending = getAcceleration().then(function(data) { if (root.isConnected) paintAcceleration(data); }).catch(function() { if (root.isConnected) paintAcceleration(null); }).finally(function() { accelerationPending = null; });
			return accelerationPending;
		}
		var main = E('div', {}, [summary, acceleration, E('div', { 'class': 'cbi-section' }, [E('h3', { 'class': 'cbi-section-title' }, _('Ethernet Links')), interfaces]), quality]);
		root.append(message, main);

		function card(title, value, sub) { return E('div', { 'class': 'flowsense-card' }, [E('span', { 'class': 'flowsense-label' }, title), E('span', { 'class': 'flowsense-value' }, value), E('span', { 'class': 'flowsense-sub' }, sub)]); }
		function update() {
			if (!root.isConnected) {
				poll.remove(update);
				return Promise.resolve();
			}
			if (pending) return pending;
			// Lightweight sibling query shares the existing tick, with its own guard.
			refreshAcceleration();
			pending = getOverview().then(function(data) {
				if (!root.isConnected) return;
				paint(data);
			}).catch(clear).finally(function() { pending = null; });
			return pending;
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
				var seconds = previous && number(data.uptime, 0, Number.MAX_SAFE_INTEGER) - previous.time;
				var totalRx = 0, totalTx = 0, rxOk = 0, txOk = 0;
				interfaces.replaceChildren();
				ports.forEach(function(port) {
					var stats = port.stats && typeof port.stats === 'object' ? port.stats : {};
					var old = previous && previous.ports[port.device], rx = rate(stats.rx_bytes, old && old.rx_bytes, seconds), tx = rate(stats.tx_bytes, old && old.tx_bytes, seconds);
					if (rx != null) { totalRx += rx; rxOk++; } if (tx != null) { totalTx += tx; txOk++; }
					interfaces.appendChild(E('div', { 'class': 'flowsense-port' }, [E('div', { 'class': 'flowsense-port-title' }, [E('span', { 'class': 'flowsense-port-name' }, [port.device.toUpperCase()]), statusBadge(port.carrier)]), portMetric(_('Speed'), number(port.speed, 0, 1000000) == null ? '—' : port.speed + ' Mbit/s'), portMetric(_('RX / TX rate'), formatRate(rx) + ' / ' + formatRate(tx)), portMetric(_('RX / TX errors'), (number(stats.rx_errors, 0, Number.MAX_SAFE_INTEGER) == null ? '—' : stats.rx_errors) + ' / ' + (number(stats.tx_errors, 0, Number.MAX_SAFE_INTEGER) == null ? '—' : stats.tx_errors))]));
				});
				summary.replaceChildren(card(_('Total Port Receive Rate'), rxOk === ports.length && ports.length ? formatRate(totalRx) : '—', rxOk + ' / ' + ports.length), card(_('Total Port Transmit Rate'), txOk === ports.length && ports.length ? formatRate(totalTx) : '—', txOk + ' / ' + ports.length), card(_('Physical Ethernet Ports'), (Array.isArray(data.interfaces) && ports.every(function(port) { return port.carrier === 0 || port.carrier === 1 || typeof port.carrier === 'boolean'; }) ? ports.filter(function(port) { return port.carrier === 1 || port.carrier === true; }).length : '—') + ' / ' + (Array.isArray(data.interfaces) ? ports.length : '—'), _('Connected / Total')), card(_('Network Quality'), jitter && number(jitter.last_ping, 0, 60000) != null ? jitter.last_ping + ' ms' : '—', jitter && number(jitter.loss, 0, 100) != null ? _('Loss') + ': ' + jitter.loss + '%' : _('Probe data unavailable')));
				quality.replaceChildren(E('h3', { 'class': 'cbi-section-title' }, _('Link Quality')), metric(_('Latest RTT'), jitter && number(jitter.last_ping, 0, 60000) != null ? jitter.last_ping + ' ms' : _('Probe data unavailable')), metric(_('RTT mean absolute deviation'), jitter && number(jitter.deviation, 0, 60000) != null ? jitter.deviation + ' ms' : '—'), metric(_('Window packet loss'), jitter && number(jitter.loss, 0, 100) != null ? jitter.loss + '%' : '—'));
				previous = { time: number(data.uptime, 0, Number.MAX_SAFE_INTEGER) || 0, ports: {} }; ports.forEach(function(port) { previous.ports[port.device] = port.stats; });
				message.textContent = data.timestamp ? _('Last update') + ': ' + new Date(data.timestamp * 1000).toLocaleTimeString() : _('Data unavailable');
				}
		function clear() {
			if (!root.isConnected) return;
			previous = null;
			message.textContent = _('Data unavailable; previous readings cleared.');
			[interfaces, summary, quality].forEach(function(node) { node.replaceChildren(); });
		}
		requestAnimationFrame(function() {
			if (!root.isConnected) return;
			var removal = new MutationObserver(function() {
				if (root.isConnected) return;
				poll.remove(update);
				removal.disconnect();
			});
			removal.observe(document.body, { childList: true, subtree: true });
			if (initial) paint(initial); else clear();
			paintAcceleration(initialAcceleration, true);
			poll.add(update, 5);
		});
		return root;
	}
});
