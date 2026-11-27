import { P, T, VER_DOMAINS, VER_HELPERS, canon, cleanLayout, devIdsIn, esc, swapDevs, uid, verLayoutKey, verPrint } from '../lib/index.js';

export const versionsPart = {
    /* ======================================================================================================
       part: versions: saved versions: the drawer, a version's tab, comparing, restoring Owns _verPending, _verUrlDone
       (PARTS): only its own methods use them; the other parts ask its methods.
       ====================================================================================================== */
    // top to bottom (the function's layout says so)
    _vert() { return !!(this._model && this._layout(this._model.label).dir === 'down'); },
    /* ---------- Sandbox (Phase 10): the drawer, the controls, the timeline ---------- */
    /* ---------- versions (0.8.0): named snapshots of a function, kept by the integration (functions_board/version_*).
       A snapshot is what Home Assistant's own APIs return: the configs of the function's automations and scripts,
       its UI helpers' settings, which items are in it, its layout, and the devices its steps use. Saving one changes
       nothing. A version opens in a tab of its own (read-only, marked against what's there now), can be tried in
       the sandbox, and in Full manager can be restored through the same config APIs Home Assistant's editors use,
       after a dialog that lists every change; what's there before is saved first if the person ticks that box. ---------- */
    _verOK() { return this._storeMode === 'shared'; },
    async _verList(label) { return (await this._verListAll(label)).vs; },
    // the versions and the one the function was last made from ({ id, print }: its fingerprint right after, 0.11.3)
    async _verListAll(label) { const r = await this._ws({ type: 'functions_board/versions', label }); return { vs: (r && r.versions) || [], made: (r && r.active) || null }; },
    // which version is active: one that's what's there now, the one it was last made from first; or the one it was
    // last made from, if nothing has changed since (Home Assistant may write a config back a little differently from
    // how it was saved, and what was added since may only be turned off). The base is the version unsaved changes
    // came from: Save writes over it.
    // which version the function is now (0.11.3): its wiring the same (verPrint) and its layout too (verLayoutKey); the
    // one it was made from first, then the newest. base: what Save writes over (the active one, else the one it was
    // made from, else one whose wiring it has, else the newest; the dialog names it). layoutOnly: the wiring is a
    // version's, the layout isn't
    async _verResolve(label) {
      const [{ vs, made }, now] = await Promise.all([this._verListAll(label), this._verSnapshot(label)]);
      const print = verPrint(now), from = made && vs.find((v) => v.id === made.id) || null;
      const keys = new Set(this._model ? this._model.nodes.keys() : []), mine = verLayoutKey(now.layout, keys);
      const cands = from && (from.print === print || made.print === print) ? [from] : [];
      vs.slice().reverse().forEach((v) => { if (v.print && v.print === print && !cands.includes(v)) cands.push(v); });
      let active = null;
      for (const v of cands) { if (verLayoutKey((await this._verSnapOf(label, v)).layout, keys) === mine) { active = v; break; } }
      const base = active || from || cands[0] || vs[vs.length - 1] || null;
      return { vs, made, now, print, active, base, guess: !active && !from && !cands.length, layoutOnly: !active && cands.length > 0 && base === cands[0] };
    },
    // a saved version's snapshot, kept while the version is as it was saved
    async _verSnapOf(label, v) {
      const k = label + '|' + v.id + '|' + v.at;
      this._verSnaps = this._verSnaps || new Map();
      if (!this._verSnaps.has(k)) this._verSnaps.set(k, (await this._verGet(label, v.id)).snapshot || {});
      return this._verSnaps.get(k);
    },
    // the open Versions drawer follows a change to the function (a config saved, something in or out of it)
    _verRefresh() { if (this._drawer && this._drawer.mode === 'versions') this._renderVersions(); },
    _verGet(label, id) { return this._ws({ type: 'functions_board/version_get', label, version_id: id }); },
    // a saved config as the board reads it: a blueprint automation or script is filled in by Home Assistant
    async _verCfg(k, it) {
      const V = this._ver;
      if (V.cfgs.has(k)) return V.cfgs.get(k);
      let cfg = it.cfg;
      const bp = cfg && cfg.use_blueprint;
      if (bp && bp.path) {
        try { const r = await this._ws({ type: 'blueprint/substitute', domain: it.dom, path: bp.path, input: bp.input || {} }); if (r && r.substituted_config) cfg = Object.assign({}, r.substituted_config, { alias: cfg.alias, id: cfg.id, use_blueprint: bp }); } catch (e) { /* inputs only */ }
      }
      V.cfgs.set(k, cfg);
      return cfg;
    },
    _verMembers(label) {
      return this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id).concat(this._devs.filter((d) => (d.labels || []).includes(label)).map((d) => 'device:' + d.id));
    },
    // the function as it is now, read through Home Assistant's own APIs (nothing is changed)
    async _verSnapshot(label) {
      const members = this._verMembers(label), items = {}, lists = new Map(), devices = {};
      const list = async (dom) => { if (!lists.has(dom)) lists.set(dom, await this._ws({ type: dom + '/list' }, { optional: 'a helper domain not set up has no list of helpers', fallback: null })); return lists.get(dom) || []; };
      for (const k of members) {
        if (k.startsWith('device:')) continue;
        const dom = k.split('.')[0], name = this._nameOf(k);
        if (dom === 'automation' || dom === 'script') {
          const r = await this._ws({ type: dom + '/config', entity_id: k }, { optional: 'an automation or script without an id has no stored config', fallback: null }), cfg = r && r.config;
          if (!cfg) continue;
          const reg = this._entMap.get(k);
          const id = dom === 'automation' ? cfg.id || null : (reg && reg.unique_id) || k.slice(7);
          // only what's in automations.yaml or scripts.yaml can be written back: Home Assistant's editors say the same
          const own = id ? !!(await this._api('GET', `config/${dom}/config/${encodeURIComponent(id)}`, undefined, { optional: 'one set up in YAML has no stored config to read', fallback: null })) : false;
          items[k] = { dom, id, name, cfg, yaml: !own };
        } else if (VER_HELPERS.has(dom)) {
          const reg = this._entMap.get(k), it = (await list(dom)).find((x) => reg && x.id === reg.unique_id);
          if (it) { const cfg = Object.assign({}, it); delete cfg.id; items[k] = { dom, id: it.id, name, cfg }; } else items[k] = { dom, id: null, name, yaml: true };
        }
      }
      const ids = new Set(members.filter((k) => k.startsWith('device:')).map((k) => k.slice(7)));
      Object.values(items).forEach((it) => { if (it.cfg) devIdsIn(it.cfg, ids); });
      ids.forEach((id) => { const d = this._devMap.get(id); if (d) devices[id] = { name: d.name_by_user || d.name || '', model: d.model || '', manufacturer: d.manufacturer || '' }; });
      const L = this._data.layouts[label] ? JSON.parse(JSON.stringify(this._data.layouts[label])) : null;
      if (L) delete L.view;
      return { fmt: 1, members, items, devices, layout: L };
    },
    _verWhen(at) { try { return new Date(at).toLocaleString(this._hass.language || undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(at).toLocaleString(); } },

    async _openVersions() {
      const label = this._data.ui.current;
      if (!label || !this._model) return;
      if (!this._verOK()) { this._toast(T('ver_needs_integration')); return; }
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'versions' };
      const d = this._$.drawer;
      d.hidden = false;
      this._put(d, `<div class="dhead"><span class="dtitle">${T('ver_title', { fnName: esc(this._fnName(label)) })}</span><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="vers"><div class="vnote">${T('ver_note')}</div><div class="vlist"><div class="muted pad">${T('ver_reading')}</div></div></div>`);
      this._fitLitbar();
      await this._renderVersions();
    },
    // the list (0.11.3): the active version pinned at the top, or "unsaved changes" there when what's there now is no
    // saved version, with Save (over the version they came from) and Save as copy; then the rest, newest first
    async _renderVersions() {
      const label = this._data.ui.current, box = this._$.drawer.querySelector('.vlist');
      if (!box || !this._drawer || this._drawer.mode !== 'versions') return;
      let r;
      try { r = await this._verResolve(label); } catch (e) { this._put(box, `<div class="lgerr">${esc((e && (e.message || e.code)) || e)}</div>`); return; }
      if (!this._drawer || this._drawer.mode !== 'versions' || label !== this._data.ui.current) return;
      const { vs, print, active, base, guess, layoutOnly } = r, full = this._full(), viewing = this._ver && this._ver.label === label ? this._ver.id : null;
      this._verCache = { label, vs, active: active ? active.id : null, base: base ? base.id : null, print };
      const row = (v, top, mine) => `<div class="vrow${active && active.id === v.id ? ' on' : ''}${top ? ' top' : ''}${viewing === v.id ? ' view' : ''}" data-id="${esc(v.id)}"><div class="vh"><b>${esc(v.name)}</b>${active && active.id === v.id ? `<span class="vbadge">${T('ver_active')}</span>` : ''}${v.auto ? `<span class="vauto">${T('ver_auto')}</span>` : ''}</div>${v.desc ? `<div class="vdesc">${esc(v.desc)}</div>` : ''}<div class="vm">${esc(this._verWhen(v.at))}${v.by ? ' · ' + esc(v.by) : ''}</div>`
        + `<div class="vb"><button data-act="ver-open" data-id="${esc(v.id)}"><ha-icon icon="mdi:tab"></ha-icon>${T('ver_open')}</button><button data-act="ver-sbx" data-id="${esc(v.id)}"><ha-icon icon="mdi:flask-outline"></ha-icon>${T('ver_try')}</button>`
        + (mine || `<button data-act="ver-restore" data-id="${esc(v.id)}"${full && !(active && active.id === v.id) ? '' : ' disabled'} title="${full ? (active && active.id === v.id ? T('ver_is_active') : T('ver_restore_t')) : T('ver_restore_full')}"><ha-icon icon="mdi:check-circle-outline"></ha-icon>${T('ver_restore')}</button>`)
        + `<button class="ib" data-act="diag" data-ver="${esc(v.id)}" title="${T('diag_ver_t')}"><ha-icon icon="mdi:file-download-outline"></ha-icon></button><button class="ib" data-act="ver-edit" data-id="${esc(v.id)}" title="${T('ver_edit_t')}"><ha-icon icon="mdi:pencil-outline"></ha-icon></button><button class="ib" data-act="ver-del" data-id="${esc(v.id)}" title="${T('ver_del_t')}"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div></div>`;
      // Save (over the active version, or the one unsaved changes came from: what's there now, its layout too) and
      // Save as copy; on the active version's row they stand in for Make active
      const saveOver = base ? `<button class="primary" data-act="ver-over" title="${T('ver_over_t', { name: esc(base.name) })}"><ha-icon icon="mdi:content-save-outline"></ha-icon>${T('ver_over_b')}</button>` : '';
      const copy = `<button${saveOver || !vs.length ? ' class="' + (saveOver ? '' : 'primary') + '"' : ''} data-act="ver-new"><ha-icon icon="mdi:content-copy"></ha-icon>${vs.length ? T('ver_copy_b') : T('ver_save_b')}</button>`;
      const head = active
        ? row(active, true, saveOver + copy)
        : `<div class="vrow cur on top"><div class="vh"><b>${vs.length ? T('ver_unsaved') : T('ver_now')}</b><span class="vbadge">${T('ver_active')}</span></div><div class="vm">${base ? (guess ? T('ver_unsaved_newest', { name: esc(base.name) }) : layoutOnly ? T('ver_unsaved_layout', { name: esc(base.name) }) : T('ver_unsaved_from', { name: esc(base.name) })) : T('ver_now_unsaved')}</div><div class="vb">${saveOver}${copy}</div></div>`;
      const rest = vs.slice().reverse().filter((v) => !active || v.id !== active.id);
      this._put(box, head + (rest.length ? rest.map((v) => row(v)).join('') : vs.length ? '' : `<div class="muted pad">${T('ver_none')}</div>`));
    },
    // Save (0.11.3): the version unsaved changes came from is saved over, on purpose, after asking
    _verOverDlg() {
      const c = this._verCache, v = c && this._verFind(c.base), m = this._$.modal;
      if (!v) return;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_over_h', { name: esc(v.name) })}</h3><p class="dtext">${T('ver_over_text', { name: esc(v.name) })}</p><label>${T('description')}<textarea name="vdesc" rows="3" maxlength="2000">${esc(v.desc || '')}</textarea></label><div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button data-act="ver-new">${T('ver_copy_b')}</button><button class="primary" data-act="ver-over-go">${T('ver_over_b')}</button></div></div>`;
    },
    async _verOver() {
      const c = this._verCache, v = c && this._verFind(c.base), m = this._$.modal, label = this._data.ui.current;
      if (!v) return;
      const val = m.querySelector('.aval'), btn = m.querySelector('[data-act="ver-over-go"]'), desc = (m.querySelector('textarea[name="vdesc"]').value || '').trim();
      btn.disabled = true;
      try {
        const snap = await this._verSnapshot(label);
        await this._ws({ type: 'functions_board/version_overwrite', label, version_id: v.id, snapshot: snap, print: verPrint(snap), client: this._client() });
        if (desc !== (v.desc || '')) await this._ws({ type: 'functions_board/version_edit', label, version_id: v.id, desc, client: this._client() });
      } catch (e) { val.textContent = T('ver_not_saved', { e: (e && (e.message || e.code)) || e }); btn.disabled = false; return; }
      this._closeModal();
      this._toast(T('ver_saved', { name: v.name }));
      this._renderVersions();
    },
    _verNewDlg() {
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_save_h')}</h3><label>${T('name')}<input name="vname" maxlength="100" placeholder="${T('ver_name_ph')}"></label><label>${T('description')}<textarea name="vdesc" rows="3" maxlength="2000" placeholder="${T('ver_desc_ph')}"></textarea></label><div class="hint">${T('ver_save_hint')}</div><div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="ver-save">${T('save')}</button></div></div>`;
      m.querySelector('input[name="vname"]').focus();
    },
    async _verSave() {
      const m = this._$.modal, label = this._data.ui.current, name = (m.querySelector('input[name="vname"]').value || '').trim(), desc = (m.querySelector('textarea[name="vdesc"]').value || '').trim();
      const val = m.querySelector('.aval'), btn = m.querySelector('[data-act="ver-save"]');
      if (!name) { val.textContent = T('ver_name_needed'); return; }
      btn.disabled = true;
      try {
        const snap = await this._verSnapshot(label);
        await this._ws({ type: 'functions_board/version_save', label, name, desc, snapshot: snap, print: verPrint(snap), client: this._client() });
      } catch (e) { val.textContent = T('ver_not_saved', { e: (e && (e.message || e.code)) || e }); btn.disabled = false; return; }
      this._closeModal();
      this._toast(T('ver_saved', { name }));
      if (!this._drawer || this._drawer.mode !== 'versions') this._openVersions(); else this._renderVersions();
    },
    _verFind(id) { return this._verCache && this._verCache.vs.find((v) => v.id === id); },
    _verEditDlg(id) {
      const v = this._verFind(id), m = this._$.modal;
      if (!v) return;
      this._verEditing = id;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_edit_h')}</h3><label>${T('name')}<input name="vname" maxlength="100" value="${esc(v.name)}"></label><label>${T('description')}<textarea name="vdesc" rows="3" maxlength="2000">${esc(v.desc || '')}</textarea></label><div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="ver-edit-save">${T('save')}</button></div></div>`;
    },
    async _verEditSave() {
      const m = this._$.modal, name = (m.querySelector('input[name="vname"]').value || '').trim(), desc = (m.querySelector('textarea[name="vdesc"]').value || '').trim();
      if (!name) { m.querySelector('.aval').textContent = T('ver_name_needed'); return; }
      try { await this._ws({ type: 'functions_board/version_edit', label: this._data.ui.current, version_id: this._verEditing, name, desc, client: this._client() }); }
      catch (e) { m.querySelector('.aval').textContent = T('ver_not_saved', { e: (e && (e.message || e.code)) || e }); return; }
      const tabs = this._vtabs && this._vtabs.get(this._data.ui.current), t = tabs && tabs.find((x) => x.id === this._verEditing);
      if (t) t.name = name;
      if (this._ver && this._ver.id === this._verEditing) this._ver.name = name;
      this._closeModal();
      this._renderVersions();
      this._renderVtabs();
    },
    async _verDelDlg(id) {
      const v = this._verFind(id), m = this._$.modal, label = this._data.ui.current;
      if (!v) return;
      this._verEditing = id; this._verDelPlan = [];
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_del_h', { name: esc(v.name) })}</h3><div class="muted">${T('ver_del_checking')}</div></div>`;
      let only = [];
      if (this._full()) {
        try { only = await this._verOnlyHere(label, id); } catch (e) { only = []; this._toast(T('ver_del_not_checked', { e: (e && (e.message || e.code)) || e })); }
      }
      if (this._verEditing !== id || m.hidden) return;
      this._verDelPlan = only;
      const list = only.length ? `<p class="dtext">${T('ver_del_only')}</p><div class="dlist">${only.map((p, i) => `<label class="drow"><input type="checkbox" data-vdel="${i}"><span class="tag">${esc(this._tagOf(p.id))}</span><span class="mn"><b>${esc(p.name)}</b><small>${esc(p.id)}${p.undo ? '' : T('can_t_be_undone')}</small></span></label>`).join('')}</div>` : '';
      m.innerHTML = `<div class="dlg${only.length ? ' wide' : ''}"><h3>${T('ver_del_h', { name: esc(v.name) })}</h3><p class="dtext">${T('ver_del_text')}</p>${list}<div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary danger" data-act="ver-del-go">${T('delete_3')}</button></div></div>`;
    },
    async _verDel() {
      const id = this._verEditing, label = this._data.ui.current, m = this._$.modal;
      const picks = new Set([...m.querySelectorAll('[data-vdel]:checked')].map((x) => +x.dataset.vdel)), also = (this._verDelPlan || []).filter((p, i) => picks.has(i));
      try { await this._ws({ type: 'functions_board/version_delete', label, version_id: id, client: this._client() }); } catch (e) { this._toast(T('ver_not_saved', { e: (e && (e.message || e.code)) || e })); return; }
      this._closeModal();
      this._verDelPlan = [];
      // what only this version had, ticked: deleted from Home Assistant too (Full manager)
      if (also.length && this._full()) {
        const { done, failed } = await this._deleteItems(also);
        this._store.changed('cfg:');
        this._toast(failed.length ? T('ver_del_some_failed', { list: failed.join('; ') }) : P('ver_del_deleted', done.length));
      }
      if (this._vtabs && this._vtabs.has(label)) this._verCloseTab(id);
      this._renderVersions();
    },

    // what only this version has (0.11.3): automations, scripts and helpers it holds that are still in Home Assistant,
    // in no function, in no other version of any function, and used by no automation or script; and that the board
    // can delete
    async _verOnlyHere(label, id) {
      const snap = (await this._verGet(label, id)).snapshot || {};
      await this._regNow();
      const fns = this._data.functions, inFn = (k) => { const e = this._entMap.get(k); return !!(e && (e.labels || []).some((l) => fns.includes(l))); };
      let ks = Object.keys(snap.items || {}).filter((k) => !snap.items[k].yaml && (this._hass.states[k] || this._entMap.has(k)) && !inFn(k));
      if (!ks.length) return [];
      const others = new Set();
      for (const f of fns) {
        const { vs } = await this._verListAll(f);
        for (const x of vs) {
          if (f === label && x.id === id) continue;
          const o = await this._verSnapOf(f, x);
          Object.keys(o.items || {}).concat(o.members || []).forEach((k) => others.add(k));
        }
      }
      const refs = await this._globalRefs();
      ks = ks.filter((k) => !others.has(k) && !refs.has(k));
      const plans = [];
      for (const k of ks) { const p = await this._howDelete(k); if (p && p.can) plans.push(p); }
      return plans;
    },

    // ---- tabs: what's there now (active) and saved versions, one shown at a time
    // a link to a saved version (…/functions/<function>?version=<id>, from "open in a new window"): once, on the
    // first function opened
    _verFromUrl() {
      const q = !this._verUrlDone && new URLSearchParams(location.search).get('version');
      this._verUrlDone = true;
      if (q && /^[0-9a-f]{32}$/.test(q) && !this._ver && this._verOK()) this._verOpenTab(q);
    },
    async _verOpenTab(id, sandbox) {
      const label = this._data.ui.current;
      if (!label) return;
      let v;
      try { v = await this._verGet(label, id); } catch (e) { this._toast(T('ver_gone')); return; }
      this._vtabs = this._vtabs || new Map();
      const tabs = this._vtabs.get(label) || [];
      if (!tabs.some((t) => t.id === id)) tabs.push({ id, name: v.name });
      this._vtabs.set(label, tabs);
      await this._verView(id, v);
      if (sandbox) this._verTrySandbox();
    },
    _verTrySandbox() {
      if (this._sbxOn()) return;
      if (this._data.ui.sbxIntro === false) this._openSandbox(); else this._sbxIntro();
    },
    _verCloseTab(id) {
      const label = this._data.ui.current, tabs = (this._vtabs && this._vtabs.get(label)) || [];
      this._vtabs.set(label, tabs.filter((t) => t.id !== id));
      if (this._ver && this._ver.id === id) this._verView(null); else this._renderVtabs();
    },
    // show a saved version (id), or what's there now (null)
    async _verView(id, v) {
      const label = this._data.ui.current;
      if (!label) return;
      if (id && !v) { try { v = await this._verGet(label, id); } catch (e) { this._toast(T('ver_gone')); return; } }
      if (this._sbx || (this._drawer && this._drawer.mode === 'sandbox')) this._closeDrawer();
      this._clearLit(true);
      if (v) {
        const raw = v.snapshot.layout ? JSON.parse(JSON.stringify(v.snapshot.layout)) : {};
        const layout = Object.assign({ nodes: {}, frames: [], notes: [], view: null, categories: null }, cleanLayout(raw) || {});
        this._ver = { label, id: v.id, name: v.name, at: v.at, snap: v.snapshot, layout, cfgs: new Map(), diff: null };
        this._ver.diff = await this._ha.soft(this._verDiff(label, v.snapshot), 'comparing a version with now', null);
      } else this._ver = null;
      this._$.board.classList.toggle('vview', !!v);
      try { history.replaceState(history.state, '', location.pathname + (v ? '?version=' + v.id : '')); } catch (e) { /* the link just won't carry it */ }
      await this._open(label, false, { fromRoute: true });
      if (this._drawer && this._drawer.mode === 'versions') this._renderVersions();
    },
    // what differs between a version and what's there now: boxes changed since, only in the version, added since
    async _verDiff(label, snap) {
      const cur = new Set(this._verMembers(label)), ver = new Set(snap.members), changed = new Set(), only = new Set(), lists = new Map();
      for (const k of ver) {
        if (!cur.has(k)) { only.add(k); continue; }
        const it = snap.items[k];
        if (!it || !it.cfg) continue;
        let now = null;
        if (it.dom === 'automation' || it.dom === 'script') { const r = await this._ws({ type: it.dom + '/config', entity_id: k }, { optional: 'an automation or script without an id has no stored config', fallback: null }); now = r && r.config; }
        else if (VER_HELPERS.has(it.dom)) {
          if (!lists.has(it.dom)) lists.set(it.dom, await this._ws({ type: it.dom + '/list' }, { optional: 'a helper domain not set up has no list of helpers', fallback: null }));
          const x = (lists.get(it.dom) || []).find((y) => y.id === it.id);
          if (x) { now = Object.assign({}, x); delete now.id; }
        }
        if (now && canon(now) !== canon(it.cfg)) changed.add(k);
      }
      return { changed, only, added: [...cur].filter((k) => !ver.has(k)) };
    },
    _renderVtabs() {
      const el = this._$.vtabs, label = this._data && this._data.ui.current, tabs = (label && this._vtabs && this._vtabs.get(label)) || [];
      if (!el) return;
      const V = this._ver && this._ver.label === label ? this._ver : null;
      if (!tabs.length && !V) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      this._fitLitbar();
      const d = V && V.diff;
      el.innerHTML = `<div class="vtrow"><button class="vtab${V ? '' : ' on'}" data-act="vtab" data-id=""><span class="vdot"></span>${T('ver_current_tab')}<span class="vact">${T('ver_active')}</span></button>`
        + tabs.map((t) => `<span class="vtab${V && V.id === t.id ? ' on' : ''}"><button data-act="vtab" data-id="${esc(t.id)}"><ha-icon icon="mdi:history"></ha-icon>${esc(t.name)}</button><button class="ib" data-act="vtab-win" data-id="${esc(t.id)}" title="${T('ver_new_window')}"><ha-icon icon="mdi:open-in-new"></ha-icon></button><button class="ib" data-act="vtab-x" data-id="${esc(t.id)}" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></span>`).join('') + '</div>'
        + (V ? `<div class="vban"><ha-icon icon="mdi:history"></ha-icon><span>${T('ver_banner', { name: esc(V.name), when: esc(this._verWhen(V.at)) })}${d ? ' ' + T('ver_diff', { changed: d.changed.size, only: d.only.size, added: d.added.length }) : ''}</span><button data-act="ver-sbx-cur"><ha-icon icon="mdi:flask-outline"></ha-icon>${T('ver_try')}</button>${this._full() ? `<button data-act="ver-restore" data-id="${esc(V.id)}"><ha-icon icon="mdi:backup-restore"></ha-icon>${T('ver_restore')}</button>` : ''}</div>` : '');
    },

    // ---- restoring (Full manager): plan, dialog, then the writes, each through Home Assistant's own config APIs
    async _verRestore(id) {
      if (!this._full()) { this._toast(T('ver_restore_full')); return; }
      const label = this._data.ui.current, m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('ver_restore_h0')}</h3><div class="muted">${T('ver_checking')}</div></div>`;
      let v, plan;
      let savedAs = null;
      try {
        v = await this._verGet(label, id); plan = await this._verPlan(label, v.snapshot);
        // is what's there now already one of the saved versions? (then a backup would only be another copy)
        const act = (await this._verResolve(label)).active;
        savedAs = act && act.id !== id ? act : null;
      } catch (e) { m.innerHTML = `<div class="dlg"><h3>${T('ver_restore_h0')}</h3><p class="dtext">${esc((e && (e.message || e.code)) || e)}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button></div></div>`; return; }
      this._verPending = { label, v, plan, devmap: {}, savedAs };
      this._verRestoreDlg();
    },
    async _verPlan(label, snap) {
      // the registries asked now (0.10.0: a plan made from registries 1.2 s out of date missed an automation deleted
      // just before)
      await this._regNow();
      const diff = await this._verDiff(label, snap), cur = new Set(this._verMembers(label));
      const plan = { write: [], recreate: [], same: [], yaml: [], rejoin: [], added: [], missing: [] };
      Object.entries(snap.items).forEach(([k, it]) => {
        if (!it || !VER_DOMAINS.has(it.dom)) return;
        if (it.yaml || !it.cfg || !it.id && (it.dom === 'automation' || it.dom === 'script')) { plan.yaml.push(k); return; }
        const there = !!(this._hass.states[k] || this._entMap.has(k));
        if (!there) plan.recreate.push(k); else if (diff.changed.has(k)) plan.write.push(k); else plan.same.push(k);
      });
      snap.members.forEach((k) => { if (!cur.has(k) && !plan.recreate.includes(k) && (k.startsWith('device:') ? this._devMap.has(k.slice(7)) : this._entMap.has(k))) plan.rejoin.push(k); });
      plan.added = diff.added;
      plan.missing = Object.keys(snap.devices || {}).filter((d) => !this._devMap.has(d));
      // what's shared (0.11.0): an automation, script or helper added since that's also in another function, or that
      // something outside this one uses, only leaves this function; it's never turned off or deleted
      const cand = plan.added.filter((k) => /^(automation|script)\./.test(k) || VER_HELPERS.has(k.split('.')[0])), mine = [...cur];
      const uses = cand.length || plan.write.length ? await this._outsideUses(cand.concat(plan.write), mine) : new Map();
      plan.shared = cand.map((k) => ({ k, why: this._sharedWhy({ id: k }, label, mine, uses) })).filter((x) => x.why);
      plan.added = plan.added.filter((k) => !plan.shared.some((x) => x.k === k));
      // and what restore writes back that's also in another function or used elsewhere: it changes there too (a warning)
      plan.writeShared = plan.write.map((k) => ({ k, why: this._sharedWhy({ id: k }, label, mine, uses, true) })).filter((x) => x.why);
      return plan;
    },
    _verRestoreDlg() {
      const p = this._verPending, { v, plan } = p, snap = v.snapshot, m = this._$.modal, nm = (k) => esc((snap.items[k] && snap.items[k].name) || this._boxName(k));
      const line = (ks, text) => (ks.length ? `<li>${text} <span class="muted">${ks.slice(0, 8).map(nm).join(', ')}${ks.length > 8 ? ' …' : ''}</span></li>` : '');
      const logic = (k) => /^(automation|script)\./.test(k) || VER_HELPERS.has(k.split('.')[0]);
      const addLogic = plan.added.filter(logic), addOther = plan.added.filter((k) => !logic(k));
      const doms = new Set(plan.write.concat(plan.recreate).map((k) => k.split('.')[0]));
      const devs = plan.missing.map((d) => { const o = snap.devices[d] || {}; return `<div class="vdevrow"><div>${T('ver_dev_gone', { name: esc(o.name || d), model: esc([o.manufacturer, o.model].filter(Boolean).join(' ')) })}</div><div class="vdevpick" data-old="${esc(d)}"></div></div>`; }).join('');
      m.hidden = false;
      m.innerHTML = `<div class="dlg wide vrdlg"><h3>${T('ver_restore_h', { name: esc(v.name) })}</h3><p class="dtext">${T('ver_restore_lead', { fnName: esc(this._fnName(p.label)), when: esc(this._verWhen(v.at)) })}</p>`
        + `<ul class="vplan">${line(plan.write, P('ver_p_write', plan.write.length))}${line(plan.recreate, P('ver_p_recreate', plan.recreate.length))}${line(plan.rejoin, P('ver_p_rejoin', plan.rejoin.length))}${line(plan.same, P('ver_p_same', plan.same.length))}${line(plan.yaml, P('ver_p_yaml', plan.yaml.length))}${snap.layout ? `<li>${T('ver_p_layout')}</li>` : ''}</ul>`
        + ((plan.writeShared || []).length ? `<div class="dwarn vwshared"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${T('ver_write_shared', { list: plan.writeShared.map((x) => nm(x.k) + ' (' + esc(x.why) + ')').join(', ') })}</span></div>` : '')
        + (plan.missing.length ? `<h4>${T('ver_dev_h')}</h4><div class="hint">${T('ver_dev_hint')}</div>${devs}` : '')
        + (addLogic.length || addOther.length || plan.shared.length ? `<h4>${T('ver_added_h')}</h4>${plan.shared.length ? `<div class="hint">${T('ver_added_shared', { list: plan.shared.map((x) => nm(x.k) + ' (' + esc(x.why) + ')').join(', ') })}</div>` : ''}${addLogic.length ? `<div class="hint">${addLogic.map(nm).join(', ')}</div><label class="chk"><input type="radio" name="vextra" value="off" checked>${T('ver_added_off')}</label><label class="chk"><input type="radio" name="vextra" value="delete">${T('ver_added_delete')}</label>` : ''}${addOther.length ? `<div class="hint">${T('ver_added_other', { list: addOther.map(nm).join(', ') })}</div>` : ''}` : '')
        // a backup of what's there now only when asked for: switching between saved versions shouldn't pile up copies
        // what's there now is kept: when it's already a saved version nothing needs saving; when it isn't, saving it
        // first is ticked (0.11.3: making another version active never loses what's there)
        + (p.savedAs ? `<div class="hint">${T('ver_now_saved_as', { name: esc(p.savedAs.name) })}</div>` : `<label class="chk vbackup"><input type="checkbox" name="vbackup" checked>${T('ver_restore_backup')}</label><div class="hint">${T('ver_restore_unsaved')}</div>`)
        + [...doms].filter((d) => d === 'automation' || d === 'script').map((d) => this._yamlWarn(d)).join('')
        + `<div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="ver-restore-go">${T('ver_restore')}</button></div></div>`;
      // a replaced device: Home Assistant's own device picker, or a plain list if it isn't loaded
      m.querySelectorAll('.vdevpick').forEach((box) => {
        const old = box.dataset.old;
        if (customElements.get('ha-selector')) {
          const sel = document.createElement('ha-selector');
          sel.hass = this._hass; sel.selector = { device: {} }; sel.label = T('ver_dev_pick'); sel.value = '';
          sel.addEventListener('value-changed', (e) => { p.devmap[old] = (e.detail && e.detail.value) || ''; });
          box.appendChild(sel);
        } else {
          const devs2 = this._devs.slice().sort((a, b) => (a.name_by_user || a.name || '').localeCompare(b.name_by_user || b.name || ''));
          box.innerHTML = `<select aria-label="${T('ver_dev_pick')}"><option value="">${T('ver_dev_keep')}</option>${devs2.map((d) => `<option value="${esc(d.id)}">${esc((d.name_by_user || d.name || d.id) + (d.model ? ' (' + d.model + ')' : ''))}</option>`).join('')}</select>`;
          box.querySelector('select').addEventListener('change', (e) => { p.devmap[old] = e.target.value; });
        }
      });
    },
    async _verRestoreGo() {
      const p = this._verPending, m = this._$.modal, val = m.querySelector('.aval'), btn = m.querySelector('[data-act="ver-restore-go"]');
      if (!p) return;
      const extra = (m.querySelector('input[name="vextra"]:checked') || { value: 'off' }).value, backup = !!(m.querySelector('input[name="vbackup"]') || {}).checked;
      const { label, v, plan } = p, snap = v.snapshot, map = Object.fromEntries(Object.entries(p.devmap).filter(([, x]) => x)), errs = [], name = (k) => (snap.items[k] && snap.items[k].name) || this._boxName(k);
      btn.disabled = true;
      val.textContent = T('ver_restoring');
      // what's there now is saved first if asked for; otherwise undo goes back to the version it already matches, if any
      let back = p.savedAs;
      if (backup) {
        try {
          const now = await this._verSnapshot(label);
          back = await this._ws({ type: 'functions_board/version_save', label, name: T('ver_before_name', { name: v.name }), desc: '', snapshot: now, print: verPrint(now), client: this._client() });
        } catch (e) { val.textContent = T('ver_not_saved', { e: (e && (e.message || e.code)) || e }); btn.disabled = false; return; }
      }
      const exists = (k) => !!(this._hass.states[k] || this._entMap.has(k));
      for (const k of plan.write.concat(plan.recreate)) {
        const it = snap.items[k], cfg = swapDevs(it.cfg, map);
        try {
          if (it.dom === 'automation' || it.dom === 'script') await this._saveCfg(it.dom, it.id, cfg);
          else if (VER_HELPERS.has(it.dom)) {
            if (exists(k)) await this._ws(Object.assign({}, cfg, { type: it.dom + '/update', [it.dom + '_id']: it.id }));
            else { const made = await this._ws(Object.assign({}, cfg, { type: it.dom + '/create' })); it.newId = made && made.id; }
          } else throw new Error('unsupported domain: ' + it.dom);
        } catch (e) { errs.push(name(k) + ': ' + ((e && (e.message || e.body || e.code)) || e)); }
      }
      // what came back, and what had left the function, wear its label again
      await this._clock.pause(plan.recreate.length ? 1500 : 200);
      const reg = await this._ws({ type: 'config/entity_registry/list' }, { fallback: [] });
      const findNew = (k) => { const it = snap.items[k], uid = it.newId || it.id; const e = reg.find((x) => x.platform === it.dom && x.unique_id === uid); return e ? e.entity_id : null; };
      for (const k of plan.rejoin.concat(plan.recreate)) {
        let id = plan.recreate.includes(k) ? findNew(k) : k;
        if (id && plan.recreate.includes(k) && id !== k) {
          const renamed = await this._ws({ type: 'config/entity_registry/update', entity_id: id, new_entity_id: k }, { optional: 'Home Assistant refuses an entity id already taken', fallback: false });
          if (renamed !== false) id = k;
        }
        if (id) { try { await this._label(id, label, true, false); } catch (e) { errs.push(name(k) + ': ' + ((e && e.message) || e)); } }
      }
      // what was added since and is shared only leaves the function (0.11.0)
      for (const x of plan.shared || []) {
        try { await this._label(x.k, label, false, false); } catch (e) { errs.push(this._boxName(x.k) + ': ' + ((e && (e.message || e.body || e.code)) || e)); }
      }
      // what was added since: turned off or deleted, as chosen; anything else is taken out of the function
      for (const k of plan.added) {
        const dom = k.split('.')[0];
        try {
          if (dom === 'automation') {
            const r = await this._ws({ type: 'automation/config', entity_id: k }, { optional: 'an automation or script without an id has no stored config', fallback: null }), aid = r && r.config && r.config.id;
            if (extra === 'delete' && aid) await this._api('DELETE', `config/automation/config/${encodeURIComponent(aid)}`);
            else await this._svc('automation', 'turn_off', { entity_id: k });
          } else if (dom === 'script') {
            const e = this._entMap.get(k), sid = (e && e.unique_id) || k.slice(7);
            if (extra === 'delete') await this._api('DELETE', `config/script/config/${encodeURIComponent(sid)}`);
          } else if (VER_HELPERS.has(dom)) {
            const e = this._entMap.get(k);
            if (extra === 'delete' && e && e.unique_id) await this._ws({ type: dom + '/delete', [dom + '_id']: e.unique_id });
          } else await this._label(k, label, false, false);
        } catch (e) { errs.push(this._boxName(k) + ': ' + ((e && (e.message || e.body || e.code)) || e)); }
      }
      // the board as it was laid out
      if (snap.layout) { this._data.layouts[label] = Object.assign(cleanLayout(JSON.parse(JSON.stringify(snap.layout))) || {}, { view: (this._data.layouts[label] || {}).view || null }); this._save(); }
      this._verPending = null;
      this._closeModal();
      this._store.changed('cfg:');
      this._ver = null;
      this._$.board.classList.remove('vview');
      try { history.replaceState(history.state, '', location.pathname); } catch (e) { /* fine */ }
      await this._ha.quiet(this._loadRegistries(), 'its calls to Home Assistant report their own failures');
      await this._open(label, true);
      // this version is what the function is made from now: noted with the fingerprint it has now (0.11.3), so it's the
      // active one even if Home Assistant wrote a config back a little differently
      try { await this._ws({ type: 'functions_board/version_active', label, version_id: v.id, print: verPrint(await this._verSnapshot(label)), client: this._client() }); }
      catch (e) { errs.push(T('ver_not_noted', { e: (e && (e.message || e.code)) || e })); }
      const undo = back && back.id ? [{ text: T('undo'), fn: () => this._verRestore(back.id) }] : [];
      this._toast(errs.length ? T('ver_restored_errs', { name: v.name, n: errs.length, list: errs.slice(0, 3).join('; ') }) : T('ver_restored', { name: v.name }), undo);
      if (this._drawer && this._drawer.mode === 'versions') this._renderVersions();
    },
    _restoreFn(lid) {
      if (!this._data.functions.includes(lid)) this._data.functions.push(lid);
      this._save();
      this._closeModal();
      this._history({ label: lid, text: T('put_back', { fnName: this._fnName(lid) }), undo: async () => this._takeOff(lid), redo: async () => { if (!this._data.functions.includes(lid)) this._data.functions.push(lid); this._save(); } });
      this._renderList();
      this._open(lid);
      this._toast(T('is_back_on_the_board', { fnName: this._fnName(lid) }));
    },

};
