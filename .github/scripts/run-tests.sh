#!/bin/sh
# Run isolated package suites once; optional path arguments select affected gates.
set -u
cd "$(dirname "$0")/../.." || exit 1
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
export LUCI_RESOURCE_DIR="${LUCI_RESOURCE_DIR:?set LUCI_RESOURCE_DIR to luci-base resources}"
export PYTHONDONTWRITEBYTECODE=1
: "${TMPDIR:?set TMPDIR to a private scratch directory}"
work=$(mktemp -d "$TMPDIR/packages-tests.XXXXXX") || exit 1
trap 'rm -rf "$work"' EXIT HUP INT TERM

# Driven by another suite with explicit arguments, not standalone.
HELPERS='client_generator_fixture.py dns_runtime_fixture.py subscription_uci_fixture.py
harness.js mlo-luci-dom.cjs test_view.js l10n.js'
# Full router/compiler fixtures are optional; runtime replays use pinned sources.
ROUTER='test_portability.py'
BROWSER='test_curve_browser.js test_chart_mount.js'
HOST='luci-app-airoha-flowsense/tests/test_coupling.js'
NEED_MSGFMT='luci-app-airoha-npu/tests/test_catalog.py
luci-app-airoha-flowsense/tests/test_i18n.py
luci-app-wifi7/tests/mlo-localization.cjs'
GENERATOR='test_client_defaults.py test_client_routing.py test_current_node.py test_dns_fallback.py
test_domain_lists.py test_ss_uot_generation.py test_tun_bypass.py test_urltest_options.py test_resource_cleanup.py'

listed() {
	for item in $2; do [ "$1" = "$item" ] && return 0; done
	return 1
}
pass=0 skip=0 fail=0
skipping() { printf 'UNVERIFIED %s (%s)\n' "$1" "$2"; skip=$((skip + 1)); }
run() {
	name=${1##*/}
	listed "$name" "$HELPERS" && return 0
	listed "$1" "$HOST" && { skipping "$1" 'needs isolated host/platform fixture'; return 0; }
	if listed "$name" "$ROUTER" || listed "$name" "$BROWSER"; then
		skipping "$1" 'needs router/source/theme/browser fixture'; return 0
	fi
	if listed "$name" "$GENERATOR" && ! ucode -L "${UCODE_LIB_DIR:-/usr/lib/ucode}" -e "import { md5 } from 'digest';" > "$work/probe" 2>&1; then
		skipping "$1" 'runtime lacks required ucode digest module'; return 0
	fi
	# Digest-dependent fixtures use the selected runtime from PATH.
	listed "$1" "$NEED_MSGFMT" && ! command -v msgfmt >/dev/null 2>&1 && {
		printf 'FAIL %s (required dependency: msgfmt)\n' "$1"; fail=$((fail + 1)); return 0;
	}
	: > "$work/output"
	case $1 in
	*.py) timeout "${PACKAGE_TEST_TIMEOUT:-300}" python3 -c '
import importlib.util, pathlib, sys, unittest
path = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, str(path.parent))
spec = importlib.util.spec_from_file_location(path.stem.replace(".", "_"), path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
suite = unittest.defaultTestLoader.loadTestsFromModule(module)
result = unittest.TextTestRunner().run(suite)
sys.exit(0 if result.wasSuccessful() and result.testsRun else 1)
' "$1" > "$work/output" 2>&1 ;;
	*) if [ "$1" = luci-app-wifi7/tests/render-reuse.cjs ]; then
		status=0
		for mode in radio mlo-runtime mlo-summary; do
			timeout "${PACKAGE_TEST_TIMEOUT:-300}" node "$1" "$mode" >> "$work/output" 2>&1 || status=1
		done
		[ "$status" -eq 0 ]
	else
		timeout "${PACKAGE_TEST_TIMEOUT:-300}" node "$1" > "$work/output" 2>&1
	fi ;;
	esac
	status=$?
	if [ "$status" -eq 0 ]; then
		if grep -Eq '^Ran 0 tests' "$work/output"; then
			printf 'FAIL %s (no tests discovered)\n' "$1"; fail=$((fail + 1)); return 0
		fi
		# unittest skips must remain visible instead of counting as acceptance.
		if grep -Eq '^OK \(skipped=[1-9][0-9]*\)' "$work/output"; then
			skipping "$1" 'suite contains skipped cases'; cat "$work/output"; return 0
		fi
		printf 'PASS %s\n' "$1"; pass=$((pass + 1)); return 0
	fi
	printf 'FAIL %s (exit %s)\n' "$1" "$status"
	cat "$work/output"
	fail=$((fail + 1))
}

if [ "$#" -eq 0 ]; then
	set --
	for pkg in luci-app-airoha-fancontrol luci-app-airoha-npu luci-app-airoha-flowsense \
	           luci-app-wifi7 luci-app-homeproxy sing-box; do
		for file in "$pkg"/tests/*.js "$pkg"/tests/*.cjs "$pkg"/tests/*.py; do
			[ ! -f "$file" ] || set -- "$@" "$file"
		done
	done
	for file in tests/*.cjs tests/helpers/test_*_lifecycle.cjs .github/tests/test_*.py; do
		[ ! -f "$file" ] || set -- "$@" "$file"
	done
fi
# Validate all selections before running anything. Paths are repository-relative.
for file do
	case "$file" in
	luci-app-*/tests/*|sing-box/tests/*.py|tests/*.cjs|tests/helpers/test_*_lifecycle.cjs|.github/tests/test_*.py) ;;
	*) printf 'Invalid suite: %s\n' "$file" >&2; exit 2 ;;
	esac
	case "$file" in *..*|/*) printf 'Invalid suite: %s\n' "$file" >&2; exit 2 ;; esac
	[ -f "$file" ] || { printf 'Missing suite: %s\n' "$file" >&2; exit 2; }
done
seen='
'
for file do
	case "$seen" in *"
$file
"*) continue ;; esac
	seen="$seen$file
"
	run "$file"
done
printf '\n%d passed, %d unverified, %d failed\n' "$pass" "$skip" "$fail"
[ "$pass" -gt 0 ] || { echo 'No runnable suites passed'; exit 1; }
[ "$fail" -eq 0 ] || { echo 'regression suites failed'; exit 1; }
