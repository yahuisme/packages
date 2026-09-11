include $(TOPDIR)/rules.mk

PKG_VERSION:=20260911
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-or-later

LUCI_TITLE:=LuCI Airoha Fan Control
LUCI_PKGNAME:=luci-app-airoha-fancontrol
LUCI_DEPENDS:=+luci-base @TARGET_airoha

define Package/$(LUCI_PKGNAME)/conffiles
/etc/config/fan
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
