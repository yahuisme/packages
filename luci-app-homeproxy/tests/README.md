# Reload regression

Run from the repository root (Python 3 and BusyBox required):

```sh
OPENWRT_SOURCE=/path/to/openwrt python3 luci-app-homeproxy/tests/test_reload.py -v
```

`OPENWRT_SOURCE` supplies native `package/base-files/files/etc/rc.common` and
`package/system/procd/files/procd.sh`. Set it to your OpenWrt source tree.
No network or proxy is started. Production init
functions and native rc/procd submission wrappers execute in BusyBox ash;
UCI, generators/checker, JSON serialization, ubus, fw4, DNS and ownership
are isolated platform boundaries.

Covers preparation failure without replacing old files, partial JSON install,
firewall generation/application, DNS restart/disable cleanup, ubus transport
failure despite native cleanup/namespace masking, client/server/both/disabled
success, concrete JSON/SRS/dashboard file monitoring, and recovery-copy/removal
failure retaining the complete backup. These are synchronous regression tests,
not proof of daemon startup health, actual procd file hashing, power-loss
atomicity or router firewall correctness.

Reload guards/backup/submission adapter selectively reuse the repository's
`e000a5c` implementation; current URLTest cleanup policy is retained. Cold
`start` remains on native rc.common semantics; this regression targets `reload`.
