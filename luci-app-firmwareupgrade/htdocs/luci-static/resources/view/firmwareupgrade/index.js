'use strict';
'require poll';
'require rpc';
'require ui';
'require view';

var callInfo = rpc.declare({ object: 'luci.firmwareupgrade', method: 'getSystemInfo', expect: { '': {} } });
var callCheck = rpc.declare({ object: 'luci.firmwareupgrade', method: 'checkUpdate', reject: true, expect: { '': {} } });
var callStatus = rpc.declare({ object: 'luci.firmwareupgrade', method: 'getStatus', reject: true, expect: { '': {} } });
var callStart = rpc.declare({ object: 'luci.firmwareupgrade', method: 'startUpgrade', params: [ 'keep_config', 'candidate_id' ], expect: { '': {} } });
var callSave = rpc.declare({ object: 'luci.firmwareupgrade', method: 'saveSettings', params: [ 'repository', 'token', 'keep_config', 'release_pattern', 'asset_pattern', 'download_proxy' ], expect: { '': {} } });

var css = '\
.fwup-dashboard .fwup-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}\
.fwup-dashboard .fwup-card,.fwup-dashboard .fwup-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0));border-radius:6px;box-sizing:border-box}\
.fwup-dashboard .fwup-card{min-height:72px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center}.fwup-dashboard .fwup-label{color:var(--cbi-muted-color,var(--text-muted,#666));margin-bottom:3px}.fwup-dashboard .fwup-value{font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fwup-dashboard .fwup-sub{color:var(--cbi-muted-color,var(--text-muted,#888));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.fwup-dashboard .fwup-panel{padding:12px;margin:12px 0}.fwup-dashboard .fwup-panel-title{padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--cbi-border-color,var(--hairline,#e0e0e0))}.fwup-dashboard .fwup-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--cbi-border-color,var(--hairline,#f0f0f0))}.fwup-dashboard .fwup-row:last-child{border-bottom:0}.fwup-dashboard .fwup-key{flex:0 0 176px;color:var(--cbi-muted-color,var(--text-muted,#666));}.fwup-dashboard .fwup-data{min-width:0;overflow-wrap:anywhere}.fwup-dashboard .fwup-input{width:min(100%,380px);min-width:0;max-width:100%;height:32px;box-sizing:border-box}.fwup-dashboard .fwup-actions{display:flex;gap:8px;align-items:center;justify-content:flex-start;flex-wrap:wrap;margin:16px 0}.fwup-dashboard .fwup-actions>.cbi-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:32px;min-height:32px;margin:0;padding:0 12px}.fwup-dashboard .fwup-release{display:flow-root}.modal.fwup-modal{box-sizing:border-box;width:560px;min-width:0;max-width:min(560px,calc(100vw - 32px))}.fwup-modal .fwup-progress{height:6px;border-radius:3px;overflow:hidden;background:var(--cbi-input-bg,#eee)}.fwup-modal .fwup-progress>i{display:block;height:100%;background:var(--cbi-link-color,#0ea5e9);transition:width .25s}\
@media(max-width:760px){.fwup-dashboard .fwup-summary{grid-template-columns:minmax(0,1fr)}.fwup-dashboard .fwup-panel{padding:10px}.fwup-dashboard .fwup-row{align-items:flex-start;flex-direction:column;gap:8px}.fwup-dashboard .fwup-key{flex:none}.fwup-dashboard .fwup-input{width:100%}}\
';

function bytes(n) { n = Number(n); if (!Number.isFinite(n) || n < 0) return '—'; return n < 1048576 ? (n / 1024).toFixed(1) + ' KiB' : (n / 1048576).toFixed(1) + ' MiB'; }
function publishedTime(value) {
	var date = typeof value === 'string' && value.trim() ? new Date(value) : null;
	if (!date || !Number.isFinite(date.getTime())) return '—';
	var parts = {};
	new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).forEach(function(part) { parts[part.type] = part.value; });
	return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute + ':' + parts.second;
}
function validPercent(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100; }
function message(node, kind, text) { node.className = kind ? 'cbi-section-' + kind : ''; node.textContent = text || ''; node.style.display = text ? '' : 'none'; }
function field(label, id, value, type, placeholder) { return E('div', { class: 'fwup-row' }, [ E('label', { class: 'fwup-key', for: id }, label), E('input', { id: id, class: 'cbi-input-text fwup-input', type: type || 'text', value: value || '', placeholder: placeholder || '' }) ]); }

