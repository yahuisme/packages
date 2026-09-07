'use strict';
'require dom';
'require poll';
'require rpc';
'require view';

var callFanStatus = rpc.declare({
	object: 'luci.fan',
	method: 'getStatus',
	raise: true
});

var HISTORY_WINDOW_MS = 2 * 60 * 1000;
var TIME_GRID_INTERVAL_MS = 10 * 1000;
var TIME_LABEL_INTERVAL_MS = 30 * 1000;
var VALUE_GRID_DIVISIONS = 4;
var history = [];

var themeCSS = '\
.fan-dashboard{width:100%;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5;color:var(--cbi-text-color,inherit)}\
.fan-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin-bottom:14px}\
.fan-summary-card,.fan-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;box-sizing:border-box}\
.fan-summary-card{padding:10px 14px;min-height:76px;display:flex;flex-direction:column;justify-content:center}\
.fan-card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.2px;color:var(--cbi-muted-color,#666);margin-bottom:4px}\
.fan-card-value{font-size:18px;font-family:monospace;font-variant-numeric:tabular-nums;font-weight:600;color:var(--cbi-text-color,inherit)}\
.fan-card-sub{font-size:12px;color:var(--cbi-muted-color,#888);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.fan-panel{padding:14px;margin:14px 0}\
.fan-panel-title{font-size:15px;font-weight:600;color:var(--cbi-text-color,inherit);padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0)}\
.fan-chart-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}\
.fan-chart-card{padding:10px 12px;min-width:0}\
.fan-chart-canvas{display:block;width:100%;height:110px;margin-top:8px;background:var(--cbi-input-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:4px}\
.fan-temp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}\
.fan-temp-group{min-width:0}\
.fan-temp-group-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.2px;color:var(--cbi-muted-color,#666);margin:0 0 8px}\
.fan-temp-list{display:grid;gap:6px}\
.fan-temp-card{padding:8px 10px;min-width:0}\
.fan-temp-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px}\
.fan-temp-label{font-size:12px;color:var(--cbi-text-color,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.fan-temp-value{font-family:monospace;font-variant-numeric:tabular-nums;font-size:14px;font-weight:600;color:var(--fan-temp-accent);white-space:nowrap}\
.fan-temp-track{height:14px!important;min-height:14px;border-radius:999px;overflow:hidden;background:var(--cbi-border-color,#e0e0e0)}\
.fan-temp-fill{height:100%;border-radius:inherit;background:var(--fan-temp-accent);transition:width .3s,background .3s}\
@media(max-width:1050px){.fan-summary-grid{grid-template-columns:repeat(2,minmax(160px,1fr))}.fan-chart-grid{grid-template-columns:1fr}}\
@media(max-width:640px){.fan-summary-grid,.fan-temp-grid{grid-template-columns:1fr}.fan-panel{padding:10px}.fan-summary-card{min-height:68px}.fan-chart-canvas{height:100px}}\
';

function injectCSS() {
	var el = document.getElementById('fan-theme-css');
	if (el) return;
	if (!el) {
		el = document.createElement('style');
		el.id = 'fan-theme-css';
		document.head.appendChild(el);
	}
	el.textContent = themeCSS;
}

function tempColor(temp) {
	if (typeof temp !== 'number' || !Number.isFinite(temp) || temp < -128 || temp > 150) return 'inherit';
	if (temp < 50) return '#10b981';
	if (temp <= 65) return '#f59e0b';
	if (temp <= 75) return '#f97316';
	return '#ef4444';
}

function modeInfo(uciMode) {
	if (uciMode !== 'manual' && uciMode !== 'auto') return { value: _('Unknown'), sub: _('Read failed') };
	return uciMode === 'manual'
		? { value: _('Manual'), sub: _('Fixed PWM output') }
		: { value: _('Automatic'), sub: _('Following fan curve') };
}

function presetInfo(preset) {
	var labels = {
		quiet: _('Quiet'), balanced: _('Balanced'),
		performance: _('Performance'), custom: _('Custom')
	};
	return { value: labels[preset] || _('Unknown'),
		sub: _('Configuration only; hardware curve is not verified.') };
}

