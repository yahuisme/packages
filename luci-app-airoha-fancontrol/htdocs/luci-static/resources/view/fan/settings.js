'use strict';
'require view';
'require form';
'require uci';

var settingsCSS = '\
.fan-settings{width:100%}\
.fan-curve-wrap{border:1px solid var(--cbi-border-color,#d0d0d0);border-radius:6px;padding:12px;background:var(--cbi-section-bg,transparent);margin-top:8px}\
.fan-curve-canvas{display:block;width:100%;height:300px;background:var(--cbi-input-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:4px;box-sizing:border-box}\
.fan-settings .fan-curve-section .cbi-section-node{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}\
.fan-settings .fan-curve-section .cbi-value{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--cbi-border-color,#f0f0f0)}\
.fan-settings .fan-curve-section .cbi-value-title{width:auto;margin:0;font-size:13px;font-weight:500}\
.fan-settings .fan-curve-section .cbi-value-field{width:auto;margin:0}\
.fan-settings .fan-curve-section .cbi-value-field input{width:96px!important;min-width:96px;max-width:96px;text-align:center;font-family:monospace;font-variant-numeric:tabular-nums;font-weight:600}\
@media(max-width:760px){.fan-settings .fan-curve-section .cbi-section-node{grid-template-columns:1fr}}\
';

function injectCSS() {
	if (document.getElementById('fan-settings-theme-css')) return;
	var el = document.createElement('style');
	el.id = 'fan-settings-theme-css';
	el.textContent = settingsCSS;
	document.head.appendChild(el);
}

function validPoints(points) {
	var previousTemp = -1, previousPwm = 0;
	return Array.isArray(points) && points.length === 5 && points.every(function(pt, i) {
		if (!pt || !/^(0|[1-9][0-9]*)$/.test(pt.temp) || !/^(0|[1-9][0-9]*)$/.test(pt.pwm) ||
			+pt.temp > 100 || +pt.pwm > 255 || +pt.temp <= previousTemp || +pt.pwm < previousPwm ||
			(i === 4 && +pt.pwm !== 255)) return false;
		previousTemp = +pt.temp;
		previousPwm = +pt.pwm;
		return true;
	});
}

