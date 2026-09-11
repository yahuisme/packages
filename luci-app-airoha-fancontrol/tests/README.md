# Core regression tests

Run from this package directory. Dependencies are installed outside the repository:

```sh
export NODE_PATH="$(npm root -g)"
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export PYTHONDONTWRITEBYTECODE=1
```

Fixtures do not connect to a router or run host services. These checks are not firmware builds or hardware acceptance. Theme/screenshot matrices and historical visual reports are maintained separately in the external `packages-ui-audit-tools` workspace; they are not package dependencies.

```sh
node tests/test_frontend.js
node tests/test_settings_form.js
node tests/test_status_dom.js
node tests/test_status_rpc.js
python3 tests/test_fan.py
python3 tests/test_real_tools.py
```

Requires BusyBox. `test_real_tools.py` skips unless `REAL_UCI=/path/to/uci` selects a real CLI; skipped cases are not passes. All writes use private sysfs/config/delta/override fixtures. Real LuCI form tests retain validation, scoped modal reuse/Escape and save callbacks.

The browser curve test remains because it executes production resize, invalid/recovery and observer disposal (not just screenshots). Requires Playwright/Chromium and optionally Aurora:

```sh
export AURORA_DIR=/path/to/luci-theme-aurora
export AURORA_CSS="$AURORA_DIR/htdocs/luci-static/aurora/main.css"
export FAN_DOM=/tmp/fan-regression.dom.html
EXPORT_DOM="$FAN_DOM" node tests/test_settings_form.js
node tests/test_curve_browser.js
```
