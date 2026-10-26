#!/bin/sh
# Run every package regression suite this host can actually provide.
#
# Skips are printed with a reason, so a green run is never mistaken for full
# coverage: either the suite needs router-only inputs (static lists), or a tool
# this host does not ship (probed, not guessed from failure text).
#
# Requires: node (jsdom via NODE_PATH), python3, LUCI_RESOURCE_DIR pointing at
# a luci-base htdocs/luci-static/resources checkout.
set -u

cd "$(dirname "$0")/../.." || exit 1
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
export LUCI_RESOURCE_DIR="${LUCI_RESOURCE_DIR:?set LUCI_RESOURCE_DIR to luci-base resources}"
export PYTHONDONTWRITEBYTECODE=1

# Driven by another suite with explicit arguments, not standalone.
HELPERS='client_generator_fixture.py dns_runtime_fixture.py subscription_uci_fixture.py
harness.js mlo-luci-dom.cjs test_view.js l10n.js'
# Need a real OpenWrt tree, ucode module dir or router binaries.
ROUTER='test_portability.py test_reload.py test_reload_cleanup.py test_resource_scopes.py
test_subscription_apply.py test_subscription_reconcile.py'
# Need Playwright or the AURORA/NPU theme layout fixtures.
BROWSER='test_curve_browser.js test_chart_mount.js'
# Read host sysfs/cpufreq and a staged rpcd fixture path; host-dependent.
HOST='luci-app-airoha-npu/tests/test_backend.py luci-app-airoha-flowsense/tests/test_coupling.js'
# Generate or validate translations through gettext.
NEED_MSGFMT='luci-app-airoha-npu/tests/test_catalog.py
luci-app-airoha-flowsense/tests/test_i18n.py
luci-app-wifi7/tests/mlo-localization.cjs'
# Run the ucode backends (generators, rpcd handlers) directly.
NEED_UCODE='luci-app-homeproxy/tests'

listed() {
	for item in $2; do [ "$1" = "$item" ] && return 0; done
	return 1
}
has() {
	command -v "$1" > /dev/null 2>&1 || return 1
	# A stub on PATH must not count as a working tool.
	"$1" --version > /dev/null 2>&1 || "$1" -v > /dev/null 2>&1 || "$1" -h > /dev/null 2>&1
}

pass=0 skip=0 fail=0
skipping() { printf 'SKIP %s (%s)\n' "$1" "$2"; skip=$((skip + 1)); }

run() {
	name=${1##*/}
	listed "$name" "$HELPERS" && return 0
	listed "$1" "$HOST" && { skipping "$1" 'reads host sysfs / needs staged rpcd fixture'; return 0; }
	if listed "$name" "$ROUTER" || listed "$name" "$BROWSER"; then
		skipping "$1" 'needs router/theme inputs'; return 0
	fi
	listed "$1" "$NEED_MSGFMT" && ! has msgfmt && { skipping "$1" 'host has no msgfmt'; return 0; }
	case $1 in
	luci-app-homeproxy/tests/*) has ucode || { skipping "$1" 'host has no ucode'; return 0; } ;;
	esac
	case $1 in
	*.py) timeout 300 python3 "$1" > /tmp/pkg-test.log 2>&1 ;;
	*) timeout 300 node "$1" > /tmp/pkg-test.log 2>&1 ;;
	esac
	if [ $? -eq 0 ]; then
		printf 'PASS %s\n' "$1"; pass=$((pass + 1)); return 0
	fi
	printf 'FAIL %s\n' "$1"
	sed -n '1,25p' /tmp/pkg-test.log
	fail=$((fail + 1))
}

for pkg in luci-app-airoha-fancontrol luci-app-airoha-npu luci-app-airoha-flowsense \
           luci-app-wifi7 luci-app-homeproxy; do
	for file in "$pkg"/tests/*.js "$pkg"/tests/*.cjs "$pkg"/tests/*.py tests/*.cjs; do
		[ -f "$file" ] && run "$file"
	done
done

printf '\n%d passed, %d skipped, %d failed\n' "$pass" "$skip" "$fail"
[ "$fail" -eq 0 ] || { echo 'regression suites failed'; exit 1; }
