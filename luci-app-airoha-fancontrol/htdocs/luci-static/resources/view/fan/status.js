'use strict';
'require dom';
'require poll';
'require rpc';
'require view';

var callFanStatus = rpc.declare({
	object: 'luci.fan',
	method: 'getStatus',
	reject: true
});

var statusCSS = '\
.fan-dashboard .fan-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:8px;margin-bottom:16px}\
.fan-dashboard .fan-summary-card,.fan-dashboard .fan-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0));border-radius:6px;box-sizing:border-box}\
.fan-dashboard .fan-summary-card{min-width:0;min-height:96px;padding:8px 16px;display:flex;flex-direction:column;justify-content:center;gap:4px;line-height:1.5;overflow-wrap:anywhere}\
.fan-dashboard .fan-card-title,.fan-dashboard .fan-group-title{color:var(--cbi-muted-color,var(--text-muted,#666));}\
.fan-dashboard .fan-card-value{font-size:1.125em;font-weight:600;font-variant-numeric:tabular-nums}.fan-dashboard .fan-card-sub{color:var(--cbi-muted-color,var(--text-muted,#888));white-space:normal;overflow-wrap:anywhere}\
.fan-dashboard .fan-panel{padding:16px;margin:16px 0}.fan-dashboard .fan-panel-title{padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0))}\
.fan-dashboard .fan-temp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.fan-dashboard .fan-group-title{margin:8px 0}.fan-dashboard .fan-temp-card{padding:8px 0;border-bottom:1px solid var(--cbi-border-color,var(--hairline,#f0f0f0))}\
.fan-dashboard .fan-temp-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px}.fan-dashboard .fan-temp-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fan-dashboard .fan-temp-value{font-variant-numeric:tabular-nums;color:var(--fan-temp-accent)}\
.fan-dashboard .fan-temp-track{height:6px;margin-top:8px;border-radius:3px;overflow:hidden;background:var(--cbi-input-bg,var(--surface-sunken,#eee))}.fan-dashboard .fan-temp-fill{height:100%;border-radius:inherit;background:var(--fan-temp-accent);transition:width .3s,background .3s}\
@media(max-width:760px){.fan-dashboard .fan-temp-grid{grid-template-columns:1fr}}\
@media(max-width:480px){.fan-dashboard .fan-panel{padding:8px}}\
';


