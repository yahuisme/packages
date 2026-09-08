# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-wifi7
PKG_VERSION:=3.1.0
PKG_RELEASE:=3

LUCI_TITLE:=LuCI Support for WiFi 7 (MT7996)
LUCI_DESCRIPTION:=LuCI WiFi 7 Manager with support for MLO, 6GHz, diagnostics and multi-band status.
LUCI_DEPENDS:=+luci-base +rpcd-mod-iwinfo +iw +hostapd-cli
LUCI_PKGARCH:=all
PKG_MAINTAINER:=Petr Wozniak <petr.wozniak@gmail.com>
PKG_LICENSE:=GPL-2.0-or-later
PKG_LICENSE_FILES:=LICENSE

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
