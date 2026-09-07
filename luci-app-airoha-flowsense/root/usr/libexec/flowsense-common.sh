#!/bin/sh
# Shared validation and numeric helpers. No hardware writes.
fs_uint() {
    case "$1" in ''|*[!0-9]*|0[0-9]*|????????????????*) return 1;; esac
}
fs_target() {
    [ -n "$1" ] && [ "${#1}" -le 253 ] || return 1
    case "$1" in *[!a-zA-Z0-9.-]*) return 1;; esac
    # Numeric IPv4 or ASCII DNS hostname. IPv6 literals are not accepted here.
    printf '%s\n' "$1" | awk '
    /^[0-9.]+$/ { n=split($0,a,"."); if(n!=4) exit 1; for(i=1;i<=n;i++) if(a[i]=="" || a[i]+0>255 || a[i] !~ /^(0|[1-9][0-9]*)$/) exit 1; exit 0 }
    { n=split($0,a,"."); if(n<1) exit 1; for(i=1;i<=n;i++) if(length(a[i])>63 || a[i] !~ /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/) exit 1 }'
}
fs_read() {
    local value
    read -r value < "$1" 2>/dev/null || { printf null; return; }
    if fs_uint "$value"; then printf '%s' "$value"; else printf null; fi
}