function summaryData(status) {
	var actualMode = status.fan_mode === 1 ? 'manual' : status.fan_mode === 2 ? 'auto' : 'unknown';
	var mode = modeInfo(actualMode);
	if (actualMode !== 'unknown' && actualMode !== status.uci_mode) mode.sub = _('Configured mode differs from hardware');
	var preset = presetInfo(status.uci_preset);
	return [
		{ id: 'fan-summary-rpm', title: _('Fan Speed'), value: (status.fan_rpm != null ? status.fan_rpm : '—') + ' RPM', sub: (status.fan_percentage != null ? status.fan_percentage : '—') + '% ' + _('PWM output') },
		{ id: 'fan-summary-pwm', title: 'PWM', value: (status.fan_pwm != null ? status.fan_pwm : '—') + ' / 255', sub: (status.fan_percentage != null ? status.fan_percentage : '—') + '%' },
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

function updateSummary(status) {
	summaryData(status).forEach(function(card) {
		var el = document.getElementById(card.id);
		if (!el) return;
		var value = el.querySelector('.fan-card-value');
		var sub = el.querySelector('.fan-card-sub');
		if (value) value.textContent = card.value;
		if (sub) sub.textContent = card.sub;
	});
}

function createTempGauge(label, temp, id) {
	var color = tempColor(temp);
	var percentage = (temp == null ? 0 : Math.min(100, Math.max(3, temp)));
	return E('div', { 'id': id, 'class': 'fan-temp-card', 'style': '--fan-temp-accent:' + color }, [
		E('div', { 'class': 'fan-temp-row' }, [
			E('span', { 'class': 'fan-temp-label' }, label),
			E('span', { 'class': 'fan-temp-value' }, (temp != null ? temp + '\u00b0C' : '—'))
		]),
		E('div', { 'class': 'fan-temp-track' }, [
			E('div', { 'class': 'fan-temp-fill', 'style': 'width:' + percentage + '%' })
		])
	]);
}

function updateGauge(id, temp) {
	var card = document.getElementById(id);
	if (!card) return;
	var color = tempColor(temp);
	var value = card.querySelector('.fan-temp-value');
	var fill = card.querySelector('.fan-temp-fill');
	card.style.setProperty('--fan-temp-accent', color);
	if (value) value.textContent = (temp != null ? temp + '\u00b0C' : '—');
	if (fill) fill.style.width = (temp == null ? 0 : Math.min(100, Math.max(3, temp))) + '%';
}

function appendHistory(status) {
	var now = Date.now();
	function value(key, min, max) {
		var v = status[key];
		return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
	}
	history.push({ time: now, temperature: value('temp_board', -128, 150),
		pwm: value('fan_pwm', 0, 255), rpm: value('fan_rpm', 0, 1350000) });
	while (history.length && history[0].time < now - HISTORY_WINDOW_MS) history.shift();
}

function chartScale(hist, key, minMax, step) {
	var maximum = minMax;
	for (var i = 0; i < hist.length; i++) if (hist[i][key] != null) maximum = Math.max(maximum, hist[i][key]);
	return Math.ceil(maximum / step) * step;
}

function drawChart(canvas, hist, key, options) {
	if (!canvas) return;
	var style = getComputedStyle(canvas);
	var width = Math.max(canvas.clientWidth, 1);
	var height = Math.max(canvas.clientHeight, 1);
	var dpr = Math.min(window.devicePixelRatio || 1, 2);
	var ctx = canvas.getContext('2d');
	var pad = { left: 31, right: 6, top: 7, bottom: 16 };
	var plotW = Math.max(width - pad.left - pad.right, 1);
	var plotH = Math.max(height - pad.top - pad.bottom, 1);
	var plotB = pad.top + plotH;
	var now = Date.now();
	hist = hist.filter(function(sample) { return sample.time >= now - HISTORY_WINDOW_MS && sample.time <= now; });
	var start = now - HISTORY_WINDOW_MS;
	var maximum = chartScale(hist, key, options.minMax, options.step);
	var minimum = Math.min(0, ...hist.filter(function(sample) { return sample[key] != null; }).map(function(sample) { return sample[key]; }));
	var labelColor = style.color || '#666';

	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);
	ctx.strokeStyle = 'rgba(127,127,127,.24)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (var e = 0; e <= HISTORY_WINDOW_MS; e += TIME_GRID_INTERVAL_MS) {
		var gx = pad.left + plotW * e / HISTORY_WINDOW_MS;
		ctx.moveTo(gx, pad.top);
		ctx.lineTo(gx, plotB);
	}
	for (var d = 0; d <= VALUE_GRID_DIVISIONS; d++) {
		var gy = pad.top + plotH * d / VALUE_GRID_DIVISIONS;
		ctx.moveTo(pad.left, gy);
		ctx.lineTo(pad.left + plotW, gy);
	}
	ctx.stroke();

	ctx.fillStyle = labelColor;
	ctx.font = '10px system-ui, sans-serif';
	ctx.textAlign = 'right';
	ctx.textBaseline = 'top';
	ctx.fillText(options.format(maximum), pad.left - 4, pad.top - 1);
	ctx.textBaseline = 'middle';
	ctx.fillText(options.format((maximum + minimum) / 2), pad.left - 4, pad.top + plotH / 2);
	ctx.textBaseline = 'bottom';
	ctx.fillText(options.format(minimum), pad.left - 4, plotB + 1);
	for (var t = 0; t <= HISTORY_WINDOW_MS; t += TIME_LABEL_INTERVAL_MS) {
		var lx = pad.left + plotW * t / HISTORY_WINDOW_MS;
		var remaining = (HISTORY_WINDOW_MS - t) / 1000;
		ctx.textAlign = t === 0 ? 'left' : t === HISTORY_WINDOW_MS ? 'right' : 'center';
		ctx.fillText(remaining ? '-' + remaining + 's' : '0', lx, height);
	}

	ctx.beginPath();
	var previous = null;
	for (var j = 0; j < hist.length; j++) {
		var sample = hist[j];
		if (sample[key] == null || !Number.isFinite(sample[key])) {
			previous = null;
			continue;
		}
		var x = pad.left + (sample.time - start) / HISTORY_WINDOW_MS * plotW;
		var y = plotB - (sample[key] - minimum) / (maximum - minimum) * plotH;
		if (!previous || sample.time - previous.time > 10000) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
		previous = sample;
	}
	ctx.strokeStyle = options.lineColor;
	ctx.lineWidth = 1.7;
	ctx.stroke();
}

