#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2023 ImmortalWrt.org

SCRIPTS_DIR="/etc/homeproxy/scripts"
RUN_DIR="${RUN_DIR:-/var/run/homeproxy}"
CONFIG_PATH="${CONFIG_PATH:-/etc/config/homeproxy}"
LOG_PATH="$RUN_DIR/homeproxy.log"
LOCK_PATH="$RUN_DIR/update_subscriptions.lock"

mkdir -p "$RUN_DIR" || exit 1

log() {
	printf '%s [SUBSCRIBE] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_PATH"
}

exec 9>"$LOCK_PATH" || {
	log "Failed to open the subscription update lock."
	exit 1
}

if ! flock -n 9 >"/dev/null" 2>&1; then
	log "Subscription update did not complete; another task may be running."
	exit 2
fi

# Keep secrets private, and snapshot before the ucode cursor can commit.
umask 077
BACKUP_DIR="$(mktemp -d "$RUN_DIR/subscription-backup.XXXXXX")" || exit 1
cp -p "$CONFIG_PATH" "$BACKUP_DIR/config" || exit 1
WAS_RUNNING=0
/etc/init.d/homeproxy running >/dev/null 2>&1 && WAS_RUNNING=1
for mode in c s; do
	file="$RUN_DIR/sing-box-$mode.json"
	[ ! -f "$file" ] || cp -p "$file" "$BACKUP_DIR/sing-box-$mode.json" || exit 1
done

ucode "$SCRIPTS_DIR/update_subscriptions.uc" 2>>"$LOG_PATH"
status="$?"
if [ "$status" -ne 0 ]; then
	log "Subscription update failed with exit code $status; restoring previous configuration."
	# Atomic replacement on the config filesystem. No UCI import/commit against stale deltas.
	if cp -p "$BACKUP_DIR/config" "$CONFIG_PATH.restore.$$" &&
	   mv -f "$CONFIG_PATH.restore.$$" "$CONFIG_PATH"; then
		for mode in c s; do
			file="sing-box-$mode.json"
			[ ! -f "$BACKUP_DIR/$file" ] || cp -p "$BACKUP_DIR/$file" "$RUN_DIR/$file"
		done
		if [ "$WAS_RUNNING" -eq 1 ]; then
			/etc/init.d/homeproxy restart >>"$LOG_PATH" 2>&1 ||
				log "Recovery restart failed; backup retained at $BACKUP_DIR."
		fi
	else
		log "Configuration restore failed; backup retained at $BACKUP_DIR."
	fi
	exit "$status"
fi
rm -rf "$BACKUP_DIR"
