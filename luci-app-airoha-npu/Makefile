# This is free software, licensed under the Apache License, Version 2.0.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for Airoha NPU Status
LUCI_DESCRIPTION:=Airoha driver status, kernel CPU frequency controls and firewall flow offloading configuration.
LUCI_PKGNAME:=luci-app-airoha-npu
LUCI_DEPENDS:=+luci-base +jsonfilter
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
