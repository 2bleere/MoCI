import { UciSectionTable } from '../../lib/uci-sections.js';

const TABS = [
	['status', 'STATUS'],
	['interfaces', 'INTERFACES'],
	['members', 'MEMBERS'],
	['policies', 'POLICIES'],
	['rules', 'RULES']
];

export default class Mwan3Addon {
	constructor(core) {
		this.core = core;
		this.core.registerRoute('/mwan3', (path, sub) => this.render(sub[0] || 'status'));
	}

	getExtensions() {
		return {
			'dashboard:widget': { id: 'mwan3-widget', render: el => this.renderWidget(el) }
		};
	}

	esc(v) {
		return this.core.escapeHtml(v ?? '');
	}

	page() {
		return document.getElementById('addon-mwan3-page');
	}

	build() {
		const page = this.page();
		if (!page || page.dataset.built) return;
		page.dataset.built = '1';
		page.innerHTML = `
			<h2>MULTI-WAN</h2>
			<div class="tabs">${TABS.map(([t, l]) => `<button class="tab-btn" data-mwan3-tab="${t}">${l}</button>`).join('')}</div>
			<div id="mwan3-tab-status" class="tab-content">
				<div class="stat-card"><div class="section-title">UPLINKS</div><div id="mwan3-ifaces"></div></div>
				<div class="stat-card" style="margin-top:24px"><div class="section-title">ACTIVE POLICIES</div><div id="mwan3-policies"></div></div>
				<div style="margin-top:16px"><button class="action-btn" id="mwan3-restart">RESTART MWAN3</button></div>
			</div>
			<div id="mwan3-tab-interfaces" class="tab-content hidden"><div class="stat-card" id="mwan3-t-interfaces"></div></div>
			<div id="mwan3-tab-members" class="tab-content hidden"><div class="stat-card" id="mwan3-t-members"></div></div>
			<div id="mwan3-tab-policies" class="tab-content hidden"><div class="stat-card" id="mwan3-t-policies"></div></div>
			<div id="mwan3-tab-rules" class="tab-content hidden"><div class="stat-card" id="mwan3-t-rules"></div></div>`;
		page.querySelectorAll('[data-mwan3-tab]').forEach(b =>
			b.addEventListener('click', () => this.core.navigate(`/mwan3/${b.dataset.mwan3Tab}`))
		);
		document.getElementById('mwan3-restart').addEventListener('click', () => this.restart());
		this.makeTables();
	}

