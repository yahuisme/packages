#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2023 ImmortalWrt.org

SCRIPTS_DIR="/etc/homeproxy/scripts"
RUN_DIR="/var/run/homeproxy"
LOG_PATH="$RUN_DIR/homeproxy.log"

UPDATE_PROXY=""
if [ "$(uci -q get homeproxy.subscription.update_via_proxy)" = "1" ]; then
	MIXED_PORT="$(uci -q get homeproxy.infra.mixed_port)"
	case "$MIXED_PORT" in
	''|*[!0-9]*) MIXED_PORT="5330" ;;
	esac
	UPDATE_PROXY="http://127.0.0.1:$MIXED_PORT"
fi

# The updater applies resources and rolls back on reload failure itself.
HOMEPROXY_UPDATE_PROXY="$UPDATE_PROXY" "$SCRIPTS_DIR"/update_resources.sh
RESOURCE_STATUS="$?"
SUBSCRIPTION_URLS="$(uci -q get homeproxy.subscription.subscription_url)"
SUBSCRIPTION_STATUS=0
if [ -n "$SUBSCRIPTION_URLS" ]; then
	HOMEPROXY_RESOURCES_UPDATED=0 "$SCRIPTS_DIR"/update_subscriptions.sh || SUBSCRIPTION_STATUS="$?"
else
	mkdir -p "$RUN_DIR"
	printf '%s [SUBSCRIBE] No subscription URL configured; skipping update.\n' \
		"$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_PATH"
fi
case "$RESOURCE_STATUS" in 0|3) ;; *) exit "$RESOURCE_STATUS" ;; esac
exit "$SUBSCRIPTION_STATUS"
