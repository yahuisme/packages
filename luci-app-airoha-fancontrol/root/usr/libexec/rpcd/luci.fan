#!/bin/sh

find_hwmon() {
    local hwmon name

    for hwmon in /sys/class/hwmon/hwmon*; do
        [ -f "$hwmon/name" ] || continue
        read -r name < "$hwmon/name" 2>/dev/null || continue
        [ "$name" = nct7802 ] || continue
        [ -f "$hwmon/pwm1" ] && [ -f "$hwmon/pwm1_enable" ] || continue
        printf '%s\n' "$hwmon"
        return 0
    done
    return 1
}

find_mt7996_hwmon() {
    local band="$1" hwmon name
    for hwmon in /sys/class/hwmon/hwmon*; do
        [ -f "$hwmon/name" ] || continue
        read -r name < "$hwmon/name" 2>/dev/null || continue
        case "$name" in
            mt7996_phy0."$band"|mt7996_phy0_"$band")
                printf '%s\n' "$hwmon"
                return 0
                ;;
        esac
    done
    return 1
}

find_phy_hwmon() {
    local suffix="$1" hwmon name
    for hwmon in /sys/class/hwmon/hwmon*; do
        [ -f "$hwmon/name" ] || continue
        read -r name < "$hwmon/name" 2>/dev/null || continue
        case "$name" in
            *"$suffix")
                printf '%s\n' "$hwmon"
                return 0
                ;;
        esac
    done
    return 1
}

read_integer() {
    local file="$1" value
    [ -r "$file" ] || return 1
    read -r value < "$file" 2>/dev/null || return 1
    local digits="${value#-}"
    case "$digits" in
        ''|*[!0-9]*|0[0-9]*|??????????*) return 1 ;;
    esac
    printf '%s\n' "$value"
}

read_temp() {
    local value
    value=$(read_integer "$1") || { printf '%s\n' null; return; }
    printf '%s\n' "$((value / 1000))"
}

read_value() {
    read_integer "$1" || printf '%s\n' null
}

uci_value() {
    uci -q get "$1" 2>/dev/null || printf '%s\n' "$2"
}

valid_uint() {
    case "$1" in
        ''|*[!0-9]*|0[0-9]*|??????????*) return 1 ;;
    esac
    return 0
}

valid_range() {
    valid_uint "$1" && [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]
}

preset_valid() {
    case "$1" in quiet|balanced|performance|custom) return 0;; esac
    return 1
}

