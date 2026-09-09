'use strict';
'require poll';
'require rpc';
'require ui';
'require view';

var callInfo = rpc.declare({ object: 'luci.firmwareupgrade', method: 'getSystemInfo', expect: { '': {} } });
var callCheck = rpc.declare({ object: 'luci.firmwareupgrade', method: 'checkUpdate', expect: { '': {} } });
var callStatus = rpc.declare({ object: 'luci.firmwareupgrade', method: 'getStatus', expect: { '': {} } });
var callStart = rpc.declare({ object: 'luci.firmwareupgrade', method: 'startUpgrade', params: [ 'keep_config', 'candidate_id' ], expect: { '': {} } });
var callSave = rpc.declare({ object: 'luci.firmwareupgrade', method: 'saveSettings', params: [ 'repository', 'token', 'keep_config' ], expect: { '': {} } });

var css = '\
.fwup-dashboard{font-size:13px;line-height:1.5}\
.fwup-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}\
.fwup-card,.fwup-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;box-sizing:border-box}\
.fwup-card{min-height:72px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center}.fwup-label{font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--cbi-muted-color,#666);margin-bottom:3px}.fwup-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fwup-sub{font-size:12px;color:var(--cbi-muted-color,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.fwup-panel{padding:12px;margin:12px 0}.fwup-panel-title{font-size:15px;font-weight:600;padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0)}.fwup-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--cbi-border-color,#f0f0f0)}.fwup-row:last-child{border-bottom:0}.fwup-key{flex:0 0 176px;color:var(--cbi-muted-color,#666);font-weight:500}.fwup-data{min-width:0;overflow-wrap:anywhere}.fwup-input{width:min(100%,380px);height:32px;box-sizing:border-box}.fwup-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.fwup-notes{max-height:200px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:monospace;font-size:12px;color:var(--cbi-muted-color,#666)}.fwup-progress{height:6px;border-radius:3px;overflow:hidden;background:var(--cbi-input-bg,#eee)}.fwup-progress>i{display:block;height:100%;background:var(--cbi-link-color,#0ea5e9);transition:width .25s}\
@media(max-width:760px){.fwup-summary{grid-template-columns:1fr}.fwup-panel{padding:10px}.fwup-row{align-items:flex-start;flex-direction:column;gap:6px}.fwup-key{flex:none}.fwup-input{width:100%}}\
';

function injectCSS() { if (!document.getElementById('fwup-css')) { var node = document.createElement('style'); node.id = 'fwup-css'; node.textContent = css; document.head.appendChild(node); } }
function bytes(n) { n = Number(n); if (!Number.isFinite(n) || n < 0) return '—'; return n < 1048576 ? (n / 1024).toFixed(1) + ' KiB' : (n / 1048576).toFixed(1) + ' MiB'; }
function validPercent(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100; }
function message(node, kind, text) { node.className = kind ? 'cbi-section-' + kind : ''; node.textContent = text || ''; node.style.display = text ? '' : 'none'; }
function field(label, id, value, type, placeholder) { return E('div', { class: 'fwup-row' }, [ E('label', { class: 'fwup-key', for: id }, label), E('input', { id: id, class: 'cbi-input-text fwup-input', type: type || 'text', value: value || '', placeholder: placeholder || '' }) ]); }

