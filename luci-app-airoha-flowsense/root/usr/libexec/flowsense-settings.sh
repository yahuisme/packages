# Private, persistent FlowSense staging; never uses LuCI's shared UCI savedir.
. /usr/share/libubox/jshn.sh
fs_settings_dir=/etc/flowsense

settings_parse() {
    local names name type value
    json_load "$1" >/dev/null 2>&1 || return 1
    json_get_keys names
    for name in $names; do
        case "$name" in hardware|vlan|pppoe|ap|enabled|target|ubus_rpc_session) ;; *) return 1;; esac
    done
    for name in hardware vlan pppoe ap enabled; do
        json_get_type type "$name"; json_get_var value "$name"
        [ "$type" = int ] || return 1
        case "$value" in -1|0|1) ;; *) return 1;; esac
        export "settings_$name=$value"
    done
    json_get_type type target; json_get_var settings_target target
    [ "$type" = string ] || return 1
    if [ "$settings_enabled" = -1 ]; then [ -z "$settings_target" ] || return 1
    else fs_target "$settings_target" || return 1; fi
}
settings_json() {
    printf '{"hardware":%s,"vlan":%s,"pppoe":%s,"ap":%s,"enabled":%s,"target":"%s"}' "$settings_hardware" "$settings_vlan" "$settings_pppoe" "$settings_ap" "$settings_enabled" "$settings_target"
}
settings_write() {
    local tmp
    tmp=$(mktemp "$fs_settings_dir/.pending.XXXXXX") || return 1
    settings_json > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$fs_settings_dir/pending.json" && return 0
    rm -f "$tmp"; return 1
}
settings_error() { printf '{"success":false,"error":"%s"}' "$1"; }
settings_rpc() (
    local input result value acceleration=unchanged monitor=unchanged success=true acceleration_error= monitor_error=
    umask 077
    # Fixed root-owned location; reject symlinks rather than following them.
    [ ! -L "$fs_settings_dir" ] || { settings_error storage; exit; }
    if [ "$1" = getSettings ]; then
        if [ -f "$fs_settings_dir/pending.json" ] && [ ! -L "$fs_settings_dir/pending.json" ]; then
            settings_parse "$(cat "$fs_settings_dir/pending.json")" || { settings_error invalid; exit; }
            printf '{"success":true,"pending":'; settings_json; printf '}'
        elif [ -e "$fs_settings_dir/pending.json" ] || [ -L "$fs_settings_dir/pending.json" ]; then settings_error storage
        else printf '{"success":true,"pending":null}'; fi
        exit
    fi
    mkdir -p "$fs_settings_dir" && chmod 700 "$fs_settings_dir" || { settings_error storage; exit; }
    [ ! -L "$fs_settings_dir/pending.json" ] || { settings_error storage; exit; }
    mkdir /var/run/flowsense-settings.lock 2>/dev/null || { settings_error busy; exit; }
    trap 'rmdir /var/run/flowsense-settings.lock' EXIT
    trap 'exit 1' HUP INT TERM
    case "$1" in
        saveSettings)
            read -r input
            settings_parse "$input" || { settings_error invalid; exit; }
            settings_write || { settings_error storage; exit; }
            printf '{"success":true}';;
        applySettings)
            [ -f "$fs_settings_dir/pending.json" ] || { printf '{"success":true,"acceleration":"unchanged","monitor":"unchanged"}'; exit; }
            settings_parse "$(cat "$fs_settings_dir/pending.json")" || { settings_error invalid; exit; }
            if [ "$settings_hardware:$settings_vlan:$settings_pppoe:$settings_ap" != '-1:-1:-1:-1' ]; then
                result=$(printf '{"hardware":%s,"vlan":%s,"pppoe":%s,"ap":%s}\n' "$settings_hardware" "$settings_vlan" "$settings_pppoe" "$settings_ap" | set_acceleration)
                json_load "$result"; json_get_var value success
                if [ "$value" = 1 ]; then
                    acceleration=applied
                    settings_hardware=-1; settings_vlan=-1; settings_pppoe=-1; settings_ap=-1
                    settings_write || { settings_error storage; exit; }
                else acceleration=failed; success=false; json_get_var acceleration_error error; fi
            fi
            if [ "$settings_enabled" != -1 ]; then
                result=$(printf '{"target":"%s","enabled":%s}\n' "$settings_target" "$settings_enabled" | set_monitor)
                json_load "$result"; json_get_var value success
                if [ "$value" = 1 ]; then
                    monitor=applied; settings_enabled=-1; settings_target=
                    settings_write || { settings_error storage; exit; }
                else monitor=failed; success=false; json_get_var monitor_error error; fi
            fi
            if [ "$success" = true ]; then rm -f "$fs_settings_dir/pending.json" || { settings_error storage; exit; }; fi
            json_init
            [ "$success" = true ] && json_add_boolean success 1 || json_add_boolean success 0
            json_add_string acceleration "$acceleration"; json_add_string monitor "$monitor"
            [ -z "$acceleration_error" ] || json_add_string acceleration_error "$acceleration_error"
            [ -z "$monitor_error" ] || json_add_string monitor_error "$monitor_error"
            json_dump;;
    esac
)
