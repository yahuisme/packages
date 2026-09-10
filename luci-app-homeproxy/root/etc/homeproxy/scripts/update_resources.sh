#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2022-2025 ImmortalWrt.org

NAME="homeproxy"
RESOURCES_DIR="${RESOURCES_DIR:-/etc/$NAME/resources}"
DASHBOARD_DIR="${DASHBOARD_DIR:-/etc/$NAME/dashboard}"
RUN_DIR="${RUN_DIR:-/var/run/$NAME}"
LOG_PATH="$RUN_DIR/$NAME.log"
RESULT_PATH="$RUN_DIR/update_resources.result"
GEOIP_SOURCE="${GEOIP_SOURCE:-https://raw.githubusercontent.com/SagerNet/sing-geoip}"
GEOSITE_SOURCE="${GEOSITE_SOURCE:-https://raw.githubusercontent.com/SagerNet/sing-geosite}"
GEOIP_VERSION_URL="${GEOIP_VERSION_URL:-https://api.github.com/repos/SagerNet/sing-geoip/commits/rule-set}"
GEOSITE_VERSION_URL="${GEOSITE_VERSION_URL:-https://api.github.com/repos/SagerNet/sing-geosite/commits/rule-set}"
GEOIP_DIGEST_URL="${GEOIP_DIGEST_URL:-https://api.github.com/repos/SagerNet/sing-geoip/contents/geoip-cn.srs}"
GEOSITE_DIGEST_URL="${GEOSITE_DIGEST_URL:-https://api.github.com/repos/SagerNet/sing-geosite/contents/geosite-cn.srs}"
DASHBOARD_SOURCE="${DASHBOARD_SOURCE:-https://codeload.github.com/SagerNet/sing-box-dashboard/zip}"
DASHBOARD_VERSION_URL="${DASHBOARD_VERSION_URL:-https://api.github.com/repos/SagerNet/sing-box-dashboard/commits/gh-pages}"
SING_BOX="${SING_BOX:-/usr/bin/sing-box}"
HOMEPROXY_INIT="${HOMEPROXY_INIT:-/etc/init.d/homeproxy}"
UPDATE_PROXY="${HOMEPROXY_UPDATE_PROXY:-}"
UPDATED_BRANCHES="" FAILED_BRANCHES=""
CORE_UPDATED=0 DASHBOARD_UPDATED=0 APPLY_FAILED=0 ROLLBACK_FAILED=0

mkdir -p "$RESOURCES_DIR" "$DASHBOARD_DIR" "$RUN_DIR" || exit 1
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_PATH"; }
mark_updated() { UPDATED_BRANCHES="${UPDATED_BRANCHES:+$UPDATED_BRANCHES,}$1"; }
mark_failed() { FAILED_BRANCHES="${FAILED_BRANCHES:+$FAILED_BRANCHES,}$1"; log "[RESOURCES] Failed: $1"; }
finish() {
	local status="$1"
	# Readers see either the previous complete result or this complete result.
	if ! printf 'status=%s\ncore_updated=%s\ndashboard_updated=%s\nupdated=%s\nfailed=%s\napply_failed=%s\nrollback_failed=%s\n' \
		"$status" "$CORE_UPDATED" "$DASHBOARD_UPDATED" "$UPDATED_BRANCHES" "$FAILED_BRANCHES" \
		"$APPLY_FAILED" "$ROLLBACK_FAILED" > "$RESULT_PATH.$$" ||
	   ! mv -f "$RESULT_PATH.$$" "$RESULT_PATH"; then
		log '[RESOURCES] Failed to publish update result.'
		exit 1
	fi
	exit "$status"
}
download() {
	if [ -n "$UPDATE_PROXY" ]; then
		/usr/bin/curl --proxy "$UPDATE_PROXY" -fsSL --compressed --retry 3 --retry-all-errors --retry-delay 1 \
			--connect-timeout 10 --max-time 60 -A 'HomeProxy resource updater' -o "$2" "$1"
	else
		/usr/bin/curl -fsSL --compressed --retry 3 --retry-all-errors --retry-delay 1 \
			--connect-timeout 10 --max-time 60 -A 'HomeProxy resource updater' -o "$2" "$1"
	fi && [ -s "$2" ]
}
fetch_sha() {
	download "$1" "$TMP_DIR/metadata" || return 1
	local sha
	sha="$(ucode -l fs -e 'let s = trim(fs.readfile(ARGV[0])); if (substr(s, 0, 1) == "{") s = json(s).sha; if (type(s) == "string") print(s);' "$TMP_DIR/metadata")" || return 1
	[ "${#sha}" -eq 40 ] || return 1
	case "$sha" in *[!0-9a-f]*) return 1 ;; esac
	printf '%s\n' "$sha"
}
fetch_version() {
	# Keep the display date and immutable commit in one atomically staged file.
	download "$1" "$TMP_DIR/commit-metadata" || return 1
	ucode -l fs -e '
		let m = json(fs.readfile(ARGV[0]));
		let sha = m?.sha, date = m?.commit?.committer?.date;
		if (type(sha) != "string" || !match(sha, /^[0-9a-f]{40}$/) ||
		    type(date) != "string" || !match(date, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/)) exit(1);
		print(replace(date, /[-:TZ]/g, ""), " ", sha, "\n");
	' "$TMP_DIR/commit-metadata"
}
validate_rule_set() {
	[ -x "$SING_BOX" ] && "$SING_BOX" rule-set match -f binary "$1" 192.0.2.1 >/dev/null 2>&1
}
verify_blob() {
	# GitHub's pinned contents metadata identifies the exact Git blob bytes.
	ucode -l fs -l digest -e 'let s = fs.readfile(ARGV[0]); exit(s == null || digest.sha1("blob " + length(s) + "\u0000" + s) != ARGV[1]);' "$1" "$2"
}

