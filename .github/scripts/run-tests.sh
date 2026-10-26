#!/bin/sh
# Run every package regression suite that a plain build host can provide.
#
# Skips are explicit and printed, so a green run is never mistaken for full
# coverage. Most suites ship their own uci/jsonfilter shims; only a few need a
# real OpenWrt source tree, ucode modules, or a browser.
#
# Requires: node (jsdom via NODE_PATH), python3, and LUCI_RESOURCE_DIR pointing
# at a luci-base htdocs/luci-static/resources checkout.
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
# Read host sysfs/cpufreq and a staged rpcd fixture path; host-dependent, and
# red on a generic build host for reasons unrelated to the packages.
HOST='luci-app-airoha-npu/tests/test_backend.py luci-app-airoha-flowsense/tests/test_coupling.js'

listed() {
	for item in $2; do [ "$1" = "$item" ] && return 0; done
	return 1
}

fail=0
run() {
	name=${1##*/}
	if listed "$name" "$HELPERS"; then return 0; fi
	if listed "$1" "$HOST"; then
		printf 'SKIP %s (reads host sysfs / needs staged rpcd fixture)\n' "$1"
		return 0
	fi
	if listed "$name" "$ROUTER" || listed "$name" "$BROWSER"; then
		printf 'SKIP %s (needs router/theme inputs)\n' "$1"
		return 0
	fi
	case $1 in
	*.py) timeout 300 python3 "$1" > /tmp/pkg-test.log 2>&1 ;;
	*) timeout 300 node "$1" > /tmp/pkg-test.log 2>&1 ;;
	esac
	if [ $? -eq 0 ]; then
		printf 'PASS %s\n' "$1"
	else
		printf 'FAIL %s\n' "$1"
		sed -n '1,25p' /tmp/pkg-test.log
		fail=1
	fi
}

for pkg in luci-app-airoha-fancontrol luci-app-airoha-npu luci-app-airoha-flowsense \
           luci-app-wifi7 luci-app-homeproxy; do
	for file in "$pkg"/tests/*.js "$pkg"/tests/*.cjs "$pkg"/tests/*.py tests/*.cjs; do
		[ -f "$file" ] && run "$file"
	done
done

[ "$fail" -eq 0 ] || { echo 'regression suites failed'; exit 1; }
echo 'all runnable regression suites passed'
