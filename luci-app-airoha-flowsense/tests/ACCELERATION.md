# Acceleration backend verification

Run `python3 luci-app-airoha-flowsense/tests/test_acceleration.py -v` from the
packages root. `OPENWRT_TOOLS` selects a native OpenWrt-tools prefix containing
`bin/uci`, `bin/jshn`, `share/libubox/jshn.sh`, and `lib/` (default:
`/root/.local/opt/openwrt-audit-tools`). BusyBox and Python 3 are required.
The tests run the real shell handler, jshn and UCI, redirect every kernel,
configuration, lock and temporary path, and replace nft/firewall boundaries.
They never reload the host firewall or write host sysctls. The applet PATH
contains BusyBox and the native tools only, not fallback GNU utilities.

The RPC fixture includes uhttpd's injected `ubus_rpc_session` and rpcd's
newline-free JSON stdin. Omitting that transport metadata hid an entry-point
bug: the strict setting-key allowlist rejected every normal browser save as
`invalid`, before any UCI or sysctl write. Only that known metadata key is
ignored; unknown settings and invalid business values still fail closed.
See upstream [uhttpd ubus.c](https://github.com/openwrt/uhttpd/blob/master/ubus.c)
(`uh_ubus_handle_request`, session injection) and
[rpcd plugin.c](https://github.com/openwrt/rpcd/blob/master/plugin.c)
(`rpc_plugin_call`, `rpc_plugin_call_stdin_cb`, complete object forwarding).
This fixture executes the shell/jshn/UCI boundary, not a live HTTP/ACL daemon.

Source evidence:

- User reference commit `38148509b37f30ab28bb999be10c63dc0a229770`,
  `package/luci-app-airoha-npu/root/usr/libexec/rpcd/luci.airoha_npu`,
  lines 491–652: VLAN/PPPoE use filter-tagged knobs; hardware sets both UCI
  options; AP requires three call-* knobs and filter-vlan/pass-vlan for
  VLAN-filtering bridges. Its PPPoE filename is **13**, not 15.
- Both actual firmware overlays (`/root/w1700k-openwrt` and
  `/root/w1700k-immortalwrt`) use `12-apmode-offload.conf`,
  `14-vlan-offload.conf`, **`15-pppoe-offload.conf`**. This backend preserves
  those actual target paths. Effective reads include all sysctl files, so
  a legacy 13 file or later overrides are not silently ignored.
- Reference `target/linux/generic/pending-6.18/675-02-nft_flow_offload-add-bridging-support.patch`
  implements bridge FDB/VLAN-aware offloading; `675-05-br_netfilter-map-vlan-aware-bridge-PVID-to-VLAN-device.patch`
  makes pass-vlan-input-dev supply logical VLAN input/output context.
- Linux v6.18 `net/bridge/br_netfilter_hooks.c`,
  `br_netfilter_sysctl_default()`: call-* defaults 1; filter VLAN, filter
  PPPoE and pass VLAN default 0. OpenWrt's `11-br-netfilter.conf` overrides
  the call-* values to 0. `package/base-files/files/etc/init.d/sysctl`
  applies `/etc/sysctl.d/*.conf` in order, then `/etc/sysctl.conf`.
- firewall4 `root/usr/share/ucode/fw4.uc` defaults both flow-offloading
  options to 0. Runtime enabled means a running `inet fw4` or W1700K `bridge fw4`
  flowtable has the `offload` flag. Discover tables with `nft -j list flowtables`;
  W1700K nft 1.1.6 omits flags from JSON, so missing flags require a text read
  of that exact family/table/name. Failed discovery or text read stays unknown.
  A successful snapshot with neither flag is off; this is not proof that every
  traffic flow is accelerated. The real device JSON is retained in `fixtures/`.
  AP remains the bridge-netfilter compatibility control, not an independent
  switch for W1700K's native bridge flowtable (which follows hardware UCI).

The setter uses an application lock and private UCI config/override/delta
paths, rejects preexisting firewall deltas, rechecks deltas and committed
bytes immediately before publication, and verifies runtime plus effective
persistence. This is not a universal lock against unrelated concurrent UCI
or sysctl writers. AP enabling on a VLAN-filtering bridge requires VLAN
already enabled at runtime and boot, or an explicit VLAN=1 in the same
request. AP off preserves independent VLAN state. Failed recovery returns
`rollback`, not success. Physical router and reboot acceptance are separate;
no router credentials were supplied and no firmware build was run.
