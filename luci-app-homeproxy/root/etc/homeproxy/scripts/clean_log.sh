#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2022-2023 ImmortalWrt.org

while true; do
	sleep 180
	ucode -e '
		import { logNames, cleanLog } from "/etc/homeproxy/scripts/runtime-files.uc";
		for (let name in logNames) {
			try { cleanLog("/var/run/homeproxy", name, 51200); }
			catch (e) { warn(e.message + "\n"); }
		}
	'
done
