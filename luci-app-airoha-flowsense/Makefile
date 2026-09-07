# This is free software, licensed under the Apache License, Version 2.0 .

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for Airoha FlowSense
LUCI_DESCRIPTION:=Provides real-time monitoring and control for Airoha PPE hardware offload. \
	Displays NPU token usage, flow entry count, flow/VLAN/PPPoE and AP-mode acceleration status, \
	and allows enabling/disabling hardware offload for specific interfaces.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-airoha-flowsense
PKG_VERSION:=1.1.3
PKG_RELEASE:=6
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Airoha Maintainer

define Package/luci-app-airoha-flowsense/conffiles
/etc/config/npu-monitor
endef

define Package/luci-app-airoha-flowsense/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

/etc/init.d/npu-jitter enable 2>/dev/null
/etc/init.d/npu-jitter start 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
exit 0
endef

define Package/luci-app-airoha-flowsense/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

/etc/init.d/npu-jitter stop 2>/dev/null
/etc/init.d/npu-jitter disable 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
