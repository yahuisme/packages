# Local package regression runner

Run regression checks locally; they are not a GitHub Actions workflow. The
separate scheduled package updater still validates resources and new stable cores
before publishing its own updates.

```sh
export TMPDIR=/path/to/private/scratch
mkdir -p "$TMPDIR"
python3 .github/scripts/setup-test-tools.py --dest "$TMPDIR/packages-tools"
. "$TMPDIR/packages-tools/env.sh"
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export NODE_PATH=/path/to/node_modules  # jsdom 26.1.0
.github/scripts/run-tests.sh
# Focused rerun; shared suites are deduplicated even if supplied twice:
.github/scripts/run-tests.sh luci-app-airoha-flowsense/tests/test_acceleration.py
```

The setup script supports Linux aarch64/x86_64, downloads checksum-pinned official
OpenWrt 24.10.4 rootfs tools (UCI, jshn, jsonfilter, ucode and fs/uci modules),
its matching checksum-pinned digest module, Debian BusyBox 1.35.0-4+deb12u1+b1,
and the pure-Python po2lmo 1.0.0 wheel. It also stages checksum-pinned official
`rc.common` and `procd.sh` sources for private service-lifecycle replays and exports
`OPENWRT_SOURCE` to that minimal read-only fixture.
It only extracts under `--dest`, uses the private musl loader explicitly, and
probes UCI against a private configuration. It does not install packages, run init
scripts, compile code or start a proxy. Host requirements: Python >=3.12, dpkg-deb,
Node, npm, timeout, GNU make, gettext/msgfmt, and strace for the process-count
tests. Use the full LuCI checkout at
`a8c110bed82375b69eb3881b2e54e617520e8c7d` for the maintained native fixtures.
The wheel is an alternate PO-to-LMO implementation; native LuCI catalog lookups
are exercised by the localization gates. This does not claim testing of upstream
C po2lmo itself.

Python suites are loaded by exact file path into unittest, including dotted
filenames and files without a `__main__` block.
Zero discovered tests fail, including an empty or entirely unverified selection.
All `.github/tests/test_*.py` updater/runner suites and `sing-box/tests/*.py`
service-init suites are included in default discovery and support focused selection.
Shared CJS suites and standalone lifecycle helper entrypoints run once. Helper
exclusions use exact repository-relative paths, never shared basenames. Both default
discovery and focused selection execute these complete mode sets (one suite result
per unique path; any mode failure fails that suite without stopping later modes):

| Suite | Modes |
| --- | --- |
| FlowSense `test_view.js` | normal, `ERROR_MESSAGES_TEST=1` |
| WiFi7 `permissions-reentry.cjs` | revoked, reentry, pending |
| WiFi7 `wireless-runtime.cjs` | availability, cost |
| WiFi7 `known-defects.cjs` | text, lifecycle, rpc |
| WiFi7 `render-reuse.cjs` | radio, mlo-runtime, mlo-summary |
| WiFi7 `view.test.js` | normal, `NATIVE_TEST=1`, `MLO_TEST=1`, `DENIED_TEST=1` |
| WiFi7 `regression.test.js` | normal, `NATIVE_TEST=1`, `MLO_TEST=1`, `READONLY_TEST=1`, `MISSING_MODE_TEST=1` |

These fixture-mode environment variables are cleared before each Node suite so
ambient selectors cannot collapse the normal/other branches. Other documented
argument selectors already run all their branches by default, including WiFi7
`cross-actions.cjs`, `radio-refresh.cjs`, `error-text.cjs` and
`performance-equivalence.cjs`; they need no duplicate runner invocations.
`.github/tests/test_runner.py` uses disposable failing sentinels for every listed
mode, discovery/focused selection, deduplication, helper exclusion and failure
aggregation. Logs use a unique directory under the caller's TMPDIR.
`UNVERIFIED` is separate from PASS and includes suites containing unittest skips.
Missing required tools otherwise cause failure rather than successful skips.

Remaining runtime boundaries are explicit: full router/compiler and browser
fixtures, the standalone coupling helper driven by SettingsTest, and the optional
DNS runtime binary. Reload/cleanup, subscription apply/reconcile and resource-scope
transactions now run using the pinned private runtime and shell-source fixture.
Generator fixtures bind their private platform modules by exact
path while retaining native fs/digest, preventing installed ucode extensions from
shadowing the isolated UCI/ubus fixtures.

## Automatic stable-core updates

`update-homeproxy.py` still verifies the official source archive. If the core
version and both resource versions and Git blobs match, it skips the binary
download and publication. Otherwise, it downloads only missing or changed SRS
bytes and runs the SRS/schema smoke checks. On a core version change, the
source archive must contain the build entry point, Go module and license. The
updater then prepares the pinned tools and runs `check-core-compatibility.py` against
that exact digest-verified candidate and the staged rule sets before publishing
any new bytes. The gate checks the default config shared by both sing-box
variants and reuses
native client/server generation, ACME DNS-01 provider switches, explicit
DNS/ECH address-family policy, routing, URLTest, UoT/multiplex and retained
Hysteria obfuscation suites with `SING_BOX_CHECK`, plus the DNS fallback and NTP
bootstrap runtime cases in distinct, verified loopback-only network namespaces.
Zero tests, skips, tool preparation failures and compatibility failures all stop
publication; there is no host-network fallback. The namespaces require root
(passwordless sudo on GitHub's runner), iproute2 and unshare; server fixtures use
OpenSSL. No firmware is compiled and no host service or clock is changed.

The recipe, README sing-box version and resources share the updater's existing
rollback/recovery transaction. The bot stages README with the core commit, not
the resource commit. These pre-publication gates do not depend on a push workflow
being triggered by `GITHUB_TOKEN`. `.github/tests/test_core_update.py` covers the
conditional gate, refusal/rollback boundaries and real commits to a private local
Git remote. Future versions must pass the same gates; this is not evidence of
router startup, feed-built full/tiny binary features, TUN/kernel behavior or
remote protocol interoperability.

For changes affecting HomeProxy permissions or native workers, use the prepared
tool environment and an isolated root test unit. Run the affected private-fixture
entrypoints explicitly; do not count a non-root or missing-runtime skip as a pass.
`test_certificate_cleanup.py`, `test_generated_config_permissions.py`,
`test_log_permissions.py` and `test_subscription_jobs.py` exercise the numeric
service UID and filesystem boundaries. For `test_runtime_init_native.py`,
`test_domain_session_rpc.py`, `tests/subscription-rpc-native.py` and
`tests/resource-rpc-native.py`, set `OPENWRT_ROOTFS=$OPENWRT_TOOLS/rootfs.tar.gz`.
The resource RPC fixture also needs
`OPENWRT_DIGEST=$OPENWRT_TOOLS/runtime/usr/lib/ucode/digest.so`.

jsdom stays at 26.1.0: 30.1.3 changes CSS custom-property computed styles and the
subscription timer harness. The upstream whatwg-encoding deprecation remains visible;
it is not suppressed or treated as a product failure.
