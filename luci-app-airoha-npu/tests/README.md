# Core regression tests

Run from this package directory. Dependencies are installed outside the repository:

```sh
export NODE_PATH="$(npm root -g)"
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export PYTHONDONTWRITEBYTECODE=1
```

Fixtures do not connect to a router or run host services. These checks are not firmware builds or hardware acceptance. Theme/screenshot matrices and historical visual reports are maintained separately in the external `packages-ui-audit-tools` workspace; they are not package dependencies.

```sh
node tests/test_dom.js
node tests/test_settings.js
node tests/test_settings_form.js
python3 tests/test_backend.py
python3 tests/test_catalog.py
```

Python RPC tests use private sysfs/config/locks and harmless reload commands. Optional `UCI_BIN` and `JSONFILTER_BIN` select real tools; without them the suite uses adapters, not real-UCI verification. `/dev/null` and `/dev/full` model read/write failures. `l10n.js` is a support module, not an entrypoint.

The first-frame test remains: complete production render, mount/reentry/resize/fallback/disposal with intervals frozen. Requires Playwright/Chromium and unchanged Aurora:

```sh
AURORA_DIR=/path/to/luci-theme-aurora NPU_LAYOUT_DIR=/tmp/npu-mount-regression node tests/test_chart_mount.js
```
