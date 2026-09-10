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
.npu-settings select,.npu-settings .cbi-input-select{max-width:280px}\
@media(max-width:640px){.npu-settings select,.npu-settings .cbi-input-select{max-width:100%}}\
';

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
		var info = data[0] || {};
		var status = data[1] || {};
		var flow = data[2] || {};

		var words = function(value) { return typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : []; };

		var m, s, o;
		// NamedSection renders only sections present in the JSON data model.
		m = new form.JSONMap({ cpu: {}, firewall: {} }, _('Airoha SoC Settings'),
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
		o.default = typeof flow.enabled === 'boolean' ? (flow.enabled ? '1' : '0') : '';
		o.readonly = typeof flow.enabled !== 'boolean';
		if (o.readonly) o.value('', _('Unknown'));

		function getVal(name, section) {
			var opt = m.lookupOption(name, section);
			return opt && opt[0] ? opt[0].formvalue(section) : null;
		}

		m.save = function() {
			var formGov = getVal('governor', 'cpu');
			var formFreq = getVal('frequency', 'cpu');
			var formFlow = getVal('flow', 'firewall');
			var tasks = [], applied = [];

			function addTask(next, undo) { tasks.push({ next: next, undo: undo }); }

			if (formGov && formGov !== String(status.cpu_governor || '')) {
				var oldGov = String(status.cpu_governor || '');
				addTask(function() { return setGovernor(formGov); }, function() { return oldGov ? setGovernor(oldGov) : Promise.resolve({ result: 'ok' }); });
			}
			if (formFreq && formFreq !== String(status.cpu_max_freq || '')) {
				var oldFreq = String(status.cpu_max_freq || '');
				addTask(function() { return setFrequency(formFreq); }, function() { return oldFreq ? setFrequency(oldFreq) : Promise.resolve({ result: 'ok' }); });
			}
			if (formFlow != null && formFlow !== '' && formFlow !== String(flow.enabled ? '1' : '0')) {
				if (typeof flow.enabled !== 'boolean') return Promise.reject(new Error(_('Flow offloading state is unknown; refresh before changing it.')));
				var oldFlow = flow.enabled === true ? '1' : '0';
				addTask(function() { return setFlow(formFlow); }, function() { return setFlow(oldFlow); });
			}

			if (!tasks.length) {
				ui.addNotification(null, E('p', {}, _('No changes to apply.')), 'info');
				return Promise.resolve();
			}

			function executeSequence(idx) {
				if (idx >= tasks.length) return Promise.resolve();
				return tasks[idx].next().then(function(res) {
					if (!res || res.result !== 'ok') throw new Error(message(res && res.error));
					applied.push(tasks[idx]);
					return executeSequence(idx + 1);
				});
			}
			function rollback(idx, ok) {
				if (idx < 0) return Promise.resolve(ok);
				return Promise.resolve().then(applied[idx].undo).then(function(res) {
					return rollback(idx - 1, ok && !!(res && res.result === 'ok'));
				}, function() { return rollback(idx - 1, false); });
			}

			return executeSequence(0).then(function() {
				if (formGov && formGov !== String(status.cpu_governor || '')) status.cpu_governor = formGov;
				if (formFreq && formFreq !== String(status.cpu_max_freq || '')) status.cpu_max_freq = Number(formFreq);
				if (formFlow != null && formFlow !== '') flow.enabled = formFlow === '1';
				// Native reset reloads option defaults from this confirmed baseline.
				m.lookupOption('governor', 'cpu')[0].default = status.cpu_governor || '';
				m.lookupOption('frequency', 'cpu')[0].default = status.cpu_max_freq ? String(status.cpu_max_freq) : '';
				m.lookupOption('flow', 'firewall')[0].default = typeof flow.enabled === 'boolean' ? (flow.enabled ? '1' : '0') : '';
				ui.addNotification(null, E('p', {}, _('Settings applied.')), 'info');
			}).catch(function(err) {
				return rollback(applied.length - 1, true).then(function(ok) {
					return Promise.all([getStatus(), getFlow()]).then(function(current) {
						var verified = ok && current[0] && current[1] &&
							current[0].cpu_governor === status.cpu_governor &&
							current[0].cpu_max_freq === status.cpu_max_freq &&
							current[1].enabled === flow.enabled;
						ui.addNotification(null, E('p', {}, message(verified ? 'write_failed' : 'rollback_failed')), 'error');
					}, function() {
						ui.addNotification(null, E('p', {}, message('rollback_failed')), 'error');
					});
				});
			});
		};

		var renderContents = m.renderContents;
		m.renderContents = function() {
			return renderContents.apply(this, arguments).then(function(node) {
				node.classList.add('npu-settings');
				node.prepend(E('style', {}, settingsCSS));
				return node;
			});
		};
		return m.render();
	}
});
