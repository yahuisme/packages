# Client and resource native interaction acceptance

Run from `/root/repos/packages`, without a browser, build, proxy or host-service changes:

```sh
/opt/test-tools/bin/run-bounded-test bash -lc '
  . /opt/test-tools/env.sh
  export PACKAGES_ROOT=/root/repos/packages TMPDIR=/root/.hermes/cache/scratch
  node tests/client-mode-acceptance.cjs &&
  node tests/resource-transaction-acceptance.cjs &&
  node luci-app-homeproxy/tests/test_client_simplification.cjs &&
  node tests/resource-results-ui.cjs &&
  node tests/ui-state-regressions.cjs
'
```

- `client-mode-acceptance.cjs` executes the complete client view with native LuCI
  dependency checking, validation, Map parsing/saving and UI apply implementation.
  It covers both routing modes × disabled/main/URLTest × IPv6 off/on × Tailscale
  off/on, plus dashboard and LAN list-mode subcases. Inactive controls hide their
  entire native field, not just their input. Disabling the main node does not
  prevent preconfiguring the client, dashboard, diversion or Tailscale settings.
- Private persistent UCI RPC storage proves hidden saved URLTest/dashboard/China
  DNS/IPv6/ACL/Tailscale options survive full Map.save/load/reset/reentry. Unsaved
  edits survive hide→show in the same form; saving while hidden intentionally
  retains the previously persisted value, per native LuCI `retain` semantics.
  It checks native defaults, custom routing ports and stack/DNS persistence.
- The actual view footer handler calls Map.save, then native `ui.changes.apply`,
  HTTP apply and delayed HTTP confirm. Held UCI writes block apply, held confirm
  blocks `uci-applied`; invalid forms, rejected saves and failed apply abort.
  Only UCI/HTTP transport is isolated; no UI apply function is substituted.
- `resource-transaction-acceptance.cjs` switches from an actual Client view into
  the actual Status view while a mutation is held, exercises the shared lock and
  a held status read across reset, then reenters Client. Top updates explicitly
  send `manual`; backend inclusion of an installed dashboard remains its own
  ash/ucode scope contract, not a DOM guess.
- Dashboard Open appears once beside its settings only for configured enable plus
  installed files. Unsaved enable/port edits do not implicitly apply configuration;
  Open uses the configured port and rechecks local installed status.
- Both mutation RPC declarations must reject nonzero ubus status even when an
  accompanying payload looks successful. The regression failed before adding
  `reject: true`, then passed. Existing resource-results and ui-state suites cover
  transport/malformed/unknown responses, mixed current/failed/updated outcomes,
  readonly retry/mutation gating, rollback/apply flags and dirty-field retention.

This is native DOM/state and isolated transport evidence, not theme geometry,
router routing, dashboard HTTP reachability or daemon startup evidence. Unchanged
Status log-viewer/service-status evidence may be reused only with matching source
hashes; do not rerun it solely to produce another PASS banner.
