'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var getStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus', expect: { '': {} }, raise: true });
var getInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getInfo', expect: { '': {} }, raise: true });
var getFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'getFlowOffload', expect: { '': {} }, raise: true });
var setGovernor = rpc.declare({ object: 'luci.airoha_npu', method: 'setGovernor', params: ['governor'], expect: { '': {} }, raise: true });
var setFrequency = rpc.declare({ object: 'luci.airoha_npu', method: 'setMaxFreq', params: ['freq'], expect: { '': {} }, raise: true });
var setFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'setFlowOffload', params: ['enabled'], expect: { '': {} }, raise: true });

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
		var self = this, info = data[0] || {}, status = data[1] || {}, flow = data[2] || {};
		self.active = true;
		var metrics = {};
		function metric(id, label, value) {
			metrics[id] = E('span', { id: 'npu-' + id, style: 'overflow-wrap:anywhere' }, text(value));
			return row(label, metrics[id]);
		}
		function control(id, label, options, value, call) {
			var select = E('select', { id: 'npu-' + id, name: 'npu-' + id, 'class': 'cbi-input-select', style: 'width:16em;max-width:100%' },
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
				E('div', { 'class': 'cbi-value-field' }, [select, ' ', button])
			]);
		}
		var notice = E('p', { role: 'status' }, '');
		function update(s, f) {
			if (!self.active) return;
			s = s || {}; f = f || {};
			metrics.current.textContent = frequency(s.cpu_cur_freq);
			metrics.maximum.textContent = frequency(s.cpu_max_freq);
			metrics.governor.textContent = governor(s.cpu_governor);
			metrics.online.textContent = text(s.cpu_count);
			metrics.clock.textContent = typeof s.npu_clock === 'number' && s.npu_clock > 0 ? (s.npu_clock / 1000000) + ' MHz' : _('Unknown');
			metrics.driver.textContent = s.npu_bound === true ? _('Bound (not a health check)') : s.npu_bound === false ? _('Not bound') : _('Unknown');
			metrics.offload.textContent = f.enabled === true ? _('Enabled in firewall configuration') : f.enabled === false ? _('Disabled in firewall configuration') : _('Unknown');
		}
		var words = function(value) { return typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : []; };
		var page = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Airoha SoC Status')),
			notice,
			E('div', { 'class': 'cbi-section' }, [
				metric('soc', _('SoC compatible (device tree)'), info.soc_compat),
				metric('driver', _('NPU driver binding')),
				metric('clock', _('NPU clock')),
				metric('firmware', _('Firmware file (device tree)'), info.firmware_file),
				metric('version', _('Firmware file version (not running version)'), info.firmware_file_version),
				metric('online', _('Online CPUs')),
				metric('current', _('CPU current frequency (cpufreq)')),
				metric('maximum', _('CPU frequency limit (cpufreq)')),
				metric('governor', _('CPU governor')),
				metric('offload', _('Hardware flow offloading configuration'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Kernel CPU controls')),
				E('p', {}, _('Only kernel-supported values are offered. The frequency limit is not a fixed clock. CPU changes last until reboot or another service changes them.')),
				control('governor-setting', _('Governor'), words(info.governors).filter(function(v) { return /^[a-zA-Z0-9_-]+$/.test(v); }).map(function(v) { return [v, governor(v)]; }), status.cpu_governor, setGovernor),
				control('frequency', _('Maximum CPU frequency'), words(info.frequencies).filter(function(v) { return /^[1-9][0-9]{0,9}$/.test(v); }).map(function(v) { return [v, frequency(Number(v))]; }), status.cpu_max_freq, setFrequency)
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Firewall flow offloading')),
				E('p', {}, _('Sets software and hardware flow offloading together and reloads the firewall. This may interrupt connections. Bridge filtering is not an offload switch; configure AP networking in the native network settings and follow your firmware documentation.')),
				control('flow', _('Hardware flow offloading'), [['0', _('Disabled')], ['1', _('Enabled')]], typeof flow.enabled === 'boolean' ? (flow.enabled ? '1' : '0') : '', setFlow),
				E('a', { href: L.url('admin/network/network') }, _('Network settings')),
				E('p', {}, _('Inspect PPE flows in Airoha FlowSense, if installed.'))
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
