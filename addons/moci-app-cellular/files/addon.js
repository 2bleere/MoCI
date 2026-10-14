// Cellular modem pages: status (3ginfo-lite backend), LTE band selection (modemband),
// SMS inbox/compose and an AT console (sms_tool). Replaces luci-app-3ginfo-lite,
// luci-app-modemband and luci-app-sms-tool-js.
const TABS = [
	['status', 'STATUS'],
	['bands', 'BANDS'],
	['sms', 'SMS'],
	['at', 'AT COMMANDS']
];
const INFO = '/usr/share/3ginfo-lite/3ginfo.sh';
const BANDS = '/usr/bin/modemband.sh';
const SMS = '/usr/bin/sms_tool';

export default class CellularAddon {
	constructor(core) {
		this.core = core;
		this.core.registerRoute('/cellular', (path, sub) => this.render(sub[0] || 'status'));
	}

	getExtensions() {
		return {
			'dashboard:widget': { id: 'cellular-widget', render: el => this.renderWidget(el) }
		};
	}

	esc(v) {
		return this.core.escapeHtml(v ?? '');
	}

	async exec(command, params = [], timeout = 30000) {
		const [st, res] = await this.core.ubusCall('file', 'exec', { command, params }, { timeout });
		if (st !== 0) throw new Error(`${command} not permitted`);
		return res || {};
	}

	async atPort() {
		if (this._port) return this._port;
		const [st, res] = await this.core.uciGet('3ginfo').catch(() => [1]);
		const sec = st === 0 ? Object.values(res?.values || {}).find(s => s.device) : null;
		this._port = sec?.device || '/dev/ttyUSB2';
		return this._port;
	}

	async smsStorage() {
		const [st, res] = await this.core.uciGet('sms_tool_js').catch(() => [1]);
		const sec = st === 0 ? Object.values(res?.values || {})[0] : null;
		return sec?.storage || 'SM';
	}

	page() {
		return document.getElementById('addon-cellular-page');
	}

