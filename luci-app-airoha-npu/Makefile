# This is free software, licensed under the Apache License, Version 2.0.

include $(TOPDIR)/rules.mk

PKG_VERSION:=20260912
PKG_RELEASE:=1

LUCI_TITLE:=LuCI Support for Airoha NPU Status
LUCI_DESCRIPTION:=Airoha driver status and kernel CPU frequency controls.
LUCI_PKGNAME:=luci-app-airoha-npu
LUCI_DEPENDS:=+luci-base +jsonfilter
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
