# Disabled service interface triggers

## Contract

- With `config.main_node=nil` and `server.enabled=0`, register only the native
  `config.change` reload trigger. Interface events must not invoke reload.
- Enabled client, URLTest, server-only and combined modes retain the generic
  `interface.*` trigger, including renamed/new uplinks.
- Applying disabled settings still runs the existing transaction, removes the
  previous JSON and DNS redirect, and submits the empty instance definition.
  Only then does native procd serialize the disabled trigger set.
- Re-enabling through Apply restores both the client instance and interface
  trigger. Preparation/application failures retain the existing recovery rules.
- Trigger changes take effect after a successful start/reload, not merely after
  replacing the init script. Already queued interface reloads may finish after
  disabling; later interface events no longer schedule new work. A failed
  disable retains the previous definition and its retry triggers.
- Explicit reload remains supported; this change does not hide reload logs or
  skip required cleanup based solely on the new UCI settings.
- Fully disabled cleanup bypasses startup-only runtime-port/core checks and
  URLTest repair. Their failure must not prevent an existing proxy from being
  disabled. Enabled paths still run both checks and re-read the repaired UCI.
- A transactional disable defers deleting client/server logs until procd
  accepts the empty instance definition. fw4, DNS or submission failure must
  retain both original log contents and inodes for the surviving processes.

## Focused verification

From the repository root:

```sh
. /opt/test-tools/env.sh
. /opt/test-tools/openwrt/packages-ci/env.sh
PYTHONPATH=luci-app-homeproxy/tests python3 -m unittest \
  test_disabled_triggers test_reload \
  test_portability.Portability.test_interface_trigger_not_named_wan -v
busybox ash -n luci-app-homeproxy/root/etc/init.d/homeproxy
git diff --check
```

`test_disabled_triggers.py` uses native procd trigger builders and libubox jshn
serialization. `test_reload.py` executes production init functions and native
rc.common/procd submission wrappers with private files and harmless UCI/core/
network/transport boundaries. It covers disable/re-enable in one shell and
checks cleanup before re-enabling. No compilation, proxy, host service change
or router deployment occurs. The existing compile-bearing procd event-pattern
probe is separate and must not run under the local no-build policy.

## Recorded evidence

- Before the production edit, `test_disabled_triggers.py` failed for both the
  explicit disabled main node and its missing-value default: an interface
  trigger was present. Enabled-mode cases already passed.
- After the edit, both native trigger cases passed; the separate existing
  enabled-interface serialization case also passed (three unittest cases).
- The affected reload suite passed all eleven cases, including the new
  disable/cleanup/re-enable cycle and startup-failure-independent disable
  cleanup, plus existing preparation/application fault matrices. The latter
  regression first failed against both runtime-init and node-repair faults.
  The final combined reload/native-trigger gate passed fourteen unittest cases
  inside a 768 MiB memory / zero-swap scope. A further focused disabled
  submission-failure regression passed and checked old JSON/DNS restoration;
  this adds one independent unittest case (fifteen unique cases accepted).
  No skipped cases were counted.
- With log-preservation assertions added, the disabled submission failure
  reproduced missing client history before the production change. After
  deferring log removal, the affected reload/recovery/native-trigger gate
  passed twenty-eight cases; all disabled fw4/DNS/ubus failures retained log
  contents and inodes. The successful-disabled cleanup assertion also passed.
- Upgrade defaults and subscription-apply consumers passed six focused cases
  against the updated init, including preparation failure and rollback paths.
- A separate temporary `hermes-verify-*.py` probe replayed disabled, client,
  URLTest and server-only native trigger JSON and checked shell syntax plus
  `git diff --check`; it passed and was deleted. This was ad-hoc verification,
  not a full-suite result.
