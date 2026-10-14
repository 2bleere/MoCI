// Per-host and per-application traffic accounting from nlbwmon (replaces luci-app-nlbwmon).
import { UciSectionForm } from '../../lib/uci-sections.js';
import { ServiceControl } from '../../lib/service-control.js';

const NLBW = '/usr/sbin/nlbw';
const TABS = [
	['hosts', 'BY HOST'],
	['apps', 'BY APPLICATION'],
	['settings', 'SETTINGS']
];

export default class TrafficAddon {
	constructor(core) {
		this.core = core;
		this.core.registerRoute('/traffic', (path, sub) => this.render(sub[0] || 'hosts'));
		this.svc = new ServiceControl(core, 'nlbwmon', { label: 'nlbwmon' });
	}

	esc(v) {
		return this.core.escapeHtml(v ?? '');
	}

	page() {
		return document.getElementById('addon-traffic-page');
	}

	build() {
		const page = this.page();
		if (!page || page.dataset.built) return;
		page.dataset.built = '1';
		page.innerHTML = `
			<h2>TRAFFIC</h2>
			<div class="tabs">${TABS.map(([t, l]) => `<button class="tab-btn" data-tr-tab="${t}">${l}</button>`).join('')}</div>
			<div class="stat-card" style="margin-bottom:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap" id="tr-period-box">
				<label class="form-label" style="margin:0">PERIOD</label>
				<select class="form-input" id="tr-period" style="max-width:220px"></select>
				<span id="tr-totals" style="color:var(--steel-muted);font-size:13px"></span>
			</div>
			<div id="tr-tab-hosts" class="tab-content"><div class="stat-card"><table class="data-table" id="tr-hosts">
				<thead><tr><th>HOST</th><th>ADDRESS</th><th>MAC</th><th>CONNECTIONS</th><th>DOWNLOAD</th><th>UPLOAD</th><th>SHARE</th></tr></thead><tbody></tbody></table></div></div>
			<div id="tr-tab-apps" class="tab-content hidden"><div class="stat-card"><table class="data-table" id="tr-apps">
				<thead><tr><th>APPLICATION</th><th>PROTOCOL / PORT</th><th>CONNECTIONS</th><th>DOWNLOAD</th><th>UPLOAD</th><th>SHARE</th></tr></thead><tbody></tbody></table></div></div>
			<div id="tr-tab-settings" class="tab-content hidden">
				<div id="tr-ctl"></div>
				<div class="stat-card" id="tr-settings"></div>
			</div>`;
		page.querySelectorAll('[data-tr-tab]').forEach(b =>
			b.addEventListener('click', () => this.core.navigate(`/traffic/${b.dataset.trTab}`))
		);
		document.getElementById('tr-period').addEventListener('change', () => this.render(this.tab));
		this.form = new UciSectionForm(this.core, {
			container: 'tr-settings',
			config: 'nlbwmon',
			section: null,
			type: 'nlbwmon',
			title: 'ACCOUNTING',
			onChange: () => this.svc.reloadIfRunning(),
			fields: [
				{
					key: 'local_network',
					label: 'LOCAL NETWORKS (interfaces or subnets)',
					type: 'list',
					placeholder: 'lan 192.168.10.0/24'
				},
				{
					key: 'database_interval',
					label: 'PERIOD START (day of month, or YYYY-MM-DD/days)',
					placeholder: '1'
				},
				{ key: 'database_generations', label: 'PERIODS TO KEEP (0 = all)', type: 'number', placeholder: '10' },
				{ key: 'database_limit', label: 'MAX RECORDS PER PERIOD', type: 'number', placeholder: '10000' },
				{ key: 'database_directory', label: 'DATABASE DIRECTORY', placeholder: '/var/lib/nlbwmon' },
				{ key: 'commit_interval', label: 'SAVE TO DISK EVERY', placeholder: '24h' },
				{ key: 'refresh_interval', label: 'REFRESH EVERY', placeholder: '30s' }
			]
		});
	}

	async exec(params) {
		const [st, res] = await this.core.ubusCall('file', 'exec', { command: NLBW, params }, { timeout: 30000 });
		if (st !== 0) throw new Error('nlbw not permitted');
		if (res?.code) throw new Error((res.stderr || 'nlbw failed').trim());
		return res?.stdout || '';
	}

	async table(group) {
		const params = ['-c', 'json', '-g', group, '-o', '-rx_bytes'];
		const period = document.getElementById('tr-period').value;
		if (period) params.push('-t', period);
		const d = JSON.parse((await this.exec(params)) || '{"columns":[],"data":[]}');
		return (d.data || []).map(row => Object.fromEntries(d.columns.map((c, i) => [c, row[i]])));
	}

