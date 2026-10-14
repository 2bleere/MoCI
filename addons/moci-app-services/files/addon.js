// Service pages that LuCI apps provided: UPnP/NAT-PMP (miniupnpd), SNMP (snmpd), Watchcat,
// OpenVPN and keepalived (VRRP). Each tab: service controls + settings from the UCI config.
import { UciSectionTable, UciSectionForm } from '../../lib/uci-sections.js';
import { ServiceControl } from '../../lib/service-control.js';

const TABS = [
	['upnp', 'UPNP'],
	['snmp', 'SNMP'],
	['watchcat', 'WATCHCAT'],
	['openvpn', 'OPENVPN'],
	['keepalived', 'VRRP']
];

const yes = { type: 'bool', def: '0' };

export default class ServicesAddon {
	constructor(core) {
		this.core = core;
		this.core.registerRoute('/services', (path, sub) => this.render(sub[0] || 'upnp'));
		this.svc = {
			upnp: new ServiceControl(core, 'miniupnpd', { label: 'UPnP / NAT-PMP' }),
			snmp: new ServiceControl(core, 'snmpd', { label: 'SNMP agent' }),
			watchcat: new ServiceControl(core, 'watchcat', { label: 'Watchcat' }),
			openvpn: new ServiceControl(core, 'openvpn', { label: 'OpenVPN' }),
			keepalived: new ServiceControl(core, 'keepalived', { label: 'keepalived' })
		};
	}

	esc(v) {
		return this.core.escapeHtml(v ?? '');
	}

	page() {
		return document.getElementById('addon-services-page');
	}

	reload(tab) {
		return async () => {
			await this.svc[tab].reloadIfRunning();
			await this.load(tab);
		};
	}

	build() {
		const page = this.page();
		if (!page || page.dataset.built) return;
		page.dataset.built = '1';
		page.innerHTML = `
			<h2>SERVICES</h2>
			<div class="tabs">${TABS.map(([t, l]) => `<button class="tab-btn" data-svc-tab="${t}">${l}</button>`).join('')}</div>
			<div id="svc-tab-upnp" class="tab-content">
				<div id="svc-upnp-ctl"></div>
				<div class="stat-card" id="svc-upnp-form"></div>
				<div class="stat-card" style="margin-top:24px"><div class="section-title">ACTIVE PORT MAPPINGS</div><div id="svc-upnp-leases"></div></div>
				<div class="stat-card" style="margin-top:24px" id="svc-upnp-rules"></div>
			</div>
			<div id="svc-tab-snmp" class="tab-content hidden">
				<div id="svc-snmp-ctl"></div>
				<div class="stat-card" id="svc-snmp-system"></div>
				<div class="stat-card" style="margin-top:24px" id="svc-snmp-agent"></div>
				<div class="stat-card" style="margin-top:24px" id="svc-snmp-com"></div>
				<div class="stat-card" style="margin-top:24px" id="svc-snmp-com6"></div>
			</div>
			<div id="svc-tab-watchcat" class="tab-content hidden">
				<div id="svc-watchcat-ctl"></div>
				<div class="stat-card" id="svc-watchcat-table"></div>
			</div>
			<div id="svc-tab-openvpn" class="tab-content hidden">
				<div id="svc-openvpn-ctl"></div>
				<div class="stat-card" id="svc-openvpn-table"></div>
				<div class="stat-card" style="margin-top:24px">
					<div class="section-title">IMPORT .OVPN FILE</div>
					<p style="color:var(--steel-muted);font-size:13px;margin-bottom:12px">Creates an instance that uses the file as-is (saved to /etc/openvpn/NAME.ovpn).</p>
					<div class="form-group"><label class="form-label">INSTANCE NAME</label><input class="form-input" id="svc-ovpn-name" placeholder="myvpn" /></div>
					<div class="form-group"><label class="form-label">FILE</label><input type="file" class="form-input" id="svc-ovpn-file" accept=".ovpn,.conf,text/plain" /></div>
					<button class="action-btn" id="svc-ovpn-import">IMPORT</button>
				</div>
			</div>
			<div id="svc-tab-keepalived" class="tab-content hidden">
				<div id="svc-keepalived-ctl"></div>
				<div class="stat-card" id="svc-ka-instances"></div>
				<div class="stat-card" style="margin-top:24px" id="svc-ka-addresses"></div>
			</div>`;
		page.querySelectorAll('[data-svc-tab]').forEach(b =>
			b.addEventListener('click', () => this.core.navigate(`/services/${b.dataset.svcTab}`))
		);
		document.getElementById('svc-ovpn-import').addEventListener('click', () => this.importOvpn());
		this.makeForms();
	}

