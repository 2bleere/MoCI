// Status badge + enable/start/stop/restart buttons for one init script, using rpcd's rc object.
export class ServiceControl {
	constructor(core, name, { label, onChange } = {}) {
		this.core = core;
		this.name = name;
		this.label = label || name;
		this.onChange = onChange;
		this.uid = `svc-${name}-${Math.random().toString(36).slice(2, 7)}`;
	}

	async state() {
		const [st, res] = await this.core.ubusCall('rc', 'list', { name: this.name }).catch(() => [1]);
		const s = st === 0 ? res?.[this.name] : null;
		return s ? { installed: true, enabled: !!s.enabled, running: !!s.running } : { installed: false };
	}

	async render(container) {
		const el = typeof container === 'string' ? document.getElementById(container) : container;
		if (!el) return;
		const s = await this.state();
		const esc = v => this.core.escapeHtml(v);
		if (!s.installed) {
			el.innerHTML = `<div class="stat-card" style="margin-bottom:16px">${esc(this.label)} is not installed.</div>`;
			return;
		}
		const b = (action, text, danger) =>
			`<button class="action-btn-sm${danger ? ' danger' : ''}" data-svc="${action}">${text}</button>`;
		el.innerHTML = `<div class="stat-card" style="margin-bottom:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
			<div><div class="stat-label">${esc(this.label.toUpperCase())}</div>
				${s.running ? this.core.renderBadge('success', 'RUNNING') : this.core.renderBadge('error', 'STOPPED')}
				${s.enabled ? this.core.renderBadge('info', 'STARTS AT BOOT') : this.core.renderBadge('warning', 'NOT AT BOOT')}</div>
			<div class="action-buttons" style="margin-left:auto">
				${s.enabled ? b('disable', 'DISABLE AT BOOT') : b('enable', 'ENABLE AT BOOT')}
				${s.running ? b('restart', 'RESTART') + b('stop', 'STOP', true) : b('start', 'START')}
			</div>
		</div>`;
		el.querySelectorAll('[data-svc]').forEach(btn =>
			btn.addEventListener('click', () => this.action(btn.dataset.svc, el))
		);
	}

	async action(action, el) {
		if (action === 'stop' && !confirm(`Stop ${this.label}?`)) return;
		try {
			const [st] = await this.core.ubusCall('rc', 'init', { name: this.name, action });
			if (st !== 0) throw new Error(`rc ${action} failed`);
			this.core.showToast(`${this.label}: ${action} done`, 'success');
		} catch (e) {
			this.core.showToast(e.message, 'error');
		}
		await new Promise(r => setTimeout(r, 1000));
		await this.render(el);
		if (this.onChange) this.onChange(action);
	}

	// apply a config change: reload if running, otherwise leave it stopped
	async reloadIfRunning() {
		const s = await this.state();
		if (s.running) await this.core.ubusCall('rc', 'init', { name: this.name, action: 'reload' }).catch(() => {});
	}
}
