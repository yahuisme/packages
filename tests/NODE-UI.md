# Node/server native UI acceptance

Run from the repository root, without a browser, local compilation, proxy or
router configuration:

```sh
/opt/test-tools/bin/run-bounded-test bash -lc '
  . /opt/test-tools/env.sh
  export PACKAGES_ROOT=/root/repos/packages TMPDIR=/root/.hermes/cache/scratch
  node tests/homeproxy-native-loader.cjs &&
  node tests/homeproxy-editor-parity.cjs &&
  node tests/node-protocol-ui.cjs &&
  node tests/node-management-ui.cjs &&
  node tests/subscription-names-ui.cjs &&
  node tests/node-source-ui.cjs &&
  node tests/node-editor-ui.cjs &&
  node tests/node-primary-ui.cjs &&
  node tests/subscription-ui.cjs &&
  node tests/share-link-ech-ui.cjs
'
```

- `homeproxy-editor-parity.cjs` evaluates the complete native pre-redesign node
  and server forms at the pinned baseline commit stored in the fixture. It
  compares every ordered option descriptor: keys, ordered choices/labels,
  dependencies (including regex), datatype, defaults and retained form flags.
  The current native form must match that immutable fixture. Deliberately new
  tab assignment and inactive-value retention are checked by the editor suite,
  rather than requiring equality with the old ungrouped design.
- `fixtures/homeproxy-editor-options.json` contains 101 node and 90 server
  descriptors from real native form objects with all feature flags enabled,
  including gVisor for WireGuard, gRPC, uTLS, ACME and TCP Brutal. It is not a
  regex inventory or a hand-maintained subset. Regenerate only deliberately:
  `node tests/homeproxy-editor-parity.cjs --write`; normal acceptance is read-only.
- `node-source-ui.cjs` exercises fixed tabs, a single native grid, literal
  subscription labels, source filtering without rebuilding rows or losing
  unsaved native widget edits, manual-only add/import/remove, hidden cron
  retention through full Map.parse, source/reset/latency state, selected-source
  bulk tests, tab visibility and deleted-source fallback.
- `node-editor-ui.cjs` opens the actual native GridSection modals, checks all
  options and native Basic/Transport/TLS/Advanced tabs, rejects an invalid port,
  then saves to private persistent RPC storage and reloads/reopens. It preserves
  literal malicious labels and inactive WebSocket/TLS/multiplex settings through
  SOCKS→VMess→SOCKS transitions. Its watchdog permits the full two-editor save
  sequence, not merely initial render. Programmatic widget edits explicitly
  trigger native validation before parsing.
- `node-primary-ui.cjs` clicks the real subscribed-row Apply button, verifies
  native Map.save persisted main_node before apply(true), and checks selected
  source plus disabled Applied state after load/reset. The apply/reload-service
  boundary is explicitly mocked; no host service is invoked.
- `share-link-ech-ui.cjs` imports real binary/query ECH share links through the
  actual modal and native UCI save, reload and Map.reset, backed by private RPC
  storage. Parser, description and subscription backend tests remain separate.

- `homeproxy-native-loader.cjs` calls real `LuCI.prototype.require`, not the
  fixture's permissive evaluator, for subscriptions. It verifies constructor
  validation, dependency parsing, instantiation and caching.
- `node-protocol-ui.cjs` saves all 14 node and 12 server protocols through real
  modal Map.save and private persistent RPC. It exercises all five transports,
  inactive option retention and reload. It does not validate remote handshakes.
- `node-management-ui.cjs` covers native Add/Save/Cancel/Remove, two subscription
  filters and subscribed editing, global/row Enable and Firewall checkbox clicks,
  certificate→ACME AliDNS→Cloudflare→REALITY native dependency/parse transitions,
  retained hidden credentials and feature-off forms. TLS issuer transitions use
  native parse, not actual certificate issuance.
- `subscription-names-ui.cjs` covers editable names/exact URL identity, validation,
  drafts, native saves/reset, readonly, keyboard deletion, nested-field desktop
  drop, touch editing versus reordering and touch cancellation. Touch hit boxes
  are synthetic jsdom inputs; this is not physical touchscreen acceptance.

Helpers under `tests/helpers/` supply native LuCI form/UI/RPC modules and jsdom,
with only transport and platform boundaries isolated. This is DOM/state evidence,
not actual theme geometry or router runtime evidence. Empty native editor tabs
may auto-hide; do not add placeholder fields or force control widths for tests.