return view.extend({
	info: null,
	load: function() { return callInfo().catch(function() { return {}; }); },
	render: function(info) {
		this.info = info || {};
		var root = E('div', { class: 'cbi-map fwup-dashboard' }, [ E('style', {}, css) ]);
		var notice = E('div', { style: 'display:none' });
		var latest = E('div', { class: 'fwup-value', id: 'fwup-latest' }, _('Not checked'));
		var detail = E('div', { class: 'fwup-release', style: 'display:none' }, [ E('h3', { class: 'fwup-panel-title' }, _('Release details')), E('div', { id: 'fwup-detail' }) ]);
		root.appendChild(E('div', { class: 'cbi-map-descr' }, _('Check a verified GitHub Release image before upgrading.')));
		root.appendChild(E('div', { class: 'fwup-summary' }, [
			E('div', { class: 'fwup-card' }, [ E('div', { class: 'fwup-label cbi-value-description' }, _('Current firmware')), E('div', { class: 'fwup-value' }, [ this.info.local_version || '—' ]), E('div', { class: 'fwup-sub cbi-value-description' }, [ this.info.distribution || 'OpenWrt', this.info.variant ? ' · ' + this.info.variant : '' ]) ]),
			E('div', { class: 'fwup-card' }, [ E('div', { class: 'fwup-label cbi-value-description' }, _('Latest release')), latest, E('div', { class: 'fwup-sub cbi-value-description', id: 'fwup-release-date', title: 'Asia/Shanghai (UTC+08:00)' }, _('Not checked')) ])
		]));
		root.appendChild(E('div', { class: 'fwup-panel' }, [
			E('h3', { class: 'fwup-panel-title' }, _('Firmware upgrade')),
			notice,
			E('div', { class: 'fwup-actions' }, [ E('button', { class: 'cbi-button cbi-button-action', click: ui.createHandlerFn(this, 'check', notice, latest, detail) }, _('Check update')) ]),
			detail
		]));
		root.appendChild(E('div', { class: 'fwup-panel' }, [
			E('h3', { class: 'fwup-panel-title' }, _('Repository settings')),
			field(_('GitHub repository'), 'fwup-repo', this.info.repository, 'text', this.info.default_repository || 'owner/repository'),
			field(_('Release tag pattern'), 'fwup-release-pattern', this.info.release_pattern),
			field(_('Firmware file pattern'), 'fwup-asset-pattern', this.info.asset_pattern),
			E('p', { class: 'cbi-value-description' }, _('Patterns are case-sensitive: * matches any text, ? matches one character. Save before checking. Changing repository clears both rules.')),
			field(_('GitHub download proxy'), 'fwup-proxy', this.info.download_proxy, 'url', 'https://gh-proxy.com/'),
			E('p', { class: 'cbi-value-description' }, _('Optional; blank connects directly. Only image downloads use this prefix; release checks connect to GitHub directly. Prefer HTTPS.')),
			field(_('GitHub access token'), 'fwup-token', '', 'password'),
			E('div', { class: 'fwup-row' }, [ E('label', { class: 'fwup-key', for: 'fwup-keep' }, _('Keep settings by default')), E('input', { id: 'fwup-keep', type: 'checkbox', checked: this.info.keep_config === '1' }) ]),
			E('div', { class: 'fwup-actions' }, [ E('button', { class: 'cbi-button cbi-button-action', click: ui.createHandlerFn(this, 'save', notice) }, _('Save settings')) ])
		]));
		var self = this; this.settingsDirty = false; this.settingsRevision = 0;
		var invalidate = function() { self.settingsRevision++; self.settingsDirty = true; detail.style.display = 'none'; document.getElementById('fwup-detail').textContent = ''; latest.textContent = _('Not checked'); };
		root.querySelector('#fwup-repo').addEventListener('input', function() { root.querySelector('#fwup-release-pattern').value = ''; root.querySelector('#fwup-asset-pattern').value = ''; invalidate(); });
		[ 'fwup-release-pattern', 'fwup-asset-pattern', 'fwup-proxy', 'fwup-token', 'fwup-keep' ].forEach(function(id) { root.querySelector('#' + id).addEventListener('input', invalidate); });
		return root;
	},
	check: function(notice, latest, detail, ev) {
		if (this.settingsBusy) return Promise.resolve();
		if (this.settingsDirty) { message(notice, 'error', _('Save settings before checking.')); return Promise.resolve(); }
		var self = this, revision = this.settingsRevision; this.settingsBusy = true;
		var button = ev.currentTarget; button.disabled = true; button.textContent = _('Checking…'); message(notice); latest.textContent = _('Not checked'); detail.style.display = 'none'; document.getElementById('fwup-detail').textContent = ''; document.getElementById('fwup-release-date').textContent = '';
		return callCheck().then(L.bind(function(result) {
			self.settingsBusy = false; button.disabled = false; button.textContent = _('Check update');
			if (revision !== this.settingsRevision) return;
			if (!result || !result.success || !/^[a-f0-9]{32}$/.test(result.candidate_id || '')) { latest.textContent = _('Not checked'); detail.style.display = 'none'; document.getElementById('fwup-detail').textContent = ''; message(notice, 'error', result && result.error || _('Failed to check for updates.')); return; }
			latest.textContent = result.tag_name || '—'; document.getElementById('fwup-release-date').textContent = publishedTime(result.published_at);
			var details = document.getElementById('fwup-detail'); details.textContent = '';
			[ [_('Image'), result.asset_name], [_('Size'), bytes(result.asset_size)], [_('SHA256'), result.sha256] ].forEach(function(row) { details.appendChild(E('div', { class: 'fwup-row' }, [ E('div', { class: 'fwup-key' }, row[0]), E('div', { class: 'fwup-data' }, [ row[1] || '—' ]) ])); });
			var keep = E('input', { type: 'checkbox', checked: document.getElementById('fwup-keep').checked });
			details.appendChild(E('div', { class: 'fwup-row' }, [ E('label', { class: 'fwup-key' }, _('Keep settings')), keep ]));
			details.appendChild(E('div', { class: 'fwup-actions' }, [ E('button', { class: 'cbi-button cbi-button-negative', click: ui.createHandlerFn(this, 'confirm', keep, notice, result.candidate_id) }, _('Upgrade firmware')) ]));
			detail.style.display = '';
			message(notice, 'info', _('Release verified. Review the image before upgrading.'));
		}, this)).catch(function(error) { self.settingsBusy = false; button.disabled = false; button.textContent = _('Check update'); if (revision !== self.settingsRevision) return; message(notice, 'error', _('Failed to check for updates.') + (error && error.message ? ' ' + error.message : '')); });
	},
	confirm: function(keep, notice, candidateId) {
		ui.showModal(_('Confirm firmware upgrade'), [ E('p', {}, _('The verified image will be downloaded, checked again, and flashed.')), E('div', { class: 'right' }, [ E('button', { class: 'cbi-button', click: ui.hideModal }, _('Cancel')), ' ', E('button', { class: 'cbi-button cbi-button-negative', click: ui.createHandlerFn(this, 'start', keep.checked ? '1' : '0', notice, candidateId) }, _('Start upgrade')) ]) ], 'fwup-modal');
	},
	start: function(keep, notice, candidateId) {
		return callStart(keep, candidateId).then(L.bind(function(result) { if (!result || !result.success) { ui.hideModal(); message(notice, 'error', result && result.error || _('Unable to start upgrade.')); return; } this.progress(); }, this));
	},
	progress: function() {
		var value = E('i', { style: 'width:0%' }); var text = E('p', {}, _('Preparing upgrade…')); var box = E('div', {}, [ text, E('div', { class: 'fwup-progress' }, value) ]); ui.showModal(_('Upgrading firmware'), [ box ], 'fwup-modal');
		var refresh = function() { if (!box.isConnected) { poll.remove(refresh); return Promise.resolve(); } return callStatus().then(function(s) { s = s || {}; text.textContent = s.message || _('Preparing upgrade…'); value.style.width = validPercent(s.percent) ? s.percent + '%' : '0%'; if (s.stage === 'error' || s.stage === 'complete') { poll.remove(refresh); ui.showModal(s.stage === 'error' ? _('Firmware upgrade failed') : _('Firmware upgrade complete'), [ box, E('div', { class: 'right' }, [ E('button', { class: 'cbi-button', click: ui.hideModal }, _('Close')) ]) ], 'fwup-modal'); } }).catch(function() { if (box.isConnected) text.textContent = _('Unable to retrieve upgrade status.'); }); };
		poll.add(refresh, 1); refresh();
	},
	save: function(notice, ev) {
		if (this.settingsBusy) return Promise.resolve();
		this.settingsBusy = true;
		var self = this, revision = this.settingsRevision; var button = ev.currentTarget; button.disabled = true;
		return callSave(document.getElementById('fwup-repo').value.trim(), document.getElementById('fwup-token').value.trim(), document.getElementById('fwup-keep').checked ? '1' : '0', document.getElementById('fwup-release-pattern').value.trim(), document.getElementById('fwup-asset-pattern').value.trim(), document.getElementById('fwup-proxy').value.trim()).then(function(result) { self.settingsBusy = false; button.disabled = false; if (revision !== self.settingsRevision) return; if (result && result.success) self.settingsDirty = false; document.getElementById('fwup-detail').textContent = ''; document.getElementById('fwup-latest').textContent = _('Not checked'); message(notice, result && result.success ? 'info' : 'error', result && result.success ? _('Settings saved.') : result && result.error || _('Failed to save settings.')); }).catch(function() { self.settingsBusy = false; button.disabled = false; if (revision !== self.settingsRevision) return; message(notice, 'error', _('Failed to save settings.')); });
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});
