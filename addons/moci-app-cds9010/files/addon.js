// DataRemote CDS-9010 board page: dual battery / UPS state, LTE modem power and SIM controls,
// power-loss alerts (SMS + e-mail). Backends live in the CDS-9010 image:
// /usr/libexec/cds9010-status, /usr/sbin/lte-ctl, /usr/libexec/cds9010-alert, /etc/config/cds9010.
const STATUS = '/usr/libexec/cds9010-status';
const LTE = '/usr/sbin/lte-ctl';
const ALERT = '/usr/libexec/cds9010-alert';
const SSD = '/sbin/start-stop-daemon';

const BATTERY = {
	charging: ['info', 'CHARGING', 'Mains power present, packs charging.'],
	idle: ['success', 'FULL / EMPTY BAY', 'Mains power present. A full pack and an empty bay read the same.'],
	discharging: ['error', 'ON BATTERY', 'Mains power lost. The router is running from the batteries.'],
	disconnected: ['warning', 'NO BATTERIES', 'No battery packs inserted: no backup power.'],
	error: ['warning', 'CHARGERS DISAGREE', 'The two chargers report different states.'],
	absent: ['info', 'NOT FITTED', ''],
	unknown: ['info', 'UNKNOWN', 'The battery monitor is not running.']
};

export default class Cds9010Addon {
	constructor(core) {
		this.core = core;
		this.core.registerRoute('/device', (path, sub) => this.render(sub[0] || 'status'));
	}

	getExtensions() {
		return {
			'dashboard:widget': { id: 'cds9010-widget', render: el => this.renderWidget(el) }
		};
	}

	esc(v) {
		return this.core.escapeHtml(v ?? '');
	}

	async exec(command, params = [], timeout = 20000) {
		const [st, res] = await this.core.ubusCall('file', 'exec', { command, params }, { timeout });
		if (st !== 0) throw new Error(`${command} not permitted`);
		return res || {};
	}

	async status() {
		const r = await this.exec(STATUS);
		return JSON.parse(r.stdout || '{}');
	}

	badge(state) {
		const [type, text] = BATTERY[state] || BATTERY.unknown;
		return this.core.renderBadge(type, text);
	}

	page() {
		return document.getElementById('addon-cds9010-page');
	}

	build() {
		const page = this.page();
		if (!page || page.dataset.built) return;
		page.dataset.built = '1';
		page.innerHTML = `
			<h2>DEVICE</h2>
			<div class="tabs">
				<button class="tab-btn" data-dev-tab="status">STATUS</button>
				<button class="tab-btn" data-dev-tab="alerts">ALERTS</button>
			</div>
			<div id="dev-tab-status" class="tab-content">
				<div id="dev-battery"></div>
				<div class="stat-card" style="margin-top:24px">
					<div class="section-title">LTE MODEM</div>
					<div id="dev-lte"></div>
					<div class="action-buttons" style="margin-top:16px">
						<button class="action-btn" id="dev-lte-restart">RESET MODEM</button>
						<button class="action-btn" id="dev-sim1">USE SIM 1</button>
						<button class="action-btn" id="dev-sim2">USE SIM 2</button>
					</div>
					<p style="color:var(--steel-muted);font-size:12px;margin-top:8px">
						Resetting or switching SIM drops the LTE link for about a minute. The modem does not detect a newly inserted SIM until it is reset.</p>
				</div>
			</div>
			<div id="dev-tab-alerts" class="tab-content hidden">
				<div class="stat-card">
					<div class="section-title">POWER ALERTS</div>
					<p style="color:var(--steel-muted);font-size:13px;margin-bottom:16px">
						Sent when mains power is lost and when it comes back. SMS go out through the LTE modem; e-mail needs an SMTP account with TLS.</p>
					<div class="form-group"><label class="form-label"><input type="checkbox" id="dev-al-enabled" /> SEND ALERTS</label></div>
					<div class="form-group"><label class="form-label">NAME IN MESSAGES</label><input class="form-input" id="dev-al-name" placeholder="hostname" /></div>
					<div class="form-group"><label class="form-label">SMS NUMBERS (space-separated)</label><input class="form-input" id="dev-al-sms" placeholder="+15551234567" /></div>
					<div class="form-group"><label class="form-label">E-MAIL ADDRESSES (space-separated)</label><input class="form-input" id="dev-al-email" placeholder="you@example.com" /></div>
					<div class="form-group"><label class="form-label">SMTP SERVER</label><input class="form-input" id="dev-al-smtp_url" placeholder="smtps://smtp.gmail.com:465" /></div>
					<div class="form-group"><label class="form-label">SMTP USER</label><input class="form-input" id="dev-al-smtp_user" autocomplete="off" /></div>
					<div class="form-group"><label class="form-label">SMTP PASSWORD</label><input class="form-input" type="password" id="dev-al-smtp_pass" autocomplete="new-password" placeholder="leave empty to keep the saved password" /></div>
					<div class="form-group"><label class="form-label">FROM ADDRESS</label><input class="form-input" id="dev-al-mail_from" placeholder="same as SMTP user" /></div>
					<div class="action-buttons">
						<button class="action-btn" id="dev-al-save">SAVE</button>
						<button class="action-btn" id="dev-al-test">SEND TEST ALERT</button>
					</div>
					<p style="color:var(--steel-muted);font-size:12px;margin-top:8px">The test result is written to the system log (tag "alert").</p>
				</div>
			</div>`;
		page.querySelectorAll('[data-dev-tab]').forEach(b =>
			b.addEventListener('click', () => this.core.navigate(`/device/${b.dataset.devTab}`))
		);
		document
			.getElementById('dev-lte-restart')
			.addEventListener('click', () => this.lte('restart', 'Reset the LTE modem?'));
		document
			.getElementById('dev-sim1')
			.addEventListener('click', () => this.lte('sim1', 'Switch to SIM 1 and reset the modem?'));
		document
			.getElementById('dev-sim2')
			.addEventListener('click', () => this.lte('sim2', 'Switch to SIM 2 and reset the modem?'));
		document.getElementById('dev-al-save').addEventListener('click', () => this.saveAlerts());
		document.getElementById('dev-al-test').addEventListener('click', () => this.testAlert());
	}

