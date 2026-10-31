#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2023 ImmortalWrt.org

SCRIPTS_DIR="/etc/homeproxy/scripts"
RUN_DIR="/var/run/homeproxy"
LOG_PATH="$RUN_DIR/homeproxy.log"
LOCK_PATH="$RUN_DIR/update_subscriptions.lock"

mkdir -p "$RUN_DIR" || exit 1

log() {
	printf '%s [SUBSCRIBE] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_PATH"
}

RESULT_PATH="$RUN_DIR/update_subscriptions.result"

# The worker inherits fd 9, so the existing single-flight lock also covers
# detached UI updates. Every caller observes the same task; no guessed timers.
if [ "$1" = "--worker" ]; then
	# Refuse a direct worker call without the inherited lock descriptor.
	flock -n 9 >"/dev/null" 2>&1 || exit 1
else
	exec 9>"$LOCK_PATH" || exit 1
	if ! flock -n 9 >"/dev/null" 2>&1; then
		case "$1" in
			--start|--status) printf '{"state":"running"}\n'; exit 0 ;;
		esac
		log "Subscription update did not complete; another task may be running."
		exit 2
	fi
fi

case "$1" in
	--status)
		status="$(cat "$RESULT_PATH" 2>/dev/null)"
		case "$status" in
			''|*[!0-9]*) printf '{"state":"idle"}\n' ;;
			*) printf '{"state":"done","code":%s}\n' "$status" ;;
		esac
		exit 0 ;;
	--start)
		rm -f "$RESULT_PATH" || exit 1
		printf '{"state":"running"}\n'
		# Close captured RPC pipes before forking; the worker must not inherit
		# them even briefly, or rpcd can miss EOF and time out after success.
		exec >/dev/null 2>&1
		/bin/sh "$0" --worker </dev/null &
		exit 0 ;;
	--worker|'') ;;
	*) exit 1 ;;
esac

rm -f "$RESULT_PATH" || exit 1
ucode "$SCRIPTS_DIR/update_subscriptions.uc" 2>>"$LOG_PATH"
status="$?"
printf '%s\n' "$status" >"$RESULT_PATH.new" && mv -f "$RESULT_PATH.new" "$RESULT_PATH" || exit 1
if [ "$status" -ne 0 ]; then
	log "Subscription update failed with exit code $status."
fi
exit "$status"
