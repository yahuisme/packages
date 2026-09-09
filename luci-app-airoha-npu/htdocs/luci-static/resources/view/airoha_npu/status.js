'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var getStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus', expect: { '': {} }, reject: true });
var getInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getInfo', expect: { '': {} }, reject: true });
var getFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'getFlowOffload', expect: { '': {} }, reject: true });
var setGovernor = rpc.declare({ object: 'luci.airoha_npu', method: 'setGovernor', params: ['governor'], expect: { '': {} }, reject: true });
var setFrequency = rpc.declare({ object: 'luci.airoha_npu', method: 'setMaxFreq', params: ['freq'], expect: { '': {} }, reject: true });
var setFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'setFlowOffload', params: ['enabled'], expect: { '': {} }, reject: true });

var themeCSS = '\
.npu-dashboard{--npu-font-ui:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--npu-font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-family:var(--npu-font-ui);font-size:13px;line-height:1.5;color:var(--cbi-text-color,inherit);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}\
.npu-notice{font-size:12px;color:var(--cbi-muted-color,#888);margin:-4px 0 14px;min-height:18px;font-variant-numeric:tabular-nums}\
.npu-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin-bottom:14px}\
.npu-summary-card{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:10px 14px;min-height:76px;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box}\
.npu-card-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.5px;color:var(--cbi-muted-color,#666);margin-bottom:4px}\
.npu-card-value{font-size:18px;font-family:var(--npu-font-mono);font-variant-numeric:tabular-nums;font-weight:600;color:var(--cbi-text-color,inherit)}\
.npu-card-sub{font-size:12px;color:var(--cbi-muted-color,#888);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.npu-dashboard .cbi-section{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:14px;margin:14px 0}\
.npu-dashboard .cbi-section-title{font-size:15px;font-weight:600;color:var(--cbi-text-color,inherit);padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0)}\
.npu-dashboard .cbi-section-descr{font-size:12px;color:var(--cbi-muted-color,#888);margin-bottom:12px}\
.npu-dashboard .cbi-value{display:flex;align-items:center;padding:6px 0;border-bottom:1px solid var(--cbi-border-color,rgba(128,128,128,.08))}\
.npu-dashboard .cbi-value:last-child{border-bottom:none}\
.npu-dashboard .cbi-value-title{width:220px;flex:0 0 220px;margin:0;font-size:13px;font-weight:500;color:var(--cbi-muted-color,#666)}\
.npu-dashboard .cbi-value-field{flex:1;display:flex;align-items:center;gap:8px;min-width:0;margin:0}\
.npu-dashboard .cbi-value-field span{font-family:var(--npu-font-mono);font-variant-numeric:tabular-nums}\
.npu-dashboard select{width:16em;max-width:240px;height:32px;border-radius:4px;font-family:var(--npu-font-mono);font-variant-numeric:tabular-nums}\
.npu-dashboard .cbi-button{height:32px;padding:0 16px;border-radius:4px;font-size:12px;font-weight:500;margin:0}\
@media(max-width:1050px){.npu-summary-grid{grid-template-columns:repeat(2,minmax(150px,1fr))}}\
@media(max-width:640px){.npu-summary-grid{grid-template-columns:1fr}.npu-summary-card{min-height:68px}.npu-dashboard .cbi-value{flex-direction:column;align-items:flex-start;gap:4px;padding:8px 0}.npu-dashboard .cbi-value-title{width:auto;flex:none}.npu-dashboard .cbi-value-field{width:100%;flex-wrap:wrap}}\
';

function injectCSS() {
	if (document.getElementById('npu-theme-css')) return;
	var el = document.createElement('style');
	el.id = 'npu-theme-css';
	el.textContent = themeCSS;
	document.head.appendChild(el);
}

function text(value) { return value == null || value === '' ? _('Unknown') : String(value); }
function frequency(value) { return typeof value === 'number' && value > 0 ? (value / 1000) + ' MHz' : _('Unknown'); }
function governor(value) {
	var labels = { performance: _('Performance'), powersave: _('Power saving'), schedutil: _('Scheduler utilization'), ondemand: _('On demand'), conservative: _('Conservative'), userspace: _('Userspace') };
	return labels[value] || text(value);
}
function row(label, node) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title', 'for': node.id }, label),
		E('div', { 'class': 'cbi-value-field' }, node)
	]);
}
function message(code) {
	var errors = {
		invalid: _('The requested value is not supported by the kernel or is invalid.'),
		busy: _('Another operation is in progress. Retry later.'),
		unavailable: _('The required system interface is unavailable.'),
		pending_changes: _('Apply or revert pending firewall changes first.'),
		write_failed: _('The change failed. Previous settings were restored.'),
		rollback_failed: _('The change failed and recovery could not be verified. Check the system settings.')
	};
	return errors[code] || _('The operation failed. Refresh the page and try again.');
}

