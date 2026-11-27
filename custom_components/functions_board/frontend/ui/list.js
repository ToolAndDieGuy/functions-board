import { P, T, VERSION, cssColor, esc } from '../lib/index.js';

export const listPart = {
    /* ======================================================================================================
       part: list: the list of functions: drawing it, its search and its menus Owns _findQ (PARTS): only its own
       methods use them; the other parts ask its methods.
       ====================================================================================================== */
    _fnName(label) { const l = this._labelMap.get(label); return l ? l.name : label; },

    // the list's search, typed into
    _findClear() { this._findQ = ''; this._renderList(); },
    _findInput(t) { if (!t.classList.contains('find')) return false; this._findQ = t.value; this._clock.after('find', 120, () => this._renderList()); return true; },
    _renderList() {
      if (!this._data) return;
      this._$.board.classList.toggle('nolist', this._compact ? !this._listOpen : !this._data.ui.list);
      const items = this._data.functions.map((lid) => {
        const l = this._labelMap.get(lid);
        if (!l) return '';
        const mem = this._ents.filter((e) => (e.labels || []).includes(lid));
        const devs = this._devs.filter((d) => (d.labels || []).includes(lid)).length;
        const unav = mem.some((e) => this._hass.states[e.entity_id] && this._hass.states[e.entity_id].state === 'unavailable');
        const txt = [this._countText(mem.map((e) => e.entity_id)), devs ? P('n_devices', devs) : ''].filter(Boolean).join(' · ');
        return `<div class="fnrow"><button class="fn ${lid === this._data.ui.current ? 'cur' : ''}" data-fn="${esc(lid)}"><ha-icon icon="${esc(l.icon || 'mdi:puzzle-outline')}" style="color:${cssColor(l.color)}"></ha-icon><span class="fnt"><span class="fnn">${esc(l.name)}</span><span class="fnc">${esc(txt) || 'empty'}</span></span>${this._probCount(lid) ? this._probBadge(this._probCount(lid)) : unav ? `<span class="dot warn" title="${T('something_in_this_function_is')}"></span>` : ''}</button><button class="ib fnmore" data-act="fn-menu" data-label="${esc(lid)}" title="${T('edit_hide_or_delete', { name: esc(l.name) })}"><ha-icon icon="mdi:dots-vertical"></ha-icon></button></div>`;
      }).join('');
      const act = this.shadowRoot.activeElement, typing = act && act.classList && act.classList.contains('find'), caret = typing ? act.selectionStart : 0;
      this._put(this._$.list, `<div class="lhead"><span>${T('functions')}</span><span><button data-act="import" title="${T('import_find_the_functions_already')}"><ha-icon icon="mdi:import"></ha-icon></button><button data-act="newfn" title="${T('new_empty_function')}"><ha-icon icon="mdi:plus"></ha-icon></button></span></div><div class="lfind"><ha-icon icon="mdi:magnify"></ha-icon><input class="find" placeholder="${T('find_an_automation_helper_device')}" value="${esc(this._findQ || '')}" aria-label="${T('find_anything')}">${this._findQ ? `<button class="ib" data-act="find-x" title="${T('clear')}"><ha-icon icon="mdi:close"></ha-icon></button>` : ''}</div><div class="fns">${this._findQ ? this._findHTML() : items || `<div class="muted pad">${T('no_functions_yet_press_import')}</div>`}</div><div class="lfoot"><button class="lbtn" data-act="import"><ha-icon icon="mdi:import"></ha-icon>${T('import_manager')}</button><div class="ver"><span>${T('functions_board_v', { version: VERSION })}</span><button class="ib" data-act="about" title="${T('about_and_what_the_board')}"><ha-icon icon="mdi:help-circle-outline"></ha-icon></button></div></div>`);
      if (typing) { const f = this._$.list.querySelector('.find'); if (f) { f.focus(); f.setSelectionRange(caret, caret); } }
    },
    // find anything across the whole system, and where it lives (4.4)
    _findHTML() {
      const terms = String(this._findQ || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return '';
      const rank = { automation: 0, script: 1, helpers: 2, devices: 3, entities: 4 };
      const rows = this._pickIndex().filter((r) => !r.diag && terms.every((t) => r.hay.includes(t)))
        .map((r) => ({ r, s: r.name.toLowerCase().startsWith(terms[0]) ? 0 : 1 }))
        .sort((x, y) => x.s - y.s || rank[x.r.type] - rank[y.r.type] || x.r.name.localeCompare(y.r.name)).slice(0, 40).map((x) => x.r);
      if (!rows.length) return `<div class="muted pad">${T('nothing_matches')}</div>`;
      const fset = new Set(this._data.functions);
      return rows.map((r) => {
        const fns = r.labels.filter((l) => fset.has(l));
        return `<div class="fres"><button class="fgo" data-act="find-go" data-key="${esc(r.key)}" title="${fns.length ? T('open_it_on_its_board') : T('in_no_function_yet')}">`
          + `<span class="tag">${esc(r.tag)}</span><span class="mn"><b>${esc(r.name)}</b><small>${esc(r.key.startsWith('device:') ? r.sub : r.key)}</small></span></button>`
          + `<div class="fin">${fns.length ? fns.map((l) => `<button class="chip" data-act="find-in" data-key="${esc(r.key)}" data-label="${esc(l)}">${esc(this._fnName(l))}</button>`).join('')
            : `<span class="muted small">${T('in_no_function')}</span><button class="chip" data-act="find-add" data-key="${esc(r.key)}">${T('add_to_3')}</button>`}</div></div>`;
      }).join('');
    },
    _findGo(key, label) {
      const r = this._pickIndex().find((x) => x.key === key);
      const fns = r ? r.labels.filter((l) => this._data.functions.includes(l)) : [];
      const to = label || (fns.includes(this._data.ui.current) ? this._data.ui.current : fns[0]);
      if (!to) return false;
      if (this._compact) this._listOpen = false;
      this._closeDrawer();
      if (to === this._data.ui.current && this._model && this._model.nodes.has(key)) { this._select(key); this._centerOn(key); this._renderList(); return true; }
      this._pendingSelect = key;
      this._open(to);
      return true;
    },
    _findAdd(btn, key) {
      this._menu(btn, this._data.functions.map((l) => ({ act: 'find-to', data: { key, label: l }, icon: (this._labelMap.get(l) || {}).icon || 'mdi:puzzle-outline', text: this._fnName(l) })), T('add_to_2'));
    },
    async _findTo(key, label) {
      this._closeMenu();
      const r = await this._labelMany([key], label, true);
      if (!r.done.length) { this._toast(T('could_not_add_2', { why: (r.skipped[0] || {}).why || '' })); return; }
      await this._loadRegistries();
      this._pidx = null;
      this._toast(T('added_to_4', { fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
      this._findGo(key, label);
    },

    /* ---------- hide and delete (8.2): kept visibly apart, each with its own words ---------- */
    _fnMenu(btn, label) {
      if (this._menuEl && this._menuAnchor === btn) { this._closeMenu(); return; }
      const full = this._full(), off = T('full_manager_only_switch_it');
      this._menu(btn, [
        { act: 'fnm-edit', data: { label }, icon: 'mdi:pencil-outline', text: T('edit_name_icon_colour') },
        { act: 'fnm-hide', data: { label }, icon: 'mdi:eye-off-outline', text: T('hide_from_board'), title: T('the_label_everything_in_it') },
        { sep: true },
        { act: 'fnm-del', data: { label }, icon: 'mdi:label-off-outline', text: T('delete_function_2'), disabled: !full, title: full ? T('deletes_the_label_and_the') : off },
        { act: 'fnm-delall', data: { label }, icon: 'mdi:delete-outline', text: T('delete_function_and_its_items'), disabled: !full, title: full ? T('also_deletes_its_automations_scripts') : off },
      ], this._fnName(label));
    },

};