exec 9>"$RUN_DIR/update_resources.lock"
flock -n 9 >/dev/null 2>&1 || exit 2
TMP_DIR="$(mktemp -d "$RUN_DIR/resources-update.XXXXXX")" || finish 1
RESOURCE_STAGE="${RESOURCES_DIR}.new.$$"
RESOURCE_BACKUP="${RESOURCES_DIR}.old.$$"
DASHBOARD_STAGE="${DASHBOARD_DIR}.new.$$"
DASHBOARD_BACKUP="${DASHBOARD_DIR}.old.$$"
RESOURCE_SWAPPED=0 DASHBOARD_SWAPPED=0
# Backups are deliberately retained if restoration fails.
restore() {
	local target="$1" backup="$2"
	rm -rf "$target" && mv "$backup" "$target" || {
		ROLLBACK_FAILED=1
		log "[RESOURCES] Restore failed; backup retained at $backup."
		return 1
	}
}
rollback() {
	if [ "$RESOURCE_SWAPPED" -eq 1 ]; then
		restore "$RESOURCES_DIR" "$RESOURCE_BACKUP" || :
		RESOURCE_SWAPPED=0
	fi
	if [ "$DASHBOARD_SWAPPED" -eq 1 ]; then
		restore "$DASHBOARD_DIR" "$DASHBOARD_BACKUP" || :
		DASHBOARD_SWAPPED=0
	fi
}
cleanup() { rm -rf "$TMP_DIR" "$RESOURCE_STAGE" "$DASHBOARD_STAGE"; rm -f "$RESULT_PATH.$$"; }
trap cleanup EXIT
trap 'rollback; exit 1' INT TERM HUP

cp -a "$RESOURCES_DIR" "$RESOURCE_STAGE" || finish 1
for kind in geoip geosite; do
	case "$kind" in
	geoip) source="$GEOIP_SOURCE"; version_url="$GEOIP_VERSION_URL"; digest_url="$GEOIP_DIGEST_URL" ;;
	geosite) source="$GEOSITE_SOURCE"; version_url="$GEOSITE_VERSION_URL"; digest_url="$GEOSITE_DIGEST_URL" ;;
	esac
	resource="${kind}_cn"
	if ! version="$(fetch_version "$version_url")"; then
		mark_failed "$resource"; continue
	fi
	commit="${version##* }"
	if ! blob="$(fetch_sha "$digest_url?ref=$commit")"; then
		mark_failed "$resource"; continue
	fi
	if [ "$(cat "$RESOURCES_DIR/$resource.ver" 2>/dev/null)" = "$version" ] &&
	   verify_blob "$RESOURCES_DIR/$resource.srs" "$blob" && validate_rule_set "$RESOURCES_DIR/$resource.srs"; then
		continue
	fi
	if ! download "$source/$commit/$kind-cn.srs" "$TMP_DIR/$resource.srs" ||
	   ! verify_blob "$TMP_DIR/$resource.srs" "$blob" ||
	   ! validate_rule_set "$TMP_DIR/$resource.srs"; then
		mark_failed "$resource"; continue
	fi
	# Only a fully staged directory is installed, keeping SRS and version paired.
	if ! cp "$TMP_DIR/$resource.srs" "$RESOURCE_STAGE/$resource.srs" ||
	   ! printf '%s\n' "$version" > "$RESOURCE_STAGE/$resource.ver" ||
	   ! chmod 0644 "$RESOURCE_STAGE/$resource.srs" "$RESOURCE_STAGE/$resource.ver"; then
		mark_failed "$resource"
		CORE_UPDATED=0 UPDATED_BRANCHES=""
		finish 1
	fi
	CORE_UPDATED=1
	mark_updated "$resource"
