include $(TOPDIR)/rules.mk

PKG_NAME:=moci-app-mwan3
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/moci-app-mwan3
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: Multi-WAN (mwan3)
  PKGARCH:=all
  DEPENDS:=+moci +mwan3
endef

define Package/moci-app-mwan3/description
  Status and configuration pages for mwan3 in MoCI.
endef

define Build/Compile
endef

define Package/moci-app-mwan3/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/mwan3
	$(INSTALL_DATA) ./files/manifest.json ./files/addon.js $(1)/www/moci/js/addons/mwan3/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/moci-app-mwan3.json
endef

define Package/moci-app-mwan3/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
endef

$(eval $(call BuildPackage,moci-app-mwan3))
