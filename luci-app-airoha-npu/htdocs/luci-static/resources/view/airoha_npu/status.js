'use strict';
'require view';
'require rpc';
'require poll';

var getStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus', expect: { '': {} }, reject: true, nobatch: true });
var getInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getInfo', expect: { '': {} }, reject: true });
var getFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'getFlowOffload', expect: { '': {} }, reject: true });

var themeCSS = '\
.npu-dashboard{font-size:13px;line-height:1.5}\
.npu-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:8px;margin:12px 0}\
.npu-summary-card,.npu-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#ddd);border-radius:6px;box-sizing:border-box}\
.npu-summary-card{min-height:72px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center}.npu-card-title,.npu-detail-group-title{font-size:11px;font-weight:500;color:var(--cbi-muted-color,#666);text-transform:uppercase;letter-spacing:.04em}.npu-card-value{display:block;margin-top:3px;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.npu-card-sub{font-size:12px;color:var(--cbi-muted-color,#888)}\
.npu-dashboard .npu-frequency-chart{margin:16px 0;min-width:0}.npu-dashboard .npu-chart-header{display:flex;justify-content:space-between;gap:8px;font-size:14px;font-weight:500}.npu-dashboard .npu-frequency-chart svg{display:block;width:100%;height:200px;color:inherit}.npu-dashboard .npu-chart-caption{font-size:12px;text-align:center}.npu-dashboard .npu-chart-grid{stroke:currentColor;stroke-width:1;opacity:.12}.npu-dashboard .npu-chart-line{fill:none;stroke:#22a06b;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}.npu-dashboard .npu-chart-point{fill:#22a06b}.npu-dashboard .npu-chart-area{fill:#22a06b;fill-opacity:.10;stroke:none}\
.npu-panel{padding:12px;margin:12px 0}.npu-panel-title{font-size:14px;font-weight:500;padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--cbi-border-color,#ddd)}.npu-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.npu-detail-group-title{margin:10px 0 2px}.npu-detail-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--cbi-border-color,rgba(128,128,128,.12))}.npu-detail-label{color:var(--cbi-muted-color,#666)}.npu-detail-value{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
@media(max-width:760px){.npu-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.npu-detail-grid{grid-template-columns:1fr}}@media(max-width:480px){.npu-summary-grid{grid-template-columns:1fr}.npu-summary-card{min-height:64px}.npu-panel{padding:10px}}\
';


function text(value) { return value == null || value === '' ? _('Unknown') : String(value); }
function nodeText(value) { return [text(value)]; }
function frequency(value) { return typeof value === 'number' && isFinite(value) && value > 0 ? (value / 1000) + ' MHz' : _('Unknown'); }
function governor(value) {
	var labels = {
		performance: _('Performance'),
		powersave: _('Power saving'),
		schedutil: _('Scheduler utilization'),
		ondemand: _('On demand'),
		conservative: _('Conservative'),
		userspace: _('Userspace')
	};
	return labels[value] || text(value);
}

function detailRow(label, valueNode) {
	return E('div', { 'class': 'npu-detail-row' }, [
		E('span', { 'class': 'npu-detail-label' }, label),
		valueNode
	]);
}

