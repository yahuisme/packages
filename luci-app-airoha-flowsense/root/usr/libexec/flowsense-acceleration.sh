#!/bin/sh
# Bridge knobs follow the firmware's br_netfilter/nft bridging patches.
. /usr/share/libubox/jshn.sh

acc_keys='call-iptables call-ip6tables call-arptables filter-vlan-tagged filter-pppoe-tagged pass-vlan-input-dev'
acc_files='12-apmode-offload.conf 14-vlan-offload.conf 15-pppoe-offload.conf'
acc_read() { local v; v=$(cat "/proc/sys/net/bridge/bridge-nf-$1" 2>/dev/null); case "$v" in 0|1) printf %s "$v";; *) printf null;; esac; }
acc_config() {
    # sysctl init applies these in this order; a missing optional file is not
    # missing support. Kernel defaults: call-*=1, filter/pass=0 (Linux 6.18).
    local key=$1 default=0
    case "$key" in call-*) default=1;; esac
    awk -v key="net.bridge.bridge-nf-$key" -v value="$default" '
        { sub(/[;#].*$/, ""); gsub(/^[ \t]+|[ \t]+$/, ""); n=split($0,a,"=");
          gsub(/[ \t]/,"",a[1]); gsub(/\//,".",a[1]);
          if(a[1]==key) { gsub(/[ \t]/,"",a[2]); value=(n==2 && a[2]~/^[01]$/)?a[2]:"null" } }
        END { print value }' /dev/null $(for f in /etc/sysctl.d/*.conf /etc/sysctl.conf; do [ ! -e "$f" ] || printf '%s\n' "$f"; done) 2>/dev/null || printf null
}
acc_vlan_filtering() {
    local f v result=0
    for f in /sys/class/net/*/bridge/vlan_filtering; do
        [ -e "$f" ] || continue
        v=$(cat "$f" 2>/dev/null)
        case "$v" in 1) result=1;; 0) :;; *) printf null; return;; esac
    done
    printf %s "$result"
}
acc_hardware() {
    local data entries entry kind family table name text flags flag value result=0
    # W1700K owns both inet fw4 and bridge fw4. One successful snapshot
    # distinguishes an absent bridge table from a failed read.
    data=$(nft -j list flowtables 2>/dev/null) || { printf null; return; }
    json_load "$data" >/dev/null 2>&1 || { printf null; return; }
    json_get_type kind nftables
    [ "$kind" = array ] || { printf null; return; }
    json_select nftables || { printf null; return; }
    json_get_keys entries
    for entry in $entries; do
        json_select "$entry"
        json_get_type kind flowtable
        if [ "$kind" = object ]; then
            json_select flowtable
            json_get_var family family; json_get_var table table; json_get_var name name
            if [ "$table" = fw4 ] && { [ "$family" = inet ] || [ "$family" = bridge ]; }; then
                json_get_type kind flags
                if [ "$kind" = array ]; then
                    json_select flags; json_get_keys flags
                    for flag in $flags; do json_get_var value "$flag"; [ "$value" != offload ] || result=1; done
                    json_select ..
                else
                    # nft 1.1.6 omits flowtable flags from JSON output. Query
                    # the exact discovered table, not table existence or PPE load.
                    [ -n "$name" ] || { printf null; return; }
                    text=$(nft list flowtable "$family" "$table" "$name" 2>/dev/null) || { printf null; return; }
                    value=$(printf '%s\n' "$text" | awk '
                        /^[ \t]*flags[ \t]+/ { gsub(/[,;]/," "); for(i=2;i<=NF;i++) if($i=="offload") found=1 }
                        END { print found ? 1 : 0 }')
                    [ "$value" != 1 ] || result=1
                fi
            fi
            json_select ..
        fi
        json_select ..
    done
    printf %s "$result"
}
acc_hw_config() (
    # A normal UCI read includes other sessions' saved deltas and overrides.
    # Use only committed /etc/config bytes and a private empty search path.
    local sw hw committed
    umask 077
    committed=$(mktemp -d /tmp/flowsense-committed.XXXXXX) || { printf null; return; }
    trap 'rm -rf "$committed"' EXIT
    trap 'exit 1' HUP INT TERM
    uci -c /etc/config -C "$committed" -t "$committed" -q export firewall >/dev/null || { printf null; return; }
    sw=$(uci -c /etc/config -C "$committed" -t "$committed" -q get firewall.@defaults[0].flow_offloading)
    hw=$(uci -c /etc/config -C "$committed" -t "$committed" -q get firewall.@defaults[0].flow_offloading_hw)
    # firewall4 defaults both absent options to false.
    case "$sw:$hw" in 1:1) printf 1;; *[!01:]*) printf null;; *) printf 0;; esac
)
acc_and() {
    local v result=1
    for v in "$@"; do [ "$v" != null ] || { printf null; return; }; [ "$v" = 1 ] || result=0; done
    printf %s "$result"
}
acc_ap() {
    local reader=$1 filtering a b c
    filtering=$(acc_vlan_filtering)
    a=$($reader call-iptables); b=$($reader call-ip6tables); c=$($reader call-arptables)
    case "$filtering" in
        0) acc_and "$a" "$b" "$c";;
        1) acc_and "$a" "$b" "$c" "$($reader filter-vlan-tagged)" "$($reader pass-vlan-input-dev)";;
        *) printf null;;
    esac
}
acc_support() {
    local key result=true
    for key in "$@"; do
        [ -e "/proc/sys/net/bridge/bridge-nf-$key" ] || { printf false; return; }
        [ "$(acc_read "$key")" != null ] || result=null
    done
    printf %s "$result"
}
get_acceleration() {
    local hw=null apkeys='call-iptables call-ip6tables call-arptables'
    [ ! -d /sys/kernel/debug/ppe ] || { command -v nft >/dev/null && hw=true; }
    [ "$(acc_vlan_filtering)" = 0 ] || apkeys="$apkeys filter-vlan-tagged pass-vlan-input-dev"
    printf '{"hardware":{"supported":%s,"enabled":%s,"configured":%s},' "$hw" "$(boolean "$(acc_hardware)")" "$(boolean "$(acc_hw_config)")"
    printf '"vlan":{"supported":%s,"enabled":%s,"configured":%s},' "$(acc_support filter-vlan-tagged)" "$(boolean "$(acc_read filter-vlan-tagged)")" "$(boolean "$(acc_config filter-vlan-tagged)")"
    printf '"pppoe":{"supported":%s,"enabled":%s,"configured":%s},' "$(acc_support filter-pppoe-tagged)" "$(boolean "$(acc_read filter-pppoe-tagged)")" "$(boolean "$(acc_config filter-pppoe-tagged)")"
    printf '"ap":{"supported":%s,"enabled":%s,"configured":%s}}' "$(acc_support $apkeys)" "$(boolean "$(acc_ap acc_read)")" "$(boolean "$(acc_ap acc_config)")"
}
acc_error() { printf '{"success":false,"error":"%s"}' "$1"; }
acc_put() { printf '%s\n' "$2" > "/proc/sys/net/bridge/bridge-nf-$1" && [ "$(acc_read "$1")" = "$2" ]; }
acc_pending() { local changes; changes=$(uci -q changes firewall) && [ -z "$changes" ]; }
acc_private() { uci -c "$tmp/config" -C "$tmp/override" -t "$tmp/delta" "$@"; }
acc_apply() {
    local key file
    if [ "$hardware" != -1 ]; then
        acc_private set "firewall.@defaults[0].flow_offloading=$hardware" &&
        acc_private set "firewall.@defaults[0].flow_offloading_hw=$hardware" && acc_private commit firewall || return 1
        acc_pending && cmp -s /etc/config/firewall "$tmp/firewall" || return 1
        published=1
        cp "$tmp/config/firewall" /etc/config/firewall || return 1
        /etc/init.d/firewall restart >/dev/null 2>&1 || return 1
    fi
    for file in $acc_files; do
        [ ! -f "$tmp/new/$file" ] || cp "$tmp/new/$file" "/etc/sysctl.d/$file" || return 1
    done
    for key in $acc_keys; do
        [ ! -f "$tmp/want/$key" ] || acc_put "$key" "$(cat "$tmp/want/$key")" || return 1
    done
    if [ "$hardware" != -1 ]; then
        [ "$(acc_hw_config)" = "$hardware" ] && [ "$(acc_hardware)" = "$hardware" ] || return 1
    fi
    for key in $acc_keys; do
        [ ! -f "$tmp/want/$key" ] || { [ "$(acc_read "$key")" = "$(cat "$tmp/want/$key")" ] && [ "$(acc_config "$key")" = "$(cat "$tmp/want/$key")" ]; } || return 1
    done
}
acc_rollback() {
    local file key failed=0
    for file in $acc_files; do
        if [ -f "$tmp/old/$file" ]; then cp -p "$tmp/old/$file" "/etc/sysctl.d/$file" || failed=1
        else rm -f "/etc/sysctl.d/$file" || failed=1; fi
    done
    if [ "$published" = 1 ]; then
        cp -p "$tmp/firewall" /etc/config/firewall || failed=1
        /etc/init.d/firewall restart >/dev/null 2>&1 || failed=1
        cmp -s /etc/config/firewall "$tmp/firewall" && [ "$(acc_hardware)" = "$oldhw" ] && acc_pending || failed=1
    fi
    for key in $acc_keys; do
        [ ! -f "$tmp/old/$key" ] || acc_put "$key" "$(cat "$tmp/old/$key")" || failed=1
    done
    for file in $acc_files; do
        if [ -f "$tmp/old/$file" ]; then cmp -s "$tmp/old/$file" "/etc/sysctl.d/$file" || failed=1
        else [ ! -e "/etc/sysctl.d/$file" ] || failed=1; fi
    done
    return "$failed"
}
set_acceleration() (
    local input names name type value hardware vlan pppoe ap filtering key file tmp oldhw armed=0 published=0
    read -r input
    json_load "$input" >/dev/null 2>&1 || { acc_error invalid; exit; }
    json_get_keys names
    # uhttpd adds this transport metadata after checking session ACLs;
    # rpcd forwards it alongside the method arguments. It is not a setting.
    for name in $names; do
        case "$name" in hardware|vlan|pppoe|ap|ubus_rpc_session) :;; *) acc_error invalid; exit;; esac
    done
    for name in hardware vlan pppoe ap; do
        json_get_type type "$name"; json_get_var value "$name"
        [ "$type" = int ] || { acc_error invalid; exit; }
        case "$value" in -1|0|1) export "$name=$value";; *) acc_error invalid; exit;; esac
    done
    umask 077
    mkdir /var/run/flowsense-acceleration.lock 2>/dev/null || { acc_error busy; exit; }
    tmp=$(mktemp -d /tmp/flowsense-acceleration.XXXXXX) || { rmdir /var/run/flowsense-acceleration.lock; acc_error prepare; exit; }
    trap '[ "$armed" = 0 ] || acc_rollback >/dev/null; rm -rf "$tmp"; rmdir /var/run/flowsense-acceleration.lock' EXIT
    trap 'exit 1' HUP INT TERM
    mkdir "$tmp/old" "$tmp/new" "$tmp/want" "$tmp/config" "$tmp/override" "$tmp/delta" || { acc_error prepare; exit; }
    filtering=$(acc_vlan_filtering)
    # Do not silently undo VLAN while enabling AP, or disable an unchanged AP.
    if [ "$filtering" != 0 ]; then
        [ "$filtering" = 1 ] || { acc_error read; exit; }
        if [ "$ap" = 1 ] && [ "$vlan" != 1 ] && { [ "$vlan" = 0 ] || [ "$(acc_read filter-vlan-tagged)" != 1 ] || [ "$(acc_config filter-vlan-tagged)" != 1 ]; }; then acc_error ap_requires_vlan; exit; fi
        if [ "$vlan" = 0 ] && [ "$ap" = -1 ] && { [ "$(acc_ap acc_read)" != 0 ] || [ "$(acc_ap acc_config)" != 0 ]; }; then acc_error ap_requires_vlan; exit; fi
    fi
    # Check shared staging before discarding even an unchanged hardware request.
    if [ "$hardware" != -1 ]; then
        acc_pending || { acc_error pending_changes; exit; }
        oldhw=$(acc_hardware)
        [ "$oldhw" != null ] && [ "$(acc_hw_config)" != null ] || { acc_error read; exit; }
        [ "$oldhw" != "$hardware" ] || [ "$(acc_hw_config)" != "$hardware" ] || hardware=-1
    fi
    # Compare both sides: matching runtime alone must not hide boot-time drift.
    # Keep the original AP/VLAN conflict checks above, before normalization.
    if [ "$ap" != -1 ] && [ "$(acc_ap acc_read)" = "$ap" ] && [ "$(acc_ap acc_config)" = "$ap" ]; then
        # VLAN-on can activate an AP that is currently off only due to VLAN.
        value=0
        if [ "$ap:$vlan:$filtering" = 0:1:1 ]; then
            for name in acc_read acc_config; do
                [ "$(acc_and "$($name call-iptables)" "$($name call-ip6tables)" "$($name call-arptables)" "$($name pass-vlan-input-dev)")" = 0 ] || value=1
            done
        fi
        [ "$value" != 0 ] || ap=-1
    fi
    [ "$vlan" = -1 ] || [ "$(acc_read filter-vlan-tagged)" != "$vlan" ] || [ "$(acc_config filter-vlan-tagged)" != "$vlan" ] || vlan=-1
    [ "$pppoe" = -1 ] || [ "$(acc_read filter-pppoe-tagged)" != "$pppoe" ] || [ "$(acc_config filter-pppoe-tagged)" != "$pppoe" ] || pppoe=-1
    [ "$hardware:$vlan:$pppoe:$ap" != -1:-1:-1:-1 ] || { printf '{"success":true}'; exit; }
    for file in $acc_files; do
        [ ! -e "/etc/sysctl.d/$file" ] || { [ -f "/etc/sysctl.d/$file" ] && [ ! -L "/etc/sysctl.d/$file" ] && cp -p "/etc/sysctl.d/$file" "$tmp/old/$file"; } || { acc_error prepare; exit; }
    done
    if [ "$hardware" != -1 ]; then
        [ ! -L /etc/config/firewall ] && cp -p /etc/config/firewall "$tmp/firewall" && cp -p "$tmp/firewall" "$tmp/config/firewall" || { acc_error read; exit; }
    fi
    if [ "$vlan" != -1 ]; then
        printf '%s\n' "$vlan" > "$tmp/want/filter-vlan-tagged"
        printf 'net.bridge.bridge-nf-filter-vlan-tagged=%s\n' "$vlan" > "$tmp/new/14-vlan-offload.conf"
    fi
    if [ "$pppoe" != -1 ]; then
        printf '%s\n' "$pppoe" > "$tmp/want/filter-pppoe-tagged"
        printf 'net.bridge.bridge-nf-filter-pppoe-tagged=%s\n' "$pppoe" > "$tmp/new/15-pppoe-offload.conf"
    fi
    if [ "$ap" != -1 ]; then
        for key in call-iptables call-ip6tables call-arptables; do
            printf '%s\n' "$ap" > "$tmp/want/$key"
            printf 'net.bridge.bridge-nf-%s=%s\n' "$key" "$ap" >> "$tmp/new/12-apmode-offload.conf"
        done
        # Preserve the independent VLAN setting; AP off does not turn VLAN off.
        value=$(acc_config pass-vlan-input-dev)
        [ "$ap:$filtering" != 1:1 ] || value=1
        [ "$value" != null ] || { acc_error read; exit; }
        printf '%s\n' "$value" > "$tmp/want/pass-vlan-input-dev"
        printf 'net.bridge.bridge-nf-pass-vlan-input-dev=%s\n' "$value" >> "$tmp/new/12-apmode-offload.conf"
        # Preserve legacy AP-file VLAN assignment when no separate file exists.
        value=$(acc_config filter-vlan-tagged)
        [ "$vlan" = -1 ] || value=$vlan
        [ "$value" != null ] || { acc_error read; exit; }
        printf 'net.bridge.bridge-nf-filter-vlan-tagged=%s\n' "$value" >> "$tmp/new/12-apmode-offload.conf"
    fi
    for key in $acc_keys; do
        [ -f "$tmp/want/$key" ] || continue
        value=$(acc_read "$key")
        [ "$value" != null ] && [ -w "/proc/sys/net/bridge/bridge-nf-$key" ] || { acc_error unsupported; exit; }
        printf '%s\n' "$value" > "$tmp/old/$key"
    done
    armed=1
    if acc_apply; then armed=0; printf '{"success":true}'
    else
        if acc_rollback; then acc_error apply; else acc_error rollback; fi
        armed=0
    fi
)