	async loadPeriods() {
		const sel = document.getElementById('tr-period');
		const cur = sel.value;
		const list = (await this.exec(['-c', 'list']).catch(() => ''))
			.split('\n')
			.map(s => s.trim())
			.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s))
			.sort()
			.reverse();
		sel.innerHTML = list.length
			? list
					.map(
						(p, i) =>
							`<option value="${i === 0 ? '' : this.esc(p)}">${i === 0 ? `Current (since ${this.esc(p)})` : `Since ${this.esc(p)}`}</option>`
					)
					.join('')
			: '<option value="">Current</option>';
		if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
	}

	share(v, total) {
		const pct = total ? (v / total) * 100 : 0;
		return `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:var(--glass-border);border-radius:3px;min-width:60px"><div style="width:${pct.toFixed(1)}%;height:100%;background:var(--starship-steel);border-radius:3px"></div></div><span style="font-size:12px">${pct.toFixed(1)}%</span></div>`;
	}

	async hostNames() {
		const [st, res] = await this.core.ubusCall('moci', 'getDHCPLeases', {}).catch(() => [1]);
		const names = {};
		if (st === 0)
			for (const l of res?.dhcp_leases || []) if (l.hostname) names[l.macaddr.toLowerCase()] = l.hostname;
		return names;
	}

	async render(tab) {
		this.build();
		const page = this.page();
		if (!page) return;
		if (!TABS.some(([t]) => t === tab)) tab = 'hosts';
		this.tab = tab;
		page.querySelectorAll('[data-tr-tab]').forEach(b => b.classList.toggle('active', b.dataset.trTab === tab));
		page.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tr-tab-${tab}`));
		document.getElementById('tr-period-box').classList.toggle('hidden', tab === 'settings');
		try {
			if (tab === 'settings') {
				await this.svc.render('tr-ctl');
				const [st, res] = await this.core.uciGet('nlbwmon');
				const cfg = st === 0 ? res?.values || {} : {};
				this.form.o.section = this.core.filterUciSections(cfg, 'nlbwmon')[0]?.section || 'nlbwmon';
				this.form.render(cfg);
				return;
			}
			if (!document.getElementById('tr-period').options.length) await this.loadPeriods();
			if (tab === 'hosts') await this.loadHosts();
			else await this.loadApps();
		} catch (e) {
			const id = tab === 'hosts' ? 'tr-hosts' : 'tr-apps';
			this.core.renderEmptyTable(
				document.querySelector(`#${id} tbody`),
				7,
				`No data (${this.esc(e.message)}). Is nlbwmon running?`
			);
		}
	}

	totals(rows) {
		const rx = rows.reduce((a, r) => a + (r.rx_bytes || 0), 0);
		const tx = rows.reduce((a, r) => a + (r.tx_bytes || 0), 0);
		document.getElementById('tr-totals').textContent =
			`Total ↓ ${this.core.formatBytes(rx)}  ↑ ${this.core.formatBytes(tx)}`;
		return rx + tx;
	}

	async loadHosts() {
		const [rows, names] = await Promise.all([this.table('ip,mac'), this.hostNames()]);
		const total = this.totals(rows);
		this.core.renderTable('#tr-hosts', rows, 7, 'No traffic recorded yet', r => {
			const mac = String(r.mac || '').toLowerCase();
			return `<tr>
				<td>${this.esc(names[mac] || '-')}</td>
				<td>${this.esc(r.ip)}</td>
				<td style="font-size:12px">${this.esc(mac)}</td>
				<td>${this.esc(r.conns)}</td>
				<td>${this.core.formatBytes(r.rx_bytes || 0)}</td>
				<td>${this.core.formatBytes(r.tx_bytes || 0)}</td>
				<td>${this.share((r.rx_bytes || 0) + (r.tx_bytes || 0), total)}</td>
			</tr>`;
		});
	}

	async loadApps() {
		const rows = await this.table('layer7');
		const total = this.totals(rows);
		this.core.renderTable(
			'#tr-apps',
			rows,
			6,
			'No traffic recorded yet',
			r => `<tr>
			<td>${this.esc(r.layer7 || 'other')}</td>
			<td>${this.esc(r.proto)}${r.port ? ' / ' + this.esc(r.port) : ''}</td>
			<td>${this.esc(r.conns)}</td>
			<td>${this.core.formatBytes(r.rx_bytes || 0)}</td>
			<td>${this.core.formatBytes(r.tx_bytes || 0)}</td>
			<td>${this.share((r.rx_bytes || 0) + (r.tx_bytes || 0), total)}</td>
		</tr>`
		);
	}
}
