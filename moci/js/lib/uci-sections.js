// Table + edit modal for one type of UCI section, driven by a field list.
// Only the fields listed are written; options not in the list are kept, cleared fields are
// deleted and booleans equal to their default are left unset (like LuCI).
//
// field: { key, label, type: text|password|number|bool|select|list|multi, def, placeholder,
//          options: [[value, label]] | (cfg) => [[value, label]], help }
//   list  = space/comma separated text stored as a UCI list
//   multi = ordered choice of options stored as a UCI list (order is kept)

const fieldOptions = (f, cfg) => (typeof f.options === 'function' ? f.options(cfg) : f.options || []);

// HTML for a list of fields; ids are `${uid}-f-${key}`
export function renderFields(core, uid, fields, values, cfg) {
	const esc = v => core.escapeHtml(v ?? '');
	return fields
		.map(f => {
			const fid = `${uid}-f-${f.key}`;
			const raw = values[f.key];
			const help = f.help
				? `<div style="color:var(--steel-muted);font-size:12px;margin-top:4px">${f.help}</div>`
				: '';
			if (f.type === 'bool') {
				const on = (raw ?? f.def ?? '0') === '1';
				return `<div class="form-group"><label class="form-label"><input type="checkbox" id="${fid}" ${on ? 'checked' : ''} /> ${esc(f.label)}</label>${help}</div>`;
			}
			let input;
			if (f.type === 'select') {
				let opts = fieldOptions(f, cfg);
				const cur = raw ?? f.def ?? opts[0]?.[0] ?? '';
				if (!opts.some(([v]) => v === cur)) opts = [...opts, [cur, cur]];
				input = `<select class="form-input" id="${fid}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
			} else if (f.type === 'multi') {
				input = `<div id="${fid}"></div>`;
			} else if (f.type === 'textarea') {
				const val = Array.isArray(raw) ? raw.join('\n') : (raw ?? '');
				input = `<textarea class="form-input" id="${fid}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder ?? '')}">${esc(val)}</textarea>`;
			} else {
				const val = Array.isArray(raw) ? raw.join(' ') : (raw ?? '');
				const type = f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text';
				input = `<input class="form-input" type="${type}" id="${fid}" value="${esc(val)}" placeholder="${esc(f.placeholder ?? f.def ?? '')}" autocomplete="off" />`;
			}
			return `<div class="form-group"><label class="form-label">${esc(f.label)}</label>${input}${help}</div>`;
		})
		.join('');
}

// comboboxes for 'multi' fields, after renderFields' HTML is in the DOM
export function initFieldCombos(core, uid, fields, values, cfg) {
	const combos = {};
	for (const f of fields.filter(f => f.type === 'multi')) {
		const combo = core.createCombobox(`${uid}-f-${f.key}`, { placeholder: f.placeholder || 'Choose...' });
		combo.setOptions(fieldOptions(f, cfg).map(([v]) => v));
		const cur = values[f.key];
		combo.setSelected(Array.isArray(cur) ? cur : cur ? [cur] : []);
		combos[f.key] = combo;
	}
	return combos;
}

// { values to set, option names to delete } relative to the existing section values
export function collectFields(uid, fields, existing, cfg, combos = {}) {
	const values = {};
	const remove = [];
	for (const f of fields) {
		if (f.type === 'multi') {
			const sel = combos[f.key]?.getSelected() || [];
			if (sel.length) values[f.key] = sel;
			else remove.push(f.key);
			continue;
		}
		const el = document.getElementById(`${uid}-f-${f.key}`);
		if (!el) continue;
		if (f.type === 'bool') {
			const v = el.checked ? '1' : '0';
			if (v === (f.def ?? '0') && existing[f.key] === undefined) continue;
			values[f.key] = v;
			continue;
		}
		const v = el.value.trim();
		if (f.type === 'select' && existing[f.key] === undefined && v === (f.def ?? fieldOptions(f, cfg)[0]?.[0]))
			continue;
		if (v === '') remove.push(f.key);
		else if (f.type === 'list') values[f.key] = v.split(/[\s,]+/).filter(Boolean);
		else if (f.type === 'textarea' && f.list)
			values[f.key] = v
				.split('\n')
				.map(l => l.trim())
				.filter(Boolean);
		else values[f.key] = v;
	}
	return { values, remove: remove.filter(k => existing[k] !== undefined) };
}

export class UciSectionTable {
	constructor(core, opts) {
		this.core = core;
		this.o = { named: false, addLabel: '+ ADD', ...opts };
		this.uid = `ust-${opts.config}-${opts.type}-${Math.random().toString(36).slice(2, 7)}`;
		this.cfg = {};
		this.combos = {};
	}

	esc(v) {
		return this.core.escapeHtml(v ?? '');
	}

	sections() {
		return this.core.filterUciSections(this.cfg, this.o.type);
	}

	// cfg = result.values of uci get for the whole config
	render(cfg) {
		this.cfg = cfg || {};
		const el = typeof this.o.container === 'string' ? document.getElementById(this.o.container) : this.o.container;
		if (!el) return;
		if (!el.dataset.ust) {
			el.dataset.ust = this.uid;
			el.innerHTML = `
				${this.o.title ? `<div class="section-title">${this.esc(this.o.title)}</div>` : ''}
				${this.o.help ? `<p style="color:var(--steel-muted);font-size:13px;margin-bottom:12px">${this.o.help}</p>` : ''}
				${this.o.readonly ? '' : `<button class="action-btn" id="${this.uid}-add" style="margin-bottom:16px">${this.esc(this.o.addLabel)}</button>`}
				<table class="data-table" id="${this.uid}-table">
					<thead><tr>${this.o.columns.map(c => `<th>${this.esc(c.label)}</th>`).join('')}${this.o.readonly ? '' : '<th>ACTIONS</th>'}</tr></thead>
					<tbody></tbody>
				</table>`;
			this.ensureModal();
			document.getElementById(`${this.uid}-add`)?.addEventListener('click', () => this.open(null));
			this.core.delegateActions(`${this.uid}-table`, {
				edit: id => this.open(id),
				delete: id => this.remove(id),
				up: id => this.move(id, -1),
				down: id => this.move(id, 1)
			});
		}
		const cols = this.o.columns.length + (this.o.readonly ? 0 : 1);
		const rows = this.sections();
		this.core.renderTable(`#${this.uid}-table`, rows, cols, this.o.empty || 'Nothing configured', s => {
			const id = this.esc(s.section);
			const order = this.o.sortable
				? `<button class="action-btn-sm" data-action="up" data-id="${id}" title="Move up">&uarr;</button><button class="action-btn-sm" data-action="down" data-id="${id}" title="Move down">&darr;</button>`
				: '';
			const actions = this.o.readonly
				? ''
				: `<td><div class="action-buttons">${order}${this.core.renderActionButtons(s.section)}</div></td>`;
			return `<tr>${this.o.columns.map(c => `<td>${c.render ? c.render(s, this) : this.esc(this.fmt(s[c.key]))}</td>`).join('')}${actions}</tr>`;
		});
	}

	fmt(v) {
		if (Array.isArray(v)) return v.join(', ');
		return v === undefined || v === '' ? '-' : v;
	}

	ensureModal() {
		if (document.getElementById(`${this.uid}-modal`)) return;
		const m = document.createElement('div');
		m.className = 'modal hidden';
		m.id = `${this.uid}-modal`;
		m.innerHTML = `<div class="modal-backdrop"></div>
			<div class="modal-content">
				<div class="modal-header"><h3 class="modal-title" id="${this.uid}-title"></h3>
					<button class="modal-close" id="${this.uid}-close">&times;</button></div>
				<div class="modal-body" id="${this.uid}-body"></div>
				<div class="modal-footer">
					<button class="action-btn" id="${this.uid}-cancel">CANCEL</button>
					<button class="action-btn" id="${this.uid}-save">SAVE</button>
				</div>
			</div>`;
		document.body.appendChild(m);
		const close = () => this.core.closeModal(m.id);
		document.getElementById(`${this.uid}-close`).addEventListener('click', close);
		document.getElementById(`${this.uid}-cancel`).addEventListener('click', close);
		m.querySelector('.modal-backdrop').addEventListener('click', close);
		document.getElementById(`${this.uid}-save`).addEventListener('click', () => this.save());
	}

	open(id) {
		this.editing = id;
		const values = id ? this.cfg[id] || {} : { ...(this.o.defaults || {}) };
		this.current = values;
		document.getElementById(`${this.uid}-title`).textContent = id
			? `${this.o.noun || this.o.type} ${id}`.toUpperCase()
			: `ADD ${this.o.noun || this.o.type}`.toUpperCase();
		const body = document.getElementById(`${this.uid}-body`);
		const nameField =
			!id && this.o.named
				? `<div class="form-group"><label class="form-label">NAME</label><input class="form-input" id="${this.uid}-name" placeholder="letters, digits, _" /></div>`
				: '';
		body.innerHTML = nameField + renderFields(this.core, this.uid, this.o.fields, values, this.cfg);
		this.combos = initFieldCombos(this.core, this.uid, this.o.fields, values, this.cfg);
		this.core.openModal(`${this.uid}-modal`);
	}

	collect() {
		return collectFields(this.uid, this.o.fields, this.current || {}, this.cfg, this.combos);
	}

	async save() {
		const { values, remove } = this.collect();
		if (this.o.validate) {
			const err = this.o.validate(values, this.editing);
			if (err) {
				this.core.showToast(err, 'error');
				return;
			}
		}
		let id = this.editing;
		try {
			if (!id) {
				let name = null;
				if (this.o.named) {
					name = document.getElementById(`${this.uid}-name`).value.trim();
					if (!/^[a-zA-Z0-9_]+$/.test(name)) {
						this.core.showToast('Name: letters, digits and _ only', 'error');
						return;
					}
					if (this.cfg[name]) {
						this.core.showToast(`"${name}" already exists`, 'error');
						return;
					}
				}
				const [st, res] = await this.core.uciAdd(this.o.config, this.o.type, name);
				if (st !== 0 || !res?.section) throw new Error('add failed');
				id = res.section;
			}
			if (Object.keys(values).length) await this.core.uciSet(this.o.config, id, values);
			for (const key of remove) await this.core.uciDelete(this.o.config, id, key);
			await this.commit();
			this.core.closeModal(`${this.uid}-modal`);
			this.core.showToast('Saved', 'success');
		} catch (e) {
			console.error(e);
			this.core.showToast('Failed to save', 'error');
		}
	}

	async remove(id) {
		if (!confirm(`Delete ${this.o.noun || this.o.type} "${id}"?`)) return;
		try {
			await this.core.uciDelete(this.o.config, id);
			await this.commit();
			this.core.showToast('Deleted', 'success');
		} catch {
			this.core.showToast('Failed to delete', 'error');
		}
	}

	// reorder among sections of this type (first match wins for mwan3 rules, firewall, ...)
	async move(id, dir) {
		const list = this.sections().map(s => s.section);
		const i = list.indexOf(id);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= list.length) return;
		const all = Object.keys(this.cfg).sort((a, b) => this.cfg[a]['.index'] - this.cfg[b]['.index']);
		const order = all.filter(k => k !== id);
		const target = list[j];
		const at = order.indexOf(target) + (dir > 0 ? 1 : 0);
		order.splice(at, 0, id);
		try {
			await this.core.ubusCall('uci', 'order', { config: this.o.config, sections: order });
			await this.commit();
		} catch {
			this.core.showToast('Failed to reorder', 'error');
		}
	}

	async commit() {
		await this.core.uciCommit(this.o.config);
		if (this.o.onChange) await this.o.onChange();
	}
}

