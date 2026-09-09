'use strict';
'require view';
'require rpc';
'require poll';

var getStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus', expect: { '': {} }, reject: true });
var getInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getInfo', expect: { '': {} }, reject: true });
var getFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'getFlowOffload', expect: { '': {} }, reject: true });

var themeCSS = '\
.npu-dashboard{font-size:13px;line-height:1.5}\
.npu-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:8px;margin:12px 0}\
.npu-summary-card,.npu-gauge-card,.npu-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#ddd);border-radius:6px;box-sizing:border-box}\
.npu-summary-card{min-height:72px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center}.npu-card-title,.npu-detail-group-title{font-size:11px;font-weight:500;color:var(--cbi-muted-color,#666);text-transform:uppercase;letter-spacing:.04em}.npu-card-value{display:block;margin-top:3px;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.npu-card-sub{font-size:12px;color:var(--cbi-muted-color,#888)}\
.npu-gauge-card{padding:10px 12px;margin:12px 0}.npu-gauge-row{display:flex;justify-content:space-between;gap:10px;margin-bottom:7px}.npu-gauge-label{font-size:12px}.npu-gauge-value,.npu-detail-value{font-variant-numeric:tabular-nums}.npu-gauge-value{font-size:13px;font-weight:600}.npu-gauge-track{height:6px;border-radius:3px;overflow:hidden;background:var(--cbi-input-bg,#eee)}.npu-gauge-fill{height:100%;border-radius:inherit;background:var(--cbi-link-color,#0ea5e9);transition:width .3s}\
.npu-panel{padding:12px;margin:12px 0}.npu-panel-title{font-size:15px;font-weight:600;padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--cbi-border-color,#ddd)}.npu-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.npu-detail-group-title{margin:10px 0 2px}.npu-detail-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--cbi-border-color,rgba(128,128,128,.12))}.npu-detail-label{color:var(--cbi-muted-color,#666)}.npu-detail-value{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
@media(max-width:760px){.npu-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.npu-detail-grid{grid-template-columns:1fr}}@media(max-width:480px){.npu-summary-grid{grid-template-columns:1fr}.npu-summary-card{min-height:64px}.npu-panel{padding:10px}}\
';

function injectCSS() {
	if (document.getElementById('npu-theme-css')) return;
	var el = document.createElement('style');
	el.id = 'npu-theme-css';
	el.textContent = themeCSS;
	document.head.appendChild(el);
}

function text(value) { return value == null || value === '' ? _('Unknown') : String(value); }
function nodeText(value) { return [text(value)]; }
function frequency(value) { return typeof value === 'number' && value > 0 ? (value / 1000) + ' MHz' : _('Unknown'); }
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
		injectCSS();
		var self = this;
		var info = data[0] || {};
		var status = data[1] || {};
		var flow = data[2] || {};
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

		var gaugeVal = E('span', { id: 'npu-gauge-val', 'class': 'npu-gauge-value' }, '—');
		var gaugeFill = E('div', { id: 'npu-gauge-fill', 'class': 'npu-gauge-fill', 'style': 'width:0%' });

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
			cards.freq.sub.textContent = _('Max limit: ') + maxFreqStr;
			cards.gov.val.textContent = govStr;
			cards.gov.sub.textContent = s.cpu_governor ? s.cpu_governor : '—';
			cards.npu.val.textContent = npuBoundStr;
			cards.npu.sub.textContent = npuClockStr;
			cards.flow.val.textContent = flowStr;
			cards.flow.sub.textContent = _('Hardware flow offload');

			var pct = 0;
			if (typeof s.cpu_cur_freq === 'number' && typeof s.cpu_max_freq === 'number' && s.cpu_max_freq > 0) {
				pct = Math.min(100, Math.max(5, Math.round((s.cpu_cur_freq / s.cpu_max_freq) * 100)));
				gaugeVal.textContent = curFreqStr + ' / ' + maxFreqStr + ' (' + pct + '%)';
			} else {
				gaugeVal.textContent = '—';
			}
			gaugeFill.style.width = pct + '%';

			detailNodes.online.textContent = text(s.cpu_count);
			detailNodes.current.textContent = curFreqStr;
			detailNodes.maximum.textContent = maxFreqStr;
			detailNodes.governor.textContent = govStr;
			detailNodes.driver.textContent = npuBoundStr;
			detailNodes.clock.textContent = npuClockStr;
			detailNodes.offload.textContent = flowDetailStr;
		}

		var page = E('div', { 'class': 'cbi-map npu-dashboard' }, [
			E('div', { 'class': 'cbi-map-descr' }, _('View real-time Airoha SoC frequency, NPU acceleration, and system status.')),
			E('div', { 'class': 'npu-summary-grid' }, [
				summaryCard('freq', _('CPU Frequency'), cards.freq),
				summaryCard('gov', _('Governor'), cards.gov),
				summaryCard('npu', _('NPU Core'), cards.npu),
				summaryCard('flow', _('Flow Offload'), cards.flow)
			]),
			E('div', { 'class': 'npu-gauge-card' }, [
				E('div', { 'class': 'npu-gauge-row' }, [
					E('span', { 'class': 'npu-gauge-label' }, _('CPU Frequency Scaling')),
					gaugeVal
				]),
				E('div', { 'class': 'npu-gauge-track' }, [
					gaugeFill
				])
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

		self.refresh = function() {
			return Promise.all([getStatus(), getFlow()]).then(function(values) {
				if (!self.active) return;
				update(values[0], values[1]);
			}).catch(function() {
				if (!self.active) return;
				update(null, null);
			});
		};

		self.pollFn = function() { return self.refresh(); };
		self.refreshing = false;
		self.pollFn = function() {
			if (self.refreshing) return Promise.resolve();
			self.refreshing = true;
			return self.refresh().finally(function() { self.refreshing = false; });
		};
		self.onHide = self.cleanup.bind(self);
		window.addEventListener('pagehide', self.onHide);

		var mounted = false;
		self.observer = new MutationObserver(function() {
			if (page.isConnected) mounted = true;
			else if (mounted) self.cleanup();
		});
		self.observer.observe(document.body, { childList: true, subtree: true });

		poll.add(self.pollFn, 5);
		return page;
	},

	cleanup: function() {
		this.active = false;
		if (this.pollFn) poll.remove(this.pollFn);
		if (this.observer) this.observer.disconnect();
		if (this.onHide) window.removeEventListener('pagehide', this.onHide);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
