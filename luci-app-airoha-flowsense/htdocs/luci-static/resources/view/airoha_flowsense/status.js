'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var overview = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getOverview', raise: true });
var flows = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getPpeEntries', raise: true });
var saveMonitor = rpc.declare({ object: 'luci.airoha_flowsense', method: 'setMonitor', params: ['target', 'enabled'], raise: true });

var HISTORY_WINDOW_MS = 2 * 60 * 1000;
var TIME_GRID_MS = 10 * 1000;
var TIME_LABEL_MS = 30 * 1000;
var VALUE_GRID_DIV = 4;
var HISTORY_KEY = 'airoha-flowsense-history-v1';
var history = [];

var themeCSS = '\
:root{--fs-canvas-bg:#fbfcfd;--fs-grid:rgba(80,90,100,.18);--fs-axis:#555}\
@media(prefers-color-scheme:dark){:root{--fs-canvas-bg:#191919;--fs-grid:rgba(255,255,255,.12);--fs-axis:#a0a0a0}}\
[data-theme="dark"],[data-dark="true"],[data-darkmode="true"],.dark-mode,:root[data-dark="true"]{--fs-canvas-bg:#191919;--fs-grid:rgba(255,255,255,.12);--fs-axis:#a0a0a0}\
.flowsense-dashboard{--fs-font-ui:system-ui,-apple-system,sans-serif;--fs-font-mono:ui-monospace,monospace;font-family:var(--fs-font-ui);font-size:13px;line-height:1.5;color:var(--cbi-text-color,inherit)}\
.flowsense-dashboard .cbi-tabmenu{margin-bottom:16px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0)}\
.fs-card-neutral{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;box-sizing:border-box}\
.fs-chart-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:12px 14px;margin:12px 0}\
.fs-chart-title{font-size:13px;font-weight:600;color:var(--cbi-text-color,inherit);padding-bottom:6px;margin-bottom:10px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0)}\
.fs-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}\
.fs-chart-card{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:4px;padding:8px 10px;min-width:0}\
.fs-chart-card .fs-card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.2px;color:var(--cbi-muted-color,#666);margin-bottom:4px}\
.fs-chart-canvas{display:block;width:100%;height:100px;margin-top:6px;background:var(--fs-canvas-bg,#fbfcfd);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:4px}\
.flowsense-dashboard .cbi-section-node{padding:12px 14px;margin-bottom:12px}\
@media(max-width:760px){.fs-chart-grid{grid-template-columns:1fr}}\
';

function injectCSS() {
	if (document.getElementById('fs-theme-css')) return;
	var el = document.createElement('style');
	el.id = 'fs-theme-css';
	el.textContent = themeCSS;
	document.head.appendChild(el);
}

function restoreHistory() {
	try {
		var saved = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
		var now = Date.now();
		var cutoff = now - HISTORY_WINDOW_MS;
		if (!Array.isArray(saved)) return;
		history = saved.filter(function(s) {
			return s && typeof s.time === 'number' && s.time >= cutoff && s.time <= now;
		});
	} catch (e) {
		history = [];
	}
}

function persistHistory() {
	try {
		window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
	} catch (e) {}
}

function appendHistory(data) {
	var now = Date.now();
	function safeValue(v, min, max) {
		return typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : null;
	}
	var ppe = data.ppe || {};
	var sample = {
		time: now,
		bnd: safeValue(ppe.bnd, 0, 1000000),
		unb: safeValue(ppe.unb, 0, 1000000),
		interfaces: {}
	};
	(data.interfaces || []).forEach(function(port) {
		sample.interfaces[port.device] = {
			rx_bytes: safeValue(port.stats.rx_bytes, 0, Number.MAX_SAFE_INTEGER),
			tx_bytes: safeValue(port.stats.tx_bytes, 0, Number.MAX_SAFE_INTEGER)
		};
	});
	history.push(sample);
	while (history.length && history[0].time < now - HISTORY_WINDOW_MS) history.shift();
	persistHistory();
}

function chartScale(hist, key, minMax, step) {
	var maximum = minMax;
	for (var i = 0; i < hist.length; i++) if (hist[i][key] != null) maximum = Math.max(maximum, hist[i][key]);
	return Math.ceil(maximum / step) * step;
}

