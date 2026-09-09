# Firmware upgrade regression tests

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 UCI_BIN=/path/to/uci JSONFILTER_BIN=/path/to/jsonfilter python3 -m unittest discover -s luci-app-firmwareupgrade/tests -v
NODE_PATH=/usr/local/lib/node_modules node luci-app-firmwareupgrade/tests/test_frontend.js
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/tmp/mlo-luci/modules/luci-base/htdocs/luci-static/resources node luci-app-firmwareupgrade/tests/test_rpc.js
```

Runtime tests execute the package's actual shell entrypoints under BusyBox ash. UCI and jsonfilter are real binaries; curl, sysupgrade and worker-launch boundaries are harmless local fixtures. Tests rewrite only absolute runtime/config paths in temporary copies, keeping all configuration, staging, locks and status below private temporary directories. No test performs a real download, flash, sysfs write or live UCI change. Missing real binaries fail rather than skip.

Coverage includes real release-to-four-column-TSV discovery, failed HTTP bodies, candidate identity and one-shot consumption, concurrent launch, lock contenders, private UCI save/commit, pre-existing deltas, blank secrets, absent options, verification/rollback failure, size/hash/preflight/final-flash failures and terminal success. The jsdom test executes actual view callbacks and proves confirmation captures the displayed candidate, not a mutable later discovery.

Settings save rejects pre-existing pending UCI edits and uses a private transaction; it never commits or reverts shared staging. Application operations share a lock. An unrelated process that ignores this lock can still race the final filesystem publish; this is not a system-wide UCI transaction guarantee.

These fixtures do not establish hardware flashing compatibility, router-side GitHub availability, full LuCI theme rendering or an OpenWrt package build.

## Check-button diagnostics and timeout evidence

`test_rpc.js` loads real LuCI `rpc.js`, `ui.js`, `form.js` and DOM helpers from `LUCI_RESOURCE_DIR`, with only HTTP transport and page bootstrap isolated. It clicks the actual view button, separately verifies the native form button `(event, section_id)` signature, and checks ACL/menu linkage, retry, stale-release clearing and text-only diagnostics. The firmware view itself does not use `form.Button`.

Before the fix, a real RPC reply `[6]` (Permission denied) became `{}` through `expect`, and the page displayed only “Failed to check for updates.” Transport exceptions were also discarded. The regression failed on that exact missing diagnostic. `checkUpdate` now declares `reject: true` and preserves the exception message in the existing text-only notice. Backend error messages remain unchanged. This fixes swallowed diagnostics, not a proven router-side transport failure.

The inspected LuCI `rpc.js:38` uses `(L.env.rpctimeout ?? 20) * 1000`: default **20 seconds**, not 5. `rpc.declare()` does not implement a per-call `timeout` option. The backend curl limit is 15 seconds; parsing comes afterward, so it is not a bound on total method time. On this host, private-path discovery using real BusyBox/UCI/jsonfilter took **0.061 s** with the captured release list and **0.395 s** with real public GitHub curl (empty token); both selected standard r41057. These are host measurements, not router timings. No timeout was changed. Upstream rpcd `include/rpcd/exec.h` currently defines a 120-second exec default, but the installed router rpcd/uhttpd settings and `L.env.rpctimeout` remain unverified.

The packaged ACL grants `checkUpdate` in `read.ubus.luci.firmwareupgrade`; the menu depends on the same ACL group. `luci-base`, curl, ca-bundle and jsonfilter are package dependencies. No missing static check permission was found. Actual installed ACL, session grants, RPC object registration, package dependencies and router connectivity still require device-side evidence. Capture the newly visible error, the browser `checkUpdate` HTTP/JSON-RPC response and elapsed time, and router `ubus -v list luci.firmwareupgrade`/rpcd logs before attributing the failure to ACL, timeout or GitHub. A root CLI call alone does not verify the browser session ACL.

## Confirmed missing-od root cause

The user subsequently confirmed router `checkUpdate` returned “No response” in 0.83 seconds and direct execution printed `od: not found`. This supersedes the earlier uncertainty below: the candidate generator piped missing `od` into successful `tr`, produced an empty ID, then returned without JSON. This is not a curl timeout or the separate standard/OC selection bug. A private copy restoring that exact old generator, with an explicit BusyBox applet PATH lacking `od`, reproduced empty stdout and `od: not found`.

The replacement reads `/proc/sys/kernel/random/uuid` using shell `read`. Linux documents a fresh UUID on each read (not the fixed `boot_id`): https://docs.kernel.org/admin-guide/sysctl/kernel.html#random . Each UUID is strictly checked as lowercase UUIDv4. A single UUID has fixed version/variant bits, so two reads supply 32 hex characters taken only from random fields, preserving the previous 128 random bits without adding dependencies. No clock, PID or weak fallback is used. The existing candidate lock, private permissions and consume-before-launch contract are unchanged. This proc entry was exercised on the Linux host; installation on the actual router still needs retesting.

The real BusyBox/UCI/jsonfilter regression verifies successful no-od discovery, distinct IDs, mode 0600 and single consumption. Fault injection checks release/assets/candidate mktemp, absent/empty/malformed random input, tr failure, candidate write, chmod and rename failures all produce explicit failure JSON without publishing or launching. UCI `/tmp/packages-fan-upgrade-audit/uci` and jsonfilter `/tmp/packages-final-jsonfilter/jsonpath` were available and executed, not skipped. All network/flash boundaries remain harmless.

## W1700K release regression

`fixtures/w1700k-immortalwrt-latest.json` and `fixtures/w1700k-immortalwrt-releases.json` are unmodified public GitHub API responses captured from `/repos/yahuisme/w1700k-immortalwrt/releases/latest` and `/repos/yahuisme/w1700k-immortalwrt/releases?per_page=10` on 2026-09-09. The repository-wide latest response is OC r41058, while the standard release is r41057. Both publish the identical `immortalwrt-airoha-an7581-gemtek_w1700k-ubi-squashfs-sysupgrade.itb` filename, with different digests. Filename-only matching cannot distinguish them.

The regression replays both responses through the actual RPC shell entrypoint, real jsonfilter and real private UCI, with an empty token. It checks correct standard/OC selection and rejects missing variants, drafts, prereleases, absent digests, zero sizes and non-HTTPS URLs. Production discovery examines the latest 20 releases for this exact known repository, selects the newest published stable tag for the requested branch and fails closed if absent; other repositories retain their existing behavior. It never falls back across variants.

A separate live check with real curl, private runtime paths and an empty token returned standard r41057, size 18477891, SHA256 `0ecbb61557fa2e4746624f1d4a615f1565bb1552c89ea78dceb71c88176db9a8`. No image was downloaded and no worker was started. Importantly, the original local code did **not** reproduce an always-failing ubi2 check: it returned success with the wrong OC release. Router-side transport/rpcd failures remain unverified without the actual router error/response; the local fixture must not be represented as proof of that symptom's cause.
