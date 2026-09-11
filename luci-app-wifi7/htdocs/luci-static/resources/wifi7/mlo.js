'use strict';
'require baseclass';
'require form';
'require uci';
'require ui';
'require poll';
'require rpc';

var callWirelessDevices = rpc.declare({
	object: 'luci-rpc',
	method: 'getWirelessDevices',
	reject: true
});

var mloRefresh = null;
var mloActive = true;

function listValues(value) {
	return L.toArray(value).map(value => String(value).trim()).filter(Boolean);
}

function uniqueValues(value) {
	return Array.from(new Set(listValues(value)));
}

function nextSectionName(prefix) {
	let index = 0;
	let name;

	do {
		name = '%s%d'.format(prefix, index++);
	} while (uci.get('wireless', name) != null);

	return name;
}

function editableSection(sectionId) {
	let section = uci.get('wireless', sectionId) || {};

	return [ 'ap', 'sta' ].includes(section.mode) &&
		[ 'sae', 'sae-mixed', 'psk2', 'psk-mixed', 'owe', 'none' ].includes(section.encryption);
}

function wirelessLink() {
	return E('a', { href: L.url('admin/network/wireless') }, _('Manage in Wireless'));
}

function radioLabel(radio) {
	let label = [ radio['.name'] ];

	if (radio.band)
		label.push(radio.band);
	if (radio.channel)
		label.push(_('channel %s').format(radio.channel));
	if (radio.disabled == '1')
		label.push(_('Disabled'));

	return label.join(' · ');
}

function radioMap(radios) {
	let result = {};

	for (let radio of radios)
		result[radio['.name']] = radio;

	return result;
}

function flattenRuntime(status) {
	let runtime = { radios: [], sections: {}, activeMldIfnames: [] };

	for (let radioName in status) {
		let radio = status[radioName];
		runtime.radios.push(radioName);

		for (let iface of L.toArray(radio.interfaces)) {
			if (!iface.section)
				continue;

			let section = runtime.sections[iface.section] || {
				ifnames: [],
				radios: [],
				up: false,
				mldDetected: false
			};
			let mldDetected = iface.mld === true ||
				(Array.isArray(iface.mld_links) && iface.mld_links.length > 1) ||
				(Array.isArray(iface.links) && iface.links.length > 1);

			if (iface.ifname && !section.ifnames.includes(iface.ifname))
				section.ifnames.push(iface.ifname);
			if (!section.radios.includes(radioName))
				section.radios.push(radioName);

			section.up ||= radio.up === true && iface.up !== false;
			section.mldDetected ||= mldDetected;
			runtime.sections[iface.section] = section;

			if (iface.ifname && radio.up === true && iface.up !== false && mldDetected && !runtime.activeMldIfnames.includes(iface.ifname))
				runtime.activeMldIfnames.push(iface.ifname);
		}
	}

	runtime.radios.sort(L.naturalCompare);
	runtime.activeMldIfnames.sort(L.naturalCompare);
	return runtime;
}

function fetchRuntime() {
	return callWirelessDevices().then(function(status) {
		if (!status || typeof status != 'object' || Array.isArray(status) ||
			Object.values(status).some(radio => !radio || typeof radio.up != 'boolean'))
			throw new Error('Invalid wireless status');
		return flattenRuntime(status);
	}).catch(function() {
		return { unknown: true, radios: [], sections: {}, activeMldIfnames: [] };
	});
}

function mloSections() {
	return uci.sections('wireless', 'wifi-iface').filter(section => section.mlo == '1');
}