get_status() {
    local hwmon phy1 phy2 wifi24 wifi5 wifi6
    local temp_cpu=null temp_board=null temp_phy1=null temp_phy2=null
    local wifi_24g=null wifi_5g=null wifi_6g=null fan_rpm=null fan_pwm=null fan_mode=null
    local fan_percentage=null mode_desc=Unknown uci_mode uci_preset uci_manual_pwm

    hwmon=$(find_hwmon) || hwmon=
    if [ -n "$hwmon" ]; then
        temp_board=$(read_temp "$hwmon/temp1_input")
        fan_rpm=$(read_value "$hwmon/fan1_input")
        fan_pwm=$(read_value "$hwmon/pwm1")
        fan_mode=$(read_value "$hwmon/pwm1_enable")
        valid_range "$fan_rpm" 0 1350000 || fan_rpm=null
        valid_range "$fan_pwm" 0 255 || fan_pwm=null
        valid_range "$fan_mode" 1 2 || fan_mode=null
        valid_range "$fan_pwm" 0 255 && fan_percentage=$((fan_pwm * 100 / 255))
    fi
    temp_cpu=$(read_temp /sys/class/thermal/thermal_zone0/temp)
    phy1=$(find_phy_hwmon :05) || phy1=
    phy2=$(find_phy_hwmon :08) || phy2=
    [ -n "$phy1" ] && temp_phy1=$(read_temp "$phy1/temp1_input")
    [ -n "$phy2" ] && temp_phy2=$(read_temp "$phy2/temp1_input")
    wifi24=$(find_mt7996_hwmon 0) || wifi24=
    wifi5=$(find_mt7996_hwmon 1) || wifi5=
    wifi6=$(find_mt7996_hwmon 2) || wifi6=
    [ -n "$wifi24" ] && wifi_24g=$(read_temp "$wifi24/temp1_input")
    [ -n "$wifi5" ] && wifi_5g=$(read_temp "$wifi5/temp1_input")
    [ -n "$wifi6" ] && wifi_6g=$(read_temp "$wifi6/temp1_input")

    case "$fan_mode" in
        1) mode_desc='Manual' ;;
        2) mode_desc='Automatic' ;;
    esac
    uci_mode=$(uci_value fan.settings.mode unknown)
    case "$uci_mode" in manual|auto) ;; *) uci_mode=unknown ;; esac
    uci_preset=$(uci_value fan.settings.curve_preset unknown)
    preset_valid "$uci_preset" || uci_preset=unknown
    uci_manual_pwm=$(uci_value fan.settings.manual_pwm null)
    valid_range "$uci_manual_pwm" 0 255 || uci_manual_pwm=null

    printf '{"available":%s,"temp_cpu":%s,"temp_board":%s,"temp_phy1":%s,"temp_phy2":%s,"wifi_24g":%s,"wifi_5g":%s,"wifi_6g":%s,"fan_rpm":%s,"fan_pwm":%s,"fan_percentage":%s,"fan_mode":%s,"fan_mode_desc":"%s","uci_mode":"%s","uci_preset":"%s","uci_manual_pwm":%s}\n' \
        "$( [ -n "$hwmon" ] && printf true || printf false )" \
        "$temp_cpu" "$temp_board" "$temp_phy1" "$temp_phy2" "$wifi_24g" "$wifi_5g" "$wifi_6g" \
        "$fan_rpm" "$fan_pwm" "$fan_percentage" "$fan_mode" "$mode_desc" "$uci_mode" "$uci_preset" "$uci_manual_pwm"
}

get_curve() {
    local preset="$1" i temp pwm first=1
    preset_valid "$preset" || preset=balanced
    printf '{"preset":"%s","points":[' "$preset"
    for i in 1 2 3 4 5; do
        temp=$(uci_value "fan.${preset}.point${i}_temp" null)
        pwm=$(uci_value "fan.${preset}.point${i}_pwm" null)
        valid_range "$temp" 0 100 || temp=null
        valid_range "$pwm" 0 255 || pwm=null
        [ "$first" -eq 1 ] || printf ','
        first=0
        printf '{"temp":%s,"pwm":%s}' "$temp" "$pwm"
    done
    printf ']}\n'
}

get_all_curves() {
    local first=1 preset i temp pwm
    printf '{'
    for preset in quiet balanced performance custom; do
        [ "$first" -eq 1 ] || printf ','
        first=0
        printf '"%s":[' "$preset"
        for i in 1 2 3 4 5; do
            temp=$(uci_value "fan.${preset}.point${i}_temp" null)
            pwm=$(uci_value "fan.${preset}.point${i}_pwm" null)
            valid_range "$temp" 0 100 || temp=null
            valid_range "$pwm" 0 255 || pwm=null
            [ "$i" -eq 1 ] || printf ','
            printf '{"temp":%s,"pwm":%s}' "$temp" "$pwm"
        done
        printf ']'
    done
    printf '}\n'
}

reload_fan() {
    /etc/init.d/fan reload >/dev/null 2>&1
}

set_mode() {
    case "$1" in manual|auto) ;; *) curve_error 'Invalid mode'; return 1 ;; esac
    save_settings "fan.settings.mode=$1"
}

set_manual_pwm() {
    valid_range "$1" 0 255 || { curve_error 'Invalid PWM value (0-255)'; return 1; }
    save_settings "fan.settings.manual_pwm=$1"
}

set_preset() {
    preset_valid "$1" || { curve_error 'Invalid preset'; return 1; }
    save_settings "fan.settings.curve_preset=$1"
}

