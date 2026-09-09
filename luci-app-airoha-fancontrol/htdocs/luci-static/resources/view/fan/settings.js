'use strict';
'require view';
'require form';
'require uci';

function validPoints(points) {
	var previousTemp = -1, previousPwm = 0;
	return Array.isArray(points) && points.length === 5 && points.every(function(point, index) {
		if (!point || !/^(0|[1-9][0-9]*)$/.test(point.temp) || !/^(0|[1-9][0-9]*)$/.test(point.pwm) ||
			+point.temp > 100 || +point.pwm > 255 || +point.temp <= previousTemp || +point.pwm < previousPwm ||
			(index === 4 && +point.pwm !== 255)) return false;
		previousTemp = +point.temp;
		previousPwm = +point.pwm;
		return true;
	});
}

function curvePreview() {
	return '<div class="fan-curve-preview"><svg viewBox="0 0 400 160" role="img" aria-label="' + _('Curve preview') + '">' +
		'<line x1="32" y1="12" x2="32" y2="132" stroke="currentColor" stroke-opacity=".35"/>' +
		'<line x1="32" y1="132" x2="388" y2="132" stroke="currentColor" stroke-opacity=".35"/>' +
		'<polyline class="fan-curve-line" points="" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<g class="fan-curve-dots"></g></svg><span class="fan-curve-message"></span></div>';
}

function updateCurvePreview(node) {
	var points = [];
	for (var i = 1; i <= 5; i++) {
		var temp = node.querySelector('[data-name="point' + i + '_temp"] input');
		var pwm = node.querySelector('[data-name="point' + i + '_pwm"] input');
		points.push({ temp: temp && temp.value, pwm: pwm && pwm.value });
	}
	var line = node.querySelector('.fan-curve-line');
	var dots = node.querySelector('.fan-curve-dots');
	var message = node.querySelector('.fan-curve-message');
	if (!line || !dots || !message) return;
	if (!validPoints(points)) {
		line.setAttribute('points', ''); dots.textContent = '';
		message.textContent = _('Complete valid curve points to preview.'); return;
	}
	line.setAttribute('points', points.map(function(point) {
		return (32 + +point.temp * 3.56) + ',' + (132 - +point.pwm * 120 / 255);
	}).join(' '));
	dots.textContent = '';
	points.forEach(function(point) {
		var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		dot.setAttribute('cx', 32 + +point.temp * 3.56);
		dot.setAttribute('cy', 132 - +point.pwm * 120 / 255);
		dot.setAttribute('r', '3.5'); dots.appendChild(dot);
	});
	message.textContent = '';
}

var previewCSS = '\
.fan-settings .cbi-section-node{box-sizing:border-box}\
.fan-settings [data-name^="point"]{box-sizing:border-box}\
.fan-settings .fan-curve-preview{max-width:none;margin:0;color:var(--cbi-text-color,currentColor)}\
.fan-settings .fan-curve-preview svg{display:block;width:100%;height:auto;border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:4px;background:var(--cbi-section-bg,transparent)}\
.fan-settings .fan-curve-line{color:var(--cbi-link-color,#0ea5e9)}.fan-settings .fan-curve-dots{fill:var(--cbi-link-color,#0ea5e9)}\
.fan-settings .fan-curve-message{display:block;margin-top:8px;color:var(--cbi-muted-color,#888);font-size:12px}\
.fan-settings .cbi-section:has(>[data-section-id="custom"]){container-type:inline-size}\
.fan-settings .cbi-section-node[data-section-id="custom"]>.cbi-value{min-width:0}\
.fan-settings .cbi-section-node[data-section-id="custom"]>.cbi-value:not([data-name="_curve_preview"]){display:grid;grid-template-columns:minmax(0,1fr) minmax(80px,120px);gap:8px;align-items:center}\
.fan-settings .cbi-section-node[data-section-id="custom"] .cbi-value-title{width:auto;padding:0;float:none;overflow-wrap:anywhere}\
.fan-settings .cbi-section-node[data-section-id="custom"] .cbi-value-field{min-width:0;margin:0;padding:0}\
.fan-settings .cbi-section-node[data-section-id="custom"] input{width:100%;min-width:0}\
.fan-settings [data-name="_curve_preview"]{display:block;margin-top:0}.fan-settings [data-name="_curve_preview"] .cbi-value-field{display:block;width:100%}.fan-settings [data-name="_curve_preview"] .cbi-value-title{display:block;margin-bottom:8px}\
@container (width < 640px){.fan-settings .cbi-section-node[data-section-id="custom"]{display:flex;flex-direction:column}.fan-settings .cbi-section-node[data-section-id="custom"]>[data-name="_curve_preview"]{order:-1;margin-bottom:16px}}\
@container (min-width:640px){.fan-settings .cbi-section-node[data-section-id="custom"]{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);column-gap:24px;align-items:start}.fan-settings .cbi-section-node[data-section-id="custom"]>.cbi-value{grid-column:1}.fan-settings .cbi-section-node[data-section-id="custom"]>[data-name="_curve_preview"]{grid-column:2;grid-row:1 / span 10}}\
';

