# ECH import, migration and previously isolated runtime gates

```sh
. /opt/test-tools/env.sh
. /opt/test-tools/openwrt/packages-ci/env.sh # setup-test-tools.py output; ABI-matched ucode/modules
export PACKAGES_ROOT="$PWD"
PYTHONPATH=luci-app-homeproxy/tests python3 -m unittest \
  test_migration test_subscription_parsing test_subscription_reconcile \
  test_subscription_apply test_reload test_reload_cleanup test_resource_scopes -v
node luci-app-homeproxy/tests/test_share_links.cjs
node tests/share-link-ech-ui.cjs
```

The migration test uses the native ucode UCI module with private configuration
and saved-delta directories. It executes the complete production migration,
injects null-returning load/set/delete boundaries, and checks unchanged committed
bytes on failure plus successful option migration and zero-commit repetition.
The ECH tests distinguish binary Base64 from UTF-8 and preserve nested DNS URLs
through manual import and subscription parsing. The native LuCI modal case runs
import → UCI save → reload → Map.reset with private persistent RPC storage.
These are isolated host contracts, not actual ECH handshakes or router upgrades.

# Subscription group display and URLTest validation

```sh
. /opt/test-tools/env.sh
# Use the checksum-pinned native runtime and its ABI-matched modules.
. /opt/test-tools/openwrt/packages-ci/env.sh
ucode -e 'import { popen, lstat } from "fs"; print(type(popen), "\n");'
node luci-app-homeproxy/tests/test_subscription_groups.cjs
python3 -m unittest discover -s luci-app-homeproxy/tests -p 'test_urltest_options.py' -v
```

The UI regression executes the shared production group parser, complete client
and node views, native choice widgets and validation. It covers Unicode/scalar
URLs, deduplication, malformed titles, literal group/node labels in main,
URLTest and diversion choices, current-node protocol display and retained
interval/tolerance controls. The generator regression rejects malformed or
out-of-range tolerance before writing a config, preserves explicit zero and
65535, and retains 120-second/default and explicit interval behavior. UCI/RPC
transport and generator platform modules are private fixtures; no browser,
proxy, compilation or host configuration is used.

# Client/status UI simplification

```sh
. /opt/test-tools/env.sh
export PACKAGES_ROOT="$PWD" NODE_PATH=/usr/local/lib/node_modules
export LUCI_RESOURCE_DIR=/opt/test-tools/luci-fixtures/luci/modules/luci-base/htdocs/luci-static/resources
node luci-app-homeproxy/tests/test_status_simplification.cjs
node luci-app-homeproxy/tests/test_client_simplification.cjs
node tests/helpers/test_connection_lifecycle.cjs
node tests/helpers/test_page_lifecycle.cjs
node tests/resource-results-ui.cjs
node tests/status-accessibility.cjs
node tests/ui-state-regressions.cjs
```

Run through the caller's bounded-test wrapper. These execute the complete
production LuCI views and shared resource module, with private RPC/file transport.
The resource-results suite mounts the client dashboard plus the production
Status rules widget to retain cross-widget lock and mixed-result coverage.
Client resource actions refresh only resource widgets, preserving unsaved form
edits. `pageBoot(name, translations, options)` accepts per-section `options.values`,
`options.resources` and `options.readonly` for current visual/state fixtures.
This is offline DOM behavior coverage; browser/theme and router verification
are separate gates. Re-run affected suites against the final shared-module
revision; earlier logs do not validate later source changes.

Node/server editor parity, source filtering, native saves and primary-node apply
regressions are documented in [`../../tests/NODE-UI.md`](../../tests/NODE-UI.md).

# Service status and current-node performance regressions

Run from the repository root with the shared test environment loaded:

```sh
. /opt/test-tools/env.sh
python3 -m unittest discover -s luci-app-homeproxy/tests -p 'test_current_node.py' -v
export PACKAGES_ROOT="$PWD"
export LUCI_RESOURCE_DIR="${LUCI_RESOURCE_DIR:-/opt/test-tools/luci-fixtures/luci/modules/luci-base/htdocs/luci-static/resources}"
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
python3 luci-app-homeproxy/tests/test_tun_bypass.py -v
python3 luci-app-homeproxy/tests/test_ss_uot_generation.py -v
python3 luci-app-homeproxy/tests/test_client_defaults.py -v
```

Runs the complete production client generator and outbound helper in real ucode.
UCI, ubus, URL-query decoding and datatype validation are explicit fixtures;
files are private. Covers list-mode pre-match/normal-path pairing, IP/MAC/empty
lists, active-family TUN-source bypass guards, mainland and forced-proxy precedence, SS UoT/multiplex
priority, and unchanged IPv6/cache behavior. Set `SING_BOX_CHECK` to an official
binary to also check every generated JSON. This is not router traffic evidence.

