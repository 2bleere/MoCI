import { UciSectionForm } from '../lib/uci-sections.js';

export default class SystemModule {
	constructor(core) {
		this.core = core;
		this.subTabs = null;
		this.cleanups = [];
		this.cronRaw = '';
		this.sshKeysRaw = '';
		this.firmwareFile = null;

		this.core.registerRoute('/system', (path, subPaths) => {
			const pageElement = document.getElementById('system-page');
			if (pageElement) pageElement.classList.remove('hidden');

			if (!this.subTabs) {
				this.subTabs = this.core.setupSubTabs('system-page', {
					general: () => {
						this.loadGeneral();
						this.loadNtp();
					},
					admin: () => this.loadAdmin(),
					logs: () => this.loadLogs(),
					backup: () => this.loadBackup(),
					software: () => this.loadPackages(),
					startup: () => this.loadStartup(),
					cron: () => this.loadCron(),
					'ssh-keys': () => {
						this.loadSSHKeys();
						this.loadDropbear();
					},
					mounts: () => this.loadMounts(),
					led: () => this.loadLED(),
					upgrade: () => this.loadUpgrade()
				});
				this.subTabs.attachListeners();
				this.setupHandlers();
			}

			const tab = subPaths[0] || 'general';
			this.subTabs.showSubTab(tab);
		});
	}

	setupHandlers() {
		const buttons = {
			'save-general-btn': () => this.saveGeneral(),
			'change-password-btn': () => this.changePassword(),
			'backup-btn': () => this.createBackup(),
			'reset-btn': () => this.factoryReset(),
			'reboot-btn': () => this.rebootSystem(),
			'restart-network-btn': () => this.core.serviceReload('network'),
			'restart-firewall-btn': () => this.core.serviceReload('firewall'),
			'add-cron-btn': () => {
				this.core.resetModal('cron-modal');
				this.core.openModal('cron-modal');
			},
			'add-ssh-key-btn': () => {
				this.core.resetModal('ssh-key-modal');
				document.getElementById('parsed-keys-preview').style.display = 'none';
				document.getElementById('save-ssh-keys-btn').style.display = 'none';
				this.core.openModal('ssh-key-modal');
			},
			'parse-keys-btn': () => this.parseSSHKeyInput(),
			'refresh-syslog-btn': () => this.loadLog('syslog'),
			'refresh-klog-btn': () => this.loadLog('klog'),
			'pkg-install-btn': () => this.installPackage(),
			'pkg-update-btn': () => this.runPkg(['update'])
		};

		for (const [id, handler] of Object.entries(buttons)) {
			document.getElementById(id)?.addEventListener('click', handler);
		}

		for (const kind of ['syslog', 'klog']) {
			document.getElementById(`${kind}-filter`)?.addEventListener('input', () => this.renderLog(kind));
		}

		this.core.setupModal({
			modalId: 'cron-modal',
			closeBtnId: 'close-cron-modal',
			cancelBtnId: 'cancel-cron-btn',
			saveBtnId: 'save-cron-btn',
			saveHandler: () => this.saveCronEntry()
		});

		this.core.setupModal({
			modalId: 'ssh-key-modal',
			closeBtnId: 'close-ssh-key-modal',
			cancelBtnId: 'cancel-ssh-key-btn',
			saveBtnId: 'save-ssh-keys-btn',
			saveHandler: () => this.saveSSHKeys()
		});

		const delegations = {
			'cron-table': { edit: id => this.editCronEntry(id), delete: id => this.deleteCronEntry(id) },
			'ssh-keys-table': { delete: id => this.deleteSSHKey(id) },
			'services-table': Object.fromEntries(
				['start', 'stop', 'restart', 'enable', 'disable'].map(a => [a, id => this.serviceAction(id, a)])
			),
			'packages-table': { remove: id => this.removePackage(id) }
		};

		for (const [tableId, handlers] of Object.entries(delegations)) {
			const cleanup = this.core.delegateActions(tableId, handlers);
			if (cleanup) this.cleanups.push(cleanup);
		}

		this.setupFirmwareUpload();
	}

	cleanup() {
		if (this.subTabs) {
			this.subTabs.cleanup();
			this.subTabs = null;
		}
		this.cleanups.filter(Boolean).forEach(fn => {
			fn();
		});
		this.cleanups = [];
	}