function injectCSS(root) {
	var style = document.createElement('style');
	style.textContent = previewCSS;
	root.prepend(style);
}

return view.extend({
	load: function() { return uci.load('fan'); },

	render: function() {
		var map = new form.Map('fan', null, _('Configure fan control mode and speed curves.'));
		var settings = map.section(form.NamedSection, 'settings', 'fancontrol', _('Control Mode'));
		settings.anonymous = true;

		var option = settings.option(form.ListValue, 'mode', _('Mode'));
		option.value('auto', _('Automatic (Follow Curve)'));
		option.value('manual', _('Manual (Fixed Speed)'));
		option.default = 'auto';

		option = settings.option(form.Value, 'manual_pwm', _('Manual Fan Speed (PWM)'),
			_('Set a fixed PWM value from 0 to 255.'));
		option.datatype = 'and(uinteger,range(0,255))';
		option.default = '127';
		option.validate = function(sectionId, value) {
			return /^(0|[1-9][0-9]*)$/.test(value) && +value <= 255 ||
				_('Enter an integer from 0 to 255 without leading zeros.');
		};
		option.depends('mode', 'manual');
		option.retain = true;
		option.rmempty = false;

		option = settings.option(form.ListValue, 'curve_preset', _('Fan Curve Preset'));
		option.value('quiet', _('Quiet - Low noise priority'));
		option.value('balanced', _('Balanced - Balanced cooling'));
		option.value('performance', _('Performance - Maximum cooling'));
		option.value('custom', _('Custom - User defined'));
		option.default = 'balanced';
		option.depends('mode', 'auto');
		option.retain = true;

		var curve = map.section(form.NamedSection, 'custom', 'curve', _('Custom Curve'));
		curve.anonymous = true;
		curve.addremove = false;
		curve.description = _('Temperatures must increase, PWM must not decrease, and the last point is fixed at full speed.');

		function field(name, section) {
			var options = map.lookupOption(name, section);
			var item = options && options[0];
			var value = item && item.formvalue(section);
			return value != null ? value : uci.get('fan', section, name);
		}

		function validateCurve(sectionId, value) {
			if (field('mode', 'settings') !== 'auto' || field('curve_preset', 'settings') !== 'custom') return true;
			var points = [];
			for (var i = 1; i <= 5; i++) points.push({
				temp: this.option === 'point' + i + '_temp' ? value : field('point' + i + '_temp', sectionId),
				pwm: i === 5 ? '255' : this.option === 'point' + i + '_pwm' ? value : field('point' + i + '_pwm', sectionId)
			});
			return validPoints(points) || _('Temperatures must increase (0-100), PWM must not decrease (0-255), and point 5 is fixed at 255.');
		}

		var defaults = [[40, 54], [50, 69], [60, 95], [70, 199], [80, 255]];
		for (var i = 1; i <= 5; i++) {
			option = curve.option(form.Value, 'point' + i + '_temp', _('Point %d Temperature (°C)').format(i));
			option.datatype = 'and(uinteger,range(0,100))';
			option.default = String(defaults[i - 1][0]);
			option.validate = validateCurve;
			option.depends({ 'fan.settings.mode': 'auto', 'fan.settings.curve_preset': 'custom' });
			option.retain = true;
			option.rmempty = false;

			option = curve.option(form.Value, 'point' + i + '_pwm', _('Point %d PWM (0-255)').format(i));
			option.datatype = 'and(uinteger,range(0,255))';
			option.default = String(defaults[i - 1][1]);
			option.validate = validateCurve;
			option.depends({ 'fan.settings.mode': 'auto', 'fan.settings.curve_preset': 'custom' });
			option.retain = true;
			option.rmempty = false;
			if (i === 5) {
				option.readonly = (i === 5);
				option.forcewrite = true;
				option.cfgvalue = function() { return '255'; };
				option.write = function(sectionId) { uci.set('fan', sectionId, 'point5_pwm', '255'); };
			}
		}
		option = curve.option(form.DummyValue, '_curve_preview', _('Curve Preview'));
		option.depends({ 'fan.settings.mode': 'auto', 'fan.settings.curve_preset': 'custom' });
		option.rawhtml = true;
		option.cfgvalue = curvePreview;
		return map.render().then(function(node) {
			node.classList.add('fan-settings');
			injectCSS(node);
			var refresh = function() { updateCurvePreview(node); };
			node.addEventListener('input', refresh);
			node.addEventListener('change', refresh);
			refresh();
			return node;
		});
	}
});