// Inline settings form for ONE existing (or to-be-created) named section.
export class UciSectionForm {
	constructor(core, opts) {
		this.core = core;
		this.o = { saveLabel: 'SAVE', ...opts };
		this.uid = `usf-${opts.config}-${opts.section}-${Math.random().toString(36).slice(2, 7)}`;
		this.combos = {};
	}

	// cfg = result.values of uci get for the whole config
	render(cfg) {
		this.cfg = cfg || {};
		const el = typeof this.o.container === 'string' ? document.getElementById(this.o.container) : this.o.container;
		if (!el) return;
		this.current = this.cfg[this.o.section] || {};
		const esc = v => this.core.escapeHtml(v ?? '');
		el.innerHTML = `
			${this.o.title ? `<div class="section-title">${esc(this.o.title)}</div>` : ''}
			${this.o.help ? `<p style="color:var(--steel-muted);font-size:13px;margin-bottom:12px">${this.o.help}</p>` : ''}
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${this.o.minColumn || 260}px,1fr));gap:0 16px">
				${renderFields(this.core, this.uid, this.o.fields, this.current, this.cfg)}
			</div>
			<button class="action-btn" id="${this.uid}-save">${esc(this.o.saveLabel)}</button>`;
		this.combos = initFieldCombos(this.core, this.uid, this.o.fields, this.current, this.cfg);
		document.getElementById(`${this.uid}-save`).addEventListener('click', () => this.save());
	}

	async save() {
		const { values, remove } = collectFields(this.uid, this.o.fields, this.current, this.cfg, this.combos);
		if (this.o.validate) {
			const err = this.o.validate(values);
			if (err) {
				this.core.showToast(err, 'error');
				return;
			}
		}
		try {
			if (!this.cfg[this.o.section]) {
				const [st] = await this.core.uciAdd(this.o.config, this.o.type, this.o.section);
				if (st !== 0) throw new Error('create failed');
			}
			if (Object.keys(values).length) await this.core.uciSet(this.o.config, this.o.section, values);
			for (const key of remove) await this.core.uciDelete(this.o.config, this.o.section, key);
			await this.core.uciCommit(this.o.config);
			if (this.o.onChange) await this.o.onChange();
			this.core.showToast('Saved', 'success');
		} catch (e) {
			console.error(e);
			this.core.showToast('Failed to save', 'error');
		}
	}
}
