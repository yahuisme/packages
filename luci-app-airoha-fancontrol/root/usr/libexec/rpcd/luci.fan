#!/bin/sh

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
    local hwmon= phy1= phy2= wifi24= wifi5= wifi6= sensor name zone
    local temp_cpu=null temp_board=null temp_phy1=null temp_phy2=null
    local wifi_24g=null wifi_5g=null wifi_6g=null fan_rpm=null fan_pwm=null fan_mode=null
    local fan_percentage=null mode_desc=Unknown uci_mode uci_preset uci_manual_pwm

    # W1700K board wiring: MDIO :05 is LAN, :08 is WAN. MT7996
    # phy0.0/1/2 (also underscore names) are this board's 2.4/5/6 GHz.
    # These are board-specific mappings, not a generic band inference.
    for sensor in /sys/class/hwmon/hwmon*; do
        [ -r "$sensor/name" ] || continue
        read -r name < "$sensor/name" || continue
        case "$name" in
            nct7802)
                if [ -z "$hwmon" ] && [ -f "$sensor/pwm1" ] && [ -f "$sensor/pwm1_enable" ]; then
                    hwmon=$sensor
                fi
                ;;
            *:05) [ -n "$phy1" ] || phy1=$sensor ;;
            *:08) [ -n "$phy2" ] || phy2=$sensor ;;
            mt7996_phy0.0|mt7996_phy0_0) [ -n "$wifi24" ] || wifi24=$sensor ;;
            mt7996_phy0.1|mt7996_phy0_1) [ -n "$wifi5" ] || wifi5=$sensor ;;
            mt7996_phy0.2|mt7996_phy0_2) [ -n "$wifi6" ] || wifi6=$sensor ;;
        esac
    done
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
    for zone in /sys/class/thermal/thermal_zone*; do
        [ -r "$zone/type" ] || continue
        read -r name < "$zone/type" || continue
        case "$name" in
            cpu-thermal|cpu_thermal|soc-thermal|soc_thermal)
                temp_cpu=$(read_temp "$zone/temp")
                [ "$temp_cpu" = null ] || break
                ;;
        esac
    done
    [ -n "$phy1" ] && temp_phy1=$(read_temp "$phy1/temp1_input")
    [ -n "$phy2" ] && temp_phy2=$(read_temp "$phy2/temp1_input")
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

case "$1" in
    list) printf '{"getStatus":{}}\n' ;;
    call)
        case "$2" in
            getStatus) get_status ;;
            *) printf '{"error":"Invalid method"}\n'; exit 1 ;;
        esac
        ;;
esac
