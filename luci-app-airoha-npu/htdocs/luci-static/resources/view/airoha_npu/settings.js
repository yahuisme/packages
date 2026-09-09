'use strict';
'require view';
'require form';
'require rpc';
'require ui';

var getStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus', expect: { '': {} }, reject: true });
var getInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getInfo', expect: { '': {} }, reject: true });
var getFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'getFlowOffload', expect: { '': {} }, reject: true });
var setGovernor = rpc.declare({ object: 'luci.airoha_npu', method: 'setGovernor', params: ['governor'], expect: { '': {} }, reject: true });
var setFrequency = rpc.declare({ object: 'luci.airoha_npu', method: 'setMaxFreq', params: ['freq'], expect: { '': {} }, reject: true });
var setFlow = rpc.declare({ object: 'luci.airoha_npu', method: 'setFlowOffload', params: ['enabled'], expect: { '': {} }, reject: true });

var settingsCSS = '\
.npu-settings{--npu-font-ui:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--npu-font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;width:100%;font-family:var(--npu-font-ui);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}\
.npu-settings select,.npu-settings .cbi-input-select{max-width:280px;height:32px;border-radius:4px;font-family:var(--npu-font-mono);font-variant-numeric:tabular-nums;box-sizing:border-box}\
.npu-settings .cbi-section{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:14px;margin:14px 0;box-sizing:border-box}\
.npu-settings .cbi-section-title{font-size:15px;font-weight:600;color:var(--cbi-text-color,inherit);padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0)}\
.npu-settings .cbi-section-descr{font-size:12px;color:var(--cbi-muted-color,#888);margin-bottom:12px}\
.npu-settings .cbi-value{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--cbi-border-color,rgba(128,128,128,.08))}\
.npu-settings .cbi-value:last-child{border-bottom:none}\
.npu-settings .cbi-value-title{width:220px;flex:0 0 220px;margin:0;font-size:13px;font-weight:500;color:var(--cbi-muted-color,#666)}\
.npu-settings .cbi-value-field{flex:1;min-width:0;margin:0}\
@media(max-width:640px){\
.npu-settings .cbi-section{padding:10px}\
.npu-settings .cbi-value{flex-direction:column;align-items:flex-start;gap:4px;padding:8px 0}\
.npu-settings .cbi-value-title{width:auto;flex:none}\
.npu-settings .cbi-value-field{width:100%}\
.npu-settings select,.npu-settings .cbi-input-select{max-width:100%}\
}\
';

function injectCSS() {
	if (document.getElementById('npu-settings-theme-css')) return;
	var el = document.createElement('style');
	el.id = 'npu-settings-theme-css';
	el.textContent = settingsCSS;
	document.head.appendChild(el);
}

function frequency(value) { return typeof value === 'number' && value > 0 ? (value / 1000) + ' MHz' : _('Unknown'); }
function governorLabel(value) {
	var labels = {
		performance: _('Performance'),
		powersave: _('Power saving'),
		schedutil: _('Scheduler utilization'),
		ondemand: _('On demand'),
		conservative: _('Conservative'),
		userspace: _('Userspace')
	};
	return labels[value] || value;
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
		var info = data[0] || {};
		var status = data[1] || {};
		var flow = data[2] || {};

		var words = function(value) { return typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : []; };

		var m, s, o;
		m = new form.JSONMap({}, _('Airoha SoC Settings'),
			_('Configure CPU governor, maximum scaling frequency, and firewall flow offloading.'));

		s = m.section(form.NamedSection, 'cpu', 'cpu', _('Kernel CPU Controls'),
			_('Adjust CPU governor policy and maximum scaling frequency.'));
		s.anonymous = true;

		o = s.option(form.ListValue, 'governor', _('Governor'));
		var govList = words(info.governors).filter(function(v) { return /^[a-zA-Z0-9_-]+$/.test(v); });
		if (!govList.length && status.cpu_governor) govList.push(status.cpu_governor);
		govList.forEach(function(v) {
			o.value(v, governorLabel(v));
		});
		o.default = status.cpu_governor || '';

		o = s.option(form.ListValue, 'frequency', _('Maximum CPU frequency'));
		var freqList = words(info.frequencies).filter(function(v) { return /^[1-9][0-9]{0,9}$/.test(v); });
		if (!freqList.length && status.cpu_max_freq) freqList.push(String(status.cpu_max_freq));
		freqList.forEach(function(v) {
			o.value(v, frequency(Number(v)));
		});
		o.default = status.cpu_max_freq ? String(status.cpu_max_freq) : '';

		s = m.section(form.NamedSection, 'firewall', 'firewall', _('Firewall Flow Offloading'),
			_('Manage hardware PPE and software flow offloading.'));
		s.anonymous = true;

		o = s.option(form.ListValue, 'flow', _('Hardware flow offloading'));
		o.value('0', _('Disabled'));
		o.value('1', _('Enabled'));
		o.default = typeof flow.enabled === 'boolean' ? (flow.enabled ? '1' : '0') : '0';

		function getVal(name, section) {
			var opt = m.lookupOption(name, section);
			return opt && opt[0] ? opt[0].formvalue(section) : null;
		}

		m.save = function() {
			var formGov = getVal('governor', 'cpu');
			var formFreq = getVal('frequency', 'cpu');
			var formFlow = getVal('flow', 'firewall');

			var tasks = [];
			if (formGov && formGov !== String(status.cpu_governor || '')) {
				tasks.push(function() {
					return setGovernor(formGov).then(function(res) {
						if (res && res.result === 'ok') status.cpu_governor = formGov;
						return res;
					});
				});
			}
			if (formFreq && formFreq !== String(status.cpu_max_freq || '')) {
				tasks.push(function() {
					return setFrequency(formFreq).then(function(res) {
						if (res && res.result === 'ok') status.cpu_max_freq = Number(formFreq);
						return res;
					});
				});
			}
			if (formFlow != null && formFlow !== '' && formFlow !== String(flow.enabled ? '1' : '0')) {
				tasks.push(function() {
					return setFlow(formFlow).then(function(res) {
						if (res && res.result === 'ok') flow.enabled = (formFlow === '1');
						return res;
					});
				});
			}

			if (!tasks.length) {
				ui.addNotification(null, E('p', {}, _('No changes to apply.')), 'info');
				return Promise.resolve();
			}

			function executeSequence(idx) {
				if (idx >= tasks.length) return Promise.resolve();
				return tasks[idx]().then(function(res) {
					if (res && res.result !== 'ok') throw new Error(message(res.error));
					return executeSequence(idx + 1);
				});
			}

			return executeSequence(0).then(function() {
				ui.addNotification(null, E('p', {}, _('Settings applied.')), 'info');
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, err.message || message()), 'error');
				return Promise.reject(err);
			});
		};

		return m.render().then(function(node) {
			node.classList.add('npu-settings');
			return node;
		});
	}
});