# A failed save/apply restores configuration, never the previous hardware output.
save_settings() {
    local backup assignment failed=0
    backup=$(uci -q export fan) || { curve_error 'Failed to back up fan configuration'; return 1; }
    for assignment in "$@"; do
        uci set "$assignment" || { failed=1; break; }
    done
    if [ "$failed" -eq 0 ]; then
        uci commit fan && reload_fan || failed=1
    fi
    if [ "$failed" -ne 0 ]; then
        if uci -q revert fan && printf '%s\n' "$backup" | uci import fan; then
            curve_error 'Failed to save or apply fan configuration; configuration restored'
        else
            curve_error 'Failed to save or apply fan configuration; rollback failed'
        fi
        return 1
    fi
    printf '{"success":true}\n'
}

curve_error() {
    printf '{"success":false,"error":"%s"}\n' "$1"
    return 1
}

set_custom_curve() {
    local json="$1" i idx temp pwm previous_temp=-1 previous_pwm=0
    local points="" extra
    command -v jsonfilter >/dev/null 2>&1 || { curve_error 'jsonfilter not available'; return 1; }
    extra=$(printf '%s\n' "$json" | jsonfilter -t '@.points' 2>/dev/null)
    [ "$extra" = array ] || { curve_error 'Expected a curve array'; return 1; }
    # jsonfilter omits JSON null. Trailing null entries have no effect; only
    # the five validated points below are ever saved or applied.
    extra=$(printf '%s\n' "$json" | jsonfilter -t '@.points[5]' 2>/dev/null)
    [ -z "$extra" ] || { curve_error 'Expected five curve points'; return 1; }
    for i in 1 2 3 4 5; do
        idx=$((i - 1))
        temp=$(printf '%s\n' "$json" | jsonfilter -e "@.points[${idx}].temp" 2>/dev/null)
        pwm=$(printf '%s\n' "$json" | jsonfilter -e "@.points[${idx}].pwm" 2>/dev/null)
        valid_range "$temp" 0 100 && valid_range "$pwm" 0 255 || {
            curve_error 'Invalid curve point'; return 1;
        }
        [ "$temp" -gt "$previous_temp" ] && [ "$pwm" -ge "$previous_pwm" ] || {
            curve_error 'Curve points must be ordered'; return 1;
        }
        points="$points $temp $pwm"
        previous_temp=$temp
        previous_pwm=$pwm
    done
    [ "$previous_pwm" -eq 255 ] || { curve_error 'Last PWM point must be 255'; return 1; }
    set -- $points
    local assignments=""
    for i in 1 2 3 4 5; do
        assignments="$assignments fan.custom.point${i}_temp=$1 fan.custom.point${i}_pwm=$2"
        shift 2
    done
    save_settings $assignments fan.settings.curve_preset=custom
}

case "$1" in
    list)
        printf '{"getStatus":{},"getCurve":{"preset":"str"},"getAllCurves":{},"setMode":{"mode":"str"},"setManualPwm":{"pwm":"int"},"setPreset":{"preset":"str"},"setCustomCurve":{"points":"array"}}\n'
        ;;
    call)
        case "$2" in
            getStatus) get_status ;;
            getCurve) read -r input; preset=$(printf '%s\n' "$input" | jsonfilter -e '@.preset' 2>/dev/null); get_curve "$preset" ;;
            getAllCurves) get_all_curves ;;
            setMode) read -r input; set_mode "$(printf '%s\n' "$input" | jsonfilter -e '@.mode' 2>/dev/null)" ;;
            setManualPwm) read -r input; set_manual_pwm "$(printf '%s\n' "$input" | jsonfilter -e '@.pwm' 2>/dev/null)" ;;
            setPreset) read -r input; set_preset "$(printf '%s\n' "$input" | jsonfilter -e '@.preset' 2>/dev/null)" ;;
            setCustomCurve) read -r input; set_custom_curve "$input" ;;
            *) printf '{"error":"Invalid method"}\n' ;;
        esac
        ;;
esac