return view.extend({
	load: function() {
		return Promise.all([getInfo(), getStatus(), getFlow()].map(function(p) {
			return p.catch(function() { return null; });
		}));
	},
	render: function(data) {
		injectCSS();
		var self = this, info = data[0] || {}, status = data[1] || {}, flow = data[2] || {};
		self.active = true;
		var metrics = {};
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

		function metric(id, label, value) {
			metrics[id] = E('span', { id: 'npu-' + id, style: 'overflow-wrap:anywhere' }, text(value));
			return row(label, metrics[id]);
		}
		function control(id, label, options, value, call) {
			var select = E('select', { id: 'npu-' + id, name: 'npu-' + id, 'class': 'cbi-input-select' },
				[E('option', { value: '' }, _('Select a value'))].concat(options.map(function(o) { return E('option', { value: o[0] }, o[1]); })));
			select.value = value == null ? '' : String(value);
			select.disabled = !L.hasViewPermission() || !options.length;
			var button = E('button', { 'class': 'cbi-button cbi-button-apply', type: 'button', click: function() {
				if (!select.value || self.saving) return;
				self.saving = true; button.disabled = true;
				return call(select.value).then(function(result) {
					if (result.result !== 'ok') throw new Error(message(result.error));
					ui.addNotification(null, E('p', {}, _('Settings applied.')), 'info');
					return self.refresh();
				}).catch(function(error) {
					ui.addNotification(null, E('p', {}, error.message || message()), 'error');
				}).finally(function() { self.saving = false; button.disabled = select.disabled; });
			} }, _('Apply'));
			button.disabled = select.disabled;
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': select.id }, label),
				E('div', { 'class': 'cbi-value-field' }, [select, button])
			]);
		}
		var notice = E('div', { 'class': 'npu-notice', role: 'status' }, '');
		function update(s, f) {
			if (!self.active) return;
			s = s || {}; f = f || {};
			var curFreqStr = frequency(s.cpu_cur_freq);
			var maxFreqStr = frequency(s.cpu_max_freq);
			var govStr = governor(s.cpu_governor);
			var npuClockStr = typeof s.npu_clock === 'number' && s.npu_clock > 0 ? (s.npu_clock / 1000000) + ' MHz' : _('Unknown');
			var npuBoundStr = s.npu_bound === true ? _('Bound') : s.npu_bound === false ? _('Not bound') : _('Unknown');
			var flowStr = f.enabled === true ? _('Enabled') : f.enabled === false ? _('Disabled') : _('Unknown');

			metrics.current.textContent = curFreqStr;
			metrics.maximum.textContent = maxFreqStr;
			metrics.governor.textContent = govStr;
			metrics.online.textContent = text(s.cpu_count);
			metrics.clock.textContent = npuClockStr;
			metrics.driver.textContent = s.npu_bound === true ? _('Bound') : s.npu_bound === false ? _('Not bound') : _('Unknown');
			metrics.offload.textContent = f.enabled === true ? _('Enabled in firewall configuration') : f.enabled === false ? _('Disabled in firewall configuration') : _('Unknown');

			cards.freq.val.textContent = curFreqStr;
			cards.freq.sub.textContent = _('Max limit: ') + maxFreqStr;
			cards.gov.val.textContent = govStr;
			cards.gov.sub.textContent = s.cpu_governor ? s.cpu_governor : '—';
			cards.npu.val.textContent = npuBoundStr;
			cards.npu.sub.textContent = npuClockStr;
			cards.flow.val.textContent = flowStr;
			cards.flow.sub.textContent = _('Hardware flow offload');
		}
		var words = function(value) { return typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : []; };
		var page = E('div', { 'class': 'cbi-map npu-dashboard' }, [
			E('h2', {}, _('Airoha SoC Status')),
			notice,
			E('div', { 'class': 'npu-summary-grid' }, [
				summaryCard('freq', _('CPU Frequency'), cards.freq),
				summaryCard('gov', _('Governor'), cards.gov),
				summaryCard('npu', _('NPU Core'), cards.npu),
				summaryCard('flow', _('Flow Offload'), cards.flow)
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', { 'class': 'cbi-section-title' }, _('SoC & NPU Details')),
				metric('soc', _('SoC compatible'), info.soc_compat),
				metric('driver', _('NPU driver binding')),
				metric('clock', _('NPU clock')),
				metric('firmware', _('Firmware file'), info.firmware_file),
				metric('version', _('Firmware file version'), info.firmware_file_version),
				metric('online', _('Online CPUs')),
				metric('current', _('CPU current frequency')),
				metric('maximum', _('CPU frequency limit')),
				metric('governor', _('CPU governor')),
				metric('offload', _('Hardware flow offloading configuration'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', { 'class': 'cbi-section-title' }, _('Kernel CPU controls')),
				E('div', { 'class': 'cbi-section-descr' }, _('Adjust CPU governor and maximum scaling frequency.')),
				control('governor-setting', _('Governor'), words(info.governors).filter(function(v) { return /^[a-zA-Z0-9_-]+$/.test(v); }).map(function(v) { return [v, governor(v)]; }), status.cpu_governor, setGovernor),
				control('frequency', _('Maximum CPU frequency'), words(info.frequencies).filter(function(v) { return /^[1-9][0-9]{0,9}$/.test(v); }).map(function(v) { return [v, frequency(Number(v))]; }), status.cpu_max_freq, setFrequency)
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', { 'class': 'cbi-section-title' }, _('Firewall flow offloading')),
				E('div', { 'class': 'cbi-section-descr' }, _('Manage hardware PPE and software flow offloading.')),
				control('flow', _('Hardware flow offloading'), [['0', _('Disabled')], ['1', _('Enabled')]], typeof flow.enabled === 'boolean' ? (flow.enabled ? '1' : '0') : '', setFlow)
			])
		]);
		update(status, flow);
		if (data.some(function(v) { return !v; })) notice.textContent = _('Status unavailable or stale. Refresh to retry static information.');
		self.refresh = function() {
			return Promise.all([getStatus(), getFlow()]).then(function(values) {
				if (!self.active) return;
				update(values[0], values[1]);
				notice.textContent = data[0] ? _('Last updated') + ': ' + new Date().toLocaleTimeString() : _('Status unavailable or stale. Refresh to retry static information.');
			}).catch(function() {
				if (!self.active) return;
				update(null, null);
				notice.textContent = _('Status unavailable or stale. Refresh to retry static information.');
			});
		};
		self.pollFn = function() { return self.saving ? Promise.resolve() : self.refresh(); };
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