function chartCard(label, canvasId) {
	return E('div', { 'class': 'fan-chart-card' }, [
		E('div', { 'class': 'fan-card-title' }, label),
		E('canvas', { 'id': canvasId, 'class': 'fan-chart-canvas' })
	]);
}

function drawAllCharts() {
	if (!history.length) return;
	drawChart(document.getElementById('fc-temp'), history, 'temperature', { minMax: 40, step: 20, lineColor: '#f97316', format: function(value) { return value + '\u00b0'; } });
	drawChart(document.getElementById('fc-pwm'), history, 'pwm', { minMax: 100, step: 50, lineColor: '#0ea5e9', format: function(value) { return String(value); } });
	drawChart(document.getElementById('fc-rpm'), history, 'rpm', { minMax: 1000, step: 500, lineColor: '#10b981', format: function(value) { return String(value); } });
}

function temperatureGroup(title, entries) {
	return E('div', { 'class': 'fan-temp-group' }, [
		E('div', { 'class': 'fan-temp-group-title' }, title),
		E('div', { 'class': 'fan-temp-list' }, entries)
	]);
}

return view.extend({
	load: function() {
		return Promise.resolve([]);
	},

	render: function(data) {
		injectCSS();
		history = [];
		var status = data || {};
		var viewEl = E('div', { 'class': 'cbi-map fan-dashboard' }, [
			E('div', { 'class': 'cbi-map-descr' }, _('View real-time fan speed and system temperatures.')),
			renderSummary(status),
			E('div', { 'class': 'fan-panel' }, [
				E('div', { 'class': 'fan-panel-title' }, _('Real-time Trends')),
				E('div', { 'class': 'fan-chart-grid' }, [
					chartCard(_('Board Temperature'), 'fc-temp'),
					chartCard(_('Fan PWM'), 'fc-pwm'),
					chartCard(_('Fan Speed'), 'fc-rpm')
				])
			]),
			E('div', { 'class': 'fan-panel' }, [
				E('div', { 'class': 'fan-panel-title' }, _('Temperatures')),
				E('div', { 'class': 'fan-temp-grid' }, [
					temperatureGroup(_('System'), [
						createTempGauge(_('CPU'), status.temp_cpu, 'temp-cpu'),
						createTempGauge(_('Board (Fan Curve)'), status.temp_board, 'temp-board'),
						createTempGauge('10G WAN', status.temp_phy2, 'temp-phy2'),
						createTempGauge('10G LAN', status.temp_phy1, 'temp-phy1')
					]),
					temperatureGroup(_('WiFi'), [
						createTempGauge(_('2.4 GHz Radio'), status.wifi_24g, 'temp-wifi24g'),
						createTempGauge(_('5 GHz Radio'), status.wifi_5g, 'temp-wifi5g'),
						createTempGauge(_('6 GHz Radio'), status.wifi_6g, 'temp-wifi6g')
					])
				])
			])
		]);

		var fetchData = L.bind(function() {
			if (!viewEl.isConnected) return Promise.resolve();
			return callFanStatus().then(L.bind(function(current) {
				if (!viewEl.isConnected) return;
				current = current || {};
				updateSummary(current);
				updateGauge('temp-cpu', current.temp_cpu);
				updateGauge('temp-board', current.temp_board);
				updateGauge('temp-phy1', current.temp_phy1);
				updateGauge('temp-phy2', current.temp_phy2);
				updateGauge('temp-wifi24g', current.wifi_24g);
				updateGauge('temp-wifi5g', current.wifi_5g);
				updateGauge('temp-wifi6g', current.wifi_6g);
				appendHistory(current);
				drawAllCharts();
			}, this)).catch(function() {
				if (!viewEl.isConnected) return;
				appendHistory({});
				drawAllCharts();
				updateSummary({});
				['temp-cpu', 'temp-board', 'temp-phy1', 'temp-phy2', 'temp-wifi24g', 'temp-wifi5g', 'temp-wifi6g'].forEach(function(id) { updateGauge(id, null); });
				var cards = document.querySelectorAll('.fan-card-sub');
				for (var i = 0; i < cards.length; i++) cards[i].textContent = _('Read failed');
			});
		}, this);

		requestAnimationFrame(function() {
			if (!viewEl.isConnected) return;
			var resize = new ResizeObserver(drawAllCharts);
			resize.observe(viewEl);
			var removal = new MutationObserver(function() {
				if (viewEl.isConnected) return;
				poll.remove(fetchData);
				resize.disconnect();
				removal.disconnect();
			});
			removal.observe(document.body, { childList: true, subtree: true });
			drawAllCharts();
			fetchData();
			poll.add(fetchData, 5);
		});
		return viewEl;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