function drawChart(canvas, hist, key, options) {
	if (!canvas) return;
	var style = window.getComputedStyle(canvas);
	var width = Math.max(canvas.clientWidth, 1);
	var height = Math.max(canvas.clientHeight, 1);
	var dpr = Math.min(window.devicePixelRatio || 1, 2);
	var ctx = canvas.getContext('2d');
	var pad = { left: 31, right: 6, top: 7, bottom: 16 };
	var plotW = Math.max(width - pad.left - pad.right, 1);
	var plotH = Math.max(height - pad.top - pad.bottom, 1);
	var plotB = pad.top + plotH;
	var now = Date.now();
	hist = hist.filter(function(s) { return s.time >= now - HISTORY_WINDOW_MS && s.time <= now; });
	var start = now - HISTORY_WINDOW_MS;
	var maximum = chartScale(hist, key, options.minMax, options.step);
	var minimum = 0;
	var gridColor = style.getPropertyValue('--fs-grid').trim() || 'rgba(127,127,127,.24)';
	var axisColor = style.getPropertyValue('--fs-axis').trim() || style.color || '#666';

	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);
	ctx.strokeStyle = gridColor;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (var e = 0; e <= HISTORY_WINDOW_MS; e += TIME_GRID_MS) {
		var gx = pad.left + plotW * e / HISTORY_WINDOW_MS;
		ctx.moveTo(gx, pad.top);
		ctx.lineTo(gx, plotB);
	}
	for (var d = 0; d <= VALUE_GRID_DIV; d++) {
		var gy = pad.top + plotH * d / VALUE_GRID_DIV;
		ctx.moveTo(pad.left, gy);
		ctx.lineTo(pad.left + plotW, gy);
	}
	ctx.stroke();

	ctx.fillStyle = axisColor;
	ctx.font = '10px system-ui, sans-serif';
	ctx.textAlign = 'right';
	ctx.textBaseline = 'top';
	ctx.fillText(options.format(maximum), pad.left - 4, pad.top - 1);
	ctx.textBaseline = 'middle';
	ctx.fillText(options.format(maximum / 2), pad.left - 4, pad.top + plotH / 2);
	ctx.textBaseline = 'bottom';
	ctx.fillText(options.format(minimum), pad.left - 4, plotB + 1);
	for (var t = 0; t <= HISTORY_WINDOW_MS; t += TIME_LABEL_MS) {
		var lx = pad.left + plotW * t / HISTORY_WINDOW_MS;
		var remaining = (HISTORY_WINDOW_MS - t) / 1000;
		ctx.textAlign = t === 0 ? 'left' : t === HISTORY_WINDOW_MS ? 'right' : 'center';
		ctx.fillText(remaining ? '-' + remaining + 's' : '0', lx, height);
	}

	if (!hist.length) return;
	ctx.beginPath();
	ctx.moveTo(pad.left, plotB);
	for (var i = 0; i < hist.length; i++) {
		var sample = hist[i];
		var val = options.extract ? options.extract(sample) : sample[key];
		if (val == null || !isFinite(val)) {
			if (i > 0) ctx.lineTo(pad.left + (sample.time - start) / HISTORY_WINDOW_MS * plotW, plotB);
		} else {
			var x = pad.left + (sample.time - start) / HISTORY_WINDOW_MS * plotW;
			var y = plotB - (val - minimum) / (maximum - minimum) * plotH;
			ctx.lineTo(x, y);
		}
	}
	ctx.lineTo(pad.left + (hist[hist.length - 1].time - start) / HISTORY_WINDOW_MS * plotW, plotB);
	ctx.closePath();
	ctx.fillStyle = options.fillColor;
	ctx.fill();

	ctx.beginPath();
	var previous = null;
	for (var j = 0; j < hist.length; j++) {
		var s = hist[j];
		var v = options.extract ? options.extract(s) : s[key];
		if (v == null || !isFinite(v)) {
			previous = null;
			continue;
		}
		var px = pad.left + (s.time - start) / HISTORY_WINDOW_MS * plotW;
		var py = plotB - (v - minimum) / (maximum - minimum) * plotH;
		if (!previous || s.time - previous.time > 10000) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
		previous = s;
	}
	ctx.strokeStyle = options.lineColor;
	ctx.lineWidth = 1.7;
	ctx.stroke();
}

