# HomeProxy focused acceptance

## Retained-settings fixes — 20261107-r1

Base: `ec1723d`. No firmware compilation, proxy startup, router deployment or
reproduction of the lost failure-state configuration. Tests run serially with
native prebuilt ucode/libuci and private paths in a 768 MiB, zero-swap scope.

- `test_retained_tls`: the pre-fix generator failed 27 disabled/missing-switch
  subcases; the fix passes all nine TLS-capable protocols with enabled, disabled,
  empty and missing flags, without erasing the saved path.
- `test_dnsmasq_directory`: the pre-fix parser failed filtered, empty/missing and
  equals-containing directory cases. A second RED/GREEN cycle checks native
  instance-specific default directories and retained UCI `confdir` before the
  generated file exists. All four cases pass in BusyBox ash.
- The first combined focused command (`PYTHONPATH=luci-app-homeproxy/tests python3 -m unittest
  test_retained_tls test_dnsmasq_directory test_upgrade_defaults test_reload
  test_reload_cleanup test_disabled_triggers test_anytls_generation
  test_ss_uot_generation test_client_defaults test_rpc_compatibility -v`):
  **44 passed**, no skips. After the final fallback change and certificate-file
  assertions, the affected subset (`test_dnsmasq_directory test_retained_tls
  test_reload test_upgrade_defaults test_reload_cleanup test_disabled_triggers
  test_client_defaults`) passed **39 cases**, no skips. Other unchanged passes
  remain valid.
- Shared helper consumers (`test_subscription_efficiency_consumers
  test_server_generation test_client_routing test_current_node`): **11 passed**,
  no skips. These cover complete client/server generation and the RPC latency
  config-construction boundary; no live handshakes are claimed. A direct
  retained-certificate on/off assertion through the production RPC latency JSON
  builder also passed; private certificate-file contents remain unchanged.
- Subscription parser/reconciliation and affected native/helper consumers:
  `test_subscription_parsing test_subscription_reconcile
  test_subscription_plugin_native test_subscription_efficiency
  test_subscription_efficiency_native test_subscription_names
  test_subscription_efficiency_consumers`: **66 passed**, no skips. New coverage
  checks all four mux-capable protocols, padding/limits, disabled stale-field
  removal, repeated zero-write refresh, decimal bandwidth unit conversion and
  rejection of unsupported `only-tcp: true` without silently broadening UDP.
  Review identified overflowing rates/limits and disabled-smux rejection on
  non-mux outbounds; each received a baseline-failing regression. Final parsing
  plus four-protocol/disabled native refresh subset: **22 passed**, no skips.
  Numeric limits are bounded before multiplication; inactive smux fields are
  ignored and non-mux protocols remain usable when smux is disabled.
- Additional disposable ad-hoc checks passed for a trailing-slash conf-dir,
  commented/missing directive, TLS false-like switch, version consistency,
  ash syntax and `git diff --check`; these are not a full-suite result.

## Previous focused acceptance

Scope: disabled-service reload lifecycle and confirmed subscription failure/
permission-boundary fixes. Base source: `4c548bf`; publication preparation sets
HomeProxy to `20261103-r1`. No firmware build, proxy startup or router deployment. Private ash/ucode/libuci/rpcd fixtures
are not live-device traffic acceptance.

## Final evidence

Environment: `/opt/test-tools/env.sh` plus
`/opt/test-tools/openwrt/packages-ci/env.sh`; repository explicitly selected.
Final combined gates ran serially inside a 768 MiB / zero-swap systemd scope.

- Python: `test_subscription_jobs`, `test_subscription_efficiency_native`,
  `test_subscription_reconcile`, `test_reload`, `test_reload_cleanup`,
  `test_disabled_triggers`, and only the non-compiling
  `test_portability.Portability.test_interface_trigger_not_named_wan`:
  **74 cases passed**, no skips.
- Python: `test_catalog` and `test_subscription_apply`: **6 cases passed**.
- Native LuCI DOM: `tests/subscription-job-ui.cjs` and
  `tests/subscription-ui.cjs` passed, including done/3 refresh and error feedback,
  partial-result refresh failure, normal zero-change success, native save/apply/
  confirm, locks, reset and transport failures. RPC/file transport is private.
- Native rootfs ash/rpcd/ubus:
  `OPENWRT_ROOTFS=$OPENWRT_TOOLS/rootfs.tar.gz python3 tests/subscription-rpc-native.py -v`:
  **1 case passed** in private chroot/network/PID namespaces. Keep native
  `ucode.real` for permission checks; only the subscription worker is held.
- CI exact sudo UID-boundary command: **9 cases passed**. The normal runner
  excludes this root-only suite; a dedicated sudo step runs it instead.
- `.github/tests/test_runner.py`: **11 cases passed**; workflow YAML and the
  added step's extracted Bash syntax passed.
- Later focused wrapper exact-exit test passed for **0, 3 and 7** after extending
  its input matrix. Production bytes did not change after the combined gate.
- Final independent review found no blocking regression and one first-directory
  creation race. Its new regression first failed, then the final wrapper gate
  passed all ten cases and native rootfs RPC passed again after the bounded
  mkdir/recheck fix. Strict owner/type/mode validation remains unchanged.
- Init/wrapper ash syntax and `git diff --check` passed.

The upgrade-defaults consumer's two cases passed against the same final init;
that source was unchanged by later subscription work. Existing unrelated
resource, generator and UI evidence was reused, not rerun as a whole suite.

## Regression causation

Before each production fix, focused tests demonstrated disabled interface
registration, startup checks blocking disable, deleted log history after failed
empty-definition submission, scalar URL omission, mixed-feed false success,
private-UID result forgery and staging-link overwrite. Final tests retain exact
configuration bytes, selected-node references, log bytes/inodes and unrelated
root target contents at those boundaries. Partial feed response now means exit
3 only when valid changes committed and reload succeeded; no-change/total or
reload failure remains 1. All-success no-op remains 0.

Temporary `hermes-verify-*` probes were executed and removed. They were ad-hoc
checks only, never substitutes for the suites above. No local compilation or
browser process was used.
