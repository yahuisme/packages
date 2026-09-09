'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require fs';

var callGetSystemInfo = rpc.declare({
	object: 'luci.firmwareupgrade',
	method: 'getSystemInfo',
	expect: { '': {} }
});

var callCheckUpdate = rpc.declare({
	object: 'luci.firmwareupgrade',
	method: 'checkUpdate',
	expect: { '': {} }
});

var callGetStatus = rpc.declare({
	object: 'luci.firmwareupgrade',
	method: 'getStatus',
	expect: { '': {} }
});

var callStartUpgrade = rpc.declare({
	object: 'luci.firmwareupgrade',
	method: 'startUpgrade',
	params: [ 'download_url', 'asset_name', 'sha256', 'sha256sums_url', 'keep_config', 'asset_size' ],
	expect: { '': {} }
});

var callSaveSettings = rpc.declare({
	object: 'luci.firmwareupgrade',
	method: 'saveSettings',
	params: [ 'repository', 'proxy', 'token', 'keep_config' ],
	expect: { '': {} }
});

var appCSS = '\
:root{--fw-canvas-bg:#fbfcfd;--fw-track-bg:rgba(128,128,128,.14)}\
@media(prefers-color-scheme:dark){:root{--fw-canvas-bg:#161616;--fw-track-bg:rgba(255,255,255,.10)}}\
[data-theme="dark"],[data-dark="true"],[data-darkmode="true"],.dark-mode,:root[data-dark="true"]{--fw-canvas-bg:#161616;--fw-track-bg:rgba(255,255,255,.10)}\
.fwup-container{--fw-font-ui:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--fw-font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-family:var(--fw-font-ui);font-size:13px;line-height:1.5;color:var(--cbi-text-color,inherit);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}\
.fwup-tabs{display:flex;gap:4px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0);margin:14px 0 18px}\
.fwup-tab{padding:8px 18px;font-size:13px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--cbi-muted-color,#666);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s ease}\
.fwup-tab.active{color:var(--cbi-button-primary-bg,#0066cc);border-bottom-color:var(--cbi-button-primary-bg,#0066cc);font-weight:600}\
.fwup-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px}\
.fwup-card{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:10px 14px;min-height:76px;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box}\
.fwup-card-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.5px;color:var(--cbi-muted-color,#666);margin-bottom:4px}\
.fwup-card-value{font-size:18px;font-family:var(--fw-font-mono);font-variant-numeric:tabular-nums;font-weight:600;color:var(--cbi-text-color,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.fwup-card-sub{font-size:12px;color:var(--cbi-muted-color,#888);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.fwup-panel{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:14px;margin:14px 0;box-sizing:border-box}\
.fwup-panel-title{font-size:15px;font-weight:600;color:var(--cbi-text-color,inherit);padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0);display:flex;align-items:center;justify-content:space-between}\
.fwup-value-row{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--cbi-border-color,rgba(128,128,128,.08))}\
.fwup-value-row:last-child{border-bottom:none}\
.fwup-value-label{width:220px;flex:0 0 220px;font-size:13px;font-weight:500;color:var(--cbi-muted-color,#666)}\
.fwup-value-content{flex:1;min-width:0;display:flex;align-items:center;gap:12px}\
.fwup-input{height:32px;border-radius:4px;border:1px solid var(--cbi-border-color,#ccc);padding:0 10px;font-size:13px;font-family:var(--fw-font-mono);font-variant-numeric:tabular-nums;width:100%;max-width:380px;background:var(--cbi-input-bg,transparent);color:inherit;box-sizing:border-box}\
.fwup-input:focus{border-color:var(--cbi-button-primary-bg,#0066cc);outline:none}\
.fwup-notes{background:var(--fw-canvas-bg,#fbfcfd);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:4px;padding:12px 14px;font-size:12px;line-height:1.6;max-height:220px;overflow-y:auto;white-space:pre-wrap;font-family:var(--fw-font-mono);font-variant-numeric:tabular-nums}\
.fwup-btn{height:32px;padding:0 16px;border-radius:4px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid var(--cbi-border-color,#ccc);background:var(--cbi-button-bg,#f5f5f5);color:inherit;transition:all .15s ease}\
.fwup-btn-primary{background:var(--cbi-button-primary-bg,#0066cc);color:#fff;border-color:var(--cbi-button-primary-border,#0055aa)}\
.fwup-btn:hover{opacity:.9}\
.fwup-btn[disabled]{opacity:.5;cursor:not-allowed}\
.fwup-progress-wrap{width:100%;background:var(--fw-track-bg,rgba(128,128,128,.14));border-radius:999px;height:12px;overflow:hidden;margin:12px 0}\
.fwup-progress-bar{height:100%;border-radius:inherit;background:#0ea5e9;transition:width .3s ease}\
.fwup-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:500;background:rgba(128,128,128,.12);color:inherit}\
.fwup-descr{font-size:12px;color:var(--cbi-muted-color,#888);margin-top:2px}\
@media(max-width:768px){\
.fwup-grid{grid-template-columns:1fr}\
.fwup-card{min-height:68px}\
.fwup-panel{padding:10px}\
.fwup-value-row{flex-direction:column;align-items:flex-start;gap:6px}\
.fwup-value-label{width:auto;flex:none}\
.fwup-value-content{width:100%}\
.fwup-input{max-width:100%}\
}\
';