	async loadGeneral() {
		if (!this.core.isFeatureEnabled('system')) return;
		try {
			const [status, boardInfo] = await this.core.ubusCall('system', 'board', {});
			if (status === 0 && boardInfo) {
				document.getElementById('system-hostname').value = boardInfo.hostname || '';
			}
			const [us, ur] = await this.core.uciGet('system', '@system[0]');
			if (us === 0 && ur?.values) {
				document.getElementById('system-timezone').value = ur.values.zonename || ur.values.timezone || 'UTC';
			}
		} catch {}
	}

	async saveGeneral() {
		const hostname = document.getElementById('system-hostname').value.trim();
		const timezone = document.getElementById('system-timezone').value.trim();
		if (!hostname) {
			this.core.showToast('Hostname is required', 'error');
			return;
		}
		try {
			await this.core.uciSet('system', '@system[0]', { hostname, zonename: timezone });
			await this.core.uciCommit('system');
			this.core.showToast('System settings saved', 'success');
		} catch {
			this.core.showToast('Failed to save settings', 'error');
		}
	}

	async loadNtp() {
		if (!this.ntpForm) {
			this.ntpForm = new UciSectionForm(this.core, {
				container: 'system-ntp',
				config: 'system',
				section: 'ntp',
				type: 'timeserver',
				title: 'TIME SYNCHRONISATION (NTP)',
				onChange: () =>
					this.core.ubusCall('rc', 'init', { name: 'sysntpd', action: 'restart' }).catch(() => {}),
				fields: [
					{ key: 'enabled', label: 'SYNC TIME FROM NTP SERVERS', type: 'bool', def: '1' },
					{ key: 'enable_server', label: 'SERVE TIME TO THE LAN', type: 'bool', def: '0' },
					{ key: 'use_dhcp', label: 'USE NTP SERVERS ANNOUNCED BY DHCP', type: 'bool', def: '1' },
					{
						key: 'server',
						label: 'NTP SERVERS (space-separated)',
						type: 'list',
						placeholder: '0.openwrt.pool.ntp.org 1.openwrt.pool.ntp.org'
					}
				]
			});
		}
		const [st, res] = await this.core.uciGet('system').catch(() => [1]);
		if (st === 0) this.ntpForm.render(res.values);
		const [, info] = await this.core.ubusCall('system', 'info', {}).catch(() => [1]);
		const el = document.getElementById('system-localtime');
		if (el && info?.localtime)
			el.textContent = new Date(info.localtime * 1000).toISOString().replace('T', ' ').slice(0, 19);
	}

	async loadDropbear() {
		const [st, res] = await this.core.uciGet('dropbear').catch(() => [1]);
		if (st !== 0) return;
		const section = this.core.filterUciSections(res.values, 'dropbear')[0]?.section;
		if (!section) return;
		if (!this.dropbearForm) {
			this.dropbearForm = new UciSectionForm(this.core, {
				container: 'system-dropbear',
				config: 'dropbear',
				section,
				type: 'dropbear',
				title: 'SSH SERVER',
				help: 'Turning off password login only takes effect for new sessions; make sure a key works first.',
				onChange: () =>
					this.core.ubusCall('rc', 'init', { name: 'dropbear', action: 'reload' }).catch(() => {}),
				fields: [
					{ key: 'Port', label: 'PORT', type: 'number', placeholder: '22' },
					{ key: 'Interface', label: 'LISTEN ON INTERFACE (empty = all)', placeholder: 'lan' },
					{ key: 'PasswordAuth', label: 'ALLOW PASSWORD LOGIN', type: 'bool', def: '1' },
					{ key: 'RootPasswordAuth', label: 'ALLOW ROOT PASSWORD LOGIN', type: 'bool', def: '1' },
					{ key: 'GatewayPorts', label: 'ALLOW REMOTE HOSTS TO USE FORWARDED PORTS', type: 'bool', def: '0' }
				]
			});
		}
		this.dropbearForm.o.section = section;
		this.dropbearForm.render(res.values);
	}

