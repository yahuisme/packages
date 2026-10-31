#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Short RPC start/status transport; the production transaction owns the same fd 9.
RUN_DIR="${RUN_DIR:-/var/run/homeproxy}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/etc/homeproxy/scripts}"
JOB_DIR="${RUN_DIR}.resources"
umask 077
mkdir -p "$RUN_DIR" || exit 1
# Never put root task controls below RUN_DIR: init chowns it recursively to
# sing-box. This sibling is created under root-owned /var/run and stays private.
[ -d "$JOB_DIR" ] || mkdir -m 0700 "$JOB_DIR" || exit 1
ucode -l fs -e 'let s=fs.lstat(ARGV[0]), p=fs.stat(ARGV[1]); exit(s?.type != "directory" || s.uid != p?.uid);' "$JOB_DIR" "${JOB_DIR%/*}" || exit 1
chmod 0700 "$JOB_DIR" || exit 1
exec 9>"$JOB_DIR/update.lock" || exit 1
# Serialize the short metadata operations, never wait behind downloads.
exec 8>"$JOB_DIR/control.lock" || exit 1
flock -x 8 || exit 1

case "$1" in
status)
	[ -n "$2" ] && [ "$(cat "$JOB_DIR/id" 2>/dev/null)" = "$2" ] || {
		printf 'state=done\nstatus=1\n'; exit 0
	}
	# A result is immutable once published, even if a later cron task holds the lock.
	if [ -f "$JOB_DIR/result" ]; then
		printf 'state=done\n'; cat "$JOB_DIR/result"; exit 0
	fi
	if ! flock -n 9 >/dev/null 2>&1; then
		printf 'state=running\n'; exit 0
	fi
	# No lock and no final result means interrupted/not started, never success.
	printf 'state=done\nstatus=1\n'; exit 0 ;;
start)
	case "$2:$3" in rules:all|rules:geoip|rules:geosite|rules:manual|dashboard-update:all|dashboard-remove:all) ;; *) exit 1 ;; esac
	if ! flock -n 9 >/dev/null 2>&1; then
		printf 'state=busy\nstatus=2\n'; exit 0
	fi
	# Keep bounded task state in tmpfs, outside transaction result pruning.
	[ ! -L "$JOB_DIR" ] || exit 1
	mkdir -p "$JOB_DIR" || exit 1
	rm -f "$JOB_DIR/result" "$JOB_DIR/result.new" "$JOB_DIR/transaction" || exit 1
	for path in "$JOB_DIR"/transaction.*; do
		[ -e "$path" ] || [ -L "$path" ] || continue
		suffix="${path##*.}"
		case "$suffix" in ''|*[!0-9]*) continue ;; esac
		rm -f "$path" || exit 1
	done
	id="$(ucode -l fs -e 'let f=fs.open("/dev/urandom","r"); let s=f?.read(16); if(length(s)!=16) exit(1); print(hexenc(s));')" || exit 1
	[ -n "$id" ] || exit 1
	printf '%s\n' "$id" > "$JOB_DIR/id" || exit 1
	printf 'state=running\njob=%s\n' "$id"
	# Release metadata lock in the worker before running the slow transaction.
	# Close rpcd pipes before forking (including the command-substitution pipe).
	exec >/dev/null 2>&1
	(
		exec 8>&-
		trap 'exit 1' HUP INT TERM
		# The inherited descriptor stays locked across the entire transaction and
		# final publication. The updater validates it instead of reopening the lock.
		HOMEPROXY_RESOURCE_JOB_RESULT="$JOB_DIR/transaction" \
			/bin/sh "$SCRIPTS_DIR/update_resources.sh" "$2" "$3" --job
		status="$?"
		# Missing/mismatched transaction evidence is a failed task, not stale success.
		first_line=''
		[ ! -f "$JOB_DIR/transaction" ] || IFS= read -r first_line < "$JOB_DIR/transaction"
		if [ -f "$JOB_DIR/transaction" ] && [ "$first_line" = "status=$status" ]; then
			cat "$JOB_DIR/transaction" > "$JOB_DIR/result.new" || exit 1
		else
			printf 'status=1\n' > "$JOB_DIR/result.new" || exit 1
		fi
		mv -f "$JOB_DIR/result.new" "$JOB_DIR/result" || exit 1
	) </dev/null &
	exit 0 ;;
*) exit 1 ;;
esac