	makeForms() {
		const ifaces = () => (this.netNames || []).map(n => [n, n]);
		this.forms = {
			upnp: [
				new UciSectionForm(this.core, {
					container: 'svc-upnp-form',
					config: 'upnpd',
					section: 'config',
					type: 'upnpd',
					title: 'SETTINGS',
					onChange: this.reload('upnp'),
					fields: [
						{ key: 'enabled', label: 'SERVICE ENABLED IN CONFIG', ...yes },
						{ key: 'enable_upnp', label: 'UPNP IGD', type: 'bool', def: '1' },
						{ key: 'enable_natpmp', label: 'NAT-PMP / PCP', type: 'bool', def: '1' },
						{
							key: 'secure_mode',
							label: 'SECURE MODE (clients may only map to themselves)',
							type: 'bool',
							def: '1'
						},
						{ key: 'igdv1', label: 'IGDV1 COMPATIBILITY (older clients)', ...yes },
						{ key: 'log_output', label: 'LOG MAPPINGS', ...yes },
						{
							key: 'internal_iface',
							label: 'LAN INTERFACE',
							type: 'select',
							options: () => ifaces(),
							def: 'lan'
						},
						{ key: 'download', label: 'REPORTED DOWNLOAD (kbit/s)', type: 'number' },
						{ key: 'upload', label: 'REPORTED UPLOAD (kbit/s)', type: 'number' },
						{ key: 'port', label: 'SERVICE PORT', type: 'number', placeholder: '5000' }
					]
				}),
				new UciSectionTable(this.core, {
					container: 'svc-upnp-rules',
					config: 'upnpd',
					type: 'perm_rule',
					noun: 'rule',
					sortable: true,
					title: 'ACCESS RULES',
					help: 'Checked top to bottom; the first rule matching the client address and ports decides.',
					addLabel: '+ ADD RULE',
					onChange: this.reload('upnp'),
					columns: [
						{ label: 'ACTION', key: 'action' },
						{ label: 'EXTERNAL PORTS', key: 'ext_ports' },
						{ label: 'CLIENT ADDRESS', key: 'int_addr' },
						{ label: 'CLIENT PORTS', key: 'int_ports' },
						{ label: 'COMMENT', key: 'comment' }
					],
					fields: [
						{
							key: 'action',
							label: 'ACTION',
							type: 'select',
							options: [
								['allow', 'allow'],
								['deny', 'deny']
							]
						},
						{ key: 'ext_ports', label: 'EXTERNAL PORTS', placeholder: '1024-65535' },
						{ key: 'int_addr', label: 'CLIENT ADDRESS', placeholder: '0.0.0.0/0' },
						{ key: 'int_ports', label: 'CLIENT PORTS', placeholder: '1024-65535' },
						{ key: 'comment', label: 'COMMENT' }
					]
				})
			],
			snmp: [
				new UciSectionForm(this.core, {
					container: 'svc-snmp-system',
					config: 'snmpd',
					section: null,
					type: 'system',
					title: 'SYSTEM',
					onChange: this.reload('snmp'),
					fields: [
						{ key: 'sysName', label: 'NAME' },
						{ key: 'sysLocation', label: 'LOCATION' },
						{ key: 'sysContact', label: 'CONTACT' }
					]
				}),
				new UciSectionForm(this.core, {
					container: 'svc-snmp-agent',
					config: 'snmpd',
					section: null,
					type: 'agent',
					title: 'LISTEN',
					onChange: this.reload('snmp'),
					fields: [{ key: 'agentaddress', label: 'AGENT ADDRESS', placeholder: 'UDP:161,UDP6:161' }]
				}),
				new UciSectionTable(this.core, {
					container: 'svc-snmp-com',
					config: 'snmpd',
					type: 'com2sec',
					noun: 'community',
					named: true,
					title: 'COMMUNITIES (SNMP v1/v2c, IPv4)',
					help: 'Each community string maps clients from SOURCE to a security name; the access rules give "ro" read-only and "rw" read-write rights.',
					addLabel: '+ ADD COMMUNITY',
					onChange: this.reload('snmp'),
					columns: [
						{ label: 'NAME', key: 'section' },
						{ label: 'SECURITY NAME', key: 'secname' },
						{ label: 'SOURCE', key: 'source' },
						{ label: 'COMMUNITY', render: s => (s.community ? '••••••' : '-') }
					],
					fields: [
						{ key: 'secname', label: 'SECURITY NAME', placeholder: 'ro' },
						{ key: 'source', label: 'ALLOWED SOURCE', placeholder: 'default or 192.168.10.0/24' },
						{ key: 'community', label: 'COMMUNITY STRING', type: 'password' }
					]
				}),
				new UciSectionTable(this.core, {
					container: 'svc-snmp-com6',
					config: 'snmpd',
					type: 'com2sec6',
					noun: 'community',
					named: true,
					title: 'COMMUNITIES (IPv6)',
					addLabel: '+ ADD COMMUNITY',
					onChange: this.reload('snmp'),
					columns: [
						{ label: 'NAME', key: 'section' },
						{ label: 'SECURITY NAME', key: 'secname' },
						{ label: 'SOURCE', key: 'source' },
						{ label: 'COMMUNITY', render: s => (s.community ? '••••••' : '-') }
					],
					fields: [
						{ key: 'secname', label: 'SECURITY NAME', placeholder: 'ro' },
						{ key: 'source', label: 'ALLOWED SOURCE', placeholder: 'default or fd00::/8' },
						{ key: 'community', label: 'COMMUNITY STRING', type: 'password' }
					]
				})
			],
			watchcat: [
				new UciSectionTable(this.core, {
					container: 'svc-watchcat-table',
					config: 'watchcat',
					type: 'watchcat',
					noun: 'watch',
					named: true,
					title: 'WATCHES',
					help: 'Ping hosts and act when they stay unreachable: reboot, restart an interface or run a script. A periodic reboot ignores the ping settings.',
					addLabel: '+ ADD WATCH',
					onChange: this.reload('watchcat'),
					columns: [
						{ label: 'NAME', key: 'section' },
						{ label: 'MODE', key: 'mode' },
						{ label: 'AFTER', key: 'period' },
						{ label: 'HOSTS', key: 'pinghosts' },
						{ label: 'INTERFACE', render: s => this.esc(s.interface || s.mmifacename || '-') }
					],
					fields: [
						{
							key: 'mode',
							label: 'MODE',
							type: 'select',
							options: [
								['ping_reboot', 'Reboot when hosts are unreachable'],
								['restart_iface', 'Restart an interface when hosts are unreachable'],
								['run_script', 'Run a script when hosts are unreachable'],
								['periodic_reboot', 'Reboot periodically']
							]
						},
						{ key: 'period', label: 'ACT AFTER (e.g. 10m, 6h)', placeholder: '6h' },
						{ key: 'pinghosts', label: 'HOSTS TO PING (space-separated)', placeholder: '8.8.8.8' },
						{ key: 'pingperiod', label: 'PING EVERY (e.g. 30s)', placeholder: '30s' },
						{
							key: 'pingsize',
							label: 'PING SIZE',
							type: 'select',
							options: [
								['standard', 'standard (56 bytes)'],
								['small', 'small'],
								['big', 'big'],
								['huge', 'huge'],
								['jumbo', 'jumbo']
							]
						},
						{
							key: 'addressfamily',
							label: 'ADDRESS FAMILY',
							type: 'select',
							options: [
								['any', 'any'],
								['ipv4', 'IPv4'],
								['ipv6', 'IPv6']
							]
						},
						{ key: 'interface', label: 'PING THROUGH / RESTART DEVICE', placeholder: 'wwan0' },
						{ key: 'mmifacename', label: 'MODEMMANAGER INTERFACE (restart_iface)', placeholder: '' },
						{ key: 'unlockbands', label: 'UNLOCK MODEM BANDS BEFORE RESTART (ModemManager)', ...yes },
						{ key: 'script', label: 'SCRIPT (run_script)', placeholder: '/etc/watchcat.user' },
						{
							key: 'forcedelay',
							label: 'FORCE REBOOT DELAY (s, 0 = off)',
							type: 'number',
							placeholder: '60'
						}
					]
				})
			],
			openvpn: [
				new UciSectionTable(this.core, {
					container: 'svc-openvpn-table',
					config: 'openvpn',
					type: 'openvpn',
					noun: 'instance',
					named: true,
					title: 'INSTANCES',
					help: 'An instance either points at a complete .ovpn file (CONFIG FILE) or is built from the options below.',
					addLabel: '+ ADD INSTANCE',
					onChange: this.reload('openvpn'),
					columns: [
						{ label: 'NAME', key: 'section' },
						{ label: 'ENABLED', render: s => this.core.renderStatusBadge(s.enabled === '1', 'YES', 'NO') },
						{ label: 'RUNNING', render: s => this.ovpnRunning(s.section) },
						{
							label: 'TYPE',
							render: s =>
								this.esc(
									s.config
										? `file ${s.config}`
										: s.client === '1'
											? 'client'
											: s.server
												? 'server'
												: '-'
								)
						},
						{
							label: 'REMOTE / PORT',
							render: s => this.esc([].concat(s.remote || []).join(', ') || s.port || '-')
						}
					],
					fields: [
						{ key: 'enabled', label: 'ENABLED', ...yes },
						{
							key: 'config',
							label: 'CONFIG FILE (.ovpn) - other options are then ignored',
							placeholder: '/etc/openvpn/myvpn.ovpn'
						},
						{ key: 'client', label: 'CLIENT MODE', ...yes },
						{ key: 'dev', label: 'DEVICE', placeholder: 'tun0' },
						{
							key: 'proto',
							label: 'PROTOCOL',
							type: 'select',
							options: [
								['udp', 'udp'],
								['tcp-client', 'tcp-client'],
								['tcp-server', 'tcp-server'],
								['udp6', 'udp6'],
								['tcp6-client', 'tcp6-client']
							]
						},
						{ key: 'remote', label: 'REMOTE (host port, space-separated list)', type: 'list' },
						{ key: 'port', label: 'LOCAL PORT (server)', type: 'number', placeholder: '1194' },
						{ key: 'server', label: 'SERVER NETWORK (e.g. 10.8.0.0 255.255.255.0)' },
						{ key: 'ca', label: 'CA CERTIFICATE PATH', placeholder: '/etc/openvpn/ca.crt' },
						{ key: 'cert', label: 'CERTIFICATE PATH' },
						{ key: 'key', label: 'PRIVATE KEY PATH' },
						{ key: 'auth_user_pass', label: 'USERNAME/PASSWORD FILE' },
						{ key: 'verb', label: 'LOG VERBOSITY', type: 'number', placeholder: '3' }
					]
				})
			],
			keepalived: [
				new UciSectionTable(this.core, {
					container: 'svc-ka-instances',
					config: 'keepalived',
					type: 'vrrp_instance',
					noun: 'VRRP instance',
					title: 'VRRP INSTANCES',
					help: 'Share a virtual IP with another router; the one with the highest priority holds it.',
					addLabel: '+ ADD INSTANCE',
					onChange: this.reload('keepalived'),
					columns: [
						{ label: 'NAME', key: 'name' },
						{ label: 'STATE', key: 'state' },
						{ label: 'INTERFACE', key: 'interface' },
						{ label: 'VRID', key: 'virtual_router_id' },
						{ label: 'PRIORITY', key: 'priority' },
						{ label: 'VIRTUAL IPS', key: 'virtual_ipaddress' }
					],
					fields: [
						{ key: 'name', label: 'NAME', placeholder: 'VI_1' },
						{
							key: 'state',
							label: 'INITIAL STATE',
							type: 'select',
							options: [
								['BACKUP', 'BACKUP'],
								['MASTER', 'MASTER']
							]
						},
						{ key: 'interface', label: 'DEVICE', placeholder: 'br-lan' },
						{
							key: 'virtual_router_id',
							label: 'VIRTUAL ROUTER ID (1-255, same on both routers)',
							type: 'number'
						},
						{ key: 'priority', label: 'PRIORITY (1-254)', type: 'number', placeholder: '100' },
						{ key: 'advert_int', label: 'ADVERTISEMENT INTERVAL (s)', type: 'number', placeholder: '1' },
						{ key: 'nopreempt', label: 'NO PREEMPT', ...yes },
						{
							key: 'virtual_ipaddress',
							label: 'VIRTUAL IP ADDRESSES',
							type: 'multi',
							options: cfg =>
								this.core
									.filterUciSections(cfg, 'ipaddress')
									.map(a => [a.name || a.section, a.name || a.section])
						},
						{
							key: 'auth_type',
							label: 'AUTHENTICATION',
							type: 'select',
							options: [
								['', 'none'],
								['PASS', 'PASS'],
								['AH', 'AH']
							]
						},
						{ key: 'auth_pass', label: 'PASSWORD', type: 'password' }
					]
				}),
				new UciSectionTable(this.core, {
					container: 'svc-ka-addresses',
					config: 'keepalived',
					type: 'ipaddress',
					noun: 'address',
					title: 'ADDRESSES',
					help: 'Addresses that VRRP instances can hold.',
					addLabel: '+ ADD ADDRESS',
					onChange: this.reload('keepalived'),
					columns: [
						{ label: 'NAME', key: 'name' },
						{ label: 'ADDRESS', key: 'address' },
						{ label: 'DEVICE', key: 'device' }
					],
					fields: [
						{ key: 'name', label: 'NAME', placeholder: 'lan_vip' },
						{ key: 'address', label: 'ADDRESS/PREFIX', placeholder: '192.168.10.254/24' },
						{ key: 'device', label: 'DEVICE', placeholder: 'br-lan' },
						{ key: 'scope', label: 'SCOPE', placeholder: 'global' }
					]
				})
			]
		};
	}

