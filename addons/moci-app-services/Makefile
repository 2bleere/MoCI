include $(TOPDIR)/rules.mk

PKG_NAME:=moci-app-services
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/moci-app-services
  SECTION:=admin
  CATEGORY:=Administration
  SUBMENU:=MoCI Add-ons
  TITLE:=MoCI Add-on: Services (UPnP, SNMP, Watchcat, OpenVPN, VRRP)
  PKGARCH:=all
  DEPENDS:=+moci
endef

define Package/moci-app-services/description
  Pages for miniupnpd, snmpd, watchcat, openvpn and keepalived; each tab works when its service is installed.
endef

define Build/Compile
endef

define Package/moci-app-services/install
	$(INSTALL_DIR) $(1)/www/moci/js/addons/services
	$(INSTALL_DATA) ./files/manifest.json ./files/addon.js $(1)/www/moci/js/addons/services/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/moci-app-services.json
endef

define Package/moci-app-services/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
endef

$(eval $(call BuildPackage,moci-app-services))
