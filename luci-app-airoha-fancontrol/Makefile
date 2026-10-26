include $(TOPDIR)/rules.mk

PKG_VERSION:=20261024
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-or-later

LUCI_TITLE:=LuCI Airoha Fan Control
LUCI_PKGNAME:=luci-app-airoha-fancontrol
LUCI_PKGARCH:=all
# The panel is useless without the NCT7802Y hwmon driver (fan1_input/pwm1/pwm1_enable).
LUCI_DEPENDS:=+luci-base +kmod-hwmon-nct7802 @TARGET_airoha
PKG_MAINTAINER:=yahuisme <40222380+yahuisme@users.noreply.github.com>

define Package/$(LUCI_PKGNAME)/conffiles
/etc/config/fan
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
