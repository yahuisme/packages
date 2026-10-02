# Service status and current-node performance regressions

From the repository root, with host ucode and native LuCI/jsdom dependencies:

```sh
python3 -m unittest discover -s luci-app-homeproxy/tests -p 'test_current_node.py' -v
export NODE_PATH=/usr/local/lib/node_modules
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
node tests/service-status-stability.cjs
node tests/service-status-ui.cjs
node tests/helpers/test_page_lifecycle.cjs
```

Run these inside the caller's bounded test cgroup and set `TMPDIR` to a private
scratch directory. They do not compile, start a proxy, launch a browser or touch
router configuration. `test_current_node.py` executes the production RPC method,
complete tag registration and legacy full-filter oracle in real ucode. It covers
first/middle/last/missing matches, registration order, reserved/duplicate/suffix
and special labels, fresh calls, API failures and complete-generator tags.
Only UCI/curl are fixtures. `HP_NODE_EVIDENCE=/path/result.json` retains measured
comparisons and the executed ucode; counts are not router CPU measurements.

The stability test runs complete views through native LuCI with private RPC
transport. Equal output retains DOM nodes with no child-list mutations while
poll RPC order remains unchanged. Running/failure/same-node recovery, unknown,
stopped, literal malicious labels, readonly, reset and reentry are covered;
the existing page-lifecycle test covers held replies across reset/reentry.
`HP_STATUS_EVIDENCE=/path/result.json` saves final DOM/text and RPC sequences.
For explicit pre-optimization comparisons only, `HP_STATUS_ALLOW_REBUILD=1` and
`HP_NODE_ALLOW_FULL_SCAN=1` disable the respective performance assertion, not
semantic assertions. Never enable them for the optimized regression run.

**No-build boundary:** exclude `test_portability.py` when local compilation is
forbidden (it compiles a C trigger probe). Leave `DNS_RUNTIME_BINARY` unset when
proxy execution is forbidden. Use unittest discovery rather than executing
every Python file directly: some test modules have no `unittest.main()` entry.

# Client generator regression

```sh
. /opt/test-tools/env.sh
python3 luci-app-homeproxy/tests/test_client_routing.py -v
python3 luci-app-homeproxy/tests/test_ss_uot_generation.py -v
python3 luci-app-homeproxy/tests/test_client_defaults.py -v
```

Runs the complete production client generator and outbound helper in real ucode.
UCI, ubus, URL-query decoding and datatype validation are explicit fixtures;
files are private. Covers list-mode pre-match/normal-path pairing, IP/MAC/empty
lists, mainland fast-path eligibility, forced-proxy exclusions, SS UoT/multiplex
priority, and unchanged IPv6/cache behavior. Set `SING_BOX_CHECK` to an official
binary to also check every generated JSON. This is not router traffic evidence.

For DNS timeout/fallback checks:

```sh
DNS_RUNTIME_BINARY=/path/to/verified/sing-box-1.14.2 \
SING_BOX_CHECK=/path/to/verified/sing-box-1.14.2 \
python3 luci-app-homeproxy/tests/test_dns_fallback.py -v
```

The runtime test verifies a separate loopback-only network namespace before
starting the official prebuilt core. Production-generated DNS rules run against
private upstream servers and synthetic rule sets: normal/delayed responses,
3-second timeout fallback, explicit domain precedence, caching and global mode.
It does not test live proxy transport or TUN routing. Without `DNS_RUNTIME_BINARY`,
only the runtime test is skipped; generator regressions still run.

# Reload regression

Run from the repository root (Python 3 and BusyBox required):

```sh
OPENWRT_SOURCE=/path/to/openwrt python3 luci-app-homeproxy/tests/test_reload.py -v
```

`OPENWRT_SOURCE` supplies native `package/base-files/files/etc/rc.common` and
`package/system/procd/files/procd.sh`. Set it to your OpenWrt source tree.
No network or proxy is started. Production init
functions and native rc/procd submission wrappers execute in BusyBox ash;
UCI, generators/checker, JSON serialization, ubus, fw4, DNS and ownership
are isolated platform boundaries.

Covers preparation failure without replacing old files, partial JSON install,
firewall generation/application, DNS restart/disable cleanup, ubus transport
failure despite native cleanup/namespace masking, client/server/both/disabled
success, concrete JSON/SRS/dashboard file monitoring, and recovery-copy/removal
failure retaining the complete backup. These are synchronous regression tests,
not proof of daemon startup health, actual procd file hashing, power-loss
atomicity or router firewall correctness.

# Subscription cron regression

```sh
python3 luci-app-homeproxy/tests/test_subscription_cron.py -v
```

Runs production cron functions in BusyBox ash with private files; lock and cron
service calls are isolated. Covers add/change/remove/no-op, first install,
invalid schedules, notification append/failure, and client/auto-update gating.
No host service is touched; this does not reproduce procd killing a cron job.

# Subscription state regression

```sh
. /opt/test-tools/env.sh
python3 -m unittest discover -s luci-app-homeproxy/tests -p 'test_subscription*.py' -v
node tests/ui-state-regressions.cjs
```

The subscription suite uses real ucode and private native libuci CLI storage
through an explicit cursor adapter, with fixture downloads/service calls. It
checks committed UCI and rendered outbound fields after optional-value removal,
partial responses, repeated imports and injected write failures. Override
`UCI_BIN`, `UCI_LIBRARY` and `UCODE_LIB_DIR` for another host tools installation.
The UI suite uses native LuCI with private RPC transport: repeated reset/reentry,
bulk-test visibility, unknown resource status/read-only retry, and log-clear
failure/success. No router service or proxy is started.

# Subscription UI regression

```sh
NODE_PATH=/usr/local/lib/node_modules \
LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources \
node tests/subscription-ui.cjs
python3 -m unittest discover -s luci-app-homeproxy/tests -p 'test_subscription*.py' -v
```

The UI suite executes native LuCI Button, DynamicList, Map and RPC code with
private UCI/apply/exec transport fixtures, not a router or host service. It covers
inline neutral/progress/error/success results, real URL edits and unchanged
apply status 5, fatal confirm status 5, retries, no navigation/notifications,
updated node rows and subscription tabs after cache invalidation, held/failing
list load/reset, retained results after reset, and deletion confirmation/cancel.
Subscription refresh explicitly reloads UCI and option values: `Map.reset()`
alone does not fetch the nodes written by the external updater. The regression
also checks the exact refreshed primary-node row's Applied label. Timer-backed
stages use a monotonic deadline and timer-phase yielding, not a count of
`setImmediate` turns. A separate unaccelerated production 1s delay case verifies
that confirmation waits and that held confirmation still blocks the updater.

Reload guards/backup/submission adapter selectively reuse the repository's
`e000a5c` implementation; current URLTest cleanup policy is retained. Cold
`start` remains on native rc.common semantics; this regression targets `reload`.