	async installPackage() {
		const input = document.getElementById('pkg-install-name');
		const names = input.value.trim().split(/\s+/).filter(Boolean);
		if (!names.length || names.some(n => !/^[a-z0-9][a-z0-9._+-]*$/.test(n))) {
			this.core.showToast('Package names: lower-case letters, digits and . _ + -', 'error');
			return;
		}
		await this.runPkg(['pkg-install', ...names], `Install ${names.join(', ')}?`);
		input.value = '';
	}

	async removePackage(name) {
		await this.runPkg(['pkg-remove', name], `Remove ${name}? Packages that depend on it may be removed too.`);
	}

	async runPkg(args, question) {
		if (question && !confirm(question)) return;
		const out = document.getElementById('pkg-output');
		out.textContent = `$ ${args.join(' ')}\n...`;
		out.classList.remove('hidden');
		try {
			const text = await this.core.pkgCall(...args);
			out.textContent = `$ ${args.join(' ')}\n${text}`;
			this.core.showToast('Done', 'success');
		} catch (e) {
			out.textContent = `$ ${args.join(' ')}\n${e.message}`;
			this.core.showToast('Package operation failed', 'error');
		}
		this.loadPackages();
	}

	async loadAdmin() {}

	async loadLogs() {
		await Promise.all([this.loadLog('syslog'), this.loadLog('klog')]);
	}

	async loadLog(kind) {
		const commands = {
			syslog: { command: '/sbin/logread', params: [] },
			klog: { command: '/bin/dmesg', params: [] }
		};
		const output = document.getElementById(`${kind}-output`);
		if (!output) return;
		output.innerHTML = '<div class="log-line">Loading...</div>';
		try {
			const [s, r] = await this.core.ubusCall('file', 'exec', commands[kind], { timeout: 15000 });
			if (s !== 0 || !r || (r.code && r.code !== 0)) throw new Error('Command failed');
			if (!this._logLines) this._logLines = {};
			this._logLines[kind] = (r.stdout || '').split('\n').filter(l => l.trim());
			this.renderLog(kind);
			output.scrollTop = output.scrollHeight;
		} catch {
			output.innerHTML = '<div class="log-line error">Failed to load log</div>';
		}
	}

	renderLog(kind) {
		const output = document.getElementById(`${kind}-output`);
		if (!output || !this._logLines?.[kind]) return;
		const query = (document.getElementById(`${kind}-filter`)?.value || '').toLowerCase();
		const lines = this._logLines[kind].filter(l => !query || l.toLowerCase().includes(query));
		this.core.renderLogLines(output, lines, query ? 'No matching log entries' : 'No logs available');
	}

	async changePassword() {
		const newPw = document.getElementById('new-password').value;
		const confirmPw = document.getElementById('confirm-password').value;
		if (!newPw) {
			this.core.showToast('Password is required', 'error');
			return;
		}
		if (newPw !== confirmPw) {
			this.core.showToast('Passwords do not match', 'error');
			return;
		}
		try {
			const [status, result] = await this.core.ubusCall('moci', 'setPassword', {
				username: 'root',
				password: newPw
			});
			if (status !== 0 || !result?.result) throw new Error('setPassword failed');
			document.getElementById('new-password').value = '';
			document.getElementById('confirm-password').value = '';
			this.core.showToast('Password changed', 'success');
		} catch {
			this.core.showToast('Failed to change password', 'error');
		}
	}

	async loadBackup() {}

	async createBackup() {
		try {
			const [s] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params: ['--create-backup', '/tmp/backup.tar.gz'] },
				{ timeout: 30000 }
			);
			if (s !== 0) throw new Error('Backup failed');

			const [rs, rr] = await this.core.ubusCall('file', 'read', {
				path: '/tmp/backup.tar.gz',
				base64: true
			});
			if (rs !== 0 || !rr?.data) throw new Error('Failed to read backup');

			const binary = atob(rr.data);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

			const blob = new Blob([bytes], { type: 'application/gzip' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
			a.click();
			URL.revokeObjectURL(url);
			this.core.showToast('Backup created', 'success');
		} catch {
			this.core.showToast('Failed to create backup', 'error');
		} finally {
			try {
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/backup.tar.gz'] });
			} catch {}
		}
	}

