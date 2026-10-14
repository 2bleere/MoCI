include $(TOPDIR)/rules.mk

PKG_NAME:=moci-app-cellular
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/moci-app-cellular
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: Cellular modem
  PKGARCH:=all
  DEPENDS:=+moci +modemband +sms-tool +comgt
endef

define Package/moci-app-cellular/description
  Modem status, LTE bands, SMS and AT console for MoCI.
  The status page uses /usr/share/3ginfo-lite/3ginfo.sh (shipped by luci-app-3ginfo-lite).
endef

define Build/Compile
endef

define Package/moci-app-cellular/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/cellular
	$(INSTALL_DATA) ./files/manifest.json ./files/addon.js $(1)/www/moci/js/addons/cellular/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/moci-app-cellular.json
endef

define Package/moci-app-cellular/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
endef

$(eval $(call BuildPackage,moci-app-cellular))