function validNumber(value, min, max) {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validTemp(value) {
	return validNumber(value, -128, 150);
}

function tempColor(value) {
	if (!validTemp(value)) return 'var(--cbi-muted-color,var(--text-muted,#888))';
	if (value < 50) return '#10b981';
	if (value <= 65) return '#f59e0b';
	if (value <= 75) return '#f97316';
	return '#ef4444';
}

function modeInfo(mode) {
	if (mode === 'manual') return { value: _('Manual'), sub: _('Fixed PWM output') };
	if (mode === 'auto') return { value: _('Automatic'), sub: _('Following fan curve') };
	return { value: _('Unknown'), sub: _('Read failed') };
}

function presetInfo(preset) {
	var labels = { quiet: _('Quiet'), balanced: _('Balanced'), performance: _('Performance'), custom: _('Custom') };
	return labels[preset] ? { value: labels[preset], sub: _('Configured profile for automatic mode') } : { value: _('Unknown'), sub: _('Read failed') };
}

function summaryData(status) {
	var actual = status.fan_mode === 1 ? 'manual' : status.fan_mode === 2 ? 'auto' : 'unknown';
	var mode = modeInfo(actual);
	if (actual !== 'unknown' && actual !== status.uci_mode) mode.sub = _('Configured mode differs from hardware');
	var preset = presetInfo(status.uci_preset);
	return [
		{ id: 'fan-summary-rpm', title: _('Fan Speed'), value: validNumber(status.fan_rpm, 0, 1350000) ? status.fan_rpm + ' RPM' : '—', sub: validNumber(status.fan_percentage, 0, 100) ? status.fan_percentage + '% ' + _('PWM output') : '—' },
		{ id: 'fan-summary-pwm', title: _('PWM'), value: validNumber(status.fan_pwm, 0, 255) ? status.fan_pwm + ' / 255' : '—', sub: validNumber(status.fan_percentage, 0, 100) ? status.fan_percentage + '%' : '—' },
		{ id: 'fan-summary-mode', title: _('Control Mode'), value: mode.value, sub: mode.sub },
		{ id: 'fan-summary-preset', title: _('Configured Curve'), value: preset.value, sub: preset.sub }
	];
}

function renderSummary(status) {
	return E('div', { 'class': 'fan-summary-grid' }, summaryData(status).map(function(card) {
		return E('div', { 'id': card.id, 'class': 'fan-summary-card' }, [
			E('div', { 'class': 'fan-card-title' }, card.title),
			E('div', { 'class': 'fan-card-value' }, card.value),
			E('div', { 'class': 'fan-card-sub' }, card.sub)
		]);
	}));
}

function createTempGauge(label, value, id) {
	var temp = validTemp(value) ? value : null;
	return E('div', { 'id': id, 'class': 'fan-temp-card', 'style': '--fan-temp-accent:' + tempColor(temp) }, [
		E('div', { 'class': 'fan-temp-row' }, [
			E('span', { 'class': 'fan-temp-label' }, label),
			E('span', { 'class': 'fan-temp-value' }, temp == null ? '—' : temp + '\u00b0C')
		]),
		E('div', { 'class': 'fan-temp-track' }, E('div', { 'class': 'fan-temp-fill', 'style': 'width:' + (temp == null ? 0 : Math.min(100, Math.max(3, temp))) + '%' }))
	]);
}

function updateTempGauge(root, id, value) {
	var card = root.querySelector('#' + id);
	if (!card) return;
	var temp = validTemp(value) ? value : null;
	card.style.setProperty('--fan-temp-accent', tempColor(temp));
	var valueEl = card.querySelector('.fan-temp-value');
	var fill = card.querySelector('.fan-temp-fill');
	if (valueEl) valueEl.textContent = temp == null ? '—' : temp + '\u00b0C';
	if (fill) fill.style.width = (temp == null ? 0 : Math.min(100, Math.max(3, temp))) + '%';
}

function updateView(viewEl, status) {
	status = status || {};
	summaryData(status).forEach(function(card) {
		var root = viewEl.querySelector('#' + card.id);
		if (!root) return;
		var value = root.querySelector('.fan-card-value');
		var sub = root.querySelector('.fan-card-sub');
		if (value) value.textContent = card.value;
		if (sub) sub.textContent = card.sub;
	});
		var values = {
			cpu: status.temp_cpu, board: status.temp_board, phy1: status.temp_phy1, phy2: status.temp_phy2,
			wifi24g: status.wifi_24g, wifi5g: status.wifi_5g, wifi6g: status.wifi_6g
		};
		Object.keys(values).forEach(function(name) { updateTempGauge(viewEl, 'temp-' + name, values[name]); });
}

return view.extend({
	load: function() {
		return callFanStatus().catch(function() { return {}; });
	},

	render: function(data) {
		var status = data || {};
		var viewEl = E('div', { 'class': 'cbi-map fan-dashboard' }, [
			E('style', {}, statusCSS),
			E('h2', {}, _('Airoha Fan Status')),
			E('div', { 'class': 'cbi-map-descr' }, _('View fan speed and system temperatures.')),
			renderSummary(status),
			E('div', { 'class': 'fan-panel' }, [
				E('h3', { 'class': 'fan-panel-title cbi-section-title' }, _('Temperatures')),
				E('div', { 'class': 'fan-temp-grid' }, [
					E('div', { 'class': 'fan-temp-group' }, [
						E('div', { 'class': 'fan-group-title' }, _('System')),
						createTempGauge(_('CPU'), status.temp_cpu, 'temp-cpu'),
						createTempGauge(_('Board'), status.temp_board, 'temp-board'),
						createTempGauge(_('10G WAN'), status.temp_phy2, 'temp-phy2'),
						createTempGauge(_('10G LAN'), status.temp_phy1, 'temp-phy1')
					]),
					E('div', { 'class': 'fan-temp-group' }, [
						E('div', { 'class': 'fan-group-title' }, _('WiFi')),
						createTempGauge(_('2.4 GHz Radio'), status.wifi_24g, 'temp-wifi24g'),
						createTempGauge(_('5 GHz Radio'), status.wifi_5g, 'temp-wifi5g'),
						createTempGauge(_('6 GHz Radio'), status.wifi_6g, 'temp-wifi6g')
					])
				])
			])
		]);

		var refresh = function() {
			if (!viewEl.isConnected) {
				poll.remove(refresh);
				return Promise.resolve();
			}
			return callFanStatus().then(function(current) {
				if (viewEl.isConnected) updateView(viewEl, current);
			}).catch(function() {
				if (!viewEl.isConnected) return;
				updateView(viewEl, {});
				viewEl.querySelectorAll('.fan-card-sub').forEach(function(el) { el.textContent = _('Read failed'); });
			});
		};
		poll.add(refresh, 5);
		requestAnimationFrame(function() {
			if (!viewEl.isConnected) return;
			var removal = new MutationObserver(function() {
				if (viewEl.isConnected) return;
				poll.remove(refresh);
				removal.disconnect();
			});
			removal.observe(document.body, { childList: true, subtree: true });
			refresh();
		});
		return viewEl;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