function chartCard(label, canvasId) {
	return E('div', { 'class': 'fs-chart-card' }, [
		E('div', { 'class': 'cbi-value-title', style: 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.2px;color:var(--cbi-muted-color,#666);margin-bottom:4px' }, label),
		E('canvas', { 'id': canvasId, 'class': 'fs-chart-canvas' })
	]);
}

function drawAllCharts() {
	if (!history.length) return;
	injectCSS();
	drawChart(document.getElementById('fc-bnd'), history, 'bnd', { minMax: 10, step: 10, lineColor: '#10b981', fillColor: 'rgba(16,185,129,.08)', format: function(v) { return String(v); } });
	drawChart(document.getElementById('fc-unb'), history, 'unb', { minMax: 10, step: 10, lineColor: '#f59e0b', fillColor: 'rgba(245,158,11,.08)', format: function(v) { return String(v); } });
	
	// 接口吞吐率：计算增量并转换为 Mbps
	var interfaces = {};
	if (history.length >= 2) {
		var recent = history[history.length - 1];
		var before = history[history.length - 2];
		var dt = (recent.time - before.time) / 1000;
		if (dt > 0) {
			Object.keys(recent.interfaces || {}).forEach(function(iface) {
				if (before.interfaces && before.interfaces[iface]) {
					var rx_delta = recent.interfaces[iface].rx_bytes - before.interfaces[iface].rx_bytes;
					var tx_delta = recent.interfaces[iface].tx_bytes - before.interfaces[iface].tx_bytes;
					if (rx_delta >= 0 && tx_delta >= 0) {
						interfaces[iface] = {
							rx_mbps: rx_delta * 8 / dt / 1000000,
							tx_mbps: tx_delta * 8 / dt / 1000000
						};
					}
				}
			});
		}
	}
	
	// 为每个接口绘制趋势图
	['wan', 'lan1', 'lan2', 'lan3', 'lan4'].forEach(function(iface) {
		var rxCanvas = document.getElementById('fc-' + iface + '-rx');
		var txCanvas = document.getElementById('fc-' + iface + '-tx');
		if (!rxCanvas || !txCanvas) return;
		
		// 构建接口历史数据（带 Mbps 计算）
		var ifaceHist = [];
		for (var i = 1; i < history.length; i++) {
			var curr = history[i];
			var prev = history[i - 1];
			if (!curr.interfaces[iface] || !prev.interfaces[iface]) continue;
			var dt = (curr.time - prev.time) / 1000;
			if (dt <= 0) continue;
			var rx_delta = curr.interfaces[iface].rx_bytes - prev.interfaces[iface].rx_bytes;
			var tx_delta = curr.interfaces[iface].tx_bytes - prev.interfaces[iface].tx_bytes;
			if (rx_delta < 0 || tx_delta < 0) continue;
			ifaceHist.push({
				time: curr.time,
				rx_mbps: rx_delta * 8 / dt / 1000000,
				tx_mbps: tx_delta * 8 / dt / 1000000
			});
		}
		
		drawChart(rxCanvas, ifaceHist, 'rx_mbps', { minMax: 10, step: 10, lineColor: '#0ea5e9', fillColor: 'rgba(14,165,233,.08)', format: formatMbps });
		drawChart(txCanvas, ifaceHist, 'tx_mbps', { minMax: 10, step: 10, lineColor: '#10b981', fillColor: 'rgba(16,185,129,.08)', format: formatMbps });
	});
}

function value(v, suffix) { return v == null ? '—' : v + (suffix || ''); }
function formatMbps(v) {
	if (v == null || !isFinite(v)) return '—';
	if (v === 0) return '0';
	if (v < 0.1) return v.toFixed(3);
	if (v < 1) return v.toFixed(2);
	if (v < 10) return v.toFixed(1);
	return v.toFixed(0);
}
function enabled(v) { return v === true ? _('Enabled') : v === false ? _('Disabled') : _('Unknown'); }
function metric(label, node) {
	return E('div', { 'class': 'cbi-value' }, [ E('span', { 'class': 'cbi-value-title' }, label), E('div', { 'class': 'cbi-value-field' }, node) ]);
}
function change(current, previous, key, dt) {
	if (!previous || !(dt > 0) || current[key] == null || previous[key] == null || current[key] < previous[key]) return null;
	return current[key] - previous[key];
}

return view.extend({
	load: function() { return Promise.resolve(); },
	render: function() {
		injectCSS();
		restoreHistory();
		var active = 0, paused = false, previous = null, dirty = false;
		var message = E('div', { 'class': 'cbi-section-descr' }, _('Waiting for data'));
		var hw = E('span'), sw = E('span'), counts = E('span'), ip = E('span');
		var ping = E('span'), deviation = E('span'), loss = E('span');
		var interfaces = E('div');
		var target = E('input', { id: 'fs-target', name: 'fs-target', 'class': 'cbi-input-text', style: 'width:192px', maxlength: 253 });
		var monitor = E('input', { id: 'fs-monitor', name: 'fs-monitor', type: 'checkbox' });
		target.addEventListener('input', function() { dirty = true; });
		monitor.addEventListener('change', function() { dirty = true; });
		var button = E('button', { 'class': 'cbi-button cbi-button-apply', click: function() {
			if (!target.value.trim()) { target.focus(); return; }
			button.disabled = true;
			return saveMonitor(target.value.trim(), monitor.checked ? 1 : 0).then(function(result) {
				if (!result || result.success !== true) throw new Error(_('Unable to apply monitor settings. Check the target and service.'));
				dirty = false;
				return update();
			}).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); })
				.finally(function() { button.disabled = false; });
		} }, _('Save & Apply'));
		
		var first = E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Offload configuration')), metric(_('Hardware flow offload'), hw), metric(_('Software flow offload'), sw),
				E('div', { 'class': 'cbi-section-descr' }, _('Configured switches do not prove that individual connections are offloaded.'))]),
			E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('PPE summary')), metric(_('Bound / Unbound flows'), counts), metric(_('IPv4 / IPv6 / Other'), ip)]),
			E('div', { 'class': 'fs-chart-panel' }, [
				E('div', { 'class': 'fs-chart-title' }, _('PPE Flow Trends')),
				E('div', { 'class': 'fs-chart-grid' }, [
					chartCard(_('Bound Flows'), 'fc-bnd'),
					chartCard(_('Unbound Flows'), 'fc-unb')
				])
			]),
			E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Ethernet links')), E('div', { 'class': 'cbi-section-descr' }, _('Rates use interface counters; hardware-bypassed traffic may not be fully counted. Errors and drops are interval increments.')), interfaces]),
			E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Link quality')), metric(_('Latest RTT'), ping), metric(_('RTT mean absolute deviation'), deviation), metric(_('Window packet loss'), loss),
				E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': 'fs-target' }, _('IPv4 address or hostname')), E('div', { 'class': 'cbi-value-field' }, target)]),
				E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': 'fs-monitor' }, _('Enable periodic probes')), E('div', { 'class': 'cbi-value-field' }, monitor)]), button])
		]);
		var detail = E('div'), detailMessage = E('div', { 'class': 'cbi-section-descr' });
		var pause = E('button', { 'class': 'cbi-button', click: function() { paused = !paused; pause.textContent = paused ? _('Resume') : _('Pause'); if (!paused) update(); } }, _('Pause'));
		var second = E('div', { style: 'display:none' }, [pause, detailMessage, detail]);
		var panes = [first, second], nav = E('ul', { 'class': 'cbi-tabmenu' });
		[_('Overview & Quality'), _('PPE Flow Offload')].forEach(function(label, index) {
			nav.appendChild(E('li', { 'class': index ? 'cbi-tab-disabled' : 'cbi-tab' }, E('a', { href: '#', click: function(event) {
				event.preventDefault(); active = index;
				panes.forEach(function(p, i) { p.style.display = i === active ? '' : 'none'; nav.children[i].className = i === active ? 'cbi-tab' : 'cbi-tab-disabled'; });
				update();
			} }, label)));
		});
		var root = E('div', { 'class': 'cbi-map flowsense-dashboard' }, [E('h2', {}, _('Airoha FlowSense')), message, nav, first, second]);
		var pending = null;
		function update() {
			if (pending) return pending;
			pending = overview().then(function(data) {
				if (!root.isConnected) return;
				hw.textContent = enabled(data.configured_hw); sw.textContent = enabled(data.configured_sw);
				var ppe = data.ppe || {};
				counts.textContent = ppe.available ? ppe.bnd + ' / ' + ppe.unb : _('Unavailable');
				ip.textContent = ppe.available ? ppe.ipv4 + ' / ' + ppe.ipv6 + ' / ' + ppe.other : '—';
				if (!dirty) { target.value = data.monitor.target; monitor.checked = data.monitor.enabled === true; }
				var jitter = data.jitter;
				ping.textContent = jitter ? value(jitter.last_ping, ' ms') : _('Stopped or stale');
				deviation.textContent = jitter ? value(jitter.deviation, ' ms') : '—';
				loss.textContent = jitter ? value(jitter.loss, '%') + ' (' + jitter.received + '/' + jitter.samples + ')' : '—';
				
				appendHistory(data);
				drawAllCharts();
				
				interfaces.replaceChildren();
				(data.interfaces || []).forEach(function(port) {
					var before = previous && previous.ports[port.device], dt = previous ? data.uptime - previous.time : 0;
					if (before && before.ifindex !== port.ifindex) before = null;
					var rx = change(port.stats, before && before.stats, 'rx_bytes', dt), tx = change(port.stats, before && before.stats, 'tx_bytes', dt);
					var rxRateText = rx == null ? '—' : formatMbps(rx * 8 / dt / 1000000) + ' Mbit/s';
					var txRateText = tx == null ? '—' : formatMbps(tx * 8 / dt / 1000000) + ' Mbit/s';
					var card = E('div', { 'class': 'cbi-section-node fs-card-neutral' }, [
						E('h4', {}, port.device),
						metric(_('Link / Speed'), (port.carrier == null ? _('Unknown') : port.carrier ? _('Up') : _('Down')) + ' / ' + value(port.speed, ' Mbit/s')),
						metric(_('RX / TX rate'), rxRateText + ' / ' + txRateText)
					]);
					['rx_errors','tx_errors','rx_dropped','tx_dropped'].forEach(function(key, i) { 
						card.appendChild(metric([_('RX errors'),_('TX errors'),_('RX drops'),_('TX drops')][i], value(change(port.stats, before && before.stats, key, dt)))); 
					});
					
					// 添加接口吞吐率趋势图
					card.appendChild(E('div', { 'class': 'fs-chart-panel', style: 'margin-top:10px' }, [
						E('div', { 'class': 'fs-chart-title' }, _('Throughput Trends')),
						E('div', { 'class': 'fs-chart-grid' }, [
							chartCard(_('RX Rate (Mbps)'), 'fc-' + port.device + '-rx'),
							chartCard(_('TX Rate (Mbps)'), 'fc-' + port.device + '-tx')
						])
					]));
					
					interfaces.appendChild(card);
				});
				previous = { time: data.uptime, ports: {} }; (data.interfaces || []).forEach(function(p) { previous.ports[p.device] = p; });
				message.textContent = _('Last update') + ': ' + new Date(data.timestamp * 1000).toLocaleTimeString();
				if (active !== 1 || paused) return;
				return flows().then(function(p) {
					if (!root.isConnected || active !== 1 || paused) return;
					detail.replaceChildren();
					if (!p.available) { detailMessage.textContent = _('PPE data unavailable'); return; }
					detailMessage.textContent = _('Shown / Total') + ': ' + p.entries.length + ' / ' + p.total;
					p.entries.forEach(function(entry) {
						detail.appendChild(E('details', { 'class': 'cbi-section-node fs-card-neutral', style: 'margin-bottom:8px' }, [E('summary', { style: 'cursor:pointer;padding:8px 0' }, entry.index + ' · ' + entry.state + ' · ' + entry.type),
							metric(_('Original Flow'), entry.orig || '—'), metric(_('New Flow'), entry.new_flow || '—')]));
					});
				});
			}).catch(function() {
				if (!root.isConnected) return;
				previous = null; message.textContent = _('Data unavailable; previous readings cleared.');
				[hw,sw,counts,ip,ping,deviation,loss].forEach(function(el) { el.textContent = '—'; }); 
				interfaces.replaceChildren(); detail.replaceChildren(); detailMessage.textContent = _('PPE data unavailable');
			}).finally(function() { pending = null; });
			return pending;
		}
		requestAnimationFrame(function() { 
			if (!root.isConnected) return;
			var resize = new ResizeObserver(drawAllCharts);
			resize.observe(root);
			drawAllCharts();
			update(); 
			poll.add(update, 5); 
		});
		return root;
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});