	async render(tab) {
		this.build();
		const page = this.page();
		if (!page) return;
		if (!['status', 'alerts'].includes(tab)) tab = 'status';
		page.querySelectorAll('[data-dev-tab]').forEach(b => b.classList.toggle('active', b.dataset.devTab === tab));
		page.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `dev-tab-${tab}`));
		if (tab === 'status') await this.loadStatus();
		else await this.loadAlerts();
	}

	async loadStatus() {
		const bat = document.getElementById('dev-battery');
		const lte = document.getElementById('dev-lte');
		let s;
		try {
			s = await this.status();
		} catch (e) {
			bat.innerHTML = `<div class="stat-card">Status unavailable (${this.esc(e.message)})</div>`;
			return;
		}
		const b = s.battery || {};
		const overall = b.status || 'unknown';
		const [, , desc] = BATTERY[overall] || BATTERY.unknown;
		const charger = (name, state, ac, chg) => `<div class="stat-card">
			<div class="stat-label">${name}</div>
			<div style="margin:8px 0">${this.badge(state)}</div>
			<div style="color:var(--steel-muted);font-size:12px">AC_OK ${this.esc(ac ?? '-')} &middot; CHG_OK ${this.esc(chg ?? '-')}</div>
		</div>`;
		bat.innerHTML = `
			<div class="stat-card">
				<div class="section-title">BACKUP POWER</div>
				<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
					<div style="font-size:22px">${this.badge(overall)}</div>
					<div style="color:var(--steel-muted)">${this.esc(desc)}</div>
				</div>
				<div style="color:var(--steel-muted);font-size:12px;margin-top:8px">Pack detected: ${b.battery_present === 0 ? 'yes (at least one)' : b.battery_present === 1 ? 'no' : '-'}</div>
			</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:16px">
				${charger('CHARGER A', b.battery_a, b.battery_ac_ok, b.battery_charge_ok)}
				${charger('CHARGER B', b.battery_b, b.battery_b_ac_ok, b.battery_b_charge_ok)}
			</div>`;
		const c = s.cellular || {};
		const row = (l, v) =>
			`<tr><td style="color:var(--steel-muted);width:40%">${l}</td><td>${this.esc(v ?? '-')}</td></tr>`;
		lte.innerHTML = `<table class="data-table"><tbody>
			${row('STATE', c.state)}
			${row('OPERATOR', [c.operator, c.access_tech?.toUpperCase()].filter(Boolean).join(' / '))}
			${row('SIGNAL', c.signal != null ? `${c.signal}% (RSRP ${c.rsrp} dBm, SNR ${c.snr} dB)` : '-')}
			${row('ACTIVE SIM', c.sim_slot)}
			${row('IPV4 / IPV6', [c.ipv4, c.ipv6].filter(Boolean).join('  '))}
			${row('MODEM', [c.model, c.revision].filter(Boolean).join(' '))}
		</tbody></table>`;
	}

	async lte(action, question) {
		if (!confirm(question)) return;
		try {
			const r = await this.exec(LTE, [action]);
			if (r.code) throw new Error(r.stderr || r.stdout || 'failed');
			this.core.showToast('Modem is restarting; LTE returns in about a minute', 'success');
		} catch (e) {
			this.core.showToast(`Failed: ${e.message}`, 'error');
		}
	}

	async loadAlerts() {
		const [st, res] = await this.core.uciGet('cds9010', 'alerts').catch(() => [1]);
		const v = st === 0 ? res?.values || {} : {};
		const set = (k, val) => {
			const el = document.getElementById(`dev-al-${k}`);
			if (el) el.value = Array.isArray(val) ? val.join(' ') : (val ?? '');
		};
		document.getElementById('dev-al-enabled').checked = v.enabled === '1';
		// the saved password is never sent back to the browser
		for (const k of ['name', 'sms', 'email', 'smtp_url', 'smtp_user', 'mail_from']) set(k, v[k]);
		set('smtp_pass', '');
		this._alertsExist = st === 0;
	}

	async saveAlerts() {
		const val = k => document.getElementById(`dev-al-${k}`).value.trim();
		const list = k =>
			val(k)
				.split(/[\s,]+/)
				.filter(Boolean);
		const sms = list('sms');
		const email = list('email');
		if (sms.some(n => !/^\+?[0-9]{3,20}$/.test(n))) {
			this.core.showToast('SMS numbers: digits with optional +', 'error');
			return;
		}
		if (email.some(a => !/^[^\s@]+@[^\s@]+$/.test(a))) {
			this.core.showToast('Check the e-mail addresses', 'error');
			return;
		}
		if (email.length && !/^smtps?:\/\//.test(val('smtp_url'))) {
			this.core.showToast('SMTP server must start with smtps:// or smtp://', 'error');
			return;
		}
		const set = { enabled: document.getElementById('dev-al-enabled').checked ? '1' : '0' };
		const del = [];
		for (const k of ['name', 'smtp_url', 'smtp_user', 'mail_from']) {
			if (val(k)) set[k] = val(k);
			else del.push(k);
		}
		if (val('smtp_pass')) set.smtp_pass = val('smtp_pass');
		if (sms.length) set.sms = sms;
		else del.push('sms');
		if (email.length) set.email = email;
		else del.push('email');
		try {
			if (!this._alertsExist) {
				const [st] = await this.core.uciAdd('cds9010', 'alerts', 'alerts');
				if (st !== 0) throw new Error('create failed');
				this._alertsExist = true;
			}
			await this.core.uciSet('cds9010', 'alerts', set);
			for (const k of del) await this.core.uciDelete('cds9010', 'alerts', k).catch(() => {});
			await this.core.uciCommit('cds9010');
			this.core.showToast('Alert settings saved', 'success');
		} catch {
			this.core.showToast('Failed to save', 'error');
		}
	}

	async testAlert() {
		if (
			!confirm(
				'Send a test alert to every configured number and address now? (Save first if you changed anything.)'
			)
		)
			return;
		try {
			// sending retries for minutes: run it detached; each result goes to the system log
			const r = await this.exec(SSD, ['-S', '-b', '-x', ALERT, '--', 'test']);
			if (r.code) throw new Error(r.stderr || 'could not start');
			this.core.showToast('Test alert started - check the system log for results', 'success');
		} catch (e) {
			this.core.showToast(`Failed: ${e.message}`, 'error');
		}
	}

	async renderWidget(el) {
		try {
			const s = await this.status();
			const b = s.battery || {};
			el.innerHTML = `<div class="stat-card"><div class="section-title">BACKUP POWER</div>
				<div style="display:flex;gap:16px;align-items:center">${this.badge(b.status || 'unknown')}
				<span style="color:var(--steel-muted);font-size:13px">${this.esc((BATTERY[b.status] || BATTERY.unknown)[2])}</span></div></div>`;
		} catch {
			el.innerHTML = '';
		}
	}
}
