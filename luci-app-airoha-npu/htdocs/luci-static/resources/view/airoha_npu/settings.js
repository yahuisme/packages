'use strict';
'require view';
'require form';
'require rpc';
'require ui';

var getStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus', expect: { '': {} }, reject: true });
var getInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getInfo', expect: { '': {} }, reject: true });
var getSettings = rpc.declare({ object: 'luci.airoha_npu', method: 'getSettings', expect: { '': {} }, reject: true });
var saveSettings = rpc.declare({ object: 'luci.airoha_npu', method: 'saveSettings', params: ['governor', 'freq'], expect: { '': {} }, reject: true });
var applySettings = rpc.declare({ object: 'luci.airoha_npu', method: 'applySettings', expect: { '': {} }, reject: true });

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
		write_failed: _('The change failed. Previous settings were restored.'),
		rollback_failed: _('The change failed and recovery could not be verified. Check the system settings.')
	};
	return Object.prototype.hasOwnProperty.call(errors, code) ? errors[code] : _('The operation failed. Refresh the page and try again.');
}

return view.extend({
	handleSaveApply: function(ev) {
		return this.settingsMap.save(true);
	},

	load: function() {
		return Promise.all([getInfo(), getStatus(), getSettings()].map(function(p) {
			return p.catch(function() { return null; });
		}));
	},

	render: function(data) {
		var info = data[0] || {};
		var status = data[1] || {};
		var saved = data[2];
		var baseline = saved && saved.result === 'ok' && saved.pending || {
			governor: status.cpu_governor || '', freq: status.cpu_max_freq ? String(status.cpu_max_freq) : ''
		};

		var words = function(value) { return typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : []; };

		var m, s, o;
		// NamedSection renders only sections present in the JSON data model.
		m = new form.JSONMap({ cpu: {} }, _('Airoha SoC Settings'),
			_('Configure CPU governor and maximum scaling frequency.'));
		m.readonly = !L.hasViewPermission() || !saved || saved.result !== 'ok';
		this.settingsMap = m;
		if (!saved || saved.result !== 'ok')
			ui.addNotification(null, E('p', {}, [message(saved && saved.error)]), 'error');

		s = m.section(form.NamedSection, 'cpu', 'cpu', _('Kernel CPU Controls'),
			_('Adjust CPU governor policy and maximum scaling frequency.'));
		s.anonymous = true;

		o = s.option(form.ListValue, 'governor', _('Governor'));
		var govList = words(info.governors).filter(function(v) { return /^[a-zA-Z0-9_-]+$/.test(v); });
		if (!govList.length && status.cpu_governor) govList.push(status.cpu_governor);
		govList.forEach(function(v) {
			o.value(v, governorLabel(v));
		});
		o.default = baseline.governor;

		o = s.option(form.ListValue, 'frequency', _('Maximum CPU frequency'));
		var freqList = words(info.frequencies).filter(function(v) { return /^[1-9][0-9]{0,9}$/.test(v); });
		if (!freqList.length && status.cpu_max_freq) freqList.push(String(status.cpu_max_freq));
		freqList.forEach(function(v) {
			o.value(v, frequency(Number(v)));
		});
		o.default = baseline.freq;

		function getVal(name, section) {
			var opt = m.lookupOption(name, section);
			return opt && opt[0] ? opt[0].formvalue(section) : null;
		}

		var inFlight = null;
		m.save = function(apply) {
			if (m.readonly || !L.hasViewPermission()) return Promise.resolve();
			if (inFlight) return inFlight;
			var failureMessage = message();
			function fail(code) {
				failureMessage = message(code);
				throw new Error(failureMessage);
			}
			function checked(result) {
				if (!result || result.result !== 'ok') fail(result && result.error);
				return result;
			}
			var desired = { governor: getVal('governor', 'cpu'), freq: getVal('frequency', 'cpu') };
			inFlight = Promise.resolve().then(function() {
				if (govList.indexOf(desired.governor) < 0 || freqList.indexOf(desired.freq) < 0)
					fail('invalid');
				return saveSettings(desired.governor, desired.freq);
			}).then(checked).then(getSettings).then(function(result) {
				checked(result);
				if (!result.pending || result.pending.governor !== desired.governor || result.pending.freq !== desired.freq)
					fail('unavailable');
				baseline = result.pending;
				m.lookupOption('governor', 'cpu')[0].default = baseline.governor;
				m.lookupOption('frequency', 'cpu')[0].default = baseline.freq;
				if (apply !== true) return;
				if (!L.hasViewPermission()) fail('unavailable');
				return applySettings().then(checked).then(getStatus).then(function(current) {
					if (!current || current.cpu_governor !== desired.governor || String(current.cpu_max_freq) !== desired.freq)
						fail('unavailable');
				});
			}).then(function() {
				ui.addNotification(null, E('p', {}, [apply === true ? _('Settings applied.') : _('Settings saved.')]), 'info');
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, [failureMessage]), 'error');
				throw err;
			}).finally(function() { inFlight = null; });
			return inFlight;
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
