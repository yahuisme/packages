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
node tests/lazy-regression.cjs
node tests/lifecycle.test.js
node tests/mlo-editor.cjs
node tests/mlo-integration.cjs
node tests/mlo-localization.cjs
node tests/mlo-modal-layout.cjs
node tests/mlo-poll.cjs
node tests/mlo-runtime.cjs
node tests/native-tabs.cjs
node tests/regression.test.js
node tests/style-scope.cjs
node tests/summary-cards.cjs
node tests/survey-dom.cjs
node tests/telemetry.test.js
node tests/typography.cjs
node tests/view.test.js
for mode in text lifecycle rpc; do node tests/known-defects.cjs "$mode"; done
for mode in NATIVE_TEST MLO_TEST DENIED_TEST; do env "$mode=1" node tests/view.test.js; done
for mode in NATIVE_TEST MLO_TEST READONLY_TEST MISSING_MODE_TEST; do env "$mode=1" node tests/regression.test.js; done
python3 tests/catalog.test.py
python3 tests/probes.test.py
python3 tests/test_summary_survey.py
```

Requires BusyBox and gettext `msgfmt`; localization additionally requires LuCI `src/po2lmo` (or `PO2LMO`). `harness.js` and `mlo-luci-dom.cjs` are support modules, not test entrypoints. `integration.cjs` is both a harness and executable test. Typography-named DOM checks stay because they also assert real Map.reset, scoped modal ownership/reopen and teardown; `native-tabs.cjs` checks actual tab/poll behavior. All collector commands use temporary boundary fixtures.