function injectCSS() {
	if (document.getElementById('fwup-theme-css')) return;
	var el = document.createElement('style');
	el.id = 'fwup-theme-css';
	el.textContent = appCSS;
	document.head.appendChild(el);
}

function formatBytes(bytes) {
	if (!bytes || bytes === 0) return '0 B';
	var k = 1024;
	var sizes = ['B', 'KB', 'MB', 'GB'];
	var i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

return view.extend({
	sysInfo: null,
	updateInfo: null,
	activeTab: 'upgrade',

	load: function() {
		return callGetSystemInfo();
	},

	render: function(sysInfo) {
		injectCSS();
		this.sysInfo = sysInfo || {};

		var viewRoot = E('div', { 'class': 'fwup-container' }, [
			E('h2', {}, _('Firmware Upgrade')),
			E('p', { 'class': 'cbi-section-descr' }, _('Check and securely flash the latest firmware builds from GitHub Release.')),

			// Tab Navigation
			E('div', { 'class': 'fwup-tabs' }, [
				E('button', {
					'class': 'fwup-tab active',
					'id': 'tab-btn-upgrade',
					'click': ui.createHandlerFn(this, 'switchTab', 'upgrade')
				}, _('Firmware Upgrade')),
				E('button', {
					'class': 'fwup-tab',
					'id': 'tab-btn-settings',
					'click': ui.createHandlerFn(this, 'switchTab', 'settings')
				}, _('Settings'))
			]),

			// Tab 1: Upgrade Panel
			E('div', { 'id': 'tab-content-upgrade' }, [
				// Dual Cards
				E('div', { 'class': 'fwup-grid' }, [
					E('div', { 'class': 'fwup-card' }, [
						E('div', { 'class': 'fwup-card-title' }, _('Current Firmware')),
						E('div', { 'class': 'fwup-card-value', 'id': 'fwup-cur-ver' }, sysInfo.local_version || _('Unknown')),
						E('div', { 'class': 'fwup-card-sub' }, [
							E('span', { 'class': 'fwup-badge' }, (sysInfo.distribution || 'OpenWrt') + (sysInfo.variant ? ' · ' + sysInfo.variant : '')),
							' ',
							E('span', {}, sysInfo.board || sysInfo.model || '')
						])
					]),
					E('div', { 'class': 'fwup-card' }, [
						E('div', { 'class': 'fwup-card-title' }, _('Latest Available Release')),
						E('div', { 'class': 'fwup-card-value', 'id': 'fwup-latest-ver' }, _('Not Checked')),
						E('div', { 'class': 'fwup-card-sub', 'id': 'fwup-latest-sub' }, _('Click check button below to detect new version'))
					])
				]),

				// Control Section
				E('div', { 'class': 'fwup-panel' }, [
					E('div', { 'class': 'fwup-panel-title' }, [
						E('span', {}, _('Upgrade Control')),
						E('button', {
							'class': 'fwup-btn fwup-btn-primary',
							'id': 'fwup-check-btn',
							'click': ui.createHandlerFn(this, 'handleCheckUpdate')
						}, _('Check Update'))
					]),

					E('div', { 'id': 'fwup-status-notice', 'style': 'margin-bottom:12px;display:none;' }),

					// Detailed update info
					E('div', { 'id': 'fwup-upgrade-details', 'style': 'display:none;' }, [
						E('div', { 'class': 'fwup-value-row' }, [
							E('div', { 'class': 'fwup-value-label' }, _('Target Image')),
							E('div', { 'class': 'fwup-value-content', 'id': 'fwup-asset-name' }, '-')
						]),
						E('div', { 'class': 'fwup-value-row' }, [
							E('div', { 'class': 'fwup-value-label' }, _('Image Size')),
							E('div', { 'class': 'fwup-value-content', 'id': 'fwup-asset-size' }, '-')
						]),
						E('div', { 'class': 'fwup-value-row' }, [
							E('div', { 'class': 'fwup-value-label' }, _('SHA256 Checksum')),
							E('div', { 'class': 'fwup-value-content', 'style': 'font-family:var(--fw-font-mono);font-size:12px;', 'id': 'fwup-asset-sha' }, '-')
						]),
						E('div', { 'class': 'fwup-value-row' }, [
							E('div', { 'class': 'fwup-value-label' }, _('Upgrade Mode')),
							E('div', { 'class': 'fwup-value-content' }, [
								E('label', { 'style': 'display:inline-flex;align-items:center;gap:6px;cursor:pointer;' }, [
									E('input', { 'type': 'checkbox', 'id': 'fwup-keep-config', 'checked': sysInfo.keep_config === '1' }),
									E('span', {}, _('Keep current settings (uncheck for clean install)'))
								])
							])
						]),
						E('div', { 'class': 'fwup-value-row', 'style': 'padding-top:14px;' }, [
							E('div', { 'class': 'fwup-value-label' }, ''),
							E('div', { 'class': 'fwup-value-content' }, [
								E('button', {
									'class': 'fwup-btn fwup-btn-primary',
									'id': 'fwup-upgrade-btn',
									'click': ui.createHandlerFn(this, 'handleStartUpgrade')
								}, _('Upgrade Firmware Now'))
							])
						])
					]),

					// Changelog Area
					E('div', { 'id': 'fwup-changelog-wrap', 'style': 'display:none;margin-top:16px;' }, [
						E('div', { 'class': 'fwup-card-title', 'style': 'margin-bottom:8px;' }, _('Release Notes')),
						E('div', { 'class': 'fwup-notes', 'id': 'fwup-changelog' })
					])
				])
			]),

			// Tab 2: Settings Panel
			E('div', { 'id': 'tab-content-settings', 'style': 'display:none;' }, [
				E('div', { 'class': 'fwup-panel' }, [
					E('div', { 'class': 'fwup-panel-title' }, [
						E('span', {}, _('Repository & Network Settings'))
					]),

					E('div', { 'id': 'fwup-settings-notice', 'style': 'margin-bottom:12px;display:none;' }),

					E('div', { 'class': 'fwup-value-row' }, [
						E('div', { 'class': 'fwup-value-label' }, [
							_('GitHub Repository'),
							E('div', { 'class': 'fwup-descr' }, _('Target GitHub release repository (owner/repo)'))
						]),
						E('div', { 'class': 'fwup-value-content' }, [
							E('input', {
								'type': 'text',
								'class': 'fwup-input',
								'id': 'cfg-repository',
								'value': sysInfo.repository || '',
								'placeholder': sysInfo.default_repository || 'owner/repo'
							})
						])
					]),

					E('div', { 'class': 'fwup-value-row' }, [
						E('div', { 'class': 'fwup-value-label' }, [
							_('Download Mirror / Proxy'),
							E('div', { 'class': 'fwup-descr' }, _('Leave empty for direct GitHub connection'))
						]),
						E('div', { 'class': 'fwup-value-content' }, [
							E('input', {
								'type': 'text',
								'class': 'fwup-input',
								'id': 'cfg-proxy',
								'value': sysInfo.proxy || '',
								'placeholder': 'https://ghproxy.net/'
							})
						])
					]),

					E('div', { 'class': 'fwup-value-row' }, [
						E('div', { 'class': 'fwup-value-label' }, [
							_('GitHub Access Token'),
							E('div', { 'class': 'fwup-descr' }, _('Optional, for private repositories or avoiding rate limits'))
						]),
						E('div', { 'class': 'fwup-value-content' }, [
							E('input', {
								'type': 'password',
								'class': 'fwup-input',
								'id': 'cfg-token',
								'placeholder': 'ghp_xxxxxxxxxxxx'
							})
						])
					]),

					E('div', { 'class': 'fwup-value-row' }, [
						E('div', { 'class': 'fwup-value-label' }, [
							_('Default Upgrade Mode')
						]),
						E('div', { 'class': 'fwup-value-content' }, [
							E('label', { 'style': 'display:inline-flex;align-items:center;gap:6px;cursor:pointer;' }, [
								E('input', { 'type': 'checkbox', 'id': 'cfg-keep-config', 'checked': sysInfo.keep_config === '1' }),
								E('span', {}, _('Keep settings by default (uncheck for clean install)'))
							])
						])
					]),

					E('div', { 'class': 'fwup-value-row', 'style': 'padding-top:14px;' }, [
						E('div', { 'class': 'fwup-value-label' }, ''),
						E('div', { 'class': 'fwup-value-content' }, [
							E('button', {
								'class': 'fwup-btn fwup-btn-primary',
								'id': 'cfg-save-btn',
								'click': ui.createHandlerFn(this, 'handleSaveSettings')
							}, _('Save Settings'))
						])
					])
				])
			])
		]);

		return viewRoot;
	},

	switchTab: function(tabName) {
		this.activeTab = tabName;
		var isUpgrade = tabName === 'upgrade';

		document.getElementById('tab-btn-upgrade').className = 'fwup-tab' + (isUpgrade ? ' active' : '');
		document.getElementById('tab-btn-settings').className = 'fwup-tab' + (!isUpgrade ? ' active' : '');

		document.getElementById('tab-content-upgrade').style.display = isUpgrade ? '' : 'none';
		document.getElementById('tab-content-settings').style.display = !isUpgrade ? '' : 'none';
	},

	handleSaveSettings: function(ev) {
		var btn = ev.target;
		btn.disabled = true;
		btn.textContent = _('Saving...');

		var noticeEl = document.getElementById('fwup-settings-notice');
		noticeEl.style.display = 'none';

		var repo = document.getElementById('cfg-repository').value.trim();
		var proxy = document.getElementById('cfg-proxy').value.trim();
		var token = document.getElementById('cfg-token').value.trim();
		var keepConfig = document.getElementById('cfg-keep-config').checked ? '1' : '0';

		return callSaveSettings(repo, proxy, token, keepConfig).then(L.bind(function(res) {
			btn.disabled = false;
			btn.textContent = _('Save Settings');

			if (res && res.success) {
				noticeEl.className = 'cbi-section-info';
				noticeEl.textContent = _('Settings saved successfully.');
				noticeEl.style.display = '';
				document.getElementById('fwup-keep-config').checked = (keepConfig === '1');
			} else {
				noticeEl.className = 'cbi-section-error';
				noticeEl.textContent = _('Failed to save settings.');
				noticeEl.style.display = '';
			}
		}, this)).catch(function(err) {
			btn.disabled = false;
			btn.textContent = _('Save Settings');
			noticeEl.className = 'cbi-section-error';
			noticeEl.textContent = _('Error saving settings: ') + err.message;
			noticeEl.style.display = '';
		});
	},

	handleCheckUpdate: function(ev) {
		var btn = ev.target;
		btn.disabled = true;
		btn.textContent = _('Checking...');

		var noticeEl = document.getElementById('fwup-status-notice');
		noticeEl.style.display = 'none';

		return callCheckUpdate().then(L.bind(function(res) {
			btn.disabled = false;
			btn.textContent = _('Check Update');

			if (!res || !res.success) {
				noticeEl.className = 'cbi-section-error';
				noticeEl.textContent = (res && res.error) ? res.error : _('Failed to check for updates.');
				noticeEl.style.display = '';
				return;
			}

			this.updateInfo = res;

			// Update cards
			document.getElementById('fwup-latest-ver').textContent = res.tag_name;
			var pubDate = res.published_at ? res.published_at.replace('T', ' ').replace('Z', ' UTC') : '';
			document.getElementById('fwup-latest-sub').textContent = _('Release Date: ') + pubDate;

			// Details
			document.getElementById('fwup-asset-name').textContent = res.asset_name;
			document.getElementById('fwup-asset-size').textContent = formatBytes(res.asset_size);
			document.getElementById('fwup-asset-sha').textContent = res.sha256 ? res.sha256 : _('Provided by sha256sums');

			if (res.body) {
				document.getElementById('fwup-changelog').textContent = res.body;
				document.getElementById('fwup-changelog-wrap').style.display = '';
			} else {
				document.getElementById('fwup-changelog-wrap').style.display = 'none';
			}

			document.getElementById('fwup-upgrade-details').style.display = '';

			noticeEl.className = 'cbi-section-info';
			noticeEl.textContent = _('Successfully retrieved latest release. Please verify before flashing.');
			noticeEl.style.display = '';

		}, this)).catch(function(err) {
			btn.disabled = false;
			btn.textContent = _('Check Update');
			noticeEl.className = 'cbi-section-error';
			noticeEl.textContent = _('Request error: ') + err.message;
			noticeEl.style.display = '';
		});
	},

	handleStartUpgrade: function() {
		if (!this.updateInfo) return;

		var keepConfig = document.getElementById('fwup-keep-config').checked ? '1' : '0';
		var assetName = this.updateInfo.asset_name;
		var tagName = this.updateInfo.tag_name;

		ui.showModal(_('Confirm Firmware Upgrade'), [
			E('p', {}, _('Please verify the following upgrade parameters:')),
			E('ul', { 'style': 'margin:10px 0 14px 20px;line-height:1.8;' }, [
				E('li', {}, [ E('strong', {}, _('Device Model: ')), this.sysInfo.model || this.sysInfo.board ]),
				E('li', {}, [ E('strong', {}, _('Target Version: ')), tagName ]),
				E('li', {}, [ E('strong', {}, _('Firmware File: ')), assetName ]),
				E('li', {}, [ E('strong', {}, _('Keep Settings: ')), keepConfig === '1' ? _('Yes') : _('No (Clean Install)') ])
			]),
			E('p', { 'style': 'color:#d93025;font-weight:500;' }, _('Warning: Do not power off or reboot the device during flashing!')),
			E('div', { 'class': 'right', 'style': 'margin-top:16px;' }, [
				E('button', {
					'class': 'fwup-btn',
					'click': ui.hideModal
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'fwup-btn fwup-btn-primary',
					'click': ui.createHandlerFn(this, 'executeUpgradeProcess', keepConfig)
				}, _('Confirm & Start Upgrade'))
			])
		]);
	},

	executeUpgradeProcess: function(keepConfig) {
		var info = this.updateInfo;

		callStartUpgrade(
			info.download_url,
			info.asset_name,
			info.sha256 || '',
			info.sha256sums_url || '',
			keepConfig,
			String(info.asset_size || 0)
		).then(L.bind(function(res) {
			if (!res || !res.success) {
				ui.addNotification(null, E('p', {}, (res && res.error) ? res.error : _('Failed to launch upgrade process.')), 'error');
				return;
			}
			this.showUpgradeProgressModal();
		}, this));
	},

	showUpgradeProgressModal: function() {
		var modalBody = E('div', {}, [
			E('h4', { 'id': 'fwup-modal-msg' }, _('Initializing upgrade...')),
			E('div', { 'class': 'fwup-progress-wrap' }, [
				E('div', { 'class': 'fwup-progress-bar', 'id': 'fwup-modal-bar', 'style': 'width: 5%;' })
			]),
			E('p', { 'id': 'fwup-modal-sub', 'style': 'font-size:12px;color:var(--cbi-muted-color,#888);' }, _('Processing securely in the background, please wait...'))
		]);

		ui.showModal(_('Upgrading System Firmware'), [ modalBody ]);

		this.startStatusPoll();
	},

	startStatusPoll: function() {
		var interval = setInterval(L.bind(function() {
			callGetStatus().then(L.bind(function(status) {
				if (!status) return;

				var msgEl = document.getElementById('fwup-modal-msg');
				var barEl = document.getElementById('fwup-modal-bar');
				var subEl = document.getElementById('fwup-modal-sub');

				if (!msgEl || !barEl) return;

				if (status.message) msgEl.textContent = status.message;
				if (status.percent) barEl.style.width = status.percent + '%';

				if (status.stage === 'error') {
					clearInterval(interval);
					subEl.textContent = _('Upgrade encountered an error and was aborted.');
					subEl.style.color = '#d93025';
				} else if (status.stage === 'flashing') {
					clearInterval(interval);
					this.startRebootWatch();
				}
			}, this)).catch(L.bind(function() {
				clearInterval(interval);
				this.startRebootWatch();
			}, this));
		}, this), 1500);
	},

	startRebootWatch: function() {
		var countdown = 65;
		var msgEl = document.getElementById('fwup-modal-msg');
		var subEl = document.getElementById('fwup-modal-sub');
		var barEl = document.getElementById('fwup-modal-bar');

		if (barEl) barEl.style.width = '100%';
		if (msgEl) msgEl.textContent = _('Firmware flashing complete. Router is rebooting...');

		var timer = setInterval(function() {
			countdown--;
			if (subEl) {
				subEl.textContent = _('Waiting for system to come online, remaining: ') + countdown + ' ' + _('seconds');
			}

			if (countdown <= 30) {
				fetch(window.location.origin, { method: 'HEAD', mode: 'no-cors' }).then(function() {
					clearInterval(timer);
					window.location.href = window.location.origin;
				}).catch(function() {});
			}

			if (countdown <= 0) {
				clearInterval(timer);
				window.location.href = window.location.origin;
			}
		}, 1000);
	}
});
