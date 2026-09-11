# Core regression tests

Run from this package directory. Dependencies are installed outside the repository:

```sh
export NODE_PATH="$(npm root -g)"
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export PYTHONDONTWRITEBYTECODE=1
```

Fixtures do not connect to a router or run host services. These checks are not firmware builds or hardware acceptance. Theme/screenshot matrices and historical visual reports are maintained separately in the external `packages-ui-audit-tools` workspace; they are not package dependencies.

```sh
node tests/test_view.js
READONLY_TEST=1 node tests/test_view.js
ERROR_TEXT_TEST=1 node tests/test_view.js
python3 tests/test_backend.py
python3 tests/test_daemon.py
python3 tests/test_i18n.py
python3 tests/test_sampling.py
```

Requires BusyBox. Durable-save tests skip without real UCI/jsonfilter/BusyBox (optionally `UCI_BIN`, `JSONFILTER_BIN`, `BUSYBOX_BIN`); skips are not transaction passes. Config/delta and restart are isolated. Daemon ping/sleep/runtime output are replaced; overview tests never scan device PPE.
