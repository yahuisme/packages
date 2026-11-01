# Core regression tests

Run from this package directory. Dependencies are installed outside the repository:

```sh
export NODE_PATH="$(npm root -g)"
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export PYTHONDONTWRITEBYTECODE=1
```

Fixtures do not connect to a router or run host services. These checks are not firmware builds or hardware acceptance. Theme/screenshot matrices and historical visual reports are maintained separately in the external `packages-ui-audit-tools` workspace; they are not package dependencies.

```sh
node tests/error-text.cjs
node tests/integration.cjs
node tests/mlo-actions.cjs
node tests/mlo-abandoned-render.cjs
node tests/mlo-background.cjs
node tests/cross-actions.cjs
for mode in revoked pending reentry; do node tests/permissions-reentry.cjs "$mode"; done
node tests/lazy-regression.cjs
node tests/lifecycle.test.js
node tests/mlo-editor.cjs
node tests/mlo-integration.cjs
node tests/mlo-localization.cjs
node tests/mlo-modal-layout.cjs
node tests/mlo-poll.cjs
node tests/mlo-poll-lifecycle.cjs
node tests/mlo-runtime.cjs
node tests/native-tabs.cjs
node tests/regression.test.js
node tests/style-scope.cjs
node tests/summary-cards.cjs
node tests/survey-dom.cjs
node tests/telemetry.test.js
node tests/radio-attribution.cjs
for mode in radio mlo-runtime mlo-summary; do node tests/render-reuse.cjs "$mode"; done
node tests/radio-refresh.cjs
node tests/reset-radio.cjs
node tests/legacy-power.cjs
node tests/narrow-settings.cjs
for mode in availability cost; do node tests/wireless-runtime.cjs "$mode"; done
node tests/typography.cjs
node tests/view.test.js
for mode in text lifecycle rpc; do node tests/known-defects.cjs "$mode"; done
for mode in NATIVE_TEST MLO_TEST DENIED_TEST; do env "$mode=1" node tests/view.test.js; done
for mode in NATIVE_TEST MLO_TEST READONLY_TEST MISSING_MODE_TEST; do env "$mode=1" node tests/regression.test.js; done
python3 tests/catalog.test.py
python3 tests/probes.test.py
python3 tests/test_summary_survey.py
```

Requires BusyBox and gettext `msgfmt`; localization additionally requires LuCI `src/po2lmo` (or `PO2LMO`). `error-text.cjs` compiles the Chinese catalog and uses native LuCI notifications for radio Apply, MLO Apply/Reset and diagnostics, covering ubus 1–10, numeric Apply rejection, unknown/hostile replies and transport failure. It locates the diagnostics button by its translated label, and re-queries MLO actions after native Map redraw. Optional `ERROR_MODE=save|mlo-apply|mlo-reset|diagnostics` selects a single branch; the default runs all four. Do not leak translation or fixture-mode environment variables into fixed-English tests.

Error reasons follow LuCI `rpc.getStatusText()` and `uci.apply()`: numeric ubus status and the native `RPCError` ubus envelope are recognized; JSON-RPC/HTTP error numbers and arbitrary exception text are not ubus codes. Unknown failures use a translated fallback, without raw transport details. `wifi7/telemetry.js` owns the small shared reason helper; both configuration action surfaces use it.

`radio-attribution.cjs` runs the production summary collector under BusyBox with temporary `iw`/`hostapd_cli` fixtures, then feeds its unmodified output through real LuCI RPC and DOM. It covers single-wiphy MLO/ordinary-interface frequency attribution, fallback, zero power, failed/empty enumeration and overview recovery, while asserting one `iw dev` enumeration and no station scans.

`reset-radio.cjs` covers failed radio Apply → explicit MLO Reset → unrelated radio Apply without resurrecting reverted settings. Reset explicitly discards radio drafts; ordinary Apply preserves open editor drafts. `legacy-power.cjs` retains unchanged integer-shaped legacy power while enforcing 0–30 dBm for every new value; `narrow-settings.cjs` checks scoped container CSS only, not browser geometry.

