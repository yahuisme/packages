'use strict';
'require view';
'require rpc';
'require ui';
'require form';

var getOverview = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getOverview', reject: true });
var getSettings = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getSettings', reject: true });
var saveSettings = rpc.declare({ object: 'luci.airoha_flowsense', method: 'saveSettings', params: ['hardware', 'vlan', 'pppoe', 'ap', 'target', 'enabled'], reject: true });
var applySettings = rpc.declare({ object: 'luci.airoha_flowsense', method: 'applySettings', reject: true });
// Acceleration RPC contract: each key is {supported, enabled, configured},
// strictly boolean or null. enabled is runtime readback, configured is the edit
// baseline. Setter parameters are 0/1, or -1 to leave unknown/unsupported keys alone.
var accelerationKeys = ['hardware', 'vlan', 'pppoe', 'ap'];
var getAcceleration = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getAcceleration', reject: true });

function text(value) { return typeof value === 'string' ? value : ''; }
function validTarget(value) {
	value = text(value).trim();
	if (!value || value.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(value)) return false;
	if (/^[0-9.]+$/.test(value)) {
		var parts = value.split('.');
		return parts.length === 4 && parts.every(function(part) { return /^(0|[1-9][0-9]*)$/.test(part) && +part <= 255; });
	}
	return value.split('.').every(function(part) { return part.length <= 63 && /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(part); });
}


