# Firmware upgrade regression tests

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 UCI_BIN=/path/to/uci JSONFILTER_BIN=/path/to/jsonfilter python3 -m unittest discover -s luci-app-firmwareupgrade/tests -v
NODE_PATH=/usr/local/lib/node_modules node luci-app-firmwareupgrade/tests/test_frontend.js
```

Runtime tests execute the package's actual shell entrypoints under BusyBox ash. UCI and jsonfilter are real binaries; curl, sysupgrade and worker-launch boundaries are harmless local fixtures. Tests rewrite only absolute runtime/config paths in temporary copies, keeping all configuration, staging, locks and status below private temporary directories. No test performs a real download, flash, sysfs write or live UCI change. Missing real binaries fail rather than skip.

Coverage includes real release-to-four-column-TSV discovery, failed HTTP bodies, candidate identity and one-shot consumption, concurrent launch, lock contenders, private UCI save/commit, pre-existing deltas, blank secrets, absent options, verification/rollback failure, size/hash/preflight/final-flash failures and terminal success. The jsdom test executes actual view callbacks and proves confirmation captures the displayed candidate, not a mutable later discovery.

Settings save rejects pre-existing pending UCI edits and uses a private transaction; it never commits or reverts shared staging. Application operations share a lock. An unrelated process that ignores this lock can still race the final filesystem publish; this is not a system-wide UCI transaction guarantee.

These fixtures do not establish hardware flashing compatibility, real GitHub availability, full LuCI theme rendering or an OpenWrt package build.
