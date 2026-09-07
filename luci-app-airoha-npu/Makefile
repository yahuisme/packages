# This is free software, licensed under the Apache License, Version 2.0.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for Airoha NPU Status
LUCI_DESCRIPTION:=Airoha driver status, kernel CPU frequency controls and firewall flow offloading configuration.
LUCI_DEPENDS:=+luci-base +jsonfilter
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-airoha-npu
PKG_VERSION:=1.1.0
PKG_RELEASE:=6
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Airoha Maintainer

include $(TOPDIR)/feeds/luci/luci.mk
