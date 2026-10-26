# This is free software, licensed under the Apache License, Version 2.0 .

include $(TOPDIR)/rules.mk

PKG_VERSION:=20261024
PKG_RELEASE:=2

PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=LuCI Airoha FlowSense
LUCI_PKGNAME:=luci-app-airoha-flowsense
LUCI_PKGARCH:=all
# Bridge/VLAN/PPPoE acceleration reads nft flowtables and writes bridge-nf sysctls.
LUCI_DEPENDS:=+luci-base +nftables-json @TARGET_airoha
PKG_MAINTAINER:=yahuisme <40222380+yahuisme@users.noreply.github.com>

define Package/$(LUCI_PKGNAME)/conffiles
/etc/config/npu-monitor
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
