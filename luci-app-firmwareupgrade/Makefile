#
# Copyright (C) 2026 yahuisme
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-firmwareupgrade
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=yahuisme

LUCI_PKGNAME:=luci-app-firmwareupgrade
LUCI_TITLE:=LuCI Support for One-Click Firmware Upgrade
LUCI_DEPENDS:=+luci-base +curl +ca-bundle +jsonfilter
LUCI_PKGARCH:=all

define Package/$(LUCI_PKGNAME)/conffiles
/etc/config/firmwareupgrade
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