function drawCurveCanvas(canvasId, curves, activePreset, customPreview) {
	var canvas = document.getElementById(canvasId);
	if (!canvas) return;
	var ctx = canvas.getContext('2d');
	var dpr = Math.min(window.devicePixelRatio || 1, 2);
	var cssW = canvas.clientWidth || 500;
	var cssH = canvas.clientHeight || 300;
	canvas.width = Math.round(cssW * dpr);
	canvas.height = Math.round(cssH * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	var width = cssW;
	var height = cssH;
	var padding = 40;
	var style = window.getComputedStyle(canvas);
	var grid = style.borderTopColor;
	var axis = style.color, muted = style.color, text = style.color;
	ctx.clearRect(0, 0, width, height);

	ctx.strokeStyle = grid;
	ctx.lineWidth = 1;
	for (var t = 0; t <= 100; t += 10) {
		var x = padding + (t / 100) * (width - 2 * padding);
		ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, height - padding); ctx.stroke();
	}
	for (var p = 0; p <= 255; p += 51) {
		var y = height - padding - (p / 255) * (height - 2 * padding);
		ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
	}

	ctx.strokeStyle = axis;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(padding, padding);
	ctx.lineTo(padding, height - padding);
	ctx.lineTo(width - padding, height - padding);
	ctx.stroke();

	ctx.fillStyle = text;
	ctx.font = '11px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(_('Temperature (°C)'), width / 2, height - 5);
	ctx.save();
	ctx.translate(12, height / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText(_('PWM (0-255)'), 0, 0);
	ctx.restore();

	ctx.fillStyle = muted;
	ctx.font = '9px sans-serif';
	ctx.textAlign = 'center';
	for (var t = 0; t <= 100; t += 20) {
		ctx.fillText(t, padding + (t / 100) * (width - 2 * padding), height - padding + 13);
	}
	ctx.textAlign = 'right';
	for (var p = 0; p <= 255; p += 51) {
		ctx.fillText(p, padding - 4, height - padding - (p / 255) * (height - 2 * padding) + 4);
	}

	var colors = {
		'quiet': '#28a745',
		'balanced': '#007bff',
		'performance': '#dc3545',
		'custom': '#6f42c1'
	};

	function drawLine(points, color, alpha, lineW, dots) {
		if (!validPoints(points)) return;
		ctx.strokeStyle = color;
		ctx.lineWidth = lineW || 1.5;
		ctx.globalAlpha = alpha != null ? alpha : 0.4;
		ctx.beginPath();
		points.forEach(function(pt, idx) {
			var px = padding + (pt.temp / 100) * (width - 2 * padding);
			var py = height - padding - (pt.pwm / 255) * (height - 2 * padding);
			idx === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
		});
		ctx.stroke();
		if (dots) {
			ctx.fillStyle = color;
			points.forEach(function(pt) {
				var px = padding + (pt.temp / 100) * (width - 2 * padding);
				var py = height - padding - (pt.pwm / 255) * (height - 2 * padding);
				ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
			});
		}
		ctx.globalAlpha = 1;
	}

	Object.keys(curves).forEach(function(preset) {
		if (preset === 'custom' && activePreset === 'custom') return;
		var isActive = preset === activePreset;
		drawLine(curves[preset], colors[preset], isActive ? 1 : 0.3, isActive ? 2.5 : 1, isActive);
	});

	if (activePreset === 'custom' && !customPreview) {
		ctx.fillStyle = text;
		ctx.textAlign = 'center';
		ctx.fillText(_('Complete valid curve points to preview.'), width / 2, height / 2);
	}
	if (customPreview) {
		drawLine(customPreview, '#ff6600', 1, 2.5, true);
	}

	var legendLabels = {
		quiet: _('Quiet'),
		balanced: _('Balanced'),
		performance: _('Performance'),
		custom: _('Custom')
	};
	var legendY = 15;
	Object.keys(colors).forEach(function(preset) {
		ctx.fillStyle = colors[preset];
		ctx.globalAlpha = preset === activePreset ? 1 : 0.5;
		ctx.fillRect(width - 100, legendY, 12, 12);
		ctx.globalAlpha = 1;
		ctx.fillStyle = text;
		ctx.font = '10px sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(legendLabels[preset] || preset, width - 84, legendY + 10);
		legendY += 17;
	});
	if (customPreview) {
		ctx.fillStyle = '#ff6600';
		ctx.fillRect(width - 100, legendY, 12, 12);
		ctx.fillStyle = text;
		ctx.fillText(_('Preview'), width - 84, legendY + 10);
	}
}

function readCustomPoints() {
	var points = [];
	for (var i = 1; i <= 5; i++) {
		var tEl = document.querySelector('[data-name="point' + i + '_temp"] input');
		var pEl = document.querySelector('[data-name="point' + i + '_pwm"] input');
		var temp = tEl && tEl.value, pwm = pEl && pEl.value;
		points.push({ temp: temp, pwm: pwm });
	}
	return validPoints(points) ? points : null;
}

return view.extend({
	load: function() {
		return uci.load('fan');
	},

	render: function(data) {
		var curves = {};
		['quiet', 'balanced', 'performance', 'custom'].forEach(function(preset) {
			curves[preset] = [];
			for (var i = 1; i <= 5; i++) {
				curves[preset].push({ temp: uci.get('fan', preset, 'point' + i + '_temp'),
					pwm: uci.get('fan', preset, 'point' + i + '_pwm') });
			}
		});
		var m, s, o;
		injectCSS();

		m = new form.Map('fan', null,
			_('Configure fan control mode and speed curves.'));

		s = m.section(form.NamedSection, 'settings', 'fancontrol', _('Control Mode'));
		s.anonymous = true;

		o = s.option(form.ListValue, 'mode', _('Mode'));
		o.value('auto', _('Automatic (Follow Curve)'));
		o.value('manual', _('Manual (Fixed Speed)'));
		o.default = 'auto';

		o = s.option(form.Value, 'manual_pwm', _('Manual Fan Speed (PWM)'),
			_('Set a fixed PWM value (0-255). 0 = Off, 255 = Full Speed. Stopping the fan may cause overheating.'));
		o.datatype = 'and(uinteger,range(0,255))';
		o.default = '127';
		o.validate = function(sectionId, value) {
			return /^(0|[1-9][0-9]*)$/.test(value) && +value <= 255 || _('Enter an integer from 0 to 255 without leading zeros.');
		};
		o.depends('mode', 'manual');
		o.retain = true;
		o.rmempty = false;

		o = s.option(form.ListValue, 'curve_preset', _('Fan Curve Preset'));
		o.value('quiet', _('Quiet - Lower speeds, higher temps'));
		o.value('balanced', _('Balanced - Good mix of noise and cooling'));
		o.value('performance', _('Performance - Higher speeds, lower temps'));
		o.value('custom', _('Custom - Define your own curve'));
		o.default = 'balanced';
		o.retain = true;
		o.depends('mode', 'auto');

		o = s.option(form.DummyValue, '_curve_graph', _('Curve Preview'));
		o.depends('mode', 'auto');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div class="fan-curve-wrap"><canvas id="curve-canvas" class="fan-curve-canvas"></canvas></div>';
		};

		s = m.section(form.NamedSection, 'custom', 'curve', _('Custom Curve Editor'),
			_('Define temperature thresholds and corresponding fan speeds.'));
		s.anonymous = true;
		s.addremove = false;

		function validateCurve(sectionId, value) {
			function field(name, section) {
				var options = m.lookupOption(name, section);
				var option = options && options[0];
				var current = option && option.formvalue(section);
				return current != null ? current : uci.get('fan', section, name);
			}
			if (field('mode', 'settings') !== 'auto' || field('curve_preset', 'settings') !== 'custom')
				return true;
			var previousTemp = -1, previousPwm = 0;
			for (var point = 1; point <= 5; point++) {
				var t = 'point' + point + '_temp', p = 'point' + point + '_pwm';
				var temp = this.option === t ? value : field(t, sectionId);
				var pwm = point === 5 ? '255' : this.option === p ? value : field(p, sectionId);
				if (!/^(0|[1-9][0-9]*)$/.test(temp) || !/^(0|[1-9][0-9]*)$/.test(pwm) ||
					+temp > 100 || +pwm > 255 || +temp <= previousTemp || +pwm < previousPwm)
					return _('Temperatures must increase (0-100), PWM must not decrease (0-255), and point 5 is fixed at 255.');
				previousTemp = +temp;
				previousPwm = +pwm;
			}
			return true;
		}

		var defaults = {
			point1_temp: 40, point1_pwm: 54,
			point2_temp: 50, point2_pwm: 69,
			point3_temp: 60, point3_pwm: 95,
			point4_temp: 70, point4_pwm: 199,
			point5_temp: 80, point5_pwm: 255
		};

		for (var i = 1; i <= 5; i++) {
			o = s.option(form.Value, 'point' + i + '_temp',
				_('Point %d Temperature (°C)').format(i));
			o.datatype = 'and(uinteger,range(0,100))';
			o.validate = validateCurve;
			o.default = String(defaults['point' + i + '_temp']);
			o.depends({ 'fan.settings.mode': 'auto', 'fan.settings.curve_preset': 'custom' });
			o.retain = true;
			o.rmempty = false;

			o = s.option(form.Value, 'point' + i + '_pwm',
				_('Point %d PWM (0-255)').format(i));
			o.datatype = 'and(uinteger,range(0,255))';
			o.default = String(defaults['point' + i + '_pwm']);
			o.depends({ 'fan.settings.mode': 'auto', 'fan.settings.curve_preset': 'custom' });
			o.retain = true;
			o.readonly = (i === 5);
			if (i === 5) {
				o.forcewrite = true;
				o.cfgvalue = function() { return '255'; };
				o.write = function(sectionId) { uci.set('fan', sectionId, 'point5_pwm', '255'); };
			}
			o.validate = validateCurve;
			o.rmempty = false;
		}

		return m.render().then(function(node) {
			node.classList.add('fan-settings');
			var intro = node.querySelector('.cbi-map-descr');
			if (intro) intro.classList.add('fan-settings-intro');
			var sections = node.querySelectorAll('.cbi-section');
			if (sections[0]) sections[0].classList.add('fan-control-section');
			if (sections[1]) sections[1].classList.add('fan-curve-section');
			requestAnimationFrame(function() {
				if (!node.isConnected) return;
				var presetSelect = node.querySelector('[data-name="curve_preset"] select');
				var modeSelect = node.querySelector('[data-name="mode"] select');
				var point1Marker = node.querySelector('[data-name="point1_temp"]');
				var manualMarker = node.querySelector('[data-name="manual_pwm"]');

				function getCurrentPreset() {
					return presetSelect ? presetSelect.value : uci.get('fan', 'settings', 'curve_preset') || 'balanced';
				}

				function getCurrentMode() {
					return modeSelect ? modeSelect.value : uci.get('fan', 'settings', 'mode') || 'auto';
				}

				function toggleCustomSection() {
					var visible = getCurrentMode() === 'auto' && getCurrentPreset() === 'custom';
					var manual = getCurrentMode() === 'manual';
					if (point1Marker) {
						var section = point1Marker.closest('.cbi-section');
						if (section) section.style.display = visible ? '' : 'none';
					}
					if (manualMarker) manualMarker.style.display = manual ? '' : 'none';
				}

				function redrawCanvas() {
					if (!node.isConnected) return;
					var preset = getCurrentPreset();
					if (preset === 'custom') {
						drawCurveCanvas('curve-canvas', curves, preset, readCustomPoints());
					} else {
						drawCurveCanvas('curve-canvas', curves, preset, null);
					}
				}

				toggleCustomSection();
				redrawCanvas();
				var resize = new ResizeObserver(redrawCanvas);
				resize.observe(node);
				var removal = new MutationObserver(function() {
					if (node.isConnected) return;
					resize.disconnect();
					removal.disconnect();
				});
				removal.observe(document.body, { childList: true, subtree: true });

				if (presetSelect) {
					presetSelect.addEventListener('change', function() {
						toggleCustomSection();
						redrawCanvas();
					});
				}

				if (modeSelect) {
					modeSelect.addEventListener('change', function() {
						toggleCustomSection();
						redrawCanvas();
					});
				}

				for (var i = 1; i <= 5; i++) {
					['_temp', '_pwm'].forEach(function(suffix) {
						var el = node.querySelector('[data-name="point' + i + suffix + '"] input');
						if (el) el.addEventListener('input', redrawCanvas);
					});
				}
			});
			return node;
		});
	}
});
