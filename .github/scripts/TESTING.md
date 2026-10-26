# Package regression runner

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
Debian BusyBox 1.35.0-4+deb12u1+b1, and the pure-Python po2lmo 1.0.0 wheel.
It only extracts under `--dest`, uses the private musl loader explicitly, and
probes UCI against a private configuration. It does not install packages, run init
scripts, compile code or start a proxy. Host requirements: Python >=3.12, dpkg-deb,
Node, npm, timeout, and gettext/msgfmt. Workflow LuCI resources are pinned by SHA.
The wheel is an alternate PO-to-LMO implementation; native LuCI catalog lookups
are exercised by the localization gates. This does not claim testing of upstream
C po2lmo itself.

Python suites are loaded by exact file path into unittest, including dotted
filenames and files without a `__main__` block.
Zero discovered tests fail. Shared CJS suites and standalone lifecycle helper
entrypoints run once. Logs use a unique directory under the caller's TMPDIR.
`UNVERIFIED` is separate from PASS and includes suites containing unittest skips.
Missing required tools otherwise cause failure rather than successful skips.

Remaining runtime boundaries are explicit: full router/source/theme/browser
fixtures, the standalone coupling helper driven by SettingsTest, the DNS runtime binary, and HomeProxy generator suites when `digest`
cannot be imported. The pinned OpenWrt rootfs lacks digest; these generator and
resource-cleanup suites are **not accepted** by this CI environment. Provide
matching isolated runtime fixtures before claiming those gates.