For DNS timeout/fallback checks:

```sh
DNS_RUNTIME_BINARY=/path/to/verified/sing-box-1.14.3 \
SING_BOX_CHECK=/path/to/verified/sing-box-1.14.3 \
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
node luci-app-homeproxy/tests/test_helper_hash.cjs
```

The shared environment supplies jsdom and native LuCI for the hash regression.
It compares UTF-8 MD5 vectors and saves subscription nodes through native Map
with private persistent transport, ensuring Unicode URLs retain nodes/references.

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
updated node rows and source choices after cache invalidation, held/failing
list load/reset, retained results after reset, and deletion confirmation/cancel.
Subscription refresh explicitly reloads UCI and option values: `Map.reset()`
alone does not fetch the nodes written by the external updater. The regression
also checks the exact refreshed primary-node row's Applied label. Timer-backed
stages use a monotonic deadline and timer-phase yielding, not a count of
`setImmediate` turns. A separate unaccelerated production 1s delay case verifies
that confirmation waits and that held confirmation still blocks the updater.

`tests/subscription-rpc-native.py` runs the production shell wrapper against the
checksum-verified OpenWrt rootfs in private network/PID namespaces with native
ash, rpcd, file.exec and ubus. Only the downloader is held by a local fixture.
It verifies that `--start` returns immediately, busy reentry is reported, and
both successful and failed worker exit codes arrive through the status RPC.
CI passes `OPENWRT_ROOTFS` from the staged rootfs archive and runs this gate as
root; it does not contact subscriptions or invoke router services.

# Audit-boundary regressions

Run these through the caller's verified memory-bounded wrapper, after selecting
checksum-pinned OpenWrt ucode/fs/UCI/digest and the native LuCI resource tree:

```sh
PYTHONPATH=luci-app-homeproxy/tests python3 -m unittest \
  test_rpc_compatibility test_domain_lists test_certificate_cleanup \
  test_anytls_generation test_subscription_plugin_native test_dns_validation \
  test_subscription_jobs -v
node tests/domain-remove-ui.cjs
node tests/dns-validation-ui.cjs
node tests/acme-validation-ui.cjs
node tests/urltest-status-ui.cjs
node tests/homeproxy-container-ui.cjs
node tests/node-latency-batches-ui.cjs
node tests/subscription-job-ui.cjs
node tests/subscription-ui.cjs
```

All new cases are automatically discovered by the existing `.github/scripts/run-tests.sh`.
The RPC-link test preserves the complete production native imports, changing only
the absolute helper path and rpcd's final registration return. It links the real
production helper, isolating only its unused LuCI HTTP query-decoding import. Domain transactions
now execute the production atomic `mktemp -d` wrapper, not an fs compatibility shim.
The uid-read test maps only the router's sing-box account name to a private numeric
uid and requires root; it never creates a host account. The plugin test executes
full updater main with native UCI confdir/savedir and checks committed strings,
boolean mux semantics, SIP003 escaping and fail-closed unsupported maps.

Contract changes are intentional: AnyTLS defaults are decided by capability-aware
importers, while empty/manual Disable stays disabled in the renderer. Removing a
domain group only changes the UCI session; unreferenced list files remain as
recoverable tombstones (including after Apply) because Apply rollback is also
reversible. The generator reads only referenced sections; destructive orphan GC
is not performed at a nontransactional UI boundary. The old static mkdtemp-name
assertion now checks the production atomic helper, with native allocation tested
separately.

Subscription UI calls the existing ACL-allowed wrapper with `--status`/`--start`.
Only start detaches; the worker inherits the existing flock descriptor and writes
an atomic exit result. Short status calls report real busy/done state without
holding a download-sized RPC open. Busy reentry does not save/apply drafts; an
uncertain status warns that the worker may still run. The no-argument cron path
remains synchronous. `subscription-ui.cjs` fixtures explicitly return the new job
JSON while retaining native save/apply/no-op/confirm ordering, failure and refresh
coverage. Node latency uses sequential 16-node RPCs with completed/total feedback;
fixtures do not start the core or claim network latency measurements.

Container tests establish native reset/style retention, not browser geometry.
Browser acceptance must still compare Aurora and Bootstrap light/dark at phone,
sidebar tablet and desktop widths, and measure actual status transitions before
claiming a CLS result. Equal-status DOM stability remains a separate regression.

Reload guards/backup/submission adapter selectively reuse the repository's
`e000a5c` implementation; current URLTest cleanup policy is retained. Cold
`start` remains on native rc.common semantics; this regression targets `reload`.