	build() {
		const page = this.page();
		if (!page || page.dataset.built) return;
		page.dataset.built = '1';
		page.innerHTML = `
			<h2>CELLULAR</h2>
			<div class="tabs">${TABS.map(([t, l]) => `<button class="tab-btn" data-cell-tab="${t}">${l}</button>`).join('')}</div>
			<div id="cell-tab-status" class="tab-content">
				<div id="cell-status"><div class="stat-card">Loading...</div></div>
			</div>
			<div id="cell-tab-bands" class="tab-content hidden">
				<div class="stat-card">
					<div class="section-title">LTE BANDS</div>
					<p style="color:var(--steel-muted);font-size:13px;margin-bottom:12px">
						Untick bands to stop the modem from using them. The modem re-attaches after saving, which drops the cellular link for a few seconds.</p>
					<div id="cell-bands">Loading...</div>
					<div class="action-buttons" style="margin-top:16px">
						<button class="action-btn" id="cell-bands-save">SAVE BANDS</button>
						<button class="action-btn" id="cell-bands-all">ENABLE ALL</button>
					</div>
				</div>
			</div>
			<div id="cell-tab-sms" class="tab-content hidden">
				<div class="stat-card">
					<div class="section-title">SEND SMS</div>
					<div class="form-group"><label class="form-label">PHONE NUMBER</label><input class="form-input" id="cell-sms-to" placeholder="+15551234567" /></div>
					<div class="form-group"><label class="form-label">MESSAGE <span id="cell-sms-count" style="color:var(--steel-muted)">0/160</span></label>
						<textarea class="form-input" id="cell-sms-text" rows="3" maxlength="160"></textarea></div>
					<button class="action-btn" id="cell-sms-send">SEND</button>
				</div>
				<div class="stat-card" style="margin-top:24px">
					<div class="section-title">INBOX <span id="cell-sms-storage" style="color:var(--steel-muted)"></span></div>
					<div class="action-buttons" style="margin-bottom:16px">
						<button class="action-btn" id="cell-sms-refresh">REFRESH</button>
						<button class="action-btn" id="cell-sms-delall">DELETE ALL</button>
					</div>
					<table class="data-table" id="cell-sms-table">
						<thead><tr><th>FROM</th><th>TIME</th><th>MESSAGE</th><th>ACTIONS</th></tr></thead>
						<tbody></tbody>
					</table>
				</div>
			</div>
			<div id="cell-tab-at" class="tab-content hidden">
				<div class="stat-card">
					<div class="section-title">AT CONSOLE</div>
					<p style="color:var(--steel-muted);font-size:13px;margin-bottom:12px">Commands go straight to the modem. Some (bands, APN, firmware) change it permanently.</p>
					<div style="display:flex;gap:8px;margin-bottom:12px">
						<input class="form-input" id="cell-at-cmd" placeholder="ATI" style="flex:1" />
						<button class="action-btn" id="cell-at-send">SEND</button>
					</div>
					<div class="action-buttons" style="margin-bottom:12px">${[
						'ATI',
						'AT+CSQ',
						'AT+COPS?',
						'AT+QENG="servingcell"',
						'AT+QCAINFO',
						'AT+CPIN?',
						'AT+QSPN'
					]
						.map(c => `<button class="action-btn-sm" data-at="${this.esc(c)}">${this.esc(c)}</button>`)
						.join('')}</div>
					<pre id="cell-at-out" class="log-viewer" style="min-height:160px;white-space:pre-wrap"></pre>
				</div>
			</div>`;
		page.querySelectorAll('[data-cell-tab]').forEach(b =>
			b.addEventListener('click', () => this.core.navigate(`/cellular/${b.dataset.cellTab}`))
		);
		document.getElementById('cell-bands-save').addEventListener('click', () => this.saveBands());
		document.getElementById('cell-bands-all').addEventListener('click', () => this.enableAllBands());
		document.getElementById('cell-sms-send').addEventListener('click', () => this.sendSms());
		document.getElementById('cell-sms-refresh').addEventListener('click', () => this.loadSms());
		document.getElementById('cell-sms-delall').addEventListener('click', () => this.deleteSms('all'));
		const text = document.getElementById('cell-sms-text');
		text.addEventListener('input', () => {
			document.getElementById('cell-sms-count').textContent = `${text.value.length}/160`;
		});
		this.core.delegateActions('cell-sms-table', { delete: id => this.deleteSms(id) });
		document.getElementById('cell-at-send').addEventListener('click', () => this.sendAt());
		document.getElementById('cell-at-cmd').addEventListener('keydown', e => e.key === 'Enter' && this.sendAt());
		page.querySelectorAll('[data-at]').forEach(b =>
			b.addEventListener('click', () => {
				document.getElementById('cell-at-cmd').value = b.dataset.at;
				this.sendAt();
			})
		);
	}

