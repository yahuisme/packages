'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require poll';
'require rpc';

const callLuciWirelessDevices = rpc.declare({
	object: 'luci-rpc',
	method: 'getWirelessDevices',
	raise: true
});

const callIwinfoAssoclist = rpc.declare({
	object: 'iwinfo',
	method: 'assoclist',
	params: [ 'device', 'mac' ],
	raise: true
});

function listValues(value) {
	return L.toArray(value).map(v => String(v).trim()).filter(v => v.length > 0);
}

function uniqueValues(value) {
	return Array.from(new Set(listValues(value)));
}

function optionValue(section, option) {
	return uci.get('wireless', section, option);
}

function nextSectionName(prefix) {
	let idx = 0;
	let sid = null;

	do {
		sid = '%s%d'.format(prefix, idx++);
	} while (uci.get('wireless', sid) != null);

	return sid;
}

function editableSection(section_id) {
	let cfg = uci.get('wireless', section_id) || {};
	return [ 'ap', 'sta' ].includes(cfg.mode) &&
		[ 'sae', 'sae-mixed', 'psk2', 'psk-mixed', 'owe', 'none' ].includes(cfg.encryption);
}

function wirelessLink() {
	return E('a', { 'href': L.url('admin/network/wireless') }, _('Manage in Wireless'));
}

function radioLabel(radio) {
	let bits = [radio['.name']];

	if (radio.band)
		bits.push(radio.band);

	if (radio.channel)
		bits.push(_('channel %s').format(radio.channel));

	if (radio.disabled == '1')
		bits.push(_('Disabled'));

	return bits.join(' | ');
}

function radioMap(radios) {
	let out = {};

	for (let radio of radios)
		out[radio['.name']] = radio;

	return out;
}

function renderBadge(label) {
	let cls = 'ifacebadge mlo-badge';
	let s = String(label ?? '');
	if (s === 'Active' || s === 'MLO' || s === 'Enabled') cls += ' mlo-badge-active';
	else if (s === 'Verified MLD') cls += ' mlo-badge-verified';
	else if (s === 'Disabled' || s === 'Down') cls += ' mlo-badge-disabled';
	return E('span', { 'class': cls }, [ s ]);
}

function renderMetaLine(label, value) {
	return E('div', { 'class': 'cbi-value mlo-value' }, [
		E('div', { 'class': 'cbi-value-title' }, [ String(label ?? '') ]),
		E('div', { 'class': 'cbi-value-field' }, typeof value === 'string' ? [ value ] : value)
	]);
}

function compactChildren(items) {
	return items.filter(item => item !== null && item !== undefined && item !== false);
}

function replaceNode(oldNode, newNode) {
	if (oldNode && oldNode.parentNode)
		oldNode.parentNode.replaceChild(newNode, oldNode);
}

function stationKey(station) {
	if (typeof(station) == 'string')
		return station.toLowerCase();

	if (!station || typeof(station) != 'object')
		return null;

	return (station.mac || station.addr || station.mld_addr || station.mldAddr ||
		station.address || JSON.stringify(station)).toLowerCase();
}

function flattenWirelessStatus(status) {
	let runtime = {
		radios: [],
		sections: {},
		activeMldIfnames: []
	};

	for (let radioName in status || {}) {
		let radio = status[radioName] || {};

		runtime.radios.push(radioName);

		for (let iface of L.toArray(radio.interfaces)) {
			let sid = iface.section;
			let ifaceCfg = iface.config || {};
			let info;

			if (!sid)
				continue;

			info = runtime.sections[sid] || {
				ifnames: [],
				radios: [],
				up: false,
				stations: null,
				mldDetected: false
			};

			if (iface.ifname && info.ifnames.indexOf(iface.ifname) < 0)
				info.ifnames.push(iface.ifname);

			if (info.radios.indexOf(radioName) < 0)
				info.radios.push(radioName);

			info.up = info.up || (radio.up === true && iface.up !== false);
			/* Only runtime-reported MLD data proves an active MLD. */
			info.mldDetected = info.mldDetected || iface.mld === true ||
				(Array.isArray(iface.mld_links) && iface.mld_links.length > 1) ||
				(Array.isArray(iface.links) && iface.links.length > 1);

			runtime.sections[sid] = info;

			if (iface.ifname && radio.up === true && iface.up !== false && info.mldDetected && runtime.activeMldIfnames.indexOf(iface.ifname) < 0)
				runtime.activeMldIfnames.push(iface.ifname);
		}
	}

	runtime.radios.sort(L.naturalCompare);
	runtime.activeMldIfnames.sort(L.naturalCompare);

	return runtime;
}