function summary(runtime, radios) {
	let sections = mloSections();
	let radioNames = new Set(radios.map(radio => radio['.name']));
	let invalid = sections.filter(section => uniqueValues(section.device).filter(name => radioNames.has(name)).length < 2).length;
	let state = runtime.unknown ? _('Unavailable') : runtime.activeMldIfnames.length ? _('Active') : _('Inactive');
	let detail = runtime.unknown ? _('Runtime status unavailable') :
		runtime.activeMldIfnames.length ? runtime.activeMldIfnames.join(', ') : _('No active MLD interface');

	return E('div', { class: 'mlo-summary', 'data-mlo-summary-status': '' }, [
		E('div', { class: 'mlo-summary-item' }, [
			E('span', { class: 'wifi7-label' }, _('MLO interfaces')),
			E('strong', {}, String(sections.length)),
			E('small', {}, sections.length ? _('%d incomplete').format(invalid) : _('Pending addition'))
		]),
		E('div', { class: 'mlo-summary-item' }, [
			E('span', { class: 'wifi7-label' }, _('Active MLD')),
			E('strong', { class: runtime.unknown ? 'mlo-muted' : runtime.activeMldIfnames.length ? 'mlo-active' : 'mlo-muted' }, state),
			E('small', {}, [ detail ])
		]),
		E('div', { class: 'mlo-summary-item' }, [
			E('span', { class: 'wifi7-label' }, _('Configured radios')),
			E('strong', {}, String(radios.length)),
			E('small', {}, [ uniqueValues(radios.map(radio => radio.band).filter(Boolean)).join(' / ') || _('Unknown') ])
		])
	]);
}

function overview(sectionId, radiosByName, runtime) {
	let section = uci.get('wireless', sectionId) || {};
	let devices = uniqueValues(section.device);
	let state = runtime.sections[sectionId];
	let stateText = runtime.unknown ? _('Unavailable') : !state ? _('No runtime state') : state.up ? _('Active') : _('Down');
	let radioText = devices.map(device => radiosByName[device] ? radioLabel(radiosByName[device]) : device).join(', ') || _('None');

	return E('div', { class: 'mlo-overview', 'data-mlo-overview-section': sectionId }, [
		E('span', { class: 'mlo-overview-primary' }, [ section.ssid || _('Unnamed network') ]),
		E('span', {}, [ radioText ]),
		E('span', { class: runtime.unknown || !state || !state.up ? 'mlo-muted' : 'mlo-active', 'data-mlo-runtime-section': sectionId }, stateText)
	]);
}