	async render(tab) {
		this.build();
		const page = this.page();
		if (!page) return;
		if (!TABS.some(([t]) => t === tab)) tab = 'status';
		page.querySelectorAll('[data-cell-tab]').forEach(b => b.classList.toggle('active', b.dataset.cellTab === tab));
		page.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `cell-tab-${tab}`));
		clearInterval(this._timer);
		if (tab === 'status') {
			await this.loadStatus();
			// refresh while the status tab stays open
			this._timer = setInterval(() => {
				if (document.hidden) return;
				if (
					!window.location.hash.startsWith('#/cellular') ||
					!/#\/cellular(\/status)?$/.test(window.location.hash)
				) {
					clearInterval(this._timer);
					return;
				}
				this.loadStatus();
			}, 10000);
		} else if (tab === 'bands') await this.loadBands();
		else if (tab === 'sms') await this.loadSms();
	}

	async info() {
		const r = await this.exec(INFO, [], 30000);
		return JSON.parse(r.stdout || '{}');
	}

	// RSRP -> 0..4 bars (same thresholds most UIs use)
	bars(rsrp) {
		const v = Number(rsrp);
		if (!Number.isFinite(v)) return 0;
		return v >= -85 ? 4 : v >= -95 ? 3 : v >= -105 ? 2 : v >= -115 ? 1 : 0;
	}

	quality(v, good, fair) {
		const n = Number(v);
		if (!Number.isFinite(n)) return '';
		return n >= good
			? this.core.renderBadge('success', 'GOOD')
			: n >= fair
				? this.core.renderBadge('warning', 'FAIR')
				: this.core.renderBadge('error', 'POOR');
	}

	async loadStatus() {
		const box = document.getElementById('cell-status');
		let d;
		try {
			d = await this.info();
		} catch (e) {
			box.innerHTML = `<div class="stat-card">Modem information unavailable (${this.esc(e.message)})</div>`;
			return;
		}
		const v = k => (d[k] && d[k] !== '-' ? d[k] : '-');
		const row = (l, val) => `<tr><td style="color:var(--steel-muted);width:40%">${l}</td><td>${val}</td></tr>`;
		const ca = [1, 2, 3, 4]
			.filter(i => d[`s${i}band`] && d[`s${i}band`] !== '-')
			.map(i => `${this.esc(d[`s${i}band`])} (PCI ${this.esc(v(`s${i}pci`))})`);
		const reg = {
			0: 'Not registered',
			1: 'Registered (home)',
			2: 'Searching',
			3: 'Denied',
			5: 'Registered (roaming)'
		};
		const b = this.bars(d.rsrp);
		box.innerHTML = `
			<div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
				<div class="stat-card"><div class="stat-label">OPERATOR</div><div class="stat-value" style="font-size:22px">${this.esc(v('operator_name'))}</div>
					<div style="color:var(--steel-muted);font-size:12px">${this.esc(reg[d.registration] || '')}</div></div>
				<div class="stat-card"><div class="stat-label">NETWORK</div><div class="stat-value" style="font-size:22px">${this.esc(v('mode'))}</div></div>
				<div class="stat-card"><div class="stat-label">SIGNAL</div><div class="stat-value" style="font-size:22px">${'▮'.repeat(b)}${'▯'.repeat(4 - b)} ${this.esc(v('signal'))}%</div></div>
				<div class="stat-card"><div class="stat-label">CONNECTED</div><div class="stat-value" style="font-size:22px">${this.esc(v('conn_time'))}</div>
					<div style="color:var(--steel-muted);font-size:12px">&darr; ${this.esc(v('rx'))} &nbsp; &uarr; ${this.esc(v('tx'))}</div></div>
			</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px;margin-top:16px">
				<div class="stat-card"><div class="section-title">RADIO</div><table class="data-table"><tbody>
					${row('RSRP', `${this.esc(v('rsrp'))} dBm ${this.quality(d.rsrp, -90, -105)}`)}
					${row('RSRQ', `${this.esc(v('rsrq'))} dB ${this.quality(d.rsrq, -10, -15)}`)}
					${row('SINR', `${this.esc(v('sinr'))} dB ${this.quality(d.sinr, 13, 0)}`)}
					${row('RSSI', `${this.esc(v('rssi'))} dBm`)}
					${row('PRIMARY BAND', this.esc(v('pband')))}
					${row('CARRIER AGGREGATION', ca.length ? ca.join('<br>') : 'none')}
					${row('PCI / EARFCN', `${this.esc(v('pci'))} / ${this.esc(v('earfcn'))}`)}
					${row('CELL ID', `${this.esc(v('cid_dec'))} (0x${this.esc(v('cid_hex'))})`)}
					${row('TAC', `${this.esc(v('tac_dec'))} (0x${this.esc(v('tac_hex'))})`)}
					${row('MCC / MNC', `${this.esc(v('operator_mcc'))} / ${this.esc(v('operator_mnc'))}`)}
				</tbody></table></div>
				<div class="stat-card"><div class="section-title">MODEM</div><table class="data-table"><tbody>
					${row('MODEL', this.esc(v('modem')))}
					${row('FIRMWARE', this.esc(v('firmware')))}
					${row('TEMPERATURE', v('mtemp').replace('&deg;', '°'))}
					${row('PROTOCOL / PORT', `${this.esc(v('protocol'))} / ${this.esc(v('cport'))}`)}
					${row('IMEI', this.esc(v('imei')))}
					${row('IMSI', this.esc(v('imsi')))}
					${row('ICCID', this.esc(v('iccid')))}
				</tbody></table></div>
			</div>`;
	}

	async loadBands() {
		const box = document.getElementById('cell-bands');
		try {
			const r = await this.exec(BANDS, ['json']);
			const d = JSON.parse(r.stdout || '{}');
			this._bands = d;
			if (!d.supported?.length) {
				box.innerHTML = '<p>This modem does not report its bands.</p>';
				return;
			}
			const on = new Set(d.enabled || []);
			box.innerHTML = `<div style="color:var(--steel-muted);font-size:12px;margin-bottom:8px">${this.esc(d.modem || '')}</div>
				<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">${d.supported
					.map(
						b =>
							`<label class="form-label" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-band="${Number(b.band)}" ${on.has(b.band) ? 'checked' : ''} /> B${Number(b.band)} <span style="color:var(--steel-muted)">${this.esc(b.txt)}</span></label>`
					)
					.join('')}</div>`;
		} catch (e) {
			box.innerHTML = `<p>Band information unavailable (${this.esc(e.message)})</p>`;
		}
	}

	async setBands(list) {
		if (!list.length) {
			this.core.showToast('Keep at least one band enabled', 'error');
			return;
		}
		if (!confirm(`Set LTE bands to ${list.map(b => 'B' + b).join(', ')}? The cellular link will drop briefly.`))
			return;
		try {
			const r = await this.exec(BANDS, ['setbands', list.join(' ')], 60000);
			if (r.code) throw new Error(r.stderr || 'failed');
			this.core.showToast('Bands updated', 'success');
			setTimeout(() => this.loadBands(), 3000);
		} catch (e) {
			this.core.showToast(`Failed: ${e.message}`, 'error');
		}
	}

	saveBands() {
		const list = [...document.querySelectorAll('#cell-bands input[data-band]:checked')].map(i =>
			Number(i.dataset.band)
		);
		this.setBands(list);
	}

	enableAllBands() {
		this.setBands((this._bands?.supported || []).map(b => Number(b.band)));
	}

	async loadSms() {
		const tbody = document.querySelector('#cell-sms-table tbody');
		try {
			const [port, storage] = await Promise.all([this.atPort(), this.smsStorage()]);
			const [r, s] = await Promise.all([
				this.exec(SMS, ['-d', port, '-s', storage, '-f', '%Y-%m-%d %H:%M', '-j', 'recv']),
				this.exec(SMS, ['-d', port, '-s', storage, 'status']).catch(() => ({}))
			]);
			const st = (s.stdout || '').match(/used: (\d+), total: (\d+)/);
			document.getElementById('cell-sms-storage').textContent = st
				? `(${storage}: ${st[1]}/${st[2]})`
				: `(${storage})`;
			const msgs = JSON.parse(r.stdout || '{"msg":[]}').msg || [];
			// join multi-part messages by reference number
			const merged = [];
			const parts = new Map();
			for (const m of msgs) {
				if (m.total > 1) {
					const key = `${m.sender}|${m.reference}`;
					if (!parts.has(key)) {
						parts.set(key, { ...m, indexes: [], chunks: [] });
						merged.push(parts.get(key));
					}
					const p = parts.get(key);
					p.indexes.push(m.index);
					p.chunks[m.part - 1] = m.content;
				} else merged.push({ ...m, indexes: [m.index], chunks: [m.content] });
			}
			merged.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
			this.core.renderTable(
				'#cell-sms-table',
				merged,
				4,
				'No messages',
				m => `<tr>
					<td>${this.esc(m.sender)}</td>
					<td style="white-space:nowrap">${this.esc(m.timestamp)}</td>
					<td style="white-space:pre-wrap">${this.esc(m.chunks.join(''))}${m.error ? ` ${this.core.renderBadge('error', 'UNDECODABLE')}` : ''}</td>
					<td><button class="action-btn-sm danger" data-action="delete" data-id="${this.esc(m.indexes.join(','))}">DELETE</button></td>
				</tr>`
			);
		} catch (e) {
			this.core.renderEmptyTable(tbody, 4, `SMS unavailable (${this.esc(e.message)})`);
		}
	}

	async deleteSms(ids) {
		if (!confirm(ids === 'all' ? 'Delete ALL messages on the SIM/modem?' : 'Delete this message?')) return;
		try {
			const [port, storage] = await Promise.all([this.atPort(), this.smsStorage()]);
			for (const id of String(ids).split(',')) {
				await this.exec(SMS, ['-d', port, '-s', storage, 'delete', id]);
			}
			this.core.showToast('Deleted', 'success');
		} catch (e) {
			this.core.showToast(`Failed: ${e.message}`, 'error');
		}
		this.loadSms();
	}

	async sendSms() {
		const to = document.getElementById('cell-sms-to').value.trim();
		const text = document.getElementById('cell-sms-text').value;
		if (!/^\+?[0-9]{3,20}$/.test(to)) {
			this.core.showToast('Enter a phone number (digits, optional +)', 'error');
			return;
		}
		if (!text.trim()) {
			this.core.showToast('Message is empty', 'error');
			return;
		}
		const btn = document.getElementById('cell-sms-send');
		btn.disabled = true;
		try {
			const port = await this.atPort();
			const r = await this.exec(SMS, ['-d', port, 'send', to, text], 60000);
			// sms_tool exits 0 even when the network rejects the message
			if (!/sms sent/i.test(r.stdout || '')) throw new Error((r.stderr || r.stdout || 'not sent').trim());
			this.core.showToast('Message sent', 'success');
			document.getElementById('cell-sms-text').value = '';
		} catch (e) {
			this.core.showToast(`Failed: ${e.message}`, 'error');
		} finally {
			btn.disabled = false;
		}
	}

	async sendAt() {
		const cmd = document.getElementById('cell-at-cmd').value.trim();
		if (!/^AT/i.test(cmd)) {
			this.core.showToast('Commands start with AT', 'error');
			return;
		}
		const out = document.getElementById('cell-at-out');
		try {
			const port = await this.atPort();
			const r = await this.exec(SMS, ['-d', port, 'at', cmd], 30000);
			out.textContent = `> ${cmd}\n${(r.stdout || '') + (r.stderr || '')}\n${out.textContent}`.slice(0, 20000);
		} catch (e) {
			out.textContent = `> ${cmd}\nerror: ${e.message}\n${out.textContent}`;
		}
	}

	async renderWidget(el) {
		try {
			const d = await this.info();
			const b = this.bars(d.rsrp);
			el.innerHTML = `<div class="stat-card"><div class="section-title">CELLULAR</div>
				<div style="display:flex;gap:32px;flex-wrap:wrap">
					<div><div style="font-size:12px;color:var(--steel-muted)">OPERATOR</div>${this.esc(d.operator_name || '-')}</div>
					<div><div style="font-size:12px;color:var(--steel-muted)">NETWORK</div>${this.esc(d.mode || '-')}</div>
					<div><div style="font-size:12px;color:var(--steel-muted)">SIGNAL</div>${'▮'.repeat(b)}${'▯'.repeat(4 - b)} ${this.esc(d.rsrp || '-')} dBm</div>
				</div></div>`;
		} catch {
			el.innerHTML = '';
		}
	}
}
