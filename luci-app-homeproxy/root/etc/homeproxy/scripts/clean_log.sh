#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2022-2023 ImmortalWrt.org

NAME="homeproxy"

log_max_bytes="51200"
main_log_file="/var/run/$NAME/$NAME.log"
singc_log_file="/var/run/$NAME/sing-box-c.log"
sings_log_file="/var/run/$NAME/sing-box-s.log"

while true; do
	sleep 180
	# An old/unprepared service-owned parent is unsafe, even after lstat().
	[ ! -L "/var/run/$NAME" ] && [ "$(stat -c '%u:%a' "/var/run/$NAME")" = '0:755' ] || continue
	# init keeps the parent root-owned; the server can append log bytes but
	# cannot replace these entries between inspection and truncation.
	for i in "$main_log_file" "$singc_log_file" "$sings_log_file"; do
		[ -f "$i" ] && [ ! -L "$i" ] && [ "$(stat -c %h "$i")" = 1 ] || continue
		[ -s "$i" ] || continue
		log_size="$(wc -c < "$i")" || continue
		[ "$log_size" -lt "$log_max_bytes" ] || : > "$i"
	done
done
