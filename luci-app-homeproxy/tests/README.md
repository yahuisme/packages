# Core regression tests

Run from this package directory. Dependencies are installed outside the repository:

```sh
export NODE_PATH="$(npm root -g)"
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export PYTHONDONTWRITEBYTECODE=1
```

Fixtures do not connect to a router or run host services. These checks are not firmware builds or hardware acceptance. Theme/screenshot matrices and historical visual reports are maintained separately in the external `packages-ui-audit-tools` workspace; they are not package dependencies.

```sh
node tests/test_connection_dom.cjs
node tests/test_connection_lifecycle.cjs
node tests/test_followup_dom.cjs
node tests/test_log_lifecycle.cjs
node tests/test_page_lifecycle.cjs
node tests/test_resource_status.cjs
node tests/test_status_dom.cjs
python3 tests/test_list_migration.py
python3 tests/test_resource_display.py
python3 tests/test_resource_versions.py
python3 tests/test_urltest_defaults.py
```

Requires BusyBox, curl, unzip and real ucode with fs/digest modules. Set `UCODE_LIB_DIR=/path/to/compatible/ucode/modules` when not on the default search path; the updater fixture wrapper currently uses `/usr/local/bin/ucode`. The LuCI checkout must include `applications/luci-app-firewall`. Updater/migration/generator tests use private paths, loopback HTTP and harmless decoder/init/UCI/ubus boundaries; no proxy is started. DOM tests cover safe text/link attributes, resource display, real Map.reset, single-flight polling, timeout/recovery and removal. Expected injected RPC failures may be logged.