	makeTables() {
		const reload = async () => {
			await this.core.serviceReload('mwan3');
			await this.loadConfig();
		};
		const members = cfg => this.core.filterUciSections(cfg, 'member').map(m => [m.section, m.section]);
		const policies = cfg => [
			...this.core.filterUciSections(cfg, 'policy').map(p => [p.section, p.section]),
			['default', 'default (main routing table)'],
			['unreachable', 'unreachable (reject)'],
			['blackhole', 'blackhole (drop)']
		];
		const family = {
			key: 'family',
			label: 'FAMILY',
			type: 'select',
			options: [
				['ipv4', 'IPv4'],
				['ipv6', 'IPv6']
			],
			def: 'ipv4'
		};

		this.tables = {
			interfaces: new UciSectionTable(this.core, {
				container: 'mwan3-t-interfaces',
				config: 'mwan3',
				type: 'interface',
				noun: 'interface',
				named: true,
				addLabel: '+ ADD INTERFACE',
				help: 'Each entry must have the same name as a network interface. Health checks decide when it is online.',
				onChange: reload,
				columns: [
					{ label: 'INTERFACE', key: 'section' },
					{ label: 'ENABLED', render: s => this.core.renderStatusBadge(s.enabled === '1', 'YES', 'NO') },
					{ label: 'TRACK IPS', key: 'track_ip' },
					{
						label: 'CHECK EVERY',
						render: s => this.esc(`${s.interval || 5}s (failing ${s.failure_interval || s.interval || 5}s)`)
					},
					{ label: 'DOWN / UP AFTER', render: s => this.esc(`${s.down || 5} / ${s.up || 5} checks`) }
				],
				fields: [
					{ key: 'enabled', label: 'ENABLED', type: 'bool', def: '0' },
					family,
					{
						key: 'initial_state',
						label: 'INITIAL STATE',
						type: 'select',
						options: [
							['online', 'Online'],
							['offline', 'Offline']
						]
					},
					{
						key: 'track_ip',
						label: 'TRACK IPS (space-separated)',
						type: 'list',
						placeholder: '1.1.1.1 9.9.9.9'
					},
					{
						key: 'track_method',
						label: 'TRACK METHOD',
						type: 'select',
						options: [
							['ping', 'ping'],
							['arping', 'arping'],
							['httping', 'httping'],
							['nping-tcp', 'nping-tcp'],
							['nping-udp', 'nping-udp']
						]
					},
					{ key: 'reliability', label: 'TARGETS THAT MUST ANSWER', type: 'number', placeholder: '1' },
					{ key: 'count', label: 'PINGS PER CHECK', type: 'number', placeholder: '1' },
					{ key: 'timeout', label: 'PING TIMEOUT (s)', type: 'number', placeholder: '4' },
					{ key: 'interval', label: 'CHECK INTERVAL (s)', type: 'number', placeholder: '10' },
					{ key: 'failure_interval', label: 'INTERVAL WHILE FAILING (s)', type: 'number' },
					{ key: 'recovery_interval', label: 'INTERVAL WHILE RECOVERING (s)', type: 'number' },
					{ key: 'down', label: 'FAILED CHECKS BEFORE OFFLINE', type: 'number', placeholder: '5' },
					{ key: 'up', label: 'GOOD CHECKS BEFORE ONLINE', type: 'number', placeholder: '5' },
					{
						key: 'flush_conntrack',
						label: 'FLUSH CONNECTIONS ON',
						type: 'multi',
						options: [
							['ifup', 'ifup'],
							['ifdown', 'ifdown'],
							['connected', 'connected'],
							['disconnected', 'disconnected']
						]
					}
				]
			}),
			members: new UciSectionTable(this.core, {
				container: 'mwan3-t-members',
				config: 'mwan3',
				type: 'member',
				noun: 'member',
				named: true,
				addLabel: '+ ADD MEMBER',
				help: 'A member is an interface with a metric (lower is preferred) and a weight (load share among equal metrics).',
				onChange: reload,
				columns: [
					{ label: 'MEMBER', key: 'section' },
					{ label: 'INTERFACE', key: 'interface' },
					{ label: 'METRIC', key: 'metric' },
					{ label: 'WEIGHT', key: 'weight' }
				],
				fields: [
					{ key: 'interface', label: 'INTERFACE', type: 'select', options: cfg => this.mwanIfaces(cfg) },
					{ key: 'metric', label: 'METRIC', type: 'number', placeholder: '1' },
					{ key: 'weight', label: 'WEIGHT', type: 'number', placeholder: '1' }
				]
			}),
			policies: new UciSectionTable(this.core, {
				container: 'mwan3-t-policies',
				config: 'mwan3',
				type: 'policy',
				noun: 'policy',
				named: true,
				addLabel: '+ ADD POLICY',
				help: 'Members with the lowest metric carry the traffic; the others take over when they fail.',
				onChange: reload,
				columns: [
					{ label: 'POLICY', key: 'section' },
					{ label: 'MEMBERS', key: 'use_member' },
					{ label: 'WHEN ALL DOWN', render: s => this.esc(s.last_resort || 'unreachable') }
				],
				fields: [
					{ key: 'use_member', label: 'MEMBERS', type: 'multi', options: members },
					{
						key: 'last_resort',
						label: 'WHEN ALL MEMBERS ARE DOWN',
						type: 'select',
						options: [
							['unreachable', 'unreachable (reject)'],
							['blackhole', 'blackhole (drop)'],
							['default', 'default (main routing table)']
						]
					}
				]
			}),
			rules: new UciSectionTable(this.core, {
				container: 'mwan3-t-rules',
				config: 'mwan3',
				type: 'rule',
				noun: 'rule',
				named: true,
				sortable: true,
				addLabel: '+ ADD RULE',
				help: 'Rules are matched top to bottom; the first match picks the policy.',
				onChange: reload,
				columns: [
					{ label: 'RULE', key: 'section' },
					{
						label: 'SOURCE',
						render: s => this.esc(`${s.src_ip || 'any'}${s.src_port ? ':' + s.src_port : ''}`)
					},
					{
						label: 'DESTINATION',
						render: s => this.esc(`${s.dest_ip || 'any'}${s.dest_port ? ':' + s.dest_port : ''}`)
					},
					{ label: 'PROTO', render: s => this.esc(s.proto || 'all') },
					{ label: 'FAMILY', render: s => this.esc(s.family || 'any') },
					{ label: 'POLICY', key: 'use_policy' }
				],
				fields: [
					{ key: 'src_ip', label: 'SOURCE ADDRESS', placeholder: 'any' },
					{ key: 'src_port', label: 'SOURCE PORT', placeholder: 'any' },
					{ key: 'dest_ip', label: 'DESTINATION ADDRESS', placeholder: 'any' },
					{ key: 'dest_port', label: 'DESTINATION PORT', placeholder: 'any' },
					{
						key: 'proto',
						label: 'PROTOCOL',
						type: 'select',
						options: [
							['all', 'all'],
							['tcp', 'tcp'],
							['udp', 'udp'],
							['icmp', 'icmp'],
							['esp', 'esp']
						]
					},
					{
						key: 'family',
						label: 'FAMILY',
						type: 'select',
						options: [
							['any', 'any'],
							['ipv4', 'IPv4'],
							['ipv6', 'IPv6']
						]
					},
					{ key: 'sticky', label: 'STICKY (keep a source on one uplink)', type: 'bool', def: '0' },
					{ key: 'timeout', label: 'STICKY TIMEOUT (s)', type: 'number', placeholder: '600' },
					{ key: 'use_policy', label: 'POLICY', type: 'select', options: policies }
				]
			})
		};
	}

