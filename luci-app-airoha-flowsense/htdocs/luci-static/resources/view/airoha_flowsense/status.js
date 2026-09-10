'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var getOverview = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getOverview', reject: true });
var getPpeEntries = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getPpeEntries', reject: true });
var setMonitor = rpc.declare({ object: 'luci.airoha_flowsense', method: 'setMonitor', params: ['target', 'enabled'], reject: true });

var css = `
.flowsense-dashboard{--flowsense-gap:16px;box-sizing:border-box}
.flowsense-dashboard *{box-sizing:border-box}
.flowsense-dashboard .flowsense-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--flowsense-gap);margin:16px 0}
.flowsense-dashboard .flowsense-card{min-width:0;min-height:96px;padding:16px;border:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0));border-radius:4px;background:var(--cbi-section-bg,transparent)}
.flowsense-dashboard .flowsense-label{font-size:inherit;font-weight:500;color:var(--cbi-muted-color,var(--text-muted,#666))}
.flowsense-dashboard .flowsense-value{display:block;margin-top:8px;font-size:18px;font-weight:500;font-variant-numeric:tabular-nums}
.flowsense-dashboard .flowsense-sub{color:var(--cbi-muted-color,var(--text-muted,#888))}
.flowsense-dashboard .flowsense-status{display:inline-flex;align-items:center;gap:8px;font-size:inherit;color:inherit;white-space:nowrap}
.flowsense-dashboard .flowsense-status-arrow{color:inherit;font-weight:600}
.flowsense-dashboard .flowsense-up > span{color:#16a34a}
.flowsense-dashboard .flowsense-port-name{font-size:1.125em;font-weight:600}
.flowsense-dashboard .flowsense-section{margin:16px 0}.flowsense-dashboard .flowsense-section .cbi-value{padding:8px 0}
.flowsense-dashboard .flowsense-ports{container-type:inline-size}
.flowsense-dashboard .flowsense-port{display:grid;grid-template-columns:minmax(0,.7fr) repeat(3,minmax(0,1fr));gap:16px;align-items:start;margin:0;padding:16px 0;border-bottom:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0))}
.flowsense-dashboard .flowsense-port:last-child{border-bottom:0}.flowsense-dashboard .flowsense-port-title{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-weight:400;min-width:0;overflow-wrap:anywhere}
.flowsense-dashboard .flowsense-port-metric{display:grid;gap:8px;min-width:0;margin:0;padding:0}
.flowsense-dashboard .flowsense-port-metric dt,.flowsense-dashboard .flowsense-port-metric dd{margin:0;padding:0;min-width:0;font-weight:400;text-align:start;overflow-wrap:anywhere}
.flowsense-dashboard .flowsense-port-metric dd{font-variant-numeric:tabular-nums}
.flowsense-dashboard .flowsense-details{margin-top:16px}.flowsense-dashboard .flowsense-details summary{cursor:pointer;min-height:32px}
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
function validTarget(value) {
	value = text(value).trim();
	if (!value || value.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(value)) return false;
	if (/^[0-9.]+$/.test(value)) {
		var parts = value.split('.');
		return parts.length === 4 && parts.every(function(part) { return /^(0|[1-9][0-9]*)$/.test(part) && +part <= 255; });
	}
	return value.split('.').every(function(part) { return part.length <= 63 && /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(part); });
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
	load: function() { return getOverview().catch(function() { return null; }); },

	render: function(initial) {
		var root = E('div', { 'class': 'cbi-map flowsense-dashboard' }, [E('style', {}, css)]);
		var message = E('div', { 'class': 'cbi-map-descr' }, _('Waiting for data'));
		var summary = E('div', { 'class': 'flowsense-summary' });
		var interfaces = E('div', { 'class': 'flowsense-ports' });
		var quality = E('div', { 'class': 'flowsense-section cbi-section' });
		var ppe = E('div', { 'class': 'flowsense-section cbi-section' });
		var target = E('input', { id: 'flowsense-target', 'class': 'cbi-input-text', maxlength: 253, placeholder: '223.5.5.5' });
		var enabled = E('input', { id: 'flowsense-enabled', type: 'checkbox', 'class': 'cbi-input-checkbox' });
		var apply = E('button', { 'class': 'cbi-button cbi-button-action cbi-button-primary' }, _('Save & Apply'));
		var previous = null, dirty = false, pending = null, ppePending = null, generation = 0, online = false;
		target.addEventListener('input', function() { dirty = true; }); enabled.addEventListener('change', function() { dirty = true; });
		apply.addEventListener('click', function() {
			if (!validTarget(target.value)) { ui.addNotification(null, E('p', {}, _('Enter a valid IPv4 address or hostname.')), 'error'); target.focus(); return; }
			target.disabled = enabled.disabled = apply.disabled = true;
			setMonitor(target.value.trim(), enabled.checked ? 1 : 0).then(function(result) {
				if (!result || result.success !== true) throw new Error(_('Unable to apply monitor settings.'));
				dirty = false; return update();
			}).catch(function(error) { ui.addNotification(null, E('p', {}, error.message), 'error'); }).finally(function() { target.disabled = enabled.disabled = apply.disabled = false; });
		});
		var main = E('div', {}, [summary, E('div', { 'class': 'cbi-section' }, [E('h3', { 'class': 'cbi-section-title' }, _('Ethernet Links')), interfaces]), quality]);
		var monitor = E('div', { 'class': 'cbi-section' }, [E('h3', { 'class': 'cbi-section-title' }, _('Probe Settings')), metric(_('IPv4 address or hostname'), target), metric(_('Enable periodic probes'), enabled), E('div', { 'class': 'cbi-value' }, [E('span', { 'class': 'cbi-value-title' }), E('div', { 'class': 'cbi-value-field' }, apply)])]);
		var details = E('details', { 'class': 'flowsense-details' }, [E('summary', {}, _('Show PPE flow entries')), ppe]);
		root.append(message, main, monitor, details);

		function card(title, value, sub) { return E('div', { 'class': 'flowsense-card' }, [E('span', { 'class': 'flowsense-label' }, title), E('span', { 'class': 'flowsense-value' }, value), E('span', { 'class': 'flowsense-sub' }, sub)]); }
		function update() {
			if (!root.isConnected) {
				poll.remove(update);
				return Promise.resolve();
			}
			if (pending) return pending;
			pending = getOverview().then(function(data) {
				if (!root.isConnected) return;
				paint(data);
			}).catch(clear).finally(function() { pending = null; });
			return pending;
		}
		function paint(data) {
				online = true;
				data = data && typeof data === 'object' ? data : {};
				var jitter = data.jitter && typeof data.jitter === 'object' ? data.jitter : null;
				var ports = Array.isArray(data.interfaces) ? data.interfaces.filter(function(port) { return port && typeof port.device === 'string' && port.device !== 'eth0' && port.stats && typeof port.stats === 'object'; }) : [];
				var priority = ['wan', 'lan2', 'lan3', 'lan4'];
				ports.sort(function(a, b) {
					var ai = priority.indexOf(a.device), bi = priority.indexOf(b.device);
					return (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi);
				});
				if (!dirty) { target.value = text(data.monitor && data.monitor.target); enabled.checked = data.monitor && data.monitor.enabled === true; }
				var seconds = previous && number(data.uptime, 0, Number.MAX_SAFE_INTEGER) - previous.time;
				var totalRx = 0, totalTx = 0, rxOk = 0, txOk = 0;
				interfaces.replaceChildren();
				ports.forEach(function(port) {
					var old = previous && previous.ports[port.device], rx = rate(port.stats.rx_bytes, old && old.rx_bytes, seconds), tx = rate(port.stats.tx_bytes, old && old.tx_bytes, seconds);
					if (rx != null) { totalRx += rx; rxOk++; } if (tx != null) { totalTx += tx; txOk++; }
					interfaces.appendChild(E('div', { 'class': 'flowsense-port' }, [E('div', { 'class': 'flowsense-port-title' }, [E('span', { 'class': 'flowsense-port-name' }, [port.device.toUpperCase()]), statusBadge(port.carrier)]), portMetric(_('Speed'), number(port.speed, 0, 1000000) == null ? '—' : port.speed + ' Mbit/s'), portMetric(_('RX / TX rate'), formatRate(rx) + ' / ' + formatRate(tx)), portMetric(_('RX / TX errors'), (number(port.stats.rx_errors, 0, Number.MAX_SAFE_INTEGER) == null ? '—' : port.stats.rx_errors) + ' / ' + (number(port.stats.tx_errors, 0, Number.MAX_SAFE_INTEGER) == null ? '—' : port.stats.tx_errors))]));
				});
				summary.replaceChildren(card(_('Total Port Receive Rate'), rxOk === ports.length && ports.length ? formatRate(totalRx) : '—', rxOk + ' / ' + ports.length), card(_('Total Port Transmit Rate'), txOk === ports.length && ports.length ? formatRate(totalTx) : '—', txOk + ' / ' + ports.length), card(_('PPE Flow Engine'), data.configured_hw === true ? _('Enabled') : data.configured_hw === false ? _('Disabled') : _('Unknown'), _('Hardware flow offload')), card(_('Network Quality'), jitter && number(jitter.last_ping, 0, 60000) != null ? jitter.last_ping + ' ms' : '—', jitter && number(jitter.loss, 0, 100) != null ? _('Loss') + ': ' + jitter.loss + '%' : _('Probe data unavailable')));
				quality.replaceChildren(E('h3', { 'class': 'cbi-section-title' }, _('Link Quality')), metric(_('Latest RTT'), jitter && number(jitter.last_ping, 0, 60000) != null ? jitter.last_ping + ' ms' : _('Probe data unavailable')), metric(_('RTT mean absolute deviation'), jitter && number(jitter.deviation, 0, 60000) != null ? jitter.deviation + ' ms' : '—'), metric(_('Window packet loss'), jitter && number(jitter.loss, 0, 100) != null ? jitter.loss + '%' : '—'), metric(_('Hardware flow offload'), data.configured_hw === true ? _('Enabled') : data.configured_hw === false ? _('Disabled') : _('Unknown')), metric(_('Software flow offload'), data.configured_sw === true ? _('Enabled') : data.configured_sw === false ? _('Disabled') : _('Unknown')));
				previous = { time: number(data.uptime, 0, Number.MAX_SAFE_INTEGER) || 0, ports: {} }; ports.forEach(function(port) { previous.ports[port.device] = port.stats; });
				message.textContent = data.timestamp ? _('Last update') + ': ' + new Date(data.timestamp * 1000).toLocaleTimeString() : _('Data unavailable');
				}
		function clear() {
			if (!root.isConnected) return;
			previous = null; online = false; generation++;
			message.textContent = _('Data unavailable; previous readings cleared.');
			[interfaces, summary, quality, ppe].forEach(function(node) { node.replaceChildren(); });
		}
		function loadPpe() {
			if (!root.isConnected || !details.open || !online) return Promise.resolve();
			if (ppePending) return ppePending;
			var requestGeneration = generation;
			ppePending = getPpeEntries().then(function(result) {
				if (!root.isConnected || !details.open || requestGeneration !== generation) return;
				ppe.replaceChildren();
				if (!result || result.available !== true || !Array.isArray(result.entries)) { ppe.appendChild(E('p', {}, _('PPE data unavailable'))); return; }
				ppe.appendChild(E('p', {}, _('Shown / Total') + ': ' + result.entries.length + ' / ' + (number(result.total, 0, 1000000) == null ? '—' : result.total)));
				result.entries.forEach(function(entry) { if (!entry || typeof entry !== 'object') return; ppe.appendChild(metric(text(entry.index), text(entry.state) + ' · ' + text(entry.type))); });
			}).catch(function() {
				if (root.isConnected && details.open && requestGeneration === generation) ppe.replaceChildren(E('p', {}, _('PPE data unavailable')));
			}).finally(function() { ppePending = null; });
			return ppePending;
		}
		details.addEventListener('toggle', function() { if (details.open) loadPpe(); else { generation++; ppe.replaceChildren(); } });
		requestAnimationFrame(function() {
			if (!root.isConnected) return;
			var removal = new MutationObserver(function() {
				if (root.isConnected) return;
				poll.remove(update);
				poll.remove(loadPpe); generation++;
				removal.disconnect();
			});
			removal.observe(document.body, { childList: true, subtree: true });
			if (initial) paint(initial); else clear();
			poll.add(update, 5);
			poll.add(loadPpe, 30);
		});
		return root;
	}
});