`radio-refresh.cjs` covers an existing `txpower=0` during another radio's Apply, bounded integer validation, and already-mounted MLO radio labels/editor choices after radio readback without discarding an open editor's draft. `wireless-runtime.cjs` loads real LuCI `network.js` to reproduce configured devices synthesized after denied runtime replies, then exercises the actual rejecting RPC boundary for unknown/down/recovery, shared polling, SSID/interface mapping, live frequency changes and detach. It counts logical RPC calls (not HTTP batches): with three radios, overview and active MLO each use one wireless-status call, one summary collector and three `iwinfo.info` calls per cycle; client diagnostics remain tab-gated.

`render-reuse.cjs` checks stable radio status nodes and zero unchanged-input DOM mutations, up/down/unknown transitions, RPC and processing-error cleanup/recovery with ARIA intact, and detached polling cleanup. Its MLO modes reject runtime refreshes that build discarded configuration DOM, require stable runtime-state nodes with zero unchanged-input mutations across down/unknown/recovery, and verify summary reuse through empty/incomplete/valid configuration, native Map.reset, held refresh across reset, runtime failure/recovery and detach. It uses real LuCI DOM/form/RPC with isolated transport; it does not measure browser layout or router CPU.

`performance-equivalence.cjs` compares complete ordered parent/modal DOM, live form values, RPC sequence, staged/committed data and notifications against immutable baseline production sources. With no argument it runs `clients`, `channels`, then `mlo` serially; an explicit mode selects only that branch. It seeds LuCI random IDs before loading native modules and does not normalize away DOM differences. Operation bounds require fewer attribution filters/no unused per-interface Sets, one freqlist filter/no per-option find, and no discarded MLO configuration overview DOM.

`collector-equivalence.py` is a real unittest entrypoint, including when imported by the CI exact-file loader. It requires BusyBox and strace on `PATH` (every private fixture shell and applet uses that selected BusyBox, including the prebuilt runtime). It compares complete stdout/stderr/exit status and ordered iw/hostapd arguments over 34 full/summary cases: whitespace, malformed/empty/failed/recovered snapshots, EOF without newline, and explicit CR/VT/FF boundaries. It verifies unchanged input bytes, identical awk call counts (one per successful enumeration, zero on failure), and fewer successfully created child processes for every successful enumeration, with unchanged counts on failure. Production retains the selected awk's field semantics; only the `printf | awk` pipeline is replaced by an awk here-document, with no custom IFS parser. Runtime-specific whitespace behavior is preserved, not normalized across BusyBox builds. All sockets and commands are private fixtures.

Both differential suites work without any `PERF_*` environment variables. They use `git show` at fixed commit `c9636f029c8fbd631cfecff43eff301d8eb898ba` (checkout history must contain it; CI uses `fetch-depth: 0`) and private directories below required scratch `TMPDIR`, cleaned on exit. The DOM suite extracts `index.js`, `mlo.js`, `telemetry.js` with their resource paths intact, plus `root/usr/libexec/wifi7-status`. The collector extracts that same baseline status helper. Default output is temporary too; explicit `PERF_OUT` retains complete before/after artifacts and source SHA-256 hashes. Optional `PERF_BASELINE_DIR` overrides the DOM baseline resources tree (`view/wifi7/index.js`, `wifi7/{mlo,telemetry}.js`), and `PERF_BASELINE_STATUS` overrides the collector baseline file; each override is independent of `PERF_OUT`.

Run inside a verified memory cgroup (these differential workers are accepted at `memory.max <= 805306368`, 768 MiB), with private scratch and the dependencies above. No browser, compiler or service is needed:

```sh
# From the package directory; TMPDIR must already be a private scratch directory.
node tests/performance-equivalence.cjs
python3 tests/collector-equivalence.py
# Or from the repository root, use the same default entrypoints as CI, no PERF_*:
.github/scripts/run-tests.sh luci-app-wifi7/tests/performance-equivalence.cjs luci-app-wifi7/tests/collector-equivalence.py
# Optional retained local evidence (baseline overrides are not required):
PERF_OUT=/private/evidence/dom node tests/performance-equivalence.cjs
PERF_OUT=/private/evidence/collector python3 tests/collector-equivalence.py
```

`harness.js` and `mlo-luci-dom.cjs` are support modules, not test entrypoints. `integration.cjs` is both a harness and executable test. Typography-named DOM checks stay because they also assert real Map.reset, scoped modal ownership/reopen and teardown; `native-tabs.cjs` checks actual tab/poll behavior. All collector commands use temporary boundary fixtures.
