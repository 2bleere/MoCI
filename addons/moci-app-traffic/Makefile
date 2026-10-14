include $(TOPDIR)/rules.mk

PKG_NAME:=moci-app-traffic
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/moci-app-traffic
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: Traffic accounting (nlbwmon)
  PKGARCH:=all
  DEPENDS:=+moci +nlbwmon
endef

define Package/moci-app-traffic/description
  Per-host and per-application usage from nlbwmon in MoCI.
endef

define Build/Compile
endef

define Package/moci-app-traffic/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/traffic
	$(INSTALL_DATA) ./files/manifest.json ./files/addon.js $(1)/www/moci/js/addons/traffic/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/moci-app-traffic.json
endef

define Package/moci-app-traffic/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
endef

$(eval $(call BuildPackage,moci-app-traffic))
