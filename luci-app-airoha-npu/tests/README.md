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

Save stores the validated CPU pair atomically in `/etc/airoha-npu/pending.json`
(directory 0700, file 0600), without sysfs writes or global UCI apply. Refresh and
native Reset use this last saved baseline. Apply first saves current edits, then
applies both fields under the same backend lock, verifies runtime readback, and
rolls both fields back on failure. The saved baseline remains available for retry
and Reset after success or failure. It survives reboot/retained upgrades but is
never applied at boot; CPU controls retain their existing runtime-only semantics.
External kernel/config writers are outside the package lock. Settings notification
regressions cover localized known/unknown errors and transport failures at Save,
saved readback, Apply and runtime readback, followed by a successful retry.
Without policy0 CPUFreq capability files, native LuCI filesystem dependencies hide
the Settings menu. Direct/stale settings views render no form or action footer when
capabilities are unavailable (including retained pending settings and fixed runtime
readings). RPC failures retain the retry error instead of claiming missing hardware.
The status view and its real CPU telemetry remain independent.

Python RPC tests use real BusyBox ash and private sysfs/config/locks. Flow offloading is read-only here; tests verify status and rejection of the removed setter without modifying firewall configuration. Optional `UCI_BIN` and `JSONFILTER_BIN` select real tools; without them the suite uses adapters, not real-UCI verification. `/dev/null` and `/dev/full` model read/write failures. `l10n.js` is a support module, not an entrypoint.

The first-frame test remains: complete production render, mount/reentry/resize/fallback/disposal with intervals frozen. Requires Playwright/Chromium and unchanged Aurora:

```sh
AURORA_DIR=/path/to/luci-theme-aurora NPU_LAYOUT_DIR=/tmp/npu-mount-regression node tests/test_chart_mount.js
```