return view.extend({
	info: null,
	load: function() { return callInfo().catch(function() { return {}; }); },
	render: function(info) {
		injectCSS(); this.info = info || {};
		var root = E('div', { class: 'cbi-map fwup-dashboard' });
		var notice = E('div', { style: 'display:none' });
		var latest = E('div', { class: 'fwup-value', id: 'fwup-latest' }, _('Not checked'));
		var detail = E('div', { class: 'fwup-panel', style: 'display:none' }, [ E('div', { class: 'fwup-panel-title' }, _('Release details')), E('div', { id: 'fwup-detail' }), E('pre', { class: 'fwup-notes', id: 'fwup-notes' }) ]);
		root.appendChild(E('div', { class: 'cbi-map-descr' }, _('Check a verified GitHub Release image before upgrading.')));
		root.appendChild(E('div', { class: 'fwup-summary' }, [
			E('div', { class: 'fwup-card' }, [ E('div', { class: 'fwup-label' }, _('Current firmware')), E('div', { class: 'fwup-value' }, this.info.local_version || '—'), E('div', { class: 'fwup-sub' }, [ this.info.distribution || 'OpenWrt', this.info.variant ? ' · ' + this.info.variant : '' ]) ]),
			E('div', { class: 'fwup-card' }, [ E('div', { class: 'fwup-label' }, _('Latest release')), latest, E('div', { class: 'fwup-sub', id: 'fwup-release-date' }, _('Not checked')) ])
		]));
		root.appendChild(E('div', { class: 'fwup-panel' }, [
			E('div', { class: 'fwup-panel-title' }, _('Firmware upgrade')),
			notice,
			E('div', { class: 'fwup-actions' }, [ E('button', { class: 'cbi-button cbi-button-action', click: ui.createHandlerFn(this, 'check', notice, latest, detail) }, _('Check update')) ]),
			detail
		]));
		root.appendChild(E('div', { class: 'fwup-panel' }, [
			E('div', { class: 'fwup-panel-title' }, _('Repository settings')),
			field(_('GitHub repository'), 'fwup-repo', this.info.repository, 'text', this.info.default_repository || 'owner/repository'),
			field(_('GitHub access token'), 'fwup-token', '', 'password'),
			E('div', { class: 'fwup-row' }, [ E('label', { class: 'fwup-key', for: 'fwup-keep' }, _('Keep settings by default')), E('input', { id: 'fwup-keep', type: 'checkbox', checked: this.info.keep_config === '1' }) ]),
			E('div', { class: 'fwup-actions' }, [ E('button', { class: 'cbi-button cbi-button-action', click: ui.createHandlerFn(this, 'save', notice) }, _('Save settings')) ])
		]));
		return root;
	},
	check: function(notice, latest, detail, ev) {
		var button = ev.currentTarget; button.disabled = true; button.textContent = _('Checking…'); message(notice); latest.textContent = _('Not checked'); detail.style.display = 'none'; document.getElementById('fwup-detail').textContent = ''; document.getElementById('fwup-notes').textContent = ''; document.getElementById('fwup-release-date').textContent = '';
		return callCheck().then(L.bind(function(result) {
			button.disabled = false; button.textContent = _('Check update');
			if (!result || !result.success || !/^[a-f0-9]{32}$/.test(result.candidate_id || '')) { latest.textContent = _('Not checked'); detail.style.display = 'none'; document.getElementById('fwup-detail').textContent = ''; document.getElementById('fwup-notes').textContent = ''; message(notice, 'error', result && result.error || _('Failed to check for updates.')); return; }
			latest.textContent = result.tag_name || '—'; document.getElementById('fwup-release-date').textContent = result.published_at || '';
			var details = document.getElementById('fwup-detail'); details.textContent = '';
			[ [_('Image'), result.asset_name], [_('Size'), bytes(result.asset_size)], [_('SHA256'), result.sha256] ].forEach(function(row) { details.appendChild(E('div', { class: 'fwup-row' }, [ E('div', { class: 'fwup-key' }, row[0]), E('div', { class: 'fwup-data' }, row[1] || '—') ])); });
			var keep = E('input', { type: 'checkbox', checked: document.getElementById('fwup-keep').checked });
			details.appendChild(E('div', { class: 'fwup-row' }, [ E('label', { class: 'fwup-key' }, _('Keep settings')), keep ]));
			details.appendChild(E('div', { class: 'fwup-actions' }, [ E('button', { class: 'cbi-button cbi-button-negative', click: ui.createHandlerFn(this, 'confirm', keep, notice, result.candidate_id) }, _('Upgrade firmware')) ]));
			document.getElementById('fwup-notes').textContent = result.body || ''; detail.style.display = '';
			message(notice, 'info', _('Release verified. Review the image before upgrading.'));
		}, this)).catch(function() { button.disabled = false; button.textContent = _('Check update'); message(notice, 'error', _('Failed to check for updates.')); });
	},
	confirm: function(keep, notice, candidateId) {
		ui.showModal(_('Confirm firmware upgrade'), [ E('p', {}, _('The verified image will be downloaded, checked again, and flashed.')), E('div', { class: 'right' }, [ E('button', { class: 'cbi-button', click: ui.hideModal }, _('Cancel')), ' ', E('button', { class: 'cbi-button cbi-button-negative', click: ui.createHandlerFn(this, 'start', keep.checked ? '1' : '0', notice, candidateId) }, _('Start upgrade')) ]) ]);
	},
	start: function(keep, notice, candidateId) {
		return callStart(keep, candidateId).then(L.bind(function(result) { if (!result || !result.success) { ui.hideModal(); message(notice, 'error', result && result.error || _('Unable to start upgrade.')); return; } this.progress(); }, this));
	},
	progress: function() {
		var value = E('i', { style: 'width:0%' }); var text = E('p', {}, _('Preparing upgrade…')); var box = E('div', {}, [ text, E('div', { class: 'fwup-progress' }, value) ]); ui.showModal(_('Upgrading firmware'), [ box ]);
		var refresh = function() { if (!box.isConnected) { poll.remove(refresh); return Promise.resolve(); } return callStatus().then(function(s) { s = s || {}; text.textContent = s.message || _('Preparing upgrade…'); value.style.width = validPercent(s.percent) ? s.percent + '%' : '0%'; if (s.stage === 'error' || s.stage === 'complete') poll.remove(refresh); }).catch(function() { if (box.isConnected) text.textContent = _('Failed to check for updates.'); }); };
		poll.add(refresh, 1); refresh();
	},
	save: function(notice, ev) {
		var button = ev.currentTarget; button.disabled = true;
		return callSave(document.getElementById('fwup-repo').value.trim(), document.getElementById('fwup-token').value.trim(), document.getElementById('fwup-keep').checked ? '1' : '0').then(function(result) { button.disabled = false; message(notice, result && result.success ? 'info' : 'error', result && result.success ? _('Settings saved.') : result && result.error || _('Failed to save settings.')); }).catch(function() { button.disabled = false; message(notice, 'error', _('Failed to save settings.')); });
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});
