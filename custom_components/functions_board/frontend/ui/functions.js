import { CAPTURE_KEY, COLORS, HELPER_DOMAINS, HELPER_PLATFORMS, HELPER_TYPES, P, T, VER_HELPERS, anchor, clash, esc, exportFunctionPackage } from '../lib/index.js';

export const functionsPart = {
    /* ======================================================================================================
       part: functions: making, editing, hiding and deleting functions; labelling what's made in the editor drawer
       Owns _watch, _fnIcon, _fnColor, _shareData (PARTS): only its own methods use them; the other parts ask its methods.
       ====================================================================================================== */
    // something was created in the editor drawer: give it the function's label and keep an eye on it
    // something just made in the editor drawer, labelled and watched for a while (its id may change)
    _isWatched(id) { return this._watch.has(id); },
    async _captured(id, c) {
      const w = { label: c.label, until: Date.now() + 20000, cat: null };
      this._watch.set(id, w);
      this._clock.after('watch:' + id, 20500, () => { if (this._watch.get(id) === w) this._watch.delete(id); });
      try {
        const u = await this._label(id, c.label, true, true);
        w.cat = u.cat;
        this._labelStep(T('add_to_6', { id, fnName: this._fnName(c.label) }), c.label, [u]);
        this._toast(T('added_to_5', { fnName: this._fnName(c.label), id }), [{ text: T('undo'), fn: () => this._undo() }]);
      } catch (e) { this._toast(T('created_but_could_not_label', { id })); }
    },
    // Home Assistant's automation and script editors write the labels, category and area from their save
    // dialog just after a new item is created. That wipes the label the board added, so put it back (and the
    // category, if the dialog left it empty) for 20 seconds after creation, keeping whatever the dialog set.
    async _rewatch(id) {
      const w = this._watch.get(id);
      if (!w || Date.now() > w.until) { this._watch.delete(id); return; }
      const reg = await this._ws({ type: 'config/entity_registry/get', entity_id: id }, { optional: 'an entity set up in YAML has no registry entry', fallback: null });
      if (!reg) return;
      const labels = reg.labels || [], cats = reg.categories || {};
      const msg = { type: 'config/entity_registry/update', entity_id: id };
      if (!labels.includes(w.label)) msg.labels = labels.concat([w.label]);
      if (w.cat && !cats[w.cat[0]]) msg.categories = { [w.cat[0]]: w.cat[1] };
      if (msg.labels || msg.categories) await this._ws(msg, { fallback: null });
    },
    // Add or remove a function's label on one item. Returns what changed, so it can be undone:
    // { id, label, add, had, cat: [scope, category_id] when it also filed the item under the function's category }
    async _label(id, label, add, withCat) {
      if (id.startsWith('device:')) {
        const did = id.slice(7), dev = this._devMap.get(did);
        const labels = new Set((dev && dev.labels) || []), had = labels.has(label);
        if (add) labels.add(label); else labels.delete(label);
        const r = await this._ws({ type: 'config/device_registry/update', device_id: did, labels: [...labels] });
        if (r && r.id) this._devMap.set(r.id, r);  // a second quick change starts from this one, not the cached list
        return { id, label, add, had };
      }
      const reg = await this._ws({ type: 'config/entity_registry/get', entity_id: id });
      const labels = new Set(reg.labels || []), had = labels.has(label);
      if (add) labels.add(label); else labels.delete(label);
      const msg = { type: 'config/entity_registry/update', entity_id: id, labels: [...labels] };
      const cats = this._layout(label).categories;
      let cat = null;
      if (add && withCat && cats) {
        const scope = this._scopeOf(id) || (HELPER_PLATFORMS.has(reg.platform) ? 'helpers' : null);
        const cur = reg.categories || {};
        if (scope && cats[scope] && !cur[scope]) { msg.categories = { [scope]: cats[scope] }; cat = [scope, cats[scope]]; }
      }
      const r = await this._ws(msg);
      const e = r && (r.entity_entry || r);
      if (e && e.entity_id) this._entMap.set(e.entity_id, Object.assign({}, this._entMap.get(e.entity_id) || {}, e));
      return { id, label, add, had, cat };
    },
    // reverse one _label() change: the label comes off again (or goes back on), and the category it set goes too
    async _unlabel(u) {
      if (!u || u.had === u.add) return;
      if (u.id.startsWith('device:')) { await this._label(u.id, u.label, !u.add, false); return; }
      const reg = await this._ws({ type: 'config/entity_registry/get', entity_id: u.id });
      const labels = new Set(reg.labels || []);
      if (u.add) labels.delete(u.label); else labels.add(u.label);
      const msg = { type: 'config/entity_registry/update', entity_id: u.id, labels: [...labels] };
      if (u.cat && (reg.categories || {})[u.cat[0]] === u.cat[1]) msg.categories = { [u.cat[0]]: null };
      await this._ws(msg);
    },
    // undo step for one or more _label() changes, with a check that the items still carry what the step left
    _labelStep(text, label, recs) {
      const live = recs.filter((u) => u && u.had !== u.add);
      if (!live.length) return;
      const state = async (u, wantOn) => {
        if (u.id.startsWith('device:')) { const d = this._devMap.get(u.id.slice(7)); return !!d && (d.labels || []).includes(u.label) === wantOn; }
        const r = await this._ws({ type: 'config/entity_registry/get', entity_id: u.id }, { optional: 'an entity set up in YAML has no registry entry', fallback: null });
        return !!r && (r.labels || []).includes(u.label) === wantOn;
      };
      this._history({
        label, text,
        check: async (dir) => { for (const u of live) if (!(await state(u, dir === 'undo' ? u.add : !u.add))) return false; return true; },
        undo: async () => { for (const u of live) await this._unlabel(u); },
        redo: async () => { for (const u of live) await this._label(u.id, u.label, u.add, !!u.cat); },
      });
    },

    /* ---------- drawer: native editors, traces, runs ---------- */
    // open Home Assistant's own editor or create dialog in the drawer; whatever it creates joins the function
    _create(kind, domain, name) {
      const label = this._data.ui.current;
      this._closeMenu();
      this._capture = { label, kind, domain: domain || null };
      const map = {
        automation: ['/config/automation/edit/new', T('new_automation')],
        script: ['/config/script/edit/new', T('new_script')],
        scene: ['/config/scene/edit/new', T('new_scene')],
        helper: domain ? [`/config/helpers/add?domain=${encodeURIComponent(domain)}`, T('new', { name: (name || domain).toLowerCase() })] : ['/config/helpers', T('helpers')],
      };
      this._openDrawer(map[kind][0], map[kind][1], { capture: true });
    },
    _helperMenu(btn) {
      const items = HELPER_TYPES.map(([d, t, i]) => ({ act: 'mk-helper', data: { domain: d, name: t }, icon: i, text: t }));
      items.push({ act: 'mk-more', icon: 'mdi:dots-horizontal', text: T('more_helper_types_2'), title: T('template_group_derivative_utility_meter') });
      items.push({ sep: true });
      items.push({ act: 'mk-scene', icon: 'mdi:palette-outline', text: T('scene') });
      this._menu(btn, items, T('create_in_this_function'));
    },
    async _helperMoreMenu() {
      const anchor = this._menuAnchor;
      this._menu(anchor, [{ text: T('loading_2'), disabled: true }], T('more_helper_types'));
      let domains = [];
      try { domains = await this._api('GET', 'config/config_entries/flow_handlers?type=helper'); } catch (e) { domains = []; }
      const man = domains.length ? await this._ws({ type: 'manifest/list', integrations: domains }, { fallback: [] }) : [];
      const names = new Map((man || []).map((x) => [x.domain, x.name]));
      const list = domains.map((d) => [d, names.get(d) || d.replace(/_/g, ' ')]).sort((a, b) => a[1].localeCompare(b[1]));
      if (this._menuAnchor !== anchor) return;
      this._menu(anchor, [{ act: 'mk-back', icon: 'mdi:arrow-left', text: T('back') }, { sep: true }]
        .concat(list.length ? list.map(([d, n]) => ({ act: 'mk-helper', data: { domain: d, name: n }, icon: 'mdi:tune-variant', text: n })) : [{ text: T('no_other_helper_types_found'), disabled: true }]), T('more_helper_types'));
    },
    async _resumeCapture() {
      if (this._mode() !== 'panel') return;
      let c = null;
      try { c = JSON.parse(sessionStorage.getItem(CAPTURE_KEY) || 'null'); sessionStorage.removeItem(CAPTURE_KEY); } catch (e) { c = null; }
      if (!c || !c.label || typeof c.since !== 'number' || Date.now() - c.at > 30 * 60000) return;
      const ents = await this._ws({ type: 'config/entity_registry/list' }, { fallback: [] });
      const made = (ents || []).filter((e) => (e.created_at || 0) > c.since).slice(0, 5);
      for (const e of made) if (await this._captureMatch(e.entity_id, c, e)) await this._captured(e.entity_id, c);
    },
    // does this new entity belong to what was being created?
    async _captureMatch(id, c, reg) {
      const dom = id.split('.')[0];
      if (c.kind === 'automation' || c.kind === 'script' || c.kind === 'scene') return dom === c.kind;
      if (c.kind !== 'helper') return false;
      if (HELPER_DOMAINS.has(dom)) return true;
      if (!reg) reg = await this._ws({ type: 'config/entity_registry/get', entity_id: id }, { optional: 'an entity set up in YAML has no registry entry', fallback: null });
      return !!(reg && (HELPER_PLATFORMS.has(reg.platform) || (c.domain && reg.platform === c.domain)));
    },
    _endCapture() {
      // a few seconds' grace: the item saved just before the drawer closed still gets the label
      const c = this._capture;
      if (!c) return;
      this._clock.after('capture', 3000, () => { if (this._capture === c) this._capture = null; });
    },

    /* ---------- functions: create / edit / remove ---------- */
    // the function dialog's colour and icon, plus the Share YAML anonymize toggle
    _fnChange(t) {
      if (t.name === 'color' && t.tagName === 'SELECT') { this._fnColor = t.value; return true; }
      if (t.name === 'shanon' && this._shareData) { this._shareData.anonymize = !!t.checked; this._shareRender(); return true; }
      return false;
    },
    _fnInput(t) { if (t.name === 'icon' && t.tagName === 'INPUT') { this._fnIcon = t.value.trim(); return true; } return false; },
    _fnModal(label) {
      const l = label ? this._labelMap.get(label) : null;
      this._editing = label || null;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${l ? T('edit_function') : T('new_function_2')}</h3><label>${T('name')}<input name="name" value="${esc(l ? l.name : '')}" placeholder="${T('e_g_bathroom_heater_filter')}"></label><label>${T('description')}<input name="desc" value="${esc(l && l.description ? l.description : '')}" placeholder="${T('what_this_function_does_optional')}"></label><div class="row"><div class="selbox" data-sel="icon"></div><div class="selbox" data-sel="color"></div></div>${l ? '' : `<label class="chk"><input type="checkbox" name="cats" checked>${T('also_file_new_automations_scripts')}</label>`}<div class="hint">${l ? T('this_edits_the_home_assistant') : T('this_creates_a_home_assistant')}</div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="modal-save">${l ? T('save') : T('create_2')}</button></div></div>`;
      this._mountPickers(l && l.icon ? l.icon : 'mdi:puzzle-outline', l && l.color ? l.color : 'indigo');
      this._clock.after('focus', 50, () => { const i = m.querySelector('input[name=name]'); if (i) i.focus(); });
    },
    _mountPickers(icon, color) {
      this._fnIcon = icon; this._fnColor = color;
      const m = this._$.modal, iconBox = m.querySelector('[data-sel="icon"]'), colorBox = m.querySelector('[data-sel="color"]');
      if (!iconBox || !colorBox) return;
      // plain inputs first; swapped for Home Assistant's own pickers as soon as they are loaded
      iconBox.innerHTML = `<label>${T('icon')}<input name="icon" value="${esc(icon)}"></label>`;
      colorBox.innerHTML = `<label>${T('colour')}<select name="color">${COLORS.map((c) => `<option value="${c}" ${c === color ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`;
      this._ensureSelector().then((ok) => {
        if (!ok || !iconBox.isConnected) return;
        const mk = (box, selector, label, value, set) => {
          const el = document.createElement('ha-selector');
          el.hass = this._hass; el.selector = selector; el.label = label; el.value = value;
          el.addEventListener('value-changed', (e) => { e.stopPropagation(); set(e.detail.value); el.value = e.detail.value; });
          box.innerHTML = ''; box.appendChild(el);
        };
        mk(iconBox, { icon: {} }, T('icon'), this._fnIcon, (v) => { this._fnIcon = v; });
        mk(colorBox, { ui_color: {} }, T('colour'), this._fnColor, (v) => { this._fnColor = v; });
      });
    },
    async _saveFn() {
      const m = this._$.modal, v = (n) => m.querySelector(`[name=${n}]`);
      const name = v('name').value.trim();
      if (!name) { v('name').focus(); return; }
      const icon = this._fnIcon || 'mdi:puzzle-outline', color = this._fnColor || null, desc = v('desc').value.trim();
      // Home Assistant label names are unique: say what the name is already used by, and offer the way out
      const clash = this._labels.find((l) => String(l.name).toLowerCase() === name.toLowerCase() && l.label_id !== this._editing);
      if (clash) { this._nameClash(clash); return; }
      try {
        if (this._editing) {
          const old = this._labelMap.get(this._editing), lid = this._editing;
          const before = { name: old.name, icon: old.icon, color: old.color, description: old.description || '' };
          const after = { name, icon, color, description: desc };
          await this._ws(Object.assign({ type: 'config/label_registry/update', label_id: lid }, after));
          this._history({ label: lid, text: T('edit', { name: before.name }), undo: () => this._ws(Object.assign({ type: 'config/label_registry/update', label_id: lid }, before)), redo: () => this._ws(Object.assign({ type: 'config/label_registry/update', label_id: lid }, after)) });
          this._closeModal();
          await this._loadRegistries(); this._renderList(); this._renderHeader();
          return;
        }
        const st = await this._createFn({ name, icon, color, desc, cats: !!(v('cats') && v('cats').checked) });
        this._history({
          label: st.lid, text: T('create', { name }),
          check: async (dir) => dir !== 'undo' || (await this._labelCount(st.lid)) === 0,
          undo: async () => { st.layout = this._data.layouts[st.lid] || null; this._takeOff(st.lid); delete this._data.layouts[st.lid]; await this._dropCategories(st.made); await this._ws({ type: 'config/label_registry/delete', label_id: st.lid }); this._save(); },
          redo: async () => { await this._loadRegistries(); Object.assign(st, await this._createFn({ name, icon, color, desc, cats: st.cats, layout: st.layout })); },
        });
        this._closeModal();
        await this._loadRegistries();
        this._open(st.lid);
      } catch (e) { this._toast(T('could_not_save', { message: e.message || e.code || e })); }
    },
    async _createFn(o) {
      const msg = { type: 'config/label_registry/create', name: o.name, icon: o.icon };
      if (o.color) msg.color = o.color;
      if (o.desc) msg.description = o.desc;
      const lbl = await this._ws(msg);
      if (o.layout) this._data.layouts[lbl.label_id] = o.layout;
      const L = this._layout(lbl.label_id);
      let made = [];
      if (o.cats) { const r = await this._categories(o.name, o.icon); L.categories = r.ids; made = r.made; }
      if (!this._data.functions.includes(lbl.label_id)) this._data.functions.push(lbl.label_id);
      this._save();
      return { lid: lbl.label_id, made, cats: o.cats };
    },
    // delete categories a step created, unless something else has been filed under them since
    async _dropCategories(made) {
      if (!made || !made.length) return;
      const ents = await this._ws({ type: 'config/entity_registry/list' }, { fallback: null });
      for (const [scope, cid] of made) {
        if (!ents || ents.some((e) => (e.categories || {})[scope] === cid)) continue;
        await this._ws({ type: 'config/category_registry/delete', scope, category_id: cid }, { fallback: null });
      }
    },
    // how many items carry a label right now (fresh from Home Assistant)
    async _labelCount(label) {
      const [ents, devs] = await Promise.all([this._ws({ type: 'config/entity_registry/list' }), this._ws({ type: 'config/device_registry/list' })]);
      return ents.filter((e) => (e.labels || []).includes(label)).length + devs.filter((d) => (d.labels || []).includes(label)).length;
    },
    // Hide from board: the label, its items and the layout all stay; Import > Labels or the name check brings it back
    _hideFunction(label) {
      const name = this._fnName(label), at = this._data.functions.indexOf(label);
      this._takeOff(label);
      this._history({
        label: null, text: T('hide_2', { name }),
        undo: async () => { if (!this._data.functions.includes(label)) this._data.functions.splice(Math.max(0, at), 0, label); this._data.ui.current = label; this._save(); },
        redo: async () => this._takeOff(label),
      });
      this._renderList();
      if (this._data.ui.current) this._open(this._data.ui.current);
      else { this._renderHeader(); this._setEmpty(); }
      this._toast(T('hid_its_label_and_items', { name }), [{ text: T('undo'), fn: () => this._undo() }]);
    },
    async _deleteItemDialog(id) {
      if (!this._full()) return;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('delete_3')}</h3><div class="muted">${T('checking_what_uses_it')}</div></div>`;
      const plan = await this._howDelete(id), used = await this._usedBy([id], new Set([id]));
      this._pendingDelete = { kind: 'item', plan: [plan], label: this._data.ui.current };
      const kind = this._tagOf(id).toLowerCase();
      m.innerHTML = `<div class="dlg"><h3>${T('delete_2', { name: esc(plan.name) })}</h3>${plan.can
          ? `<p class="dtext">${T('deletes_this_from_home_assistant', { kind: esc(kind), where: esc(plan.where), extra: plan.how === 'entry' && plan.siblings && plan.siblings.length > 1 ? T('that_also_deletes_the_same', { n: esc(P('n_other_entities', plan.siblings.length - 1)) }) : '' })}</p>${this._usedHtml(id, used)}<p class="dtext ${plan.undo ? '' : 'dno'}">${plan.undo ? T('undo_brings_it_back_with') : esc(T('this_can_t_be_undone', { why: plan.why }))}</p>`
          : `<p class="dtext">${T('the_board_can_t_delete', { why: esc(plan.why) })}</p>`}<div class="btns"><button data-act="modal-cancel">${T('cancel')}</button>${plan.can ? `<button class="danger" data-act="del-go">${T('delete_3')}</button>` : ''}</div></div>`;
    },
    async _deleteFnDialog(label, withItems) {
      if (!this._full()) return;
      const m = this._$.modal, name = this._fnName(label);
      m.hidden = false;
      m.innerHTML = `<div class="dlg wide"><h3>${T('delete_2', { name: esc(name) })}</h3><div class="muted">${T('checking_what_it_contains_and')}</div></div>`;
      await this._loadRegistries();
      const ents = this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id);
      const devs = this._devs.filter((d) => (d.labels || []).includes(label)).map((d) => 'device:' + d.id);
      const L = this._data.layouts[label] || {};
      const cats = await this._fnCategories(label, withItems ? ents : []);
      let plan = [], used = new Map();
      if (withItems) {
        for (const id of ents.concat(devs)) plan.push(await this._howDelete(id));
        // what's shared is never deleted (0.11.0): it stays, in its other functions, until nothing else has it
        used = await this._outsideUses([...new Set(ents.concat(plan.flatMap((p) => p.siblings || [])))], ents);
        plan.forEach((p) => { const why = p.can && this._sharedWhy(p, label, ents, used); if (why) Object.assign(p, { can: false, kept: true, why }); });
      }
      this._pendingDelete = { kind: 'function', label, withItems, plan, cats, ents, devs };
      const box = (L.frames || []).length, notes = (L.notes || []).length;
      const items = withItems ? `<div class="dlist">${plan.map((p, i) => `<label class="drow ${p.can ? '' : 'dcant'}"><input type="checkbox" data-delpick="${i}" ${p.can ? 'checked' : 'disabled'}>`
        + `<span class="tag">${esc(this._tagOf(p.id))}</span><span class="mn"><b>${esc(p.name)}</b><small>${esc(p.id.startsWith('device:') ? 'device' : p.id)}${p.can ? (p.undo ? '' : T('can_t_be_undone')) : ' · ' + esc(p.why)}</small>${p.kept ? '' : this._usedHtml(p.id, used)}</span></label>`).join('')}</div>${plan.some((p) => p.kept) ? `<p class="dtext">${T('shared_items_stay')}</p>` : ''}` : '';
      const catLine = cats.length ? `<label class="chk"><input type="checkbox" data-delcats ${cats.every((c) => c.free) ? 'checked' : ''}>${T('also_delete_the_named', { count: esc(P('n_categories', cats.length)), name: esc(name), cats: esc(cats.map((c) => c.scope === 'helpers' ? 'helpers' : c.scope + 's').join(', ')), extra: cats.some((c) => !c.free) ? T('other_items_are_filed_there') : withItems ? '' : T('only_this_function_s_items') })}</label>` : '';
      m.innerHTML = `<div class="dlg wide"><h3>${T('delete_2', { name: esc(name) })}</h3><p class="dtext">${T('deletes_the_label')} <b>${esc(name)}</b>${T('home_assistant_removes_it_from', { n: esc(P('n_items', ents.length + devs.length)), extra: withItems ? '' : T('the_items_themselves_stay_where') })}</p><p class="dtext">${T('deletes_the_board_s_layout', { extra: box ? ', ' + P('n_frames', box) : '', extra2: notes ? ', ' + P('n_notes', notes) : '' })}</p>${withItems ? `<p class="dtext">${T('deletes_these_from_home_assistant')}</p>${items}` : ''}${catLine}<p class="dtext">${withItems && plan.some((p) => p.can && !p.undo) ? T('undo_brings_back_the_function') : T('undo_brings_it_all_back')}</p><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="danger" data-act="del-go">${withItems ? T('delete_function_and_items') : T('delete_function')}</button></div></div>`;
    },
    async _deleteGo() {
      const d = this._pendingDelete, m = this._$.modal;
      if (!d) return;
      const go = m.querySelector('[data-act="del-go"]');
      if (go) { go.disabled = true; go.textContent = T('deleting'); }
      if (d.kind === 'function') {
        const picks = new Set([...m.querySelectorAll('[data-delpick]:checked')].map((x) => +x.dataset.delpick));
        d.plan = d.plan.filter((p, i) => p.can && picks.has(i));
        d.dropCats = !!(m.querySelector('[data-delcats]') && m.querySelector('[data-delcats]').checked);
      }
      this._pendingDelete = null;
      try {
        if (d.kind === 'item') await this._runItemDelete(d);
        else await this._runFnDelete(d);
      } catch (e) { this._toast(T('could_not_delete_2', { message: e.message || e.code || e })); }
      this._closeModal();
    },
    async _deleteItems(plan) {
      const done = [], failed = [];
      for (const p of plan) {
        if (!p.can) continue;
        try {
          if (p.how === 'config') await this._api('DELETE', `config/${p.dom}/config/${encodeURIComponent(p.cid)}`);
          else if (p.how === 'collection') await this._ws({ type: p.dom + '/delete', [p.dom + '_id']: p.item.id });
          else if (p.how === 'entry') await this._api('DELETE', `config/config_entries/entry/${p.entryId}`);
          done.push(p);
        } catch (e) { failed.push(p.name + ': ' + (e.message || e.code || e)); }
      }
      return { done, failed };
    },
    // take a function off the list (the label stays); opens another one if it was on screen
    _takeOff(label) {
      this._data.functions = this._data.functions.filter((f) => f !== label);
      if (this._data.ui.current === label) {
        this._data.ui.current = this._data.functions[0] || null;
        this._model = null; this._clearWorld();
      }
      this._save();
    },
    // label several items, carrying on past ones that can't take a label; one undo step for all of them
    async _labelMany(ids, label, withCat) {
      const done = [], skipped = [], undo = [];
      for (const id of ids) {
        try { undo.push(await this._label(id, label, true, withCat)); done.push(id); }
        catch (e) { skipped.push({ id, why: this._noLabelWhy(id, e) }); }
      }
      if (done.length) this._labelStep(T('add_to', { count: P('n_items', done.length), fnName: this._fnName(label) }), label, undo);
      return { done, skipped };
    },
    /* ---------- Share a function as a Home Assistant YAML package (0.16.0) ---------- */
    async _shareModal(label) {
      const m = this._$.modal, fnName = this._fnName(label);
      m.hidden = false;
      m.innerHTML = `<div class="dlg shdlg"><h3>${T('sh_h', { name: esc(fnName) })}</h3><div class="muted">${T('reading_configs')}</div></div>`;
      const members = this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id);
      const automations = [], scripts = [], helpers = [], templates = [], lists = new Map();
      const getList = async (dom) => {
        if (!lists.has(dom)) lists.set(dom, await this._ws({ type: dom + '/list' }, { optional: 'a helper domain not set up has no list of helpers', fallback: [] }));
        return lists.get(dom) || [];
      };
      for (const k of members) {
        const dom = k.split('.')[0];
        if (dom === 'automation' || dom === 'script') {
          const cfg = await this._fetchConfig(k);
          if (cfg) (dom === 'automation' ? automations : scripts).push({ entity_id: k, cfg });
        } else if (VER_HELPERS.has(dom)) {
          const reg = this._entMap.get(k);
          const it = (await getList(dom)).find((x) => reg && x.id === reg.unique_id);
          if (it) helpers.push({ entity_id: k, dom, id: it.id, cfg: it });
        }
      }
      if (this._storeMode === 'shared') {
        const tplCand = members.filter((k) => { const e = this._entMap.get(k); return e && e.platform === 'template'; });
        const r = tplCand.length ? await this._ws({ type: 'functions_board/sources', entity_ids: tplCand, include_templates: true }, { fallback: null }) : null;
        Object.entries((r && r.sources) || {}).forEach(([k, src]) => {
          const t = src && src.templates;
          if (t && t.state) {
            templates.push({ entity_id: k, dom: k.split('.')[0], name: this._nameOf(k), state: t.state, availability: t.availability || null, icon: t.icon || null, attributes: t.attributes || null, triggered: !!t.triggered });
          }
        });
      }
      const entities = this._ents.map((e) => ({ entity_id: e.entity_id, name: this._nameOf(e.entity_id), area_id: e.area_id || null }));
      const areas = this._areaMap ? [...this._areaMap.values()].map((a) => ({ area_id: a.area_id, name: a.name })) : [];
      const devices = this._devs.map((d) => ({ id: d.id, name: d.name_by_user || d.name || '' }));
      this._shareData = { label, pkg: { name: fnName, automations, scripts, helpers, templates, entities, areas, devices }, anonymize: true, res: null };
      this._shareRender();
    },
    _shareRender() {
      const s = this._shareData, m = this._$.modal;
      if (!s) return;
      const res = exportFunctionPackage(s.pkg, { anonymize: s.anonymize });
      s.res = res;
      const st = res.stats;
      const statsTxt = T('sh_stats', {
        autos: P('n_automations', st.automations),
        scripts: P('n_scripts', st.scripts),
        helpers: P('n_helpers', st.helpers),
        tpls: P('sh_tpls_n', st.templates),
      });
      m.hidden = false;
      m.innerHTML = `<div class="dlg shdlg"><h3>${T('sh_h', { name: esc(s.pkg.name) })}</h3><p class="dtext">${T('sh_lead')}</p>`
        + `<div class="hint">${esc(statsTxt)}</div>`
        + `<label class="chk"><input type="checkbox" name="shanon"${s.anonymize ? ' checked' : ''}>${T('sh_anon')}</label>`
        + (s.anonymize ? '' : `<div class="dwarn"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${T('sh_real_warn')}</span></div>`)
        + `<textarea class="shyaml" readonly aria-label="${esc(T('sh_h', { name: s.pkg.name }))}">${esc(res.yaml)}</textarea>`
        + `<div class="dval"></div><div class="btns"><button data-act="modal-cancel">${T('close')}</button><button data-act="share-copy"><ha-icon icon="mdi:content-copy"></ha-icon>${T('sh_copy')}</button><button class="primary" data-act="share-download"><ha-icon icon="mdi:file-download-outline"></ha-icon>${T('sh_download')}</button></div></div>`;
    },
    async _shareCopy() {
      const s = this._shareData, m = this._$.modal, t = m.querySelector('textarea.shyaml');
      if (!s || !s.res) return;
      try { await navigator.clipboard.writeText(s.res.yaml); this._toast(T('sh_copied')); }
      catch (e) { if (t) { t.focus(); t.select(); } const v = m.querySelector('.dval'); if (v) v.textContent = T('chk_copy_by_hand'); }
    },
    _shareDownload() {
      const s = this._shareData;
      if (!s || !s.res) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([s.res.yaml], { type: 'text/yaml' }));
      a.download = s.res.filename;
      document.body.appendChild(a); a.click(); a.remove();
      this._clock.deadline(5000, () => URL.revokeObjectURL(a.href));
      this._toast(T('sh_downloaded', { file: s.res.filename }));
    },

};