	ovpnRunning(name) {
		const inst = this._ovpnInstances || {};
		return inst[name] ? this.core.renderBadge('success', 'UP') : this.core.renderBadge('info', 'NO');
	}

	async render(tab) {
		this.build();
		const page = this.page();
		if (!page) return;
		if (!TABS.some(([t]) => t === tab)) tab = 'upnp';
		page.querySelectorAll('[data-svc-tab]').forEach(b => b.classList.toggle('active', b.dataset.svcTab === tab));
		page.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `svc-tab-${tab}`));
		await this.load(tab);
	}

	config(name) {
		return this.core
			.uciGet(name)
			.then(([st, res]) => (st === 0 ? res?.values || {} : {}))
			.catch(() => ({}));
	}

	async load(tab) {
		await this.svc[tab].render(`svc-${tab}-ctl`);
		if (tab === 'upnp') {
			const [cfg, net] = await Promise.all([this.config('upnpd'), this.config('network')]);
			this.netNames = this.core.filterUciSections(net, 'interface').map(i => i.section);
			this.forms.upnp.forEach(f => f.render(cfg));
			await this.loadUpnpLeases(cfg.config?.upnp_lease_file || '/var/run/miniupnpd.leases');
		} else if (tab === 'snmp') {
			const cfg = await this.config('snmpd');
			// system and agent are anonymous sections: edit the first of each
			const [system, agent, com, com6] = this.forms.snmp;
			system.o.section = this.core.filterUciSections(cfg, 'system')[0]?.section || 'system';
			agent.o.section = this.core.filterUciSections(cfg, 'agent')[0]?.section || 'agent';
			[system, agent, com, com6].forEach(f => f.render(cfg));
		} else if (tab === 'openvpn') {
			const [cfg, svc] = await Promise.all([
				this.config('openvpn'),
				this.core.ubusCall('service', 'list', { name: 'openvpn' }).catch(() => [1])
			]);
			this._ovpnInstances = svc[0] === 0 ? svc[1]?.openvpn?.instances || {} : {};
			this.forms.openvpn.forEach(f => f.render(cfg));
		} else {
			const cfg = await this.config(tab);
			this.forms[tab].forEach(f => f.render(cfg));
		}
	}

	async loadUpnpLeases(path) {
		const box = document.getElementById('svc-upnp-leases');
		const [st, res] = await this.core.ubusCall('file', 'read', { path }).catch(() => [1]);
		const lines = st === 0 ? (res?.data || '').split('\n').filter(Boolean) : [];
		// PROTO:EXTPORT:INTADDR:INTPORT:EXPIRY:DESCRIPTION
		const rows = lines.map(l => {
			const [proto, ext, addr, port, expiry, ...desc] = l.split(':');
			return { proto, ext, addr, port, expiry, desc: desc.join(':') };
		});
		box.innerHTML = rows.length
			? `<table class="data-table"><thead><tr><th>PROTOCOL</th><th>EXTERNAL PORT</th><th>CLIENT</th><th>CLIENT PORT</th><th>DESCRIPTION</th></tr></thead><tbody>${rows
					.map(
						r =>
							`<tr><td>${this.esc(r.proto)}</td><td>${this.esc(r.ext)}</td><td>${this.esc(r.addr)}</td><td>${this.esc(r.port)}</td><td>${this.esc(r.desc)}</td></tr>`
					)
					.join('')}</tbody></table>`
			: '<p style="color:var(--steel-muted)">No active mappings.</p>';
	}

	async importOvpn() {
		const name = document.getElementById('svc-ovpn-name').value.trim();
		const file = document.getElementById('svc-ovpn-file').files[0];
		if (!/^[a-zA-Z0-9_]+$/.test(name)) {
			this.core.showToast('Name: letters, digits and _ only', 'error');
			return;
		}
		if (!file) {
			this.core.showToast('Choose a .ovpn file', 'error');
			return;
		}
		if (file.size > 256 * 1024) {
			this.core.showToast('File is too large for an OpenVPN profile', 'error');
			return;
		}
		const path = `/etc/openvpn/${name}.ovpn`;
		try {
			const text = await file.text();
			const [ws] = await this.core.ubusCall('file', 'write', { path, data: text, mode: 0o600 });
			if (ws !== 0) throw new Error('could not write the file');
			const cfg = await this.config('openvpn');
			if (!cfg[name]) {
				const [st] = await this.core.uciAdd('openvpn', 'openvpn', name);
				if (st !== 0) throw new Error('could not create the instance');
			}
			await this.core.uciSet('openvpn', name, { config: path, enabled: '0' });
			await this.core.uciCommit('openvpn');
			this.core.showToast(`Imported as "${name}" (disabled - enable it to connect)`, 'success');
			await this.load('openvpn');
		} catch (e) {
			this.core.showToast(`Import failed: ${e.message}`, 'error');
		}
	}
}