function enrichRuntimeStations(runtime) {
	let queries = new Map();
	for (let info of Object.values(runtime.sections)) {
		for (let ifname of info.ifnames) {
			if (!queries.has(ifname))
				queries.set(ifname, callIwinfoAssoclist(ifname, null).then(function(reply) {
					return reply && Array.isArray(reply.results) ? reply.results : null;
				}).catch(function() { return null; }));
		}
	}
	return Promise.all(Object.values(runtime.sections).map(function(info) {
		return Promise.all(info.ifnames.map(name => queries.get(name))).then(function(results) {
			let stations = new Set();
			for (let list of results)
				for (let station of list || []) {
					let key = stationKey(station);
					if (key)
						stations.add(key);
				}
			info.stations = results.length && results.every(Array.isArray) ? stations.size : null;
		});
	})).then(function() { return runtime; });
}

function collectSummary(runtime, radios) {
	let sections = uci.sections('wireless', 'wifi-iface');
	let summary = {
		totalIfaces: sections.length,
		mloIfaces: 0,
		invalidMlo: 0,
		customIfname: 0,
		warnings: []
	};

	for (let section of sections) {
		let devices = uniqueValues(section.device);
		let isMlo = section.mlo == '1';

		if (!isMlo)
			continue;

		summary.mloIfaces++;

		if (devices.length < 2)
			summary.invalidMlo++;

		if (section.ifname)
			summary.customIfname++;
	}

	if (radios.length < 2)
		summary.warnings.push(_('Only one radio is configured. MLO needs at least two radios.'));

	if (!summary.totalIfaces)
		summary.warnings.push(_('No wireless interfaces are configured yet.'));
	else if (!summary.mloIfaces)
		summary.warnings.push(_('No MLO-enabled wireless interface is configured yet.'));

	if (summary.invalidMlo)
		summary.warnings.push(_('%d MLO interface(s) still have fewer than two radios selected.').format(summary.invalidMlo));

	if (!runtime.unknown && summary.mloIfaces && !runtime.activeMldIfnames.length)
		summary.warnings.push(_('MLO is configured, but no active runtime MLD interface is currently reported.'));

	if (summary.customIfname)
		summary.warnings.push(_('%d MLO interface(s) override the auto-generated MLD ifname.').format(summary.customIfname));

	return summary;
}

function renderSummaryCard(title, value) {
	return E('div', { 'class': 'mlo-summary-card' }, [
		E('div', { 'class': 'mlo-card-title' }, [ title ]),
		E('div', { 'class': 'mlo-card-value' }, [ value ])
	]);
}

function renderSummaryStatus(runtime, radios) {
	let summary = collectSummary(runtime, radios);
	let warningNodes = summary.warnings.map(w => E('div', { 'class': 'mlo-warning-item' }, [
		E('span', { 'class': 'mlo-warning-bullet' }, '•'),
		E('span', {}, w)
	]));

	let mldValue = runtime.unknown ? _('unknown') : (runtime.activeMldIfnames.join(', ') || _('none'));

	return E('div', { 'data-mlo-summary-status': '' }, [
		E('div', { 'class': 'mlo-summary-grid' }, [
			renderSummaryCard(_('Configured radios'), String(radios.length)),
			renderSummaryCard(_('MLO-enabled'), String(summary.mloIfaces)),
			renderSummaryCard(_('Verified active MLD interfaces'), mldValue)
		]),
		E('div', { 'class': 'cbi-value-description mlo-hint' }, _('Runtime names and multi-radio configuration are hints, not proof of client MLO links.')),
		warningNodes.length ? E('div', { 'class': 'mlo-warnings' }, warningNodes) : null
	]);
}

function fetchRuntime() {
	return callLuciWirelessDevices().then(function(status) {
		if (!status || typeof(status) != 'object' || Array.isArray(status) ||
			Object.values(status).some(radio => !radio || typeof(radio.up) != 'boolean'))
			throw new Error('Invalid wireless status');
		return enrichRuntimeStations(flattenWirelessStatus(status));
	}).catch(function() {
		return { unknown: true, radios: [], sections: {}, activeMldIfnames: [] };
	});
}

