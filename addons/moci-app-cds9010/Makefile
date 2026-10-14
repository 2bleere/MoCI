include $(TOPDIR)/rules.mk

PKG_NAME:=moci-app-cds9010
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/moci-app-cds9010
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: DataRemote CDS-9010 device page
  PKGARCH:=all
  DEPENDS:=+moci
endef

define Package/moci-app-cds9010/description
  Battery, LTE modem controls and power alerts for the CDS-9010 (backends ship in the CDS-9010 image).
endef

define Build/Compile
endef

define Package/moci-app-cds9010/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/cds9010
	$(INSTALL_DATA) ./files/manifest.json ./files/addon.js $(1)/www/moci/js/addons/cds9010/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/moci-app-cds9010.json
endef

define Package/moci-app-cds9010/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
endef

$(eval $(call BuildPackage,moci-app-cds9010))