done

if ! version="$(fetch_version "$DASHBOARD_VERSION_URL")"; then
	mark_failed dashboard
elif [ "$(cat "$DASHBOARD_DIR/dashboard.ver" 2>/dev/null)" != "$version" ] || [ ! -s "$DASHBOARD_DIR/index.html" ]; then
	commit="${version##* }"
	if download "$DASHBOARD_SOURCE/$commit" "$TMP_DIR/dashboard.zip" &&
	   mkdir "$TMP_DIR/dashboard" && unzip -q "$TMP_DIR/dashboard.zip" -d "$TMP_DIR/dashboard"; then
		for index in "$TMP_DIR/dashboard/index.html" "$TMP_DIR"/dashboard/*/index.html; do
			[ -s "$index" ] || continue
			if cp -a "${index%/index.html}" "$DASHBOARD_STAGE" &&
			   printf '%s\n' "$version" > "$DASHBOARD_STAGE/dashboard.ver" && chmod -R a+rX "$DASHBOARD_STAGE"; then
				DASHBOARD_UPDATED=1
			fi
			break
		done
	fi
	if [ "$DASHBOARD_UPDATED" -eq 1 ]; then mark_updated dashboard; else mark_failed dashboard; fi
fi

install_failed=0
if [ "$CORE_UPDATED" -eq 1 ]; then
	if mv "$RESOURCES_DIR" "$RESOURCE_BACKUP"; then
		RESOURCE_SWAPPED=1
		mv "$RESOURCE_STAGE" "$RESOURCES_DIR" || install_failed=1
	else install_failed=1; fi
fi
if [ "$install_failed" -eq 0 ] && [ "$DASHBOARD_UPDATED" -eq 1 ]; then
	if mv "$DASHBOARD_DIR" "$DASHBOARD_BACKUP"; then
		DASHBOARD_SWAPPED=1
		mv "$DASHBOARD_STAGE" "$DASHBOARD_DIR" || install_failed=1
	else install_failed=1; fi
fi
if [ "$install_failed" -eq 1 ]; then
	rollback
	mark_failed install
	CORE_UPDATED=0 DASHBOARD_UPDATED=0 UPDATED_BRANCHES=""
	finish 1
fi
if [ "$CORE_UPDATED" -eq 1 ] || [ "$DASHBOARD_UPDATED" -eq 1 ]; then
	if "$HOMEPROXY_INIT" running >/dev/null 2>&1 && ! "$HOMEPROXY_INIT" reload >/dev/null 2>&1; then
		APPLY_FAILED=1
		rollback
		# Reapply the old resources, but never claim the failed update succeeded.
		"$HOMEPROXY_INIT" reload >/dev/null 2>&1 || ROLLBACK_FAILED=1
		mark_failed reload
		CORE_UPDATED=0 DASHBOARD_UPDATED=0 UPDATED_BRANCHES=""
		finish 1
	fi
fi
RESOURCE_SWAPPED=0 DASHBOARD_SWAPPED=0
rm -rf "$RESOURCE_BACKUP" "$DASHBOARD_BACKUP"
if [ -n "$FAILED_BRANCHES" ]; then
	[ -z "$UPDATED_BRANCHES" ] && finish 1
	finish 4
fi
[ -n "$UPDATED_BRANCHES" ] || finish 3
finish 0