function renderSectionOverview(section_id, radiosByName) {
	let cfg = uci.get('wireless', section_id) || {};
	let devices = uniqueValues(cfg.device);
	let networks = uniqueValues(cfg.network);
	let issues = [];

	let allRadiosDisabled = devices.length > 0 && devices.every(dev => radiosByName[dev] && radiosByName[dev].disabled == '1');
	let isEnabled = cfg.disabled != '1' && !allRadiosDisabled;

	if (cfg.mlo == '1' && devices.length < 2)
		issues.push(E('div', { 'class': 'mlo-issue-item' }, _('Needs at least two radios')));

	if (cfg.mlo == '1' && cfg.mode == 'ap' && ![ 'sae', 'sae-mixed', 'owe' ].includes(cfg.encryption))
		issues.push(E('div', { 'class': 'mlo-issue-item' }, _('AP MLO is usually paired with WPA3-SAE or OWE')));

	if (cfg.mlo == '1' && cfg.ifname && cfg.ifname.indexOf('mld') < 0)
		issues.push(E('div', { 'class': 'mlo-issue-item' }, _('Custom ifname overrides the default ap-mldX / sta-mldX naming')));

	return E('div', {
		'class': 'mlo-panel mlo-overview-panel',
		'data-mlo-overview-section': section_id,
		'style': 'overflow-wrap:anywhere;'
	}, [
		E('div', { 'class': 'mlo-panel-header' }, [
			renderBadge(cfg.mlo == '1' ? _('MLO') : _('Single-link')),
			renderBadge((cfg.mode || 'ap').toUpperCase()),
			renderBadge(isEnabled ? _('Enabled') : _('Disabled'))
		]),
		renderMetaLine(_('SSID'), cfg.ssid || E('em', _('unset'))),
		renderMetaLine(_('Radios'), devices.length
			? devices.map(dev => radiosByName[dev] ? radioLabel(radiosByName[dev]) : dev).join(', ')
			: E('em', _('none'))),
		renderMetaLine(_('Networks'), networks.length ? networks.join(', ') : E('em', _('none'))),
		renderMetaLine(_('Security'), cfg.encryption || E('em', _('unset'))),
		issues.length ? E('div', { 'class': 'mlo-issues-box' }, issues) : null
	]);
}

