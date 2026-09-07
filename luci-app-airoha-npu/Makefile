# This is free software, licensed under the Apache License, Version 2.0 .

include $(TOPDIR)/rules.mk

LUCI_NAME:=luci-app-airoha-npu
PKG_VERSION:=1.1.0
PKG_RELEASE:=5
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Airoha Maintainer
TITLE:=LuCI Support for Airoha NPU Status

LUCI_TITLE:=LuCI Support for Airoha NPU Status
LUCI_DESCRIPTION:=Displays real-time Airoha NPU status including NPU utilization, \
	CPU frequency and load, frame engine statistics, and supports CPU overclocking.
LUCI_DEPENDS:=+luci-base +kmod-br-netfilter

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(LUCI_NAME)/install
	# Install LuCI frontend views
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/airoha_npu
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/airoha_npu/status.js $(1)/www/luci-static/resources/view/airoha_npu/

	# Install RPC backend script (executable)
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/luci.airoha_npu $(1)/usr/libexec/rpcd/

	# Install LuCI menu configuration
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-airoha-npu.json $(1)/usr/share/luci/menu.d/

	# Install RPC ACL configuration
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-airoha-npu.json $(1)/usr/share/rpcd/acl.d/

	# Preserve runtime-created acceleration settings during sysupgrade.
	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./root/lib/upgrade/keep.d/luci-app-airoha-npu $(1)/lib/upgrade/keep.d/
endef

define Package/$(LUCI_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

# Default enable hardware acceleration sysctl options if not already configured
[ -f /etc/sysctl.d/14-vlan-offload.conf ] || echo "net.bridge.bridge-nf-filter-vlan-tagged=1" > /etc/sysctl.d/14-vlan-offload.conf
[ -f /etc/sysctl.d/15-pppoe-offload.conf ] || echo "net.bridge.bridge-nf-filter-pppoe-tagged=1" > /etc/sysctl.d/15-pppoe-offload.conf

if [ ! -f /etc/sysctl.d/12-apmode-offload.conf ]; then
	cat << 'EOF' > /etc/sysctl.d/12-apmode-offload.conf
net.bridge.bridge-nf-call-iptables=1
net.bridge.bridge-nf-call-ip6tables=1
net.bridge.bridge-nf-call-arptables=1
net.bridge.bridge-nf-pass-vlan-input-dev=1
net.bridge.bridge-nf-filter-vlan-tagged=1
EOF
fi

# Apply bridge sysctl values immediately if proc entries exist
for conf in /etc/sysctl.d/12-apmode-offload.conf /etc/sysctl.d/14-vlan-offload.conf /etc/sysctl.d/15-pppoe-offload.conf; do
	[ -f "$$conf" ] && sysctl -p "$$conf" >/dev/null 2>&1
done

# Default enable firewall hardware flow offload
if command -v uci >/dev/null 2>&1; then
	if [ "$$(uci -q get firewall.@defaults[0].flow_offloading_hw)" != "1" ]; then
		uci -q set firewall.@defaults[0].flow_offloading='1'
		uci -q set firewall.@defaults[0].flow_offloading_hw='1'
		uci -q commit firewall
		/etc/init.d/firewall reload >/dev/null 2>&1
	fi
fi

# Reload rpcd to register the new luci.airoha_npu backend
/etc/init.d/rpcd reload 2>/dev/null

exit 0
endef

define Package/$(LUCI_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

/etc/init.d/rpcd reload 2>/dev/null

exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
