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
.fwup-view{--fw-font-ui:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--fw-font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-family:var(--fw-font-ui);font-size:13px;line-height:1.5;color:var(--cbi-text-color,inherit);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}\
.fwup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:14px}\
.fwup-card{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:10px 14px;min-height:76px;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box}\
.fwup-card-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.5px;color:var(--cbi-muted-color,#666);margin-bottom:4px}\
.fwup-card-value{font-size:18px;font-family:var(--fw-font-mono);font-variant-numeric:tabular-nums;font-weight:600;color:var(--cbi-text-color,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.fwup-card-sub{font-size:12px;color:var(--cbi-muted-color,#888);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.fwup-view .cbi-section{background:var(--cbi-section-bg,transparent);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:6px;padding:14px;margin:14px 0;box-sizing:border-box}\
.fwup-view .cbi-section-title{font-size:15px;font-weight:600;color:var(--cbi-text-color,inherit);padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid var(--cbi-border-color,#e0e0e0);display:flex;align-items:center;justify-content:space-between}\
.fwup-view .cbi-value{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--cbi-border-color,rgba(128,128,128,.08))}\
.fwup-view .cbi-value:last-child{border-bottom:none}\
.fwup-view .cbi-value-title{width:220px;flex:0 0 220px;font-size:13px;font-weight:500;color:var(--cbi-muted-color,#666);margin:0}\
.fwup-view .cbi-value-field{flex:1;min-width:0;display:flex;align-items:center;gap:12px;margin:0}\
.fwup-view .cbi-input-text,.fwup-view .cbi-input-password{height:32px;border-radius:4px;font-family:var(--fw-font-mono);font-variant-numeric:tabular-nums;width:100%;max-width:380px;box-sizing:border-box}\
.fwup-view .cbi-button{height:32px;padding:0 16px;border-radius:4px;font-size:12px;font-weight:500;margin:0}\
.fwup-notes{background:var(--fw-canvas-bg,#fbfcfd);border:1px solid var(--cbi-border-color,#e0e0e0);border-radius:4px;padding:12px 14px;font-size:12px;line-height:1.6;max-height:220px;overflow-y:auto;white-space:pre-wrap;font-family:var(--fw-font-mono);font-variant-numeric:tabular-nums}\
.fwup-progress-wrap{width:100%;background:var(--fw-track-bg,rgba(128,128,128,.14));border-radius:999px;height:12px;overflow:hidden;margin:12px 0}\
.fwup-progress-bar{height:100%;border-radius:inherit;background:#0ea5e9;transition:width .3s ease}\
.fwup-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:500;background:rgba(128,128,128,.12);color:inherit}\
.fwup-descr{font-size:12px;color:var(--cbi-muted-color,#888);margin-top:2px}\
@media(max-width:768px){\
.fwup-grid{grid-template-columns:1fr}\
.fwup-card{min-height:68px}\
.fwup-view .cbi-section{padding:10px}\
.fwup-view .cbi-value{flex-direction:column;align-items:flex-start;gap:6px}\
.fwup-view .cbi-value-title{width:auto;flex:none}\
.fwup-view .cbi-value-field{width:100%}\
.fwup-view .cbi-input-text,.fwup-view .cbi-input-password{max-width:100%}\
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

		var viewRoot = E('div', { 'class': 'fwup-view' }, [
			E('h2', {}, _('Firmware Upgrade')),
			E('div', { 'class': 'cbi-map-descr' }, _('Check and securely flash the latest firmware builds from GitHub Release.')),

			// 原生标准 cbi-tabmenu 导航结构
			E('ul', { 'class': 'cbi-tabmenu' }, [
				E('li', {
					'class': 'cbi-tab cbi-tab-active',
					'id': 'tab-nav-upgrade'
				}, [
					E('a', {
						'href': '#',
						'click': ui.createHandlerFn(this, 'switchTab', 'upgrade')
					}, _('Firmware Upgrade'))
				]),
				E('li', {
					'class': 'cbi-tab',
					'id': 'tab-nav-settings'
				}, [
					E('a', {
						'href': '#',
						'click': ui.createHandlerFn(this, 'switchTab', 'settings')
					}, _('Settings'))
				])
			]),

			// Tab 1: 固件升级面板
			E('div', { 'id': 'tab-content-upgrade' }, [
				// 顶部中性双卡片
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

				// 原生 cbi-section 升级控制区
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'cbi-section-title' }, [
						E('span', {}, _('Upgrade Control')),
						E('button', {
							'class': 'cbi-button cbi-button-primary',
							'id': 'fwup-check-btn',
							'click': ui.createHandlerFn(this, 'handleCheckUpdate')
						}, _('Check Update'))
					]),

					E('div', { 'id': 'fwup-status-notice', 'style': 'margin-bottom:12px;display:none;' }),

					// 固件详情列表（采用原生 cbi-value 结构）
					E('div', { 'id': 'fwup-upgrade-details', 'style': 'display:none;' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Target Image')),
							E('div', { 'class': 'cbi-value-field', 'id': 'fwup-asset-name' }, '-')
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Image Size')),
							E('div', { 'class': 'cbi-value-field', 'id': 'fwup-asset-size' }, '-')
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('SHA256 Checksum')),
							E('div', { 'class': 'cbi-value-field', 'style': 'font-family:var(--fw-font-mono);font-size:12px;', 'id': 'fwup-asset-sha' }, '-')
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Upgrade Mode')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('label', { 'style': 'display:inline-flex;align-items:center;gap:6px;cursor:pointer;' }, [
									E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox', 'id': 'fwup-keep-config', 'checked': sysInfo.keep_config === '1' }),
									E('span', {}, _('Keep current settings (uncheck for clean install)'))
								])
							])
						]),
						E('div', { 'class': 'cbi-value', 'style': 'padding-top:14px;' }, [
							E('div', { 'class': 'cbi-value-title' }, ''),
							E('div', { 'class': 'cbi-value-field' }, [
								E('button', {
									'class': 'cbi-button cbi-button-action cbi-button-primary',
									'id': 'fwup-upgrade-btn',
									'click': ui.createHandlerFn(this, 'handleStartUpgrade')
								}, _('Upgrade Firmware Now'))
							])
						])
					]),

					// 更新日志展示区
					E('div', { 'id': 'fwup-changelog-wrap', 'style': 'display:none;margin-top:16px;' }, [
						E('div', { 'class': 'fwup-card-title', 'style': 'margin-bottom:8px;' }, _('Release Notes')),
						E('div', { 'class': 'fwup-notes', 'id': 'fwup-changelog' })
					])
				])
			]),

			// Tab 2: 设置面板（完全复用原生 CBI 表单组件）
			E('div', { 'id': 'tab-content-settings', 'style': 'display:none;' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'cbi-section-title' }, [
						E('span', {}, _('Repository & Network Settings'))
					]),

					E('div', { 'id': 'fwup-settings-notice', 'style': 'margin-bottom:12px;display:none;' }),

					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': 'cfg-repository' }, [
							_('GitHub Repository'),
							E('div', { 'class': 'fwup-descr' }, _('Target GitHub release repository (owner/repo)'))
						]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'type': 'text',
								'class': 'cbi-input-text',
								'id': 'cfg-repository',
								'value': sysInfo.repository || '',
								'placeholder': sysInfo.default_repository || 'owner/repo'
							})
						])
					]),

					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': 'cfg-proxy' }, [
							_('Download Mirror / Proxy'),
							E('div', { 'class': 'fwup-descr' }, _('Leave empty for direct GitHub connection'))
						]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'type': 'text',
								'class': 'cbi-input-text',
								'id': 'cfg-proxy',
								'value': sysInfo.proxy || '',
								'placeholder': 'https://ghproxy.net/'
							})
						])
					]),

					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title', 'for': 'cfg-token' }, [
							_('GitHub Access Token'),
							E('div', { 'class': 'fwup-descr' }, _('Optional, for private repositories or avoiding rate limits'))
						]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'type': 'password',
								'class': 'cbi-input-password',
								'id': 'cfg-token',
								'placeholder': 'ghp_xxxxxxxxxxxx'
							})
						])
					]),

					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [
							_('Default Upgrade Mode')
						]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('label', { 'style': 'display:inline-flex;align-items:center;gap:6px;cursor:pointer;' }, [
								E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox', 'id': 'cfg-keep-config', 'checked': sysInfo.keep_config === '1' }),
								E('span', {}, _('Keep settings by default (uncheck for clean install)'))
							])
						])
					]),

					E('div', { 'class': 'cbi-value', 'style': 'padding-top:14px;' }, [
						E('div', { 'class': 'cbi-value-title' }, ''),
						E('div', { 'class': 'cbi-value-field' }, [
							E('button', {
								'class': 'cbi-button cbi-button-action cbi-button-primary',
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

	switchTab: function(tabName, ev) {
		if (ev && ev.preventDefault) ev.preventDefault();
		this.activeTab = tabName;
		var isUpgrade = tabName === 'upgrade';

		var navUpgrade = document.getElementById('tab-nav-upgrade');
		var navSettings = document.getElementById('tab-nav-settings');
		if (navUpgrade && navSettings) {
			navUpgrade.className = 'cbi-tab' + (isUpgrade ? ' cbi-tab-active' : '');
			navSettings.className = 'cbi-tab' + (!isUpgrade ? ' cbi-tab-active' : '');
		}

		var contentUpgrade = document.getElementById('tab-content-upgrade');
		var contentSettings = document.getElementById('tab-content-settings');
		if (contentUpgrade && contentSettings) {
			contentUpgrade.style.display = isUpgrade ? '' : 'none';
			contentSettings.style.display = !isUpgrade ? '' : 'none';
		}
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
				var keepEl = document.getElementById('fwup-keep-config');
				if (keepEl) keepEl.checked = (keepConfig === '1');
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

			// 更新顶部卡片
			document.getElementById('fwup-latest-ver').textContent = res.tag_name;
			var pubDate = res.published_at ? res.published_at.replace('T', ' ').replace('Z', ' UTC') : '';
			document.getElementById('fwup-latest-sub').textContent = _('Release Date: ') + pubDate;

			// 填充固件详情
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
					'class': 'cbi-button',
					'click': ui.hideModal
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-action cbi-button-primary',
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