return baseclass.extend({
	load: function() {
		return Promise.all([ uci.load('wireless'), uci.load('network'), fetchRuntime() ]);
	},

	pause: function() {
		mloActive = false;
	},

	resume: function() {
		mloActive = true;
		return mloRefresh ? mloRefresh() : Promise.resolve();
	},

	render: function(data) {
		let runtime = data[2];
		let radios = uci.sections('wireless', 'wifi-device');
		let radiosByName = radioMap(radios);
		let inflight;
		let refresh;
		let map = new form.Map('wireless', null, _('Configure Wi-Fi 7 Multi-Link Operation interfaces.'));
		map.chain('network');

		let section = map.section(form.GridSection, 'wifi-iface', _('MLO Interfaces'));
		// This embedded section has the same heading level as the radio settings.
		section.hidetitle = true;
		section.renderContents = function() {
			let node = form.GridSection.prototype.renderContents.apply(this, arguments);
			node.prepend(E('h4', {}, this.title));
			return node;
		};
		section.anonymous = true;
		section.addremove = true;
		section.sortable = true;
		section.addbtntitle = _('Add MLO');
		section.modaltitle = _('Edit MLO interface');
		section.cfgsections = function() { return mloSections().map(section => section['.name']); };
		section.sectiontitle = function(sectionId) {
			return '%h'.format(uci.get('wireless', sectionId, 'ssid') || sectionId);
		};
		section.handleAdd = function(event) {
			if (event)
				event.preventDefault();
			if (this.map.readonly)
				return Promise.resolve();
			return form.GridSection.prototype.handleAdd.call(this, event, nextSectionName('mlo')).catch(function(error) {
				if (section.map.addedSection != null) {
					uci.remove('wireless', section.map.addedSection);
					delete section.map.addedSection;
				}
				throw error;
			});
		};
		section.renderMoreOptionsModal = function(sectionId, event) {
			if (this.map.readonly)
				return Promise.resolve();
			if (this.map.addedSection == sectionId) {
				uci.set('wireless', sectionId, 'mode', 'ap');
				uci.set('wireless', sectionId, 'mlo', '1');
				uci.set('wireless', sectionId, 'encryption', 'sae');
				uci.set('wireless', sectionId, 'ieee80211w', '2');
			}
			if (!editableSection(sectionId)) {
				ui.addNotification(null, E('p', {}, [ _('This mode or encryption is not supported by this editor.'), ' ', wirelessLink() ]));
				return Promise.resolve();
			}
			return form.GridSection.prototype.renderMoreOptionsModal.call(this, sectionId, event).then(function(result) {
				let modal = document.querySelector('body.modal-overlay-active > #modal_overlay > .modal.cbi-modal');
				if (modal) {
					modal.classList.add('wifi7-mlo-modal', 'wifi7-modal');
					if (!modal.querySelector('[data-wifi7-modal-style]'))
						modal.appendChild(E('style', { 'data-wifi7-modal-style': '' }, '#modal_overlay > .wifi7-mlo-modal{max-width:calc(100vw - 32px)}.wifi7-mlo-modal input:not([type="checkbox"]),.wifi7-mlo-modal select,.wifi7-mlo-modal .cbi-button{height:32px}.wifi7-mlo-modal .cbi-button{padding-top:0;padding-bottom:0}'));
				}
				return result;
			});
		};
		section.renderRowActions = function(sectionId) {
			return this.map.readonly || !editableSection(sectionId)
				? E('td', { class: 'td cbi-section-actions' }, wirelessLink())
				: form.GridSection.prototype.renderRowActions.call(this, sectionId);
		};

		let option = section.option(form.DummyValue, '_overview', _('Interface'));
		option.textvalue = sectionId => overview(sectionId, radiosByName, runtime);

		section.tab('general', _('General'));
		section.tab('security', _('Security'));
		section.tab('advanced', _('Advanced'));

		option = section.taboption('general', form.Flag, 'disabled', _('Enabled'));
		option.enabled = '0'; option.disabled = '1'; option.default = '0'; option.rmempty = false;
		option = section.taboption('general', form.ListValue, 'mode', _('Mode'));
		option.value('ap', _('Access Point')); option.value('sta', _('Client')); option.default = 'ap'; option.rmempty = false;
		option = section.taboption('general', form.MultiValue, 'device', _('Radio devices'), _('Select at least two radios for MLO.'));
		for (let radio of radios) option.value(radio['.name'], radioLabel(radio));
		option.widget = 'select'; option.rmempty = true;
		option.validate = function(sectionId, value) {
			return uniqueValues(value).length >= 2 || _('MLO requires at least two radio devices');
		};
		option = section.taboption('general', form.MultiValue, 'network', _('Attached network(s)'));
		for (let network of uci.sections('network', 'interface')) option.value(network['.name']);
		option.widget = 'select'; option.rmempty = true;
		option = section.taboption('general', form.Value, 'ssid', _('SSID'));
		option.datatype = 'maxlength(32)'; option.rmempty = false;
		option = section.taboption('general', form.Flag, 'hidden', _('Hide SSID'));
		option.depends('mode', 'ap');

		option = section.taboption('security', form.ListValue, 'encryption', _('Encryption'));
		option.value('sae', _('WPA3-SAE')); option.value('sae-mixed', _('WPA2/WPA3 mixed'));
		option.value('psk2', _('WPA2-PSK')); option.value('psk-mixed', _('WPA/WPA2 mixed PSK'));
		option.value('owe', _('OWE')); option.value('none', _('No encryption')); option.default = 'sae'; option.rmempty = false;
		option = section.taboption('security', form.Value, 'key', _('Passphrase'));
		option.password = true; option.datatype = 'wpakey'; option.rmempty = false;
		for (let encryption of [ 'sae', 'sae-mixed', 'psk2', 'psk-mixed' ]) option.depends('encryption', encryption);
		option = section.taboption('security', form.ListValue, 'ieee80211w', _('802.11w Management Frame Protection'));
		option.value('0', _('Disabled')); option.value('1', _('Optional')); option.value('2', _('Required')); option.default = '2'; option.rmempty = false;
		option.validate = function(sectionId, value) {
			let encryption = this.section.children.find(option => option.option == 'encryption').formvalue(sectionId);
			return [ 'sae', 'owe' ].includes(encryption) && value != '2'
				? _('SAE and OWE require Management Frame Protection: select Required.') : true;
		};
		option.depends('encryption', 'sae-mixed'); option.depends('encryption', 'psk2'); option.depends('encryption', 'psk-mixed');
		option = section.taboption('security', form.ListValue, '_pmf_required', _('802.11w Management Frame Protection'));
		option.value('2', _('Required')); option.readonly = true; option.forcewrite = true; option.rmempty = false;
		option.depends('encryption', 'sae'); option.depends('encryption', 'owe');
		option.cfgvalue = function() { return '2'; };
		option.write = function(sectionId) { uci.set('wireless', sectionId, 'ieee80211w', '2'); };
		option.remove = function() {};

		option = section.taboption('advanced', form.Value, 'ifname', _('Interface name'), _('Optional override.'));
		option.datatype = 'netdevname'; option.placeholder = 'ap-mld0';
		option = section.taboption('advanced', form.Value, 'macaddr', _('MAC address'));
		option.datatype = 'macaddr';
		option = section.taboption('advanced', form.Value, 'bssid', _('BSSID'));
		option.datatype = 'macaddr'; option.depends('mode', 'sta');
		option = section.taboption('advanced', form.Flag, 'wds', _('Enable WDS / 4-address mode'));
		option = section.taboption('advanced', form.Flag, 'uapsd', _('Enable U-APSD'));
		option.depends('mode', 'ap');
		option = section.taboption('advanced', form.Flag, 'ocv', _('Enable OCV'));
		for (let encryption of [ 'sae', 'sae-mixed', 'owe' ]) option.depends('encryption', encryption);
		option = section.taboption('advanced', form.Flag, 'disassoc_low_ack', _('Disassociate on low ACK'));
		option.depends('mode', 'ap');

		for (let child of section.children)
			child.modalonly = child.option != '_overview';

		// Include local presentation in every native Map reset/save redraw.
		map.renderContents = function() {
			return form.Map.prototype.renderContents.apply(this, arguments).then(function(nodes) {
				nodes.classList.add('mlo-map');
				nodes.appendChild(E('style', {}, '.mlo-map .mlo-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 16px}.mlo-map .mlo-summary-item{min-width:0;min-height:96px;padding:8px 16px;gap:4px;line-height:1.5;overflow-wrap:anywhere;box-sizing:border-box;border:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0));border-radius:6px;background:var(--cbi-section-bg,transparent);display:flex;flex-direction:column;justify-content:center}.mlo-map .mlo-summary-item strong{font-size:1.125em;font-weight:600}.mlo-map .mlo-summary-item small{font-size:inherit;color:var(--cbi-muted-color,var(--text-muted,#888));overflow-wrap:anywhere}.mlo-map .mlo-active{color:inherit}.mlo-map .mlo-muted{color:var(--cbi-muted-color,var(--text-muted,#888))}.mlo-map .mlo-overview{display:grid;gap:8px;min-width:0;overflow-wrap:anywhere}@media(max-width:760px){.mlo-map .mlo-summary{grid-template-columns:1fr}}'));
				let description = nodes.querySelector('.cbi-map-descr');
				let status = summary(runtime, radios);
				description && description.parentNode.insertBefore(status, description.nextSibling);
				return nodes;
			});
		};

		return map.render().then(function(nodes) {
			refresh = function() {
				if (!nodes.isConnected) {
					poll.remove(refresh);
					return Promise.resolve();
				}
				if (!mloActive)
					return Promise.resolve();
				if (inflight)
					return inflight;
				inflight = fetchRuntime().then(function(nextRuntime) {
					if (!nodes.isConnected)
						return;
					runtime = nextRuntime;
					let oldSummary = nodes.querySelector('[data-mlo-summary-status]');
					oldSummary && oldSummary.replaceWith(summary(runtime, radios));
					for (let oldState of nodes.querySelectorAll('[data-mlo-runtime-section]')) {
						let sectionId = oldState.getAttribute('data-mlo-runtime-section');
						let nextState = overview(sectionId, radiosByName, runtime).querySelector('[data-mlo-runtime-section]');
						oldState.replaceWith(nextState);
					}
				}).then(function(result) { inflight = null; return result; }, function(error) { inflight = null; throw error; });
				return inflight;
			};
			mloRefresh = refresh;
			poll.add(refresh, 5);
			let observer = new MutationObserver(function() {
				if (nodes.isConnected)
					return;
				poll.remove(refresh);
				observer.disconnect();
			});
			observer.observe(document.body, { childList: true, subtree: true });
			return nodes;
		});
	}
});
