# FlowSense regression tests

Run from the repository root:

```sh
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources node luci-app-airoha-flowsense/tests/test_view.js
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources node luci-app-airoha-flowsense/tests/test_status.js
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources ERROR_MESSAGES_TEST=1 node luci-app-airoha-flowsense/tests/test_view.js
NODE_PATH="$(npm root -g)" \
LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources \
OPENWRT_TOOLS=/opt/test-tools/openwrt \
UCI_BIN=/opt/test-tools/openwrt/bin/uci \
JSONFILTER_BIN=/opt/test-tools/openwrt/bin/jsonpath \
BUSYBOX_BIN="$(command -v busybox)" \
python3 -m unittest discover -s luci-app-airoha-flowsense/tests -v
```

The DOM tests execute upstream LuCI view, form.Flag, RPC, notifications and native footer/ComboButton. Only transport is isolated. Expected RPC rejection cases log errors before the PASS line. Settings tests cover each checkbox mapping, Save without Apply, saved baseline across reload/Reset, joint and single-group Apply, partial failure/retry, readonly and duplicate actions. Status is read-only, displays runtime enabled/disabled/unknown and owns one bounded telemetry poll. The separate Chinese error run loads the package PO into native LuCI translation lookup after cbi.js, then exercises known backend errors, unknown/hostile codes, save/apply/readback transport failures, rollback wording and retry through real notifications. It checks that no internal error text reaches the notification.

Backend tests require BusyBox, real libubox jshn, UCI and jsonfilter. Monitor settings integration also requires Node/jsdom and `LUCI_RESOURCE_DIR` (the same environment as the DOM commands above). It feeds actual isolated RPC getter/setter results through real LuCI controls and native Save/Apply/Reset: shipped config without `enabled`, explicit 0/1, and a failed read of a present option. The absent option inherits npu-jitter's enabled default only after successful section inspection; read failures remain unknown/readonly. Getter tests also cover per-read failures, staged/override isolation, unchanged config bytes/mtime and temporary-directory cleanup. `OPENWRT_TOOLS` supplies the acceleration/settings fixture tool prefix; `UCI_BIN`, `JSONFILTER_BIN`, and `BUSYBOX_BIN` supply the monitor fixture binaries. The settings fixture accepts the toolchain's `bin/jsonpath` executable as jsonfilter. Configure `LD_LIBRARY_PATH` for that prefix if needed. Missing-tool skips are not transaction passes. All config, sysctl, runtime and restart paths are redirected to temporary fixtures; tests never write router configuration.

## Save / Apply / Reset contract

Only the Settings route has the native footer. Save atomically stores fixed, validated fields in root-private `/etc/flowsense/pending.json` (directory 0700, file 0600), without UCI commit or service/sysctl changes. Page reload retrieves this pending baseline; Reset discards only unsaved browser edits, matching LuCI Reset semantics. Pending data is not runtime telemetry.

Apply saves current edits first, invokes the original acceleration and monitor transactions, then reads both groups back. A successful group is removed from pending; a failed group remains retryable. The response distinguishes groups and returns underlying failure codes, including rollback failure. It never invokes global LuCI UCI apply. Settings operations serialize with a runtime lock; a reboot cannot preserve a stale lock. As with existing setters, external concurrent config writers are not coordinated by this package lock. State-changing API requests still require write ACL.

Aurora screenshots/geometry are external audit artifacts, not package contents or hardware validation.