	async factoryReset() {
		if (!confirm('This will erase all settings and restore factory defaults. Continue?')) return;
		if (!confirm('This action cannot be undone. Are you absolutely sure?')) return;
		try {
			await this.core.ubusCall('file', 'exec', { command: '/sbin/firstboot', params: ['-y'] });
			this.core.showToast('Factory reset initiated, rebooting...', 'success');
			setTimeout(async () => {
				try {
					await this.core.ubusCall('system', 'reboot', {});
					setTimeout(() => this.core.logout(), 2000);
				} catch {}
			}, 2000);
		} catch {
			this.core.showToast('Failed to initiate factory reset', 'error');
		}
	}

	async rebootSystem() {
		if (!confirm('Reboot the system?')) return;
		try {
			await this.core.ubusCall('system', 'reboot', {});
			this.core.showToast('System is rebooting...', 'success');
			setTimeout(() => this.core.logout(), 2000);
		} catch {
			this.core.showToast('Failed to reboot', 'error');
		}
	}

	async loadPackages() {
		await this.core.loadResource('packages-table', 3, 'packages', async () => {
			const out = await this.core.pkgCall('pkg-list-installed');
			const packages = out
				.split('\n')
				.map(l => l.trim().split(' '))
				.filter(([name]) => name)
				.map(([name, version]) => ({ name, version: version || '' }));
			packages.sort((a, b) => a.name.localeCompare(b.name));
			this._packages = packages;
			this.renderPackages();
		});
		const filter = document.getElementById('pkg-filter');
		if (filter && !filter.dataset.bound) {
			filter.dataset.bound = '1';
			filter.addEventListener('input', () => this.renderPackages());
		}
	}

	renderPackages() {
		const q = (document.getElementById('pkg-filter')?.value || '').trim().toLowerCase();
		const all = this._packages || [];
		const list = q ? all.filter(p => p.name.toLowerCase().includes(q)) : all;
		const count = document.getElementById('pkg-count');
		if (count) count.textContent = `${list.length} of ${all.length}`;
		this.core.renderTable(
			'#packages-table',
			list,
			3,
			'No packages found',
			p => `<tr>
				<td>${this.core.escapeHtml(p.name)}</td>
				<td>${this.core.escapeHtml(p.version)}</td>
				<td><button class="action-btn-sm danger" data-action="remove" data-id="${this.core.escapeHtml(p.name)}">REMOVE</button></td>
			</tr>`
		);
	}

	async loadStartup() {
		await this.core.loadResource('services-table', 4, 'services', async () => {
			const [status, result] = await this.core.ubusCall('rc', 'list', {});
			if (status !== 0 || !result) throw new Error('No data');
			const services = Object.entries(result)
				.map(([name, info]) => ({ name, ...info }))
				.sort((a, b) => (a.start ?? 99) - (b.start ?? 99) || a.name.localeCompare(b.name));
			const btn = (action, name, label, danger) =>
				`<button class="action-btn-sm${danger ? ' danger' : ''}" data-action="${action}" data-id="${this.core.escapeHtml(name)}">${label}</button>`;
			this.core.renderTable(
				'#services-table',
				services,
				4,
				'No services found',
				s => `<tr>
				<td>${this.core.escapeHtml(s.name)}${s.start !== undefined ? ` <span style="color:var(--steel-muted);font-size:12px">(${this.core.escapeHtml(s.start)})</span>` : ''}</td>
				<td>${s.running ? this.core.renderBadge('success', 'RUNNING') : this.core.renderBadge('error', 'STOPPED')}</td>
				<td>${s.enabled ? this.core.renderBadge('info', 'ENABLED') : this.core.renderBadge('warning', 'DISABLED')}</td>
				<td><div class="action-buttons">
					${s.running ? btn('restart', s.name, 'RESTART') + btn('stop', s.name, 'STOP', true) : btn('start', s.name, 'START')}
					${s.enabled ? btn('disable', s.name, 'DISABLE') : btn('enable', s.name, 'ENABLE')}
				</div></td>
			</tr>`
			);
		});
	}

