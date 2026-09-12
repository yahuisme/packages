# This is free software, licensed under the Apache License, Version 2.0 .

include $(TOPDIR)/rules.mk

PKG_VERSION:=20260912
PKG_RELEASE:=3

PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=LuCI Airoha FlowSense
LUCI_PKGNAME:=luci-app-airoha-flowsense
LUCI_DEPENDS:=+luci-base @TARGET_airoha

define Package/$(LUCI_PKGNAME)/conffiles
/etc/config/npu-monitor
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