	mwanIfaces(cfg) {
		return this.core.filterUciSections(cfg, 'interface').map(i => [i.section, i.section]);
	}

	async render(tab) {
		this.build();
		const page = this.page();
		if (!page) return;
		if (!TABS.some(([t]) => t === tab)) tab = 'status';
		page.querySelectorAll('[data-mwan3-tab]').forEach(b =>
			b.classList.toggle('active', b.dataset.mwan3Tab === tab)
		);
		page.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `mwan3-tab-${tab}`));
		if (tab === 'status') await this.loadStatus();
		else await this.loadConfig(tab);
	}

	async loadConfig(only) {
		const [st, res] = await this.core.uciGet('mwan3');
		if (st !== 0 || !res?.values) {
			this.core.showToast('mwan3 config not found', 'error');
			return;
		}
		for (const [name, t] of Object.entries(this.tables)) {
			if (!only || only === name) t.render(res.values);
		}
	}

	async fetchStatus() {
		const [st, res] = await this.core.ubusCall('mwan3', 'status', {});
		return st === 0 ? res : null;
	}

	ifaceBadge(i) {
		const map = {
			online: 'success',
			offline: 'error',
			disabled: 'info',
			disconnecting: 'warning',
			connecting: 'warning'
		};
		return this.core.renderBadge(map[i.status] || 'info', (i.status || 'unknown').toUpperCase());
	}

	async loadStatus() {
		const box = document.getElementById('mwan3-ifaces');
		const pol = document.getElementById('mwan3-policies');
		const s = await this.fetchStatus().catch(() => null);
		if (!s) {
			box.innerHTML = '<p style="color:var(--steel-muted)">mwan3 is not running.</p>';
			pol.innerHTML = '';
			return;
		}
		const ifaces = Object.entries(s.interfaces || {});
		box.innerHTML = `<table class="data-table"><thead><tr><th>INTERFACE</th><th>STATUS</th><th>TRACKING</th><th>ONLINE FOR</th><th>TRACK TARGETS</th></tr></thead><tbody>${
			ifaces
				.map(
					([name, i]) => `<tr>
				<td>${this.esc(name)}</td>
				<td>${this.ifaceBadge(i)}</td>
				<td>${this.esc(i.tracking || '-')}${i.score !== undefined ? ` (score ${this.esc(i.score)})` : ''}</td>
				<td>${i.status === 'online' && i.online ? this.esc(this.core.formatUptime(i.online)) : '-'}</td>
				<td>${(i.track_ip || []).map(t => `${this.esc(t.ip)} ${this.core.renderBadge(t.status === 'up' ? 'success' : t.status === 'down' ? 'error' : 'info', t.status)}`).join(' ')}</td>
			</tr>`
				)
				.join('') || '<tr><td colspan="5">No interfaces</td></tr>'
		}</tbody></table>`;
		const rows = [];
		for (const fam of ['ipv4', 'ipv6']) {
			for (const [name, members] of Object.entries(s.policies?.[fam] || {})) {
				rows.push(
					`<tr><td>${this.esc(name)}</td><td>${fam}</td><td>${
						(members || []).map(m => `${this.esc(m.interface)} (${this.esc(m.percent)}%)`).join(', ') ||
						this.core.renderBadge('error', 'NO UPLINK')
					}</td></tr>`
				);
			}
		}
		pol.innerHTML = `<table class="data-table"><thead><tr><th>POLICY</th><th>FAMILY</th><th>CURRENTLY USING</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="3">No policies</td></tr>'}</tbody></table>`;
	}

	async restart() {
		if (!confirm('Restart mwan3? Connections may drop for a moment.')) return;
		const [st] = await this.core.ubusCall('file', 'exec', { command: '/etc/init.d/mwan3', params: ['restart'] });
		this.core.showToast(st === 0 ? 'mwan3 restarted' : 'Restart failed', st === 0 ? 'success' : 'error');
		setTimeout(() => this.loadStatus(), 3000);
	}

	async renderWidget(el) {
		const s = await this.fetchStatus().catch(() => null);
		if (!s) {
			el.innerHTML = '';
			return;
		}
		const ifaces = Object.entries(s.interfaces || {});
		el.innerHTML = `<div class="stat-card"><div class="section-title">UPLINKS</div>
			<div style="display:flex;gap:24px;flex-wrap:wrap">${ifaces
				.map(
					([n, i]) =>
						`<div><div style="font-size:12px;color:var(--steel-muted)">${this.esc(n.toUpperCase())}</div>${this.ifaceBadge(i)}</div>`
				)
				.join('')}</div></div>`;
	}
}