	async serviceAction(name, action) {
		if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
			this.core.showToast('Invalid service name', 'error');
			return;
		}
		if ((action === 'stop' || action === 'disable') && !confirm(`${action} ${name}?`)) return;
		try {
			const [st] = await this.core.ubusCall('rc', 'init', { name, action });
			if (st !== 0) throw new Error();
			this.core.showToast(`${name}: ${action} done`, 'success');
		} catch {
			this.core.showToast(`Failed to ${action} ${name}`, 'error');
		}
		setTimeout(() => this.loadStartup(), 800);
	}

	async loadCron() {
		await this.core.loadResource('cron-table', 4, null, async () => {
			try {
				const [s, r] = await this.core.ubusCall('file', 'read', { path: '/etc/crontabs/root' });
				this.cronRaw = s === 0 && r?.data ? r.data : '';
			} catch {
				this.cronRaw = '';
			}

			const entries = this.parseCron(this.cronRaw);
			this.core.renderTable(
				'#cron-table',
				entries,
				4,
				'No scheduled tasks',
				(e, i) => `<tr>
				<td>${this.core.escapeHtml(e.schedule)}</td>
				<td>${this.core.escapeHtml(e.command)}</td>
				<td>${e.enabled ? this.core.renderBadge('success', 'ENABLED') : this.core.renderBadge('error', 'DISABLED')}</td>
				<td>${this.core.renderActionButtons(String(i))}</td>
			</tr>`
			);
		});
	}

	parseCron(data) {
		const result = [];
		data.split('\n').forEach((line, rawIndex) => {
			if (!line.trim()) return;
			const enabled = !line.trim().startsWith('#');
			const clean = line.replace(/^#\s*/, '').trim();
			const parts = clean.split(/\s+/);
			if (parts.length < 6) return;
			result.push({
				schedule: parts.slice(0, 5).join(' '),
				command: parts.slice(5).join(' '),
				enabled,
				minute: parts[0],
				hour: parts[1],
				day: parts[2],
				month: parts[3],
				weekday: parts[4],
				rawIndex
			});
		});
		return result;
	}

	editCronEntry(index) {
		const entries = this.parseCron(this.cronRaw);
		const entry = entries[parseInt(index)];
		if (!entry) return;
		document.getElementById('edit-cron-index').value = index;
		document.getElementById('edit-cron-minute').value = entry.minute;
		document.getElementById('edit-cron-hour').value = entry.hour;
		document.getElementById('edit-cron-day').value = entry.day;
		document.getElementById('edit-cron-month').value = entry.month;
		document.getElementById('edit-cron-weekday').value = entry.weekday;
		document.getElementById('edit-cron-command').value = entry.command;
		document.getElementById('edit-cron-enabled').checked = entry.enabled;
		this.core.openModal('cron-modal');
	}

	async saveCronEntry() {
		const index = document.getElementById('edit-cron-index').value;
		const minute = document.getElementById('edit-cron-minute').value || '*';
		const hour = document.getElementById('edit-cron-hour').value || '*';
		const day = document.getElementById('edit-cron-day').value || '*';
		const month = document.getElementById('edit-cron-month').value || '*';
		const weekday = document.getElementById('edit-cron-weekday').value || '*';
		const command = document.getElementById('edit-cron-command').value.trim();
		const enabled = document.getElementById('edit-cron-enabled').checked;

		if (!command) {
			this.core.showToast('Command is required', 'error');
			return;
		}

		const newLine = `${enabled ? '' : '# '}${minute} ${hour} ${day} ${month} ${weekday} ${command}`;
		const lines = this.cronRaw.split('\n');
		const entries = this.parseCron(this.cronRaw);

		if (index !== '') {
			const entry = entries[parseInt(index)];
			if (entry) lines[entry.rawIndex] = newLine;
		} else {
			if (lines.length && lines[lines.length - 1] === '') lines.pop();
			lines.push(newLine);
		}

		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: lines.join('\n') + (this.cronRaw.endsWith('\n') ? '' : '\n')
			});
			this.core.closeModal('cron-modal');
			this.core.showToast('Cron entry saved', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to save cron entry', 'error');
		}
	}

	async deleteCronEntry(index) {
		if (!confirm('Delete this scheduled task?')) return;
		const entries = this.parseCron(this.cronRaw);
		const entry = entries[parseInt(index)];
		if (!entry) return;
		const lines = this.cronRaw.split('\n');
		lines.splice(entry.rawIndex, 1);
		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/crontabs/root',
				data: lines.join('\n') + (this.cronRaw.endsWith('\n') ? '' : '\n')
			});
			this.core.showToast('Task deleted', 'success');
			this.loadCron();
		} catch {
			this.core.showToast('Failed to delete task', 'error');
		}
	}

	async loadSSHKeys() {
		await this.core.loadResource('ssh-keys-table', 4, 'ssh_keys', async () => {
			try {
				const [s, r] = await this.core.ubusCall('file', 'read', { path: '/etc/dropbear/authorized_keys' });
				this.sshKeysRaw = s === 0 && r?.data ? r.data : '';
			} catch {
				this.sshKeysRaw = '';
			}

			const keys = this.parseSSHKeys(this.sshKeysRaw);
			this.core.renderTable(
				'#ssh-keys-table',
				keys,
				4,
				'No SSH keys',
				(k, i) => `<tr>
				<td>${this.core.escapeHtml(k.type)}</td>
				<td>${this.core.escapeHtml(k.key.substring(0, 30))}...</td>
				<td>${this.core.escapeHtml(k.comment || 'N/A')}</td>
				<td>
					<div class="action-buttons">
						<button class="action-btn-sm danger" data-action="delete" data-id="${i}">DELETE</button>
					</div>
				</td>
			</tr>`
			);
		});
	}

	parseSSHKeys(data) {
		const result = [];
		data.split('\n').forEach((line, rawIndex) => {
			if (!line.trim() || line.startsWith('#')) return;
			const parts = line.trim().split(/\s+/);
			if (!parts[1]) return;
			result.push({
				type: parts[0] || 'unknown',
				key: parts[1],
				comment: parts.slice(2).join(' '),
				rawIndex
			});
		});
		return result;
	}

	parseSSHKeyInput() {
		const textarea = document.getElementById('ssh-key-paste-area');
		const raw = textarea?.value || '';
		const keys = this.parseSSHKeys(raw);

		const preview = document.getElementById('parsed-keys-preview');
		const list = document.getElementById('parsed-keys-list');
		const saveBtn = document.getElementById('save-ssh-keys-btn');

		if (keys.length === 0) {
			this.core.showToast('No valid keys found', 'error');
			return;
		}

		list.innerHTML = keys
			.map(
				(k, i) =>
					`<div style="padding:8px;border-bottom:1px solid var(--slate-border);display:flex;align-items:center;gap:8px">
			<input type="checkbox" id="key-select-${i}" checked />
			<div>
				<div style="font-weight:600;font-size:12px">${this.core.escapeHtml(k.type)} ${this.core.escapeHtml(k.comment || 'No comment')}</div>
				<div style="font-size:11px;color:var(--steel-muted)">${this.core.escapeHtml(k.key.substring(0, 40))}...</div>
			</div>
		</div>`
			)
			.join('');

		preview.style.display = 'block';
		saveBtn.style.display = 'inline-block';
		this._parsedKeys = keys;
	}

	async saveSSHKeys() {
		const keys = this._parsedKeys || [];
		const selected = keys.filter((_, i) => document.getElementById(`key-select-${i}`)?.checked);

		if (selected.length === 0) {
			this.core.showToast('No keys selected', 'error');
			return;
		}

		const newLines = selected.map(k => `${k.type} ${k.key}${k.comment ? ' ' + k.comment : ''}`);
		const existing = this.sshKeysRaw.trim();
		const combined = existing ? existing + '\n' + newLines.join('\n') + '\n' : newLines.join('\n') + '\n';

		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: combined
			});
			this.core.closeModal('ssh-key-modal');
			this.core.showToast(`${selected.length} key(s) added`, 'success');
			this.loadSSHKeys();
		} catch {
			this.core.showToast('Failed to save SSH keys', 'error');
		}
	}

	async deleteSSHKey(index) {
		if (!confirm('Remove this SSH key?')) return;
		const keys = this.parseSSHKeys(this.sshKeysRaw);
		const entry = keys[parseInt(index)];
		if (!entry) return;
		const lines = this.sshKeysRaw.split('\n');
		lines.splice(entry.rawIndex, 1);
		const newContent = lines.join('\n') + (this.sshKeysRaw.endsWith('\n') ? '' : '\n');
		try {
			await this.core.ubusCall('file', 'write', {
				path: '/etc/dropbear/authorized_keys',
				data: newContent
			});
			this.core.showToast('SSH key removed', 'success');
			this.loadSSHKeys();
		} catch {
			this.core.showToast('Failed to remove SSH key', 'error');
		}
	}

	async loadMounts() {
		await this.core.loadResource('mounts-table', 6, 'storage', async () => {
			const [s, r] = await this.core.ubusCall('file', 'exec', { command: '/bin/df', params: ['-h'] });
			if (s !== 0 || !r?.stdout) throw new Error('No data');

			const mounts = r.stdout
				.split('\n')
				.slice(1)
				.filter(l => l.trim())
				.map(line => {
					const parts = line.trim().split(/\s+/);
					return {
						device: parts[0],
						size: parts[1],
						used: parts[2],
						available: parts[3],
						usePercent: parts[4],
						mountPoint: parts[5]
					};
				});

			const charts = document.getElementById('storage-charts');
			if (charts) {
				charts.innerHTML = mounts
					.filter(m => m.mountPoint !== '/dev')
					.map(
						m => `<div style="padding:12px;background:var(--slate-bg);border-radius:6px">
					<div style="font-weight:600;font-size:12px;margin-bottom:8px">${this.core.escapeHtml(m.mountPoint)}</div>
					<div class="progress-bar" style="margin-bottom:8px">
						<div class="progress-fill" style="width:${this.core.escapeHtml(m.usePercent)}"></div>
					</div>
					<div style="font-size:11px;color:var(--steel-muted)">${this.core.escapeHtml(m.used)} / ${this.core.escapeHtml(m.size)} (${this.core.escapeHtml(m.usePercent)})</div>
				</div>`
					)
					.join('');
			}

			this.core.renderTable(
				'#mounts-table',
				mounts,
				6,
				'No mount points',
				m => `<tr>
				<td>${this.core.escapeHtml(m.device)}</td>
				<td>${this.core.escapeHtml(m.mountPoint)}</td>
				<td>N/A</td>
				<td>${this.core.escapeHtml(m.size)}</td>
				<td>${this.core.escapeHtml(m.used)}</td>
				<td>${this.core.escapeHtml(m.available)}</td>
			</tr>`
			);
		});
	}

	async loadLED() {
		await this.core.loadResource('led-table', 3, 'leds', async () => {
			const [status, result] = await this.core.uciGet('system');
			if (status !== 0 || !result?.values) throw new Error('No data');

			const leds = this.core.filterUciSections(result.values, 'led');
			this.core.renderTable(
				'#led-table',
				leds,
				3,
				'No LEDs configured',
				l => `<tr>
				<td>${this.core.escapeHtml(l.sysfs || l.section)}</td>
				<td>${this.core.escapeHtml(l.trigger || 'default-on')}</td>
				<td>${this.core.renderBadge('info', 'CONFIGURED')}</td>
			</tr>`
			);
		});
	}

	setupFirmwareUpload() {
		const fileInput = document.getElementById('firmware-file');
		const uploadArea = document.getElementById('file-upload-area');
		const validateBtn = document.getElementById('validate-firmware-btn');
		const flashBtn = document.getElementById('flash-firmware-btn');

		if (!fileInput || !uploadArea) return;

		uploadArea.addEventListener('click', () => fileInput.click());

		uploadArea.addEventListener('dragover', e => {
			e.preventDefault();
			uploadArea.style.borderColor = 'var(--starship-steel)';
		});

		uploadArea.addEventListener('dragleave', () => {
			uploadArea.style.borderColor = 'var(--slate-border)';
		});

		uploadArea.addEventListener('drop', e => {
			e.preventDefault();
			uploadArea.style.borderColor = 'var(--slate-border)';
			if (e.dataTransfer.files.length) this.handleFirmwareFile(e.dataTransfer.files[0]);
		});

		fileInput.addEventListener('change', () => {
			if (fileInput.files.length) this.handleFirmwareFile(fileInput.files[0]);
		});

		validateBtn?.addEventListener('click', () => this.validateFirmware());
		flashBtn?.addEventListener('click', () => this.flashFirmware());
	}

	handleFirmwareFile(file) {
		this.firmwareFile = file;
		const uploadText = document.getElementById('file-upload-text');
		const info = document.getElementById('firmware-info');
		const details = document.getElementById('firmware-details');
		const validateBtn = document.getElementById('validate-firmware-btn');

		if (uploadText) uploadText.textContent = file.name;
		if (info) info.style.display = 'block';
		if (details) {
			details.textContent = `File: ${file.name}\nSize: ${this.core.formatBytes(file.size)}\nType: ${file.type || 'application/octet-stream'}`;
		}
		if (validateBtn) validateBtn.disabled = false;
	}

	async uploadFirmwareChunked() {
		if (!this.firmwareFile) throw new Error('No file selected');
		const CHUNK_SIZE = 65536;
		const reader = new FileReader();

		const readChunk = blob =>
			new Promise((resolve, reject) => {
				reader.onload = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsArrayBuffer(blob);
			});

		const total = this.firmwareFile.size;
		let offset = 0;

		while (offset < total) {
			const chunk = this.firmwareFile.slice(offset, offset + CHUNK_SIZE);
			const buffer = await readChunk(chunk);
			const bytes = new Uint8Array(buffer);
			const parts = [];
			const batchSize = 8192;
			for (let i = 0; i < bytes.length; i += batchSize) {
				parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + batchSize)));
			}
			const b64 = btoa(parts.join(''));

			await this.core.ubusCall(
				'file',
				'write',
				{
					path: '/tmp/firmware.bin',
					data: b64,
					base64: true,
					...(offset > 0 ? { append: true } : {})
				},
				{ timeout: 30000 }
			);
			offset += CHUNK_SIZE;
		}
	}

	async validateFirmware() {
		const statusEl = document.getElementById('upgrade-status');
		const progress = document.getElementById('upgrade-progress');
		const flashBtn = document.getElementById('flash-firmware-btn');

		if (progress) progress.style.display = 'block';
		if (statusEl) statusEl.textContent = 'Uploading firmware...';

		try {
			await this.uploadFirmwareChunked();
			if (statusEl) statusEl.textContent = 'Validating firmware...';

			const [s, r] = await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params: ['--test', '/tmp/firmware.bin'] },
				{ timeout: 30000 }
			);

			if (s !== 0 || (r?.code && r.code !== 0)) {
				const err = r?.stderr || r?.stdout || 'Validation failed';
				if (statusEl) statusEl.textContent = 'Validation failed: ' + err;
				this.core.showToast('Firmware validation failed', 'error');
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin'] });
				return;
			}

			if (statusEl) statusEl.textContent = 'Firmware validated successfully. Ready to flash.';
			if (flashBtn) flashBtn.disabled = false;
			this.core.showToast('Firmware validated', 'success');
		} catch {
			if (statusEl) statusEl.textContent = 'Upload or validation failed';
			this.core.showToast('Firmware validation failed', 'error');
			try {
				await this.core.ubusCall('file', 'exec', { command: '/bin/rm', params: ['-f', '/tmp/firmware.bin'] });
			} catch {}
		}
	}

	async flashFirmware() {
		if (!confirm('Flash firmware now? The device will reboot.')) return;
		if (!confirm('This will replace the firmware. Proceed?')) return;

		const statusEl = document.getElementById('upgrade-status');
		const keepSettings = document.getElementById('keep-settings')?.checked;
		const params = keepSettings ? ['/tmp/firmware.bin'] : ['-n', '/tmp/firmware.bin'];

		if (statusEl) statusEl.textContent = 'Flashing firmware... Do not power off the device.';

		try {
			await this.core.ubusCall(
				'file',
				'exec',
				{ command: '/sbin/sysupgrade', params },
				{ timeout: 120000, retries: 0 }
			);
			if (statusEl) statusEl.textContent = 'Firmware flashed. Device is rebooting...';
			this.core.showToast('Firmware flashed, device rebooting...', 'success');
		} catch {
			if (statusEl) statusEl.textContent = 'Flash initiated. Device should be rebooting...';
		}
	}

	loadUpgrade() {}
}
