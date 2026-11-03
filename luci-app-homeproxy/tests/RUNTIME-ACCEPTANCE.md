# HomeProxy focused acceptance

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