return view.extend({
	handleSave: function() { return this.saveSettings(false); },
	handleSaveApply: function() { return this.saveSettings(true); },
	handleReset: function() { return this.resetSettings(); },
	load: function() { return Promise.all([getOverview().catch(function() { return null; }), getAcceleration().catch(function() { return null; }), getSettings().catch(function() { return null; })]); },

	render: function(initial) {
		var self = this, saved = Array.isArray(initial) ? initial[2] : null;
		var baseline = saved && saved.success === true ? saved.pending : null;
		var settingsReady = !!(saved && saved.success === true), monitorState = null;
		var initialAcceleration = Array.isArray(initial) ? initial[1] : null;
		initial = Array.isArray(initial) ? initial[0] : initial;
		var root, target, enabled, accelerationInputs = {}, accelerationState = initialAcceleration || {};
		var accelerationSaving = false, dirty = false, accelerationDirty = {};
		var m = new form.JSONMap({ acceleration: {}, monitor: {} }, _('Airoha FlowSense'), _('Configure acceleration and periodic probes.'));
		m.readonly = !settingsReady || !L.hasViewPermission();
		var section = m.section(form.NamedSection, 'acceleration', 'acceleration', _('Acceleration'));
		var labels = [_('Hardware acceleration'), _('VLAN acceleration'), _('PPPoE acceleration'), _('Bridge compatibility mode')];
		accelerationKeys.forEach(function(key, i) {
			var o = section.option(form.Flag, key, labels[i]);
			o.default = editable(key) && (baseline && baseline[key] !== -1 ? baseline[key] === 1 : accelerationState[key].configured) ? '1' : '0';
			o.readonly = m.readonly || !editable(key);
			o.description = !editable(key) ? _('Unknown') : null;
			o.rmempty = false;
		});
		section = m.section(form.NamedSection, 'monitor', 'monitor', _('Probe Settings'));
		var o = section.option(form.Value, 'target', _('IPv4 address or hostname'));
		o.default = baseline && baseline.enabled !== -1 ? baseline.target : initial && initial.monitor && initial.monitor.target || '';
		o = section.option(form.Flag, 'enabled', _('Enable periodic probes'));
		o.default = (baseline && baseline.enabled !== -1 ? baseline.enabled === 1 : initial && initial.monitor && initial.monitor.enabled) ? '1' : '0';
		o.rmempty = false;
		function editable(key) {
			var state = accelerationState[key];
			return state && state.supported === true && typeof state.enabled === 'boolean' && typeof state.configured === 'boolean';
		}
		function lockAcceleration() {
			accelerationKeys.forEach(function(key) { accelerationInputs[key].disabled = accelerationSaving || !settingsReady || !L.hasViewPermission() || !editable(key); });
			target.disabled = enabled.disabled = accelerationSaving || !settingsReady || !L.hasViewPermission() || !monitorState;
		}
		function paintAcceleration(data, reset) {
			accelerationKeys.forEach(function(key) {
				var value = data && data[key] || {};
				var state = accelerationState[key] = {};
				['supported', 'enabled', 'configured'].forEach(function(field) { state[field] = typeof value[field] === 'boolean' ? value[field] : null; });
				accelerationInputs[key].title = state.supported === false ? _('Unsupported') : !editable(key) ? _('Unknown') : '';
				if (reset || !accelerationDirty[key] || !editable(key)) { accelerationInputs[key].checked = !!(editable(key) && (baseline && baseline[key] !== -1 ? baseline[key] === 1 : state.configured)); accelerationInputs[key].indeterminate = !editable(key); accelerationDirty[key] = false; }
			});
			lockAcceleration();
		}
		self.resetSettings = function() {
			if (accelerationSaving || !L.hasViewPermission()) return;
			dirty = false; accelerationDirty = {};
			paintAcceleration(accelerationState, true);
			paintMonitor();
		};
		function paintMonitor() {
			if (!dirty && monitorState) {
				target.value = baseline && baseline.enabled !== -1 ? baseline.target : monitorState.target;
				enabled.checked = baseline && baseline.enabled !== -1 ? baseline.enabled === 1 : monitorState.enabled;
			}
			lockAcceleration();
		}
		self.saveSettings = function(apply) {
			if (accelerationSaving || !settingsReady || !root.isConnected || !L.hasViewPermission()) return Promise.resolve();
			if (baseline && (accelerationKeys.some(function(key) { return baseline[key] !== -1 && !editable(key); }) || baseline.enabled !== -1 && !monitorState)) {
				ui.addNotification(null, E('p', {}, _('Unable to verify saved settings.')), 'error');
				return Promise.resolve();
			}
			if (monitorState && !validTarget(target.value)) {
				ui.addNotification(null, E('p', {}, _('Enter a valid IPv4 address or hostname.')), 'error');
				return Promise.resolve();
			}
			var values = accelerationKeys.map(function(key) { return editable(key) && (baseline && baseline[key] !== -1 || accelerationInputs[key].checked !== accelerationState[key].configured || accelerationState[key].enabled !== accelerationState[key].configured) ? +accelerationInputs[key].checked : -1; });
			var desired = {};
			accelerationKeys.forEach(function(key, i) { desired[key] = values[i]; });
			var monitorChanged = monitorState && (baseline && baseline.enabled !== -1 || target.value.trim() !== monitorState.target || enabled.checked !== monitorState.enabled);
			desired.target = monitorChanged ? target.value.trim() : '';
			desired.enabled = monitorChanged ? +enabled.checked : -1;
			accelerationSaving = true; lockAcceleration();
			return Promise.resolve().then(function() {
				if (!root.isConnected || !L.hasViewPermission()) throw new Error(_('Unable to save settings.'));
				return saveSettings.apply(null, values.concat([desired.target, desired.enabled]));
			}).then(function(result) {
				if (!result || result.success !== true) throw new Error(_('Unable to save settings.'));
				return getSettings();
			}).then(function(result) {
				if (!result || result.success !== true || !result.pending || !Object.keys(desired).every(function(key) { return result.pending[key] === desired[key]; }))
					throw new Error(_('Unable to verify saved settings.'));
				baseline = result.pending; dirty = false; accelerationDirty = {};
				if (!apply) { ui.addNotification(null, E('p', {}, _('Settings saved; not yet applied.')), 'info'); return; }
				if (!root.isConnected || !L.hasViewPermission()) throw new Error(_('Unable to save settings.'));
				return applySettings().then(function(result) {
					return Promise.all([getAcceleration(), getOverview(), getSettings()].map(function(request) { return request.catch(function() { return null; }); })).then(function(data) {
						if (!root.isConnected) return;
						paintAcceleration(data[0], true); paint(data[1]);
						if (!data[2] || data[2].success !== true) throw new Error(_('Unable to verify saved settings.'));
						baseline = data[2].pending;
						paintAcceleration(data[0], true); paint(data[1]);
						var accOK = accelerationKeys.every(function(key) { return desired[key] === -1 || editable(key) && accelerationState[key].configured === !!desired[key] && accelerationState[key].enabled === !!desired[key]; });
						var monOK = desired.enabled === -1 || monitorState && monitorState.target === desired.target && monitorState.enabled === !!desired.enabled;
						if (!result || result.success !== true || !accOK || !monOK || baseline) {
							ui.addNotification(null, E('p', {}, [
								_('Acceleration') + ': ' + (result && result.acceleration === 'unchanged' && accOK ? _('Unchanged') : result && result.acceleration === 'applied' && accOK ? _('Applied') : _('Not verified; check current settings.')) + (result && result.acceleration_error ? ' (' + result.acceleration_error + ')' : '') + '; ' +
								_('Probe Settings') + ': ' + (result && result.monitor === 'unchanged' && monOK ? _('Unchanged') : result && result.monitor === 'applied' && monOK ? _('Applied') : _('Not verified; check current settings.')) + (result && result.monitor_error ? ' (' + result.monitor_error + ')' : '')
							]), 'error'); return;
						}
						ui.addNotification(null, E('p', {}, _('Settings saved and applied.')), 'info');
					});
				});
			}).catch(function(error) {
				if (root.isConnected) ui.addNotification(null, E('p', {}, [error.message]), 'error');
			}).finally(function() { accelerationSaving = false; if (root.isConnected) lockAcceleration(); });
		};
		function paint(data) {
			monitorState = data && data.monitor && validTarget(data.monitor.target) && typeof data.monitor.enabled === 'boolean' ? data.monitor : null;
			paintMonitor();
		}
		return m.render().then(function(node) {
			root = node; root.classList.add('flowsense-settings');
			accelerationKeys.forEach(function(key) { accelerationInputs[key] = root.querySelector('[data-name="' + key + '"] input[type="checkbox"]'); accelerationInputs[key].addEventListener('change', function() { accelerationDirty[key] = true; }); });
			target = root.querySelector('[data-name="target"] input[type="text"]');
			enabled = root.querySelector('[data-name="enabled"] input[type="checkbox"]');
			target.addEventListener('input', function() { dirty = true; }); enabled.addEventListener('change', function() { dirty = true; });
			paint(initial); paintAcceleration(initialAcceleration, true);
			return root;
		});
	}
});

