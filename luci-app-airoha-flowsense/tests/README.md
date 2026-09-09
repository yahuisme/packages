# Isolated regression tests

Set `NODE_PATH` to an external jsdom installation and `LUCI_RESOURCE_DIR` to the local LuCI resource directory, then run:

```sh
node tests/test_view.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

The DOM suite retains the real LuCI view constructor and RPC declaration/reply implementation. Only HTTP responses and polling are fixtures. It tests initial reuse, ubus rejection, clearing every telemetry section, independent single-flight overview/PPE calls, labels, disclosure closure and detached replies. Expected permission errors may print an RPCError while assertions pass.

Backend sampling tests execute BusyBox functions with isolated producers and prove overview never invokes the PPE scanner. Decimal tests parse actual shell output as JSON. The daemon test replaces ping/sleep and its runtime output path. Durable-save tests require real uci/jsonfilter/busybox and use temporary config/delta directories and a fake service restart; a skip is not a transaction pass.

Overview never scans PPE. Entries and counts are collected only while the disclosure is open, on opening and at most one in-flight request with a 30-second poll. These tests do not validate router drivers, firmware builds, theme geometry, or on-device performance.