function renderRuntimeCell(section_id, runtime) {
	let cfg = uci.get('wireless', section_id) || {};
	let state = runtime.sections[section_id];

	if (runtime.unknown)
		return E('div', {
			'class': 'mlo-panel mlo-runtime-panel',
			'data-mlo-runtime-section': section_id
		}, _('Runtime status: unknown'));

	if (!state) {
		return E('div', {
			'class': 'mlo-panel mlo-runtime-panel',
			'data-mlo-runtime-section': section_id,
			'style': 'overflow-wrap:anywhere;'
		}, [
			E('div', { 'class': 'mlo-panel-header' }, [
				renderBadge(_('No runtime state'))
			]),
			E('div', { 'class': 'mlo-status-empty' }, [
				E('div', {}, _('No active interface was reported yet')),
				cfg.mlo == '1'
					? E('div', { 'class': 'mlo-hint-text' }, _('Save & Apply, then verify driver support if this persists'))
					: null
			])
		]);
	}

	return E('div', {
		'class': 'mlo-panel mlo-runtime-panel',
		'data-mlo-runtime-section': section_id,
		'style': 'overflow-wrap:anywhere;'
	}, [
		E('div', { 'class': 'mlo-panel-header' }, compactChildren([
			renderBadge(state.up ? _('Active') : _('Down')),
			state.mldDetected ? renderBadge(_('Verified MLD')) : null
		])),
		renderMetaLine(_('ifname'), state.ifnames.length ? state.ifnames.join(', ') : E('em', _('unknown'))),
		renderMetaLine(_('Runtime radios'), state.radios.join(', ')),
		renderMetaLine(_('Stations'), state.stations == null ? _('unknown') : String(state.stations))
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('wireless'),
			uci.load('network'),
			fetchRuntime()
		]);
	},

	render: function(data) {
		let m, s, o;
		let runtime = data[2];
		let radios = uci.sections('wireless', 'wifi-device');
		let networks = uci.sections('network', 'interface');
		let radiosByName = radioMap(radios);
		let inflight;
		let refreshRuntime;

		m = new form.Map('wireless', _('Wi-Fi MLO'));
		m.chain('network');

		s = m.section(form.GridSection, 'wifi-iface', _('Wireless Interfaces'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add MLO');
		s.modaltitle = _('Edit wireless interface');
		s.sectiontitle = function(section_id) {
			return optionValue(section_id, 'ssid') ||
				optionValue(section_id, 'ifname') ||
				section_id;
		};

		s.handleAdd = function(ev) {
			if (ev)
				ev.preventDefault();
			if (this.map.readonly)
				return Promise.resolve();
			return form.GridSection.prototype.handleAdd.call(this, ev, nextSectionName('mlo')).catch(function(error) {
				if (s.map.addedSection != null) {
					uci.remove('wireless', s.map.addedSection);
					delete s.map.addedSection;
				}
				throw error;
			});
		};
		s.renderMoreOptionsModal = function(section_id, ev) {
			if (this.map.readonly)
				return Promise.resolve();
			if (this.map.addedSection == section_id) {
				uci.set('wireless', section_id, 'mode', 'ap');
				uci.set('wireless', section_id, 'mlo', '1');
				uci.set('wireless', section_id, 'encryption', 'sae');
				uci.set('wireless', section_id, 'ieee80211w', '2');
			}
			if (!editableSection(section_id)) {
				ui.addNotification(null, E('p', {}, [ _('This mode or encryption is not supported by this editor.'), ' ', wirelessLink() ]));
				return Promise.resolve();
			}
			return form.GridSection.prototype.renderMoreOptionsModal.call(this, section_id, ev);
		};

		s.renderRowActions = function(section_id) {
			if (this.map.readonly || !editableSection(section_id))
				return E('td', { 'class': 'td cbi-section-actions' }, wirelessLink());
			return form.GridSection.prototype.renderRowActions.call(this, section_id);
		};

		o = s.option(form.DummyValue, '_overview', _('Details'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return E('div', { 'class': 'mlo-details-cell' }, [
				renderSectionOverview(section_id, radiosByName),
				E('div', { 'class': 'mlo-cell-divider' }),
				renderRuntimeCell(section_id, runtime)
			]);
		};

		s.tab('general', _('General'));
		s.tab('security', _('Security'));
		s.tab('advanced', _('Advanced'));

		o = s.taboption('general', form.Flag, 'disabled', _('Enabled'));
		o.enabled = '0';
		o.disabled = '1';
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('general', form.Flag, 'mlo', _('Enable MLO'),
			_('Use multiple radios for this interface.'));
		o.default = o.enabled;
		o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'mode', _('Mode'));
		o.value('ap', _('Access Point'));
		o.value('sta', _('Client'));
		o.default = 'ap';
		o.rmempty = false;

		o = s.taboption('general', form.MultiValue, 'device', _('Radio devices'),
			_('Select one radio for normal Wi-Fi, or two or more radios for MLO.'));
		for (let radio of radios)
			o.value(radio['.name'], radioLabel(radio));
		o.rmempty = true;
		o.widget = 'select';
		o.validate = function(section_id, value) {
			let values = uniqueValues(value);
			let mloOption = this.section.children.find(opt => opt.option == 'mlo');
			let mloEnabled = mloOption ? mloOption.formvalue(section_id) : optionValue(section_id, 'mlo');

			if (!values.length)
				return _('Select at least one radio device');

			if (mloEnabled == '1' && values.length < 2)
				return _('MLO requires at least two radio devices');

			return true;
		};

		o = s.taboption('general', form.MultiValue, 'network', _('Attached network(s)'),
			_('Logical network names from <code>/etc/config/network</code>, for example <code>lan</code>.'));
		for (let network of networks)
			o.value(network['.name']);
		o.rmempty = true;
		o.widget = 'select';
		o.modalonly = true;

		o = s.taboption('general', form.Value, 'ssid', _('SSID'));
		o.datatype = 'maxlength(32)';
		o.rmempty = false;
		o.depends('mode', 'ap');
		o.depends('mode', 'sta');

		o = s.taboption('general', form.Flag, 'hidden', _('Hide SSID'));
		o.depends('mode', 'ap');
		o.modalonly = true;

		o = s.taboption('security', form.ListValue, 'encryption', _('Encryption'),
			_('WPA3-SAE with required Management Frame Protection is recommended for MLO.'));
		o.value('sae', _('WPA3-SAE'));
		o.value('sae-mixed', _('WPA2/WPA3 mixed'));
		o.value('psk2', _('WPA2-PSK'));
		o.value('psk-mixed', _('WPA/WPA2 mixed PSK'));
		o.value('owe', _('OWE'));
		o.value('none', _('No encryption'));
		o.default = 'sae';
		o.rmempty = false;

		o = s.taboption('security', form.Value, 'key', _('Passphrase'));
		o.password = true;
		o.datatype = 'wpakey';
		o.depends('encryption', 'sae');
		o.depends('encryption', 'sae-mixed');
		o.depends('encryption', 'psk2');
		o.depends('encryption', 'psk-mixed');
		o.modalonly = true;
		o.validate = function(section_id, value) {
			let encryptionOption = this.section.children.find(opt => opt.option == 'encryption');
			let encryption = encryptionOption ? encryptionOption.formvalue(section_id) : optionValue(section_id, 'encryption');

			if ([ 'sae', 'sae-mixed', 'psk2', 'psk-mixed' ].includes(encryption) && !value)
				return _('Passphrase is required for the selected encryption');

			return true;
		};

		o = s.taboption('security', form.ListValue, 'ieee80211w', _('802.11w Management Frame Protection'),
			_('SAE and OWE require Management Frame Protection: select Required.'));
		o.validate = function(section_id, value) {
			let encryption = this.section.children.find(opt => opt.option == 'encryption').formvalue(section_id);
			return [ 'sae', 'owe' ].includes(encryption) && value != '2'
				? _('SAE and OWE require Management Frame Protection: select Required.') : true;
		};
		o.value('0', _('Disabled'));
		o.value('1', _('Optional'));
		o.value('2', _('Required'));
		o.default = '2';
		o.rmempty = false;
		o.depends('encryption', 'sae-mixed');
		o.depends('encryption', 'psk2');
		o.depends('encryption', 'psk-mixed');
		o.modalonly = true;

		// Keep the standard option when hidden; the fixed field writes it below.
		o.retain = true;
		o = s.taboption('security', form.ListValue, '_pmf_required', _('802.11w Management Frame Protection'),
			_('SAE and OWE require Management Frame Protection.'));
		o.value('2', _('Required'));
		o.readonly = true;
		o.forcewrite = true;
		o.rmempty = false;
		o.depends('encryption', 'sae');
		o.depends('encryption', 'owe');
		o.cfgvalue = function() { return '2'; };
		o.write = function(section_id) { uci.set('wireless', section_id, 'ieee80211w', '2'); };
		o.remove = function() {};

		o = s.taboption('advanced', form.Value, 'ifname', _('Interface name'),
			_('Optional override. Leave empty to use auto-generated names such as <code>ap-mld0</code> or <code>sta-mld0</code>.'));
		o.datatype = 'netdevname';
		o.placeholder = 'ap-mld0';
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'macaddr', _('MAC address'),
			_('Optional override for the generated interface MAC address.'));
		o.datatype = 'macaddr';
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'bssid', _('BSSID'));
		o.datatype = 'macaddr';
		o.depends('mode', 'sta');
		o.modalonly = true;

		o = s.taboption('advanced', form.Flag, 'wds', _('Enable WDS / 4-address mode'));
		o.depends('mode', 'ap');
		o.depends('mode', 'sta');
		o.modalonly = true;

		o = s.taboption('advanced', form.Flag, 'uapsd', _('Enable U-APSD'));
		o.depends('mode', 'ap');
		o.modalonly = true;

		o = s.taboption('advanced', form.Flag, 'ocv', _('Enable OCV'));
		o.depends('encryption', 'sae');
		o.depends('encryption', 'sae-mixed');
		o.depends('encryption', 'owe');
		o.modalonly = true;

		o = s.taboption('advanced', form.Flag, 'disassoc_low_ack', _('Disassociate on low ACK'));
		o.depends('mode', 'ap');
		o.modalonly = true;

		for (let option of s.children)
			option.modalonly = option.option != '_overview';

		refreshRuntime = function(nodes) {
			if (inflight)
				return inflight;
			inflight = fetchRuntime().then(function(nextRuntime) {
				runtime = nextRuntime;
				replaceNode(nodes.querySelector('[data-mlo-summary-status]'), renderSummaryStatus(runtime, radios));
				for (let row of nodes.querySelectorAll('[data-mlo-runtime-section]'))
					replaceNode(row, renderRuntimeCell(row.getAttribute('data-mlo-runtime-section'), runtime));
			}).finally(function() { inflight = null; });
			return inflight;
		};

		return m.render().then(function(nodes) {
			nodes.classList.add('mlo-map');
			nodes.appendChild(E('style', {}, `
				.mlo-map { --mlo-border: var(--cbi-border-color, rgba(128,128,128,0.15)); --mlo-bg: var(--cbi-section-bg, rgba(128,128,128,0.03)); }
				.mlo-map .mlo-header-bar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
				.mlo-map .mlo-header-bar > h3 { margin:0; }
				.mlo-map .mlo-summary-grid { display:grid; grid-template-columns:repeat(3, minmax(180px, 1fr)); gap:12px; margin-bottom:8px; }
				.mlo-map .mlo-summary-card { background:var(--mlo-bg); border:1px solid var(--mlo-border); border-radius:6px; padding:10px 14px; min-height:68px; display:flex; flex-direction:column; justify-content:center; box-sizing:border-box; }
				.mlo-map .mlo-card-title { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.3px; color:var(--cbi-muted-color, #666); margin-bottom:4px; }
				.mlo-map .mlo-card-value { font-size:17px; font-weight:600; font-variant-numeric:tabular-nums; color:var(--cbi-text-color, inherit); }
				.mlo-map .mlo-hint { margin:8px 0; font-size:12px; opacity:0.8; }
				.mlo-map .mlo-warnings { margin:8px 0; display:flex; flex-direction:column; gap:4px; }
				.mlo-map .mlo-warning-item { display:flex; align-items:flex-start; gap:6px; font-size:12px; color:var(--cbi-warning-color, #c08400); }
				.mlo-map .mlo-warning-bullet { flex-shrink:0; font-weight:600; }
				.mlo-map .mlo-details-cell { display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:stretch; padding:4px 0; }
				.mlo-map .mlo-cell-divider { display:none; }
				.mlo-map .mlo-panel { background:var(--mlo-bg); border:1px solid var(--mlo-border); border-radius:6px; padding:10px 12px; display:flex; flex-direction:column; gap:2px; box-sizing:border-box; }
				.mlo-map .mlo-panel-header { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid var(--mlo-border); }
				.mlo-map .mlo-badge { margin:0; padding:2px 6px; font-size:11px; font-weight:500; border-radius:4px; line-height:1.4; }
				.mlo-map .mlo-badge-active { border-color:var(--cbi-success-color, #2ea44f); color:var(--cbi-success-color, #2ea44f); }
				.mlo-map .mlo-badge-verified { border-color:var(--cbi-info-color, #0969da); color:var(--cbi-info-color, #0969da); }
				.mlo-map .mlo-badge-disabled { opacity:0.6; }
				.mlo-map .cbi-value.mlo-value { display:flex; align-items:baseline; padding:3px 0; margin:0; font-size:13px; min-height:auto; }
				.mlo-map .cbi-value.mlo-value > .cbi-value-title { width:80px; flex:0 0 80px; text-align:left; padding:0; font-size:12px; font-weight:500; color:var(--cbi-muted-color, #666); }
				.mlo-map .cbi-value.mlo-value > .cbi-value-field { flex:1; min-width:0; padding:0; overflow-wrap:anywhere; }
				.mlo-map .mlo-issues-box { margin-top:6px; padding-top:6px; border-top:1px dashed var(--mlo-border); }
				.mlo-map .mlo-issue-item { font-size:12px; color:var(--cbi-warning-color, #c08400); margin-top:2px; }
				.mlo-map .mlo-status-empty { font-size:12px; color:var(--cbi-muted-color, #888); padding:8px 0; }
				.mlo-map .mlo-hint-text { margin-top:4px; opacity:0.85; }
				.modal.cbi-modal { min-width:0; width:min(720px, calc(100vw - 32px)); max-width:calc(100vw - 32px); }
				.modal.cbi-modal .cbi-value-field { min-width:0; }
				@media (max-width: 860px) {
					.mlo-map .mlo-summary-grid { grid-template-columns:1fr; }
					.mlo-map .mlo-details-cell { grid-template-columns:1fr; gap:8px; }
				}
				@media (max-width: 540px) {
					.mlo-map .cbi-value.mlo-value { flex-direction:column; align-items:flex-start; gap:2px; }
					.mlo-map .cbi-value.mlo-value > .cbi-value-title { width:auto; flex:none; }
				}
			`));
			nodes.insertBefore(E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'mlo-header-bar' }, [
					E('h3', {}, _('MLO Overview')),
					E('button', {
						'class': 'cbi-button', 'type': 'button',
						'click': ui.createHandlerFn(null, function() { return refreshRuntime(nodes); })
					}, _('Refresh Runtime Status'))
				]),
				renderSummaryStatus(runtime, radios)
			]), nodes.firstChild);
			poll.add(function() { return refreshRuntime(nodes); }, 5);
			return nodes;
		});
	}
});
