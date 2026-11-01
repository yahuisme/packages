# Scoped startup / Dashboard read equivalence

Run from the repository root inside the caller's <=768MiB, swap-disabled test
cgroup, with `TMPDIR` pointing at private scratch storage:

```sh
. /opt/test-tools/env.sh
. /opt/test-tools/openwrt/packages-ci/env.sh
PYTHONPATH=luci-app-homeproxy/tests python3 -m unittest \
  test_init_path_cost test_subscription_cron test_reload test_reload_cleanup \
  test_runtime_init test_dashboard_read_boundary test_dashboard_rpc \
  test_rpc_compatibility -v
```

`test_init_path_cost` executes the complete production cron functions in native
ash. It compares exit/stdout/stderr and all private committed file bytes/modes
against the old dirname expressions for 13 success/failure cases, including
space-containing absolute paths. It requires zero dirname invocations after the
change. Platform locks are fixtures; no crond or host service is touched.

`test_dashboard_read_boundary` executes the complete RPC module using native
fs/UCI and the production helper (HTTP query parsing is private). Missing,
empty, literal `nil`, 32KiB, directory and real EACCES cases compare entire
`resources_get` outputs against a test-only one-byte candidate, including changed
files between calls. The EACCES child drops uid only when run as root; unused
helper imports in that case are placeholders to avoid realpath traversal of a
root-private scratch ancestor.

A private PTY supplies 8192 bytes followed by EIO. The index-path adapter directs
both reads to native `fs.fdopen`: the legacy whole-read boundary uses a 1MiB
native numeric read, while the candidate reads one byte. A full failing read
reports absent, but a one-byte read reports installed. Immediate EIO reports
absent in both. Production therefore deliberately retains `fs.readfile`; the
candidate is not a safe equivalent for late read faults. The generator's
`isEmpty('nil')` rule and independent mkdir entry remain untouched.

Optional evidence export: `HP_P2_EVIDENCE=/private/path` retains complete JSON
outputs and executed ucode/helper inputs, source hashes and cron comparisons.
Counts describe returned string bytes / eliminated command invocations, not
physical disk reads, fork counts, router RSS or performance percentages.

Exploratory acceptance switches deliberately fail, and must NOT be set in CI:
`HP_P2_REQUIRE_BOUNDED=1` requires the still-unmodified production RPC to avoid
its full read; `HP_P2_REQUIRE_SHORT_EQ=1` requires the unsafe candidate to match
the complete late-EIO output. Default unittest discovery executes three tests
(nonzero), passes only when the documented safe behavior/boundary is preserved,
and requires no bespoke command-line arguments. No compilation, browser,
network, real proxy or host configuration is used.