return view.extend({
	load: function() {
		return Promise.all([getInfo(), getStatus(), getFlow()].map(function(p) {
			return p.catch(function() { return null; });
		}));
	},

	render: function(data) {
		var self = this;
		var info = data[0] || {};
		var status = data[1] || {};
		var flow = data[2] || {};
		self.cleanup();
		self.active = true;

		var cards = {
			freq: { val: E('span', { 'class': 'npu-card-value' }, '—'), sub: E('span', { 'class': 'npu-card-sub' }, '—') },
			gov:  { val: E('span', { 'class': 'npu-card-value' }, '—'), sub: E('span', { 'class': 'npu-card-sub' }, '—') },
			npu:  { val: E('span', { 'class': 'npu-card-value' }, '—'), sub: E('span', { 'class': 'npu-card-sub' }, '—') },
			flow: { val: E('span', { 'class': 'npu-card-value' }, '—'), sub: E('span', { 'class': 'npu-card-sub' }, '—') }
		};

		function summaryCard(id, title, card) {
			return E('div', { id: 'npu-summary-' + id, 'class': 'npu-summary-card' }, [
				E('div', { 'class': 'npu-card-title' }, title),
				card.val,
				card.sub
			]);
		}

		var samples = [], lastRequest = Date.now(), lastFlowRequest = Date.now(), ceiling = 1000;
		var chartValue = E('span', { id: 'npu-chart-value' }, '—');
		function svgNode(tag, attrs, text) {
			var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
			Object.keys(attrs || {}).forEach(function(key) { node.setAttribute(key, attrs[key]); });
			if (text != null) node.textContent = text;
			return node;
		}
		var chart = svgNode('svg', { role: 'img', 'aria-label': _('CPU Frequency Changes') });
		function drawChart() {
			var now = Date.now();
			samples = samples.filter(function(p) { return p.time >= now - 120000; });
			var width = chart.clientWidth || 600, left = 48, right = width - 16;
			var top = 24, bottom = 168;
			var peak = Math.max(ceiling, 100, ...samples.map(function(p) { return p.value || 0; }));
			var step = Math.ceil(peak / 6 / 100) * 100, max = Math.ceil(peak / step) * step;
			chart.setAttribute('viewBox', '0 0 ' + width + ' 200');
			while (chart.firstChild) chart.removeChild(chart.firstChild);
			chart.appendChild(svgNode('text', { x: left, y: 14, fill: 'currentColor', 'font-size': 12 }, 'MHz'));
			for (var value = 0; value <= max; value += step) {
				var y = bottom - value / max * (bottom - top);
				chart.appendChild(svgNode('line', { x1: left, x2: right, y1: y, y2: y, 'class': 'npu-chart-grid' }));
				chart.appendChild(svgNode('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', fill: 'currentColor', 'font-size': 12 }, value));
			}
			var timeStep = width < 480 ? 30 : width < 800 ? 20 : 15;
			for (var seconds = -120; seconds <= 0; seconds += timeStep) {
				var x = left + (seconds + 120) / 120 * (right - left);
				chart.appendChild(svgNode('line', { x1: x, x2: x, y1: top, y2: bottom, 'class': 'npu-chart-grid' }));
				chart.appendChild(svgNode('text', { x: x, y: 190, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 12 }, seconds + ' s'));
			}
			var path = '', area = '', areaStart = null, areaEnd = null, previous = null;
			function closeArea() {
				if (areaStart != null) area += ' L ' + areaEnd + ' ' + bottom + ' L ' + areaStart + ' ' + bottom + ' Z ';
				areaStart = null;
			}
			samples.forEach(function(p, i) {
				if (p.value == null) { closeArea(); previous = null; return; }
				var x = left + (p.time - (now - 120000)) / 120000 * (right - left);
				var y = bottom - p.value / max * (bottom - top);
				var connected = previous && p.time - previous.time < 4500;
				var next = samples[i + 1];
				// Hold the previous observed value only between healthy readings.
				// The display hold below never appends synthetic samples.
				var segment = connected ? ' H ' + x + ' V ' + y : ' M ' + x + ' ' + y;
				if (!connected) { closeArea(); areaStart = x; }
				path += segment; area += segment; areaEnd = x;
				var isolated = !connected && !(next && next.value != null && next.time - p.time < 4500);
				chart.appendChild(svgNode('circle', { cx: x, cy: y, r: isolated ? 2 : 1, 'class': 'npu-chart-point', 'data-time': p.time, 'data-mhz': p.value }));
				previous = p;
			});
			if (previous && now - previous.time <= 3000) { path += ' H ' + right; area += ' H ' + right; areaEnd = right; }
			closeArea();
			chart.insertBefore(svgNode('path', { d: area, 'class': 'npu-chart-area' }), chart.firstChild);
			chart.appendChild(svgNode('path', { d: path, 'class': 'npu-chart-line', 'vector-effect': 'non-scaling-stroke' }));
		}
		function sample(s) {
			var value = s && s.cpu_cur_freq;
			value = typeof value === 'number' && isFinite(value) && value > 0 ? value / 1000 : null;
			if (s && typeof s.cpu_max_freq === 'number' && isFinite(s.cpu_max_freq) && s.cpu_max_freq > 0)
				ceiling = s.cpu_max_freq / 1000;
			samples.push({ time: Date.now(), value: value });
			chartValue.textContent = value == null ? _('Unknown') : value + ' MHz';
			drawChart();
		}

		var detailNodes = {
			soc: E('span', { id: 'npu-soc', 'class': 'npu-detail-value' }, nodeText(info.soc_compat)),
			online: E('span', { id: 'npu-online', 'class': 'npu-detail-value' }, nodeText(status.cpu_count)),
			current: E('span', { id: 'npu-current', 'class': 'npu-detail-value' }, frequency(status.cpu_cur_freq)),
			maximum: E('span', { id: 'npu-maximum', 'class': 'npu-detail-value' }, frequency(status.cpu_max_freq)),
			governor: E('span', { id: 'npu-governor', 'class': 'npu-detail-value' }, governor(status.cpu_governor)),
			driver: E('span', { id: 'npu-driver', 'class': 'npu-detail-value' }, '—'),
			clock: E('span', { id: 'npu-clock', 'class': 'npu-detail-value' }, '—'),
			version: E('span', { id: 'npu-version', 'class': 'npu-detail-value' }, nodeText(info.firmware_file_version)),
			firmware: E('span', { id: 'npu-firmware', 'class': 'npu-detail-value' }, nodeText(info.firmware_file)),
			offload: E('span', { id: 'npu-offload', 'class': 'npu-detail-value' }, '—')
		};

		function update(s, f) {
			if (!self.active) return;
			s = s || {};
			f = f || {};

			var curFreqStr = frequency(s.cpu_cur_freq);
			var maxFreqStr = frequency(s.cpu_max_freq);
			var govStr = governor(s.cpu_governor);
			var npuClockStr = typeof s.npu_clock === 'number' && s.npu_clock > 0 ? (s.npu_clock / 1000000) + ' MHz' : _('Unknown');
			var npuBoundStr = s.npu_bound === true ? _('Bound') : s.npu_bound === false ? _('Not bound') : _('Unknown');
			var flowStr = f.enabled === true ? _('Enabled') : f.enabled === false ? _('Disabled') : _('Unknown');
			var flowDetailStr = f.enabled === true ? _('Enabled in firewall') : f.enabled === false ? _('Disabled in firewall') : _('Unknown');

			cards.freq.val.textContent = curFreqStr;
			cards.freq.sub.textContent = _('Max limit:') + ' ' + maxFreqStr;
			cards.gov.val.textContent = govStr;
			cards.gov.sub.textContent = s.cpu_governor ? s.cpu_governor : '—';
			cards.npu.val.textContent = npuBoundStr;
			cards.npu.sub.textContent = npuClockStr;
			cards.flow.val.textContent = flowStr;
			cards.flow.sub.textContent = _('Hardware flow offload');


			detailNodes.online.textContent = text(s.cpu_count);
			detailNodes.current.textContent = curFreqStr;
			detailNodes.maximum.textContent = maxFreqStr;
			detailNodes.governor.textContent = govStr;
			detailNodes.driver.textContent = npuBoundStr;
			detailNodes.clock.textContent = npuClockStr;
			detailNodes.offload.textContent = flowDetailStr;
		}

		var page = E('div', { 'class': 'cbi-map npu-dashboard' }, [
			E('style', {}, themeCSS),
			E('div', { 'class': 'cbi-map-descr' }, _('View real-time Airoha SoC frequency, NPU acceleration, and system status.')),
			E('div', { 'class': 'npu-summary-grid' }, [
				summaryCard('freq', _('CPU Frequency'), cards.freq),
				summaryCard('gov', _('Governor'), cards.gov),
				summaryCard('npu', _('NPU Core'), cards.npu),
				summaryCard('flow', _('Flow Offload'), cards.flow)
			]),
			E('div', { 'class': 'npu-frequency-chart' }, [
				E('div', { 'class': 'npu-chart-header' }, [
					E('span', {}, _('CPU Frequency Changes')), chartValue
				]),
				chart,
				E('div', { 'class': 'npu-chart-caption' }, _('Last 120 seconds'))
			]),
			E('div', { 'class': 'npu-panel' }, [
				E('div', { 'class': 'npu-panel-title' }, _('SoC & NPU Details')),
				E('div', { 'class': 'npu-detail-grid' }, [
					E('div', { 'class': 'npu-detail-group' }, [
						E('div', { 'class': 'npu-detail-group-title' }, _('SoC & CPU Architecture')),
						detailRow(_('SoC Compatible'), detailNodes.soc),
						detailRow(_('Online CPUs'), detailNodes.online),
						detailRow(_('Current Frequency'), detailNodes.current),
						detailRow(_('Frequency Limit'), detailNodes.maximum),
						detailRow(_('Current Governor'), detailNodes.governor)
					]),
					E('div', { 'class': 'npu-detail-group' }, [
						E('div', { 'class': 'npu-detail-group-title' }, _('NPU & Acceleration Engine')),
						detailRow(_('Driver Binding'), detailNodes.driver),
						detailRow(_('Clock Rate'), detailNodes.clock),
						detailRow(_('Firmware Version'), detailNodes.version),
						detailRow(_('Firmware File'), detailNodes.firmware),
						detailRow(_('Hardware PPE Offload'), detailNodes.offload)
					])
				])
			])
		]);

		update(status, flow);
		sample(status);

		var statusPending = false, flowPending = false;
		self.pollFn = function() {
			if (!self.active || !page.isConnected) return Promise.resolve();
			drawChart();
			// Firewall state has its own single-flight guard. Do not return its
			// promise to LuCI poll: a held sibling must not suspend CPU sampling.
			if (!flowPending && Date.now() - lastFlowRequest >= 6000) {
				lastFlowRequest = Date.now(); flowPending = true;
				getFlow().catch(function() { return null; }).then(function(f) {
					if (!self.active || !page.isConnected) return;
					flow = f; update(status, flow);
				}).finally(function() { flowPending = false; });
			}
			if (statusPending || Date.now() - lastRequest < 3000) return Promise.resolve();
			lastRequest = Date.now(); statusPending = true;
			return getStatus().catch(function() { return null; }).then(function(s) {
				if (!self.active || !page.isConnected) return;
				status = s; update(status, flow); sample(status);
			}).finally(function() { statusPending = false; });
		};
		// Age the window even if a transport stalls; no synthetic samples.
		self.chartTimer = window.setInterval(drawChart, 1000);
		self.onHide = self.cleanup.bind(self);
		window.addEventListener('pagehide', self.onHide);

		var mounted = false;
		self.observer = new MutationObserver(function() {
			if (page.isConnected) mounted = true;
			else if (mounted) self.cleanup();
		});
		self.observer.observe(document.body, { childList: true, subtree: true });

		// Check the 3s CPU deadline each second; refresh firewall state at 6s.
		// A slightly early tick must not skip a whole sampling slot.
		poll.add(self.pollFn, 1);
		return page;
	},

	cleanup: function() {
		this.active = false;
		if (this.chartTimer != null) window.clearInterval(this.chartTimer);
		this.chartTimer = null;
		if (this.pollFn) poll.remove(this.pollFn);
		if (this.observer) this.observer.disconnect();
		if (this.onHide) window.removeEventListener('pagehide', this.onHide);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
