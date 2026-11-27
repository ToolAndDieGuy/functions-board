import { AUTO_RECIPE_KINDS, P, T, TPL_RECIPE_KINDS, autoDesc, autoSame, cleanAutoRecipe, cleanNotify, esc, generateAutoRecipe, nbDesc, nbSame, notifyPhones, notifyScript, notifyTargets, slugify, toList } from '../lib/index.js';

const galleryItems = () => [
  { cat: 'notify', act: 'nb-new', kind: 'notify', icon: 'mdi:bell-ring-outline', title: T('nb_button'), desc: T('rcp_d_notify'), badge: 'script' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_count', icon: 'mdi:counter', title: T('ts_r_count'), desc: T('ts_r_count_d'), badge: 'sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_any_all', icon: 'mdi:checkbox-multiple-marked-outline', title: T('ts_r_any_all'), desc: T('ts_r_any_all_d'), badge: 'binary_sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_list_names', icon: 'mdi:format-list-text', title: T('ts_r_list_names'), desc: T('ts_r_list_names_d'), badge: 'sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_duration', icon: 'mdi:timer-sand', title: T('ts_r_duration'), desc: T('ts_r_duration_d'), badge: 'sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_fallback', icon: 'mdi:backup-restore', title: T('ts_r_fallback'), desc: T('ts_r_fallback_d'), badge: 'sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_low_battery', icon: 'mdi:battery-alert-variant-outline', title: T('ts_r_low_battery'), desc: T('ts_r_low_battery_d'), badge: 'sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_band', icon: 'mdi:gauge', title: T('ts_r_band'), desc: T('ts_r_band_d'), badge: 'sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_math', icon: 'mdi:calculator-variant-outline', title: T('ts_r_math'), desc: T('ts_r_math_d'), badge: 'sensor' },
  { cat: 'template', act: 'ts-pick-recipe', kind: 'tpl_time_window', icon: 'mdi:clock-check-outline', title: T('ts_r_time_window'), desc: T('ts_r_time_window_d'), badge: 'binary_sensor' },
  { cat: 'automation', act: 'ar-new', kind: 'auto_left_open', icon: 'mdi:door-open', title: T('ar_left_open'), desc: T('ar_left_open_d'), badge: 'automation' },
  { cat: 'automation', act: 'ar-new', kind: 'auto_motion_light', icon: 'mdi:motion-sensor', title: T('ar_motion_light'), desc: T('ar_motion_light_d'), badge: 'automation' },
];

export const buildersPart = {
    /* ======================================================================================================
       part: builders: the builders & 12-Recipes Gallery (0.11.3 / 0.15.0): notification scripts, automation
       recipes (left-open alert, motion light), and gallery launch into Template Studio for 9 template helper
       recipes. Owns _bld (PARTS): only its own methods use it; the other parts ask its methods.
       ====================================================================================================== */
    // the builder record ({ kind, spec }) for a script, automation, or template helper in the open function
    _bldEntry(key) {
      const label = this._data && this._data.ui.current, L = label && this._data.layouts[label];
      const b = L && L.builders && L.builders[key];
      return b && b.kind && b.spec ? b : null;
    },
    _bldSpec(key) {
      const b = this._bldEntry(key);
      return b && b.kind === 'notify' ? b.spec : null;
    },
    _bldHas(key) { return !this._ver && !!this._bldEntry(key); },
    // Edit on a recipe-made item: reopens in its recipe while still unchanged; edited by hand, opens in HA's editor
    async _bldEdit(n) {
      const entry = this._bldEntry(n.key);
      if (!entry) { this._openItem(n, true); return; }
      if (TPL_RECIPE_KINDS.has(entry.kind)) { await this._tsEditRecipe(n, entry); return; }
      if (AUTO_RECIPE_KINDS.has(entry.kind)) {
        const cfg = await this._fetchConfig(n.key);
        if (!autoSame(cfg, entry.kind, entry.spec)) { this._toast(T('nb_by_hand')); this._openItem(n, true); return; }
        this._arOpen({ kind: entry.kind, key: n.key, oid: this._itemId(n), spec: JSON.parse(JSON.stringify(entry.spec)), name: cfg.alias || n.name, desc: autoDesc(cfg.description) });
        return;
      }
      const spec = entry.kind === 'notify' ? entry.spec : null, cfg = spec ? await this._fetchConfig(n.key) : null;
      if (!spec || !nbSame(cfg, spec)) { if (spec) this._toast(T('nb_by_hand')); this._openItem(n, true); return; }
      this._bldOpen({ key: n.key, oid: this._itemId(n), spec: JSON.parse(JSON.stringify(spec)), name: cfg.alias || n.name, icon: cfg.icon || null, desc: nbDesc(cfg.description) });
    },
    // Recipes menu: Template Studio, All 12 Recipes Gallery, plus direct shortcuts (keeps [data-act="nb-new"] for E2E)
    _bldMenu(btn) {
      const fullHint = this._full() ? '' : ' ' + T('full_manager_only_switch_it');
      this._menu(btn, [
        { act: 'ts-open', icon: 'mdi:code-braces-box', text: T('ts_menu_btn'), title: T('ts_menu_t') },
        { act: 'rcp-gallery', icon: 'mdi:book-open-variant', text: T('rcp_gallery_btn'), title: T('rcp_gallery_t') },
        { sep: true },
        { act: 'nb-new', icon: 'mdi:bell-plus-outline', text: T('nb_button'), title: T('nb_new_t') + fullHint },
        { act: 'ar-new', data: { kind: 'auto_left_open' }, icon: 'mdi:door-open', text: T('ar_left_open'), title: T('ar_left_open_d') + fullHint },
        { act: 'ar-new', data: { kind: 'auto_motion_light' }, icon: 'mdi:motion-sensor', text: T('ar_motion_light'), title: T('ar_motion_light_d') + fullHint },
      ], T('rcp_h'));
    },
    // Categorized searchable gallery of all 12 recipes
    _rcpGallery(cat, q) {
      this._closeMenu();
      this._bld = { mode: 'gallery', cat: cat || 'all', q: q || '' };
      this._rcpGalleryShow();
    },
    _rcpGalleryShow() {
      const b = this._bld, m = this._$.modal;
      if (!b || b.mode !== 'gallery') return;
      const q = (b.q || '').trim().toLowerCase();
      const cats = [
        ['all', T('all')],
        ['template', T('rcp_cat_template')],
        ['notify', T('rcp_cat_notify')],
        ['automation', T('rcp_cat_auto')],
      ];
      const badgeLabel = (k) => (k === 'sensor' ? T('ts_dom_sensor') : k === 'binary_sensor' ? T('ts_dom_binary') : k === 'script' ? T('script') : T('automation'));
      const items = galleryItems().filter((r) => (b.cat === 'all' || r.cat === b.cat) && (!q || r.title.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)));
      m.hidden = false;
      m.innerHTML = `<div class="dlg rcpdlg">
        <div class="rcphead">
          <div><h3><ha-icon icon="mdi:book-open-variant"></ha-icon> ${T('rcp_gallery_h')}</h3><div class="hint">${T('rcp_gallery_lead')}</div></div>
          <button class="chip" data-act="ts-open"><ha-icon icon="mdi:code-braces-box"></ha-icon>${T('ts_from_scratch')}</button>
        </div>
        <div class="rcpbar">
          <div class="rcpcats">${cats.map(([id, lbl]) => `<button class="chip${b.cat === id ? ' on' : ''}" data-act="rcp-cat" data-cat="${id}">${lbl}</button>`).join('')}</div>
          <input name="rcpq" value="${esc(b.q)}" placeholder="${esc(T('rcp_search_ph'))}" aria-label="${esc(T('rcp_search_ph'))}">
        </div>
        <div class="rcpgrid">${items.map((r) => `<button class="rcpcard" data-act="${r.act}" data-kind="${r.kind}"><div class="rcpctop"><ha-icon icon="${r.icon}"></ha-icon><b>${esc(r.title)}</b><span class="tsbadge">${esc(badgeLabel(r.badge))}</span></div><span>${esc(r.desc)}</span></button>`).join('') || `<div class="muted">${T('rcp_none')}</div>`}</div>
        <div class="btns"><button data-act="modal-cancel">${T('close')}</button></div>
      </div>`;
    },
    // a new notification for the open function
    _bldNew() {
      const tg = this._bldTargets();
      this._bldOpen({ key: null, oid: null, name: '', icon: null, desc: '',
        spec: { title: '', message: '', phones: [], people: [], speakers: [], tts: tg.tts.length ? tg.tts[0].id : null, say: '', speakAlways: false, level: 'normal', tag: '', buttons: [], wait: 30, timeout: [], clear: true, quiet: null } });
    },
    _bldOpen(b) {
      this._closeMenu();
      this._bld = Object.assign({ mode: 'notify', label: this._data.ui.current, sel: {}, kept: {}, qf: '22:00', qt: '07:00' }, b);
      this._bldShow();
    },
    _bldTargets() {
      return notifyTargets({ states: this._hass.states, entities: this._ents, devices: this._devs, services: (this._hass.services || {}).notify });
    },
    // the dialog, from what's picked so far (_bldRead keeps the form in _bld before it's drawn again)
    _bldShow() {
      const b = this._bld;
      if (!b || b.mode !== 'notify' || !this._data || this._data.ui.current !== b.label) return;
      const s = b.spec, tg = this._bldTargets(), m = this._$.modal, full = this._full();
      b.targets = tg; b.sel = {}; b.kept = {};
      const ck = (name, value, on, text, more) => `<label class="chk"><input type="checkbox" name="${name}" value="${esc(value)}"${on ? ' checked' : ''}${more || ''}>${text}</label>`;
      const os = (p) => (p.os === 'ios' ? 'iOS' : 'Android');
      const ppl = new Map(s.people.map((p) => [p.id, p])), ph = new Set(s.phones.map((p) => p.svc)), sp = new Set(s.speakers);
      const people = tg.people.map((p) => {
        const on = ppl.get(p.id), has = p.phones.length > 0;
        return `<div class="nbrow">${ck('nbp', p.id, !!on && has, `${esc(p.name)} <span class="muted">${has ? esc(p.phones.map((x) => `${x.name} (${os(x)})`).join(', ')) : T('nb_no_phone')}</span>`, has ? '' : ' disabled')}${has ? ck('nbaway', p.id, !!(on && on.away), T('nb_only_away')) : ''}</div>`;
      }).join('');
      const phones = tg.phones.map((p) => ck('nbph', p.svc, ph.has(p.svc), `${esc(p.name)} <span class="muted">${os(p)}</span>`)).join('');
      const opt = (v, l, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
      const speak = tg.tts.length ? `<label>${T('nb_tts')}<select name="nbtts">${opt('', T('nb_no_speaking'), !s.tts)}${tg.tts.map((x) => opt(x.id, x.name, s.tts === x.id)).join('')}</select></label>`
        + `<div class="nblist" role="group" aria-label="${esc(T('nb_speakers'))}">${tg.speakers.map((x) => ck('nbsp', x.id, sp.has(x.id), esc(x.name))).join('') || `<span class="muted">${T('nb_no_speakers')}</span>`}</div>`
        + `<label>${T('nb_say')}<input name="nbsay" value="${esc(s.say)}" placeholder="${esc(T('nb_say_ph'))}"></label>${ck('nbalways', '1', s.speakAlways, T('nb_always'))}`
        : `<span class="muted">${T('nb_no_tts')}</span>`;
      const lv = [['normal', T('nb_l_normal')], ['time', T('nb_l_time')], ['critical', T('nb_l_critical')]];
      const btns = s.buttons.map((x, i) => `<div class="nbbtn"><div class="nbrow"><label class="nbgrow">${T('nb_button_n', { n: i + 1 })}<input name="nbbt" value="${esc(x.title)}" maxlength="64" placeholder="${esc(T('nb_button_ph'))}"></label><button class="chip" data-act="nb-del-btn" data-i="${i}" title="${esc(T('nb_del_btn_t'))}">${T('remove')}</button></div><div class="selbox" data-nbsel="b${i}">${this._bldActSel('b' + i, x.then, T('nb_then'))}</div></div>`).join('');
      m.hidden = false;
      m.innerHTML = `<div class="dlg nbdlg"><h3>${b.oid ? T('nb_h_edit', { name: esc(b.name) }) : T('nb_h')}</h3><div class="nbbody">
        <div class="hint">${T('nb_lead')}</div>
        <label>${T('name')}<input name="nbname" value="${esc(b.name)}" placeholder="${esc(T('nb_name_ph'))}"></label>
        <label>${T('description')}<input name="nbdesc" value="${esc(b.desc)}"></label>
        <fieldset><legend>${T('nb_what')}</legend><label>${T('nb_title')}<input name="nbtitle" value="${esc(s.title)}" maxlength="200"></label><label>${T('nb_message')}<textarea name="nbmsg" rows="3" maxlength="4000">${esc(s.message)}</textarea></label><div class="hint">${T('nb_tpl_hint')}</div></fieldset>
        <fieldset><legend>${T('nb_to')}</legend>${people ? `<div class="nbsub">${T('nb_people')}</div>${people}` : ''}${phones ? `<div class="nbsub">${T('nb_phones')}</div><div class="nbrow">${phones}</div>` : ''}${people || phones ? '' : `<span class="muted">${T('nb_no_phones')}</span>`}</fieldset>
        <fieldset><legend>${T('nb_speak')}</legend>${speak}</fieldset>
        <fieldset><legend>${T('nb_how')}</legend><label>${T('nb_level')}<select name="nblevel">${lv.map(([v, l]) => opt(v, l, s.level === v)).join('')}</select></label>
          <label>${T('nb_tag')}<input name="nbtag" value="${esc(s.tag)}" maxlength="64" placeholder="${esc(T('nb_tag_ph'))}"></label>
          ${ck('nbq', '1', !!s.quiet, T('nb_quiet'))}<div class="nbrow nbqh"${s.quiet ? '' : ' hidden'}><label>${T('nb_from')}<input type="time" name="nbqf" value="${esc(s.quiet ? s.quiet.from : b.qf)}"></label><label>${T('nb_until')}<input type="time" name="nbqt" value="${esc(s.quiet ? s.quiet.to : b.qt)}"></label></div><div class="hint">${T('nb_quiet_hint')}</div></fieldset>
        <fieldset><legend>${T('nb_buttons')}</legend><div class="hint">${T('nb_buttons_hint')}</div>${btns}${s.buttons.length < 3 ? `<div><button class="chip" data-act="nb-add-btn"><ha-icon icon="mdi:plus"></ha-icon>${T('nb_add_btn')}</button></div>` : ''}
          <div class="nbans"${s.buttons.length ? '' : ' hidden'}><label>${T('nb_wait')}<input type="number" name="nbwait" min="1" max="1440" value="${esc(s.wait)}"></label><div class="selbox" data-nbsel="timeout">${this._bldActSel('timeout', s.timeout, T('nb_timeout'))}</div>${ck('nbclear', '1', s.clear, T('nb_clear'))}</div></fieldset>
        <div class="aval" role="alert"></div></div>
        <div class="btns">${b.oid ? `<button data-act="nb-ha">${T('nb_ha')}</button>` : ''}<button data-act="nb-try" title="${esc(T('nb_try_t'))}">${T('ver_try')}</button><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="nb-save"${full ? '' : ` disabled title="${esc(T('full_manager_only_switch_it'))}"`}>${T('save')}</button></div></div>`;
      this._bldMount();
      this._clock.after('focus', 50, () => { const i = m.querySelector('input[name="nbname"]'); if (i && !m.contains(this.shadowRoot.activeElement)) i.focus(); });
    },
    _bldActSel(k, acts, text) {
      const b = this._bld, cur = this._bldActKey(acts), opts = [['', T('nb_nothing')]].concat(this._bldRunnable());
      if (cur === 'keep') { b.kept[k] = acts; opts.push(['keep', P('nb_as_set_up', acts.length)]); }
      return `<label>${text}<select data-nbact="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    },
    _bldActKey(acts) {
      const a = toList(acts);
      if (!a.length) return '';
      if (a.length === 1 && Object.keys(a[0]).length === 1 && /^script\.[a-z0-9_]+$/.test(a[0].action || '')) return 'run:' + a[0].action;
      if (a.length === 1 && a[0].action === 'scene.turn_on' && a[0].target && typeof a[0].target.entity_id === 'string' && Object.keys(a[0]).length === 2) return 'scene:' + a[0].target.entity_id;
      return 'keep';
    },
    _bldRunnable() {
      const b = this._bld, mine = new Set(this._model ? this._model.nodes.keys() : []), self = b.oid && b.mode === 'notify' ? 'script.' + b.oid : null;
      const ids = Object.keys(this._hass.states).filter((k) => /^(script|scene)\./.test(k) && k !== self);
      ids.sort((x, y) => (mine.has(y) - mine.has(x)) || this._boxName(x).localeCompare(this._boxName(y)));
      return ids.map((k) => [(k.startsWith('scene.') ? 'scene:' : 'run:') + k, (k.startsWith('scene.') ? T('nb_scene_x', { name: this._boxName(k) }) : T('nb_run_x', { name: this._boxName(k) }))]);
    },
    _bldMount() {
      const b = this._bld, m = this._$.modal;
      this._ensureSelector().then((ok) => {
        if (!ok || this._bld !== b || !m.querySelector('.nbdlg, .ardlg')) return;
        m.querySelectorAll('.selbox[data-nbsel]').forEach((box) => {
          const k = box.dataset.nbsel;
          const acts = b.mode === 'auto' ? (k === 'cleared' ? b.spec.cleared : b.spec.then)
            : (k === 'timeout' ? b.spec.timeout : (b.spec.buttons[+k.slice(1)] || {}).then);
          const el = document.createElement('ha-selector');
          el.hass = this._hass; el.selector = { action: {} };
          el.label = b.mode === 'auto' ? (k === 'cleared' ? T('ar_cleared_act') : T('ar_then_act')) : (k === 'timeout' ? T('nb_timeout') : T('nb_then'));
          el.value = toList(acts);
          b.sel[k] = toList(acts);
          el.addEventListener('value-changed', (e) => { e.stopPropagation(); b.sel[k] = toList(e.detail.value); el.value = e.detail.value; });
          box.innerHTML = ''; box.appendChild(el);
        });
      });
    },
    _bldActs(k) {
      const b = this._bld;
      if (b.sel[k] !== undefined) return b.sel[k];
      const e = this._$.modal.querySelector(`select[data-nbact="${k}"]`), v = e ? e.value : '';
      if (v === 'keep') return b.kept[k] || [];
      if (v.startsWith('run:')) return [{ action: v.slice(4) }];
      if (v.startsWith('scene:')) return [{ action: 'scene.turn_on', target: { entity_id: v.slice(6) } }];
      return [];
    },
    _bldRead() {
      const b = this._bld, s = b.spec, tg = b.targets, m = this._$.modal, q = (x) => m.querySelector(x);
      if (!q('.nbdlg')) return;
      const val = (n) => { const e = q(`[name="${n}"]`); return e ? e.value : ''; };
      const on = (n, v) => !!q(`input[name="${n}"][value="${CSS.escape(v)}"]:checked`);
      b.name = val('nbname').trim(); b.desc = val('nbdesc').trim();
      s.title = val('nbtitle'); s.message = val('nbmsg');
      s.people = tg.people.filter((p) => on('nbp', p.id)).map((p) => ({ id: p.id, away: on('nbaway', p.id), phones: p.phones }));
      s.phones = tg.phones.filter((p) => on('nbph', p.svc));
      if (q('[name="nbtts"]')) { s.tts = val('nbtts') || null; s.speakers = tg.speakers.filter((x) => on('nbsp', x.id)).map((x) => x.id); s.say = val('nbsay'); s.speakAlways = on('nbalways', '1'); }
      s.level = val('nblevel') || 'normal'; s.tag = val('nbtag').trim();
      b.qf = val('nbqf') || b.qf; b.qt = val('nbqt') || b.qt;
      s.quiet = on('nbq', '1') ? { from: b.qf, to: b.qt } : null;
      s.buttons = [...m.querySelectorAll('input[name="nbbt"]')].map((e, i) => ({ title: e.value, then: this._bldActs('b' + i) }));
      if (q('[name="nbwait"]')) s.wait = +val('nbwait') || 30;
      s.timeout = this._bldActs('timeout'); s.clear = on('nbclear', '1');
    },
    _bldChange(t) {
      if (!this._bld || !t.closest || !t.closest('.nbdlg, .ardlg')) return false;
      const m = this._$.modal;
      if (t.name === 'nbq') { const r = m.querySelector('.nbqh'); if (r) r.hidden = !t.checked; }
      if (t.name === 'nbaway' && t.checked) { const p = m.querySelector(`input[name="nbp"][value="${CSS.escape(t.value)}"]`); if (p && !p.disabled) p.checked = true; }
      return true;
    },
    _bldInput(t) {
      if (!this._bld || this._bld.mode !== 'gallery' || t.name !== 'rcpq') return false;
      this._bld.q = t.value;
      const pos = t.selectionStart;
      this._rcpGalleryShow();
      const ni = this._$.modal.querySelector('input[name="rcpq"]');
      if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (e) { /* non-selectable */ } }
      return true;
    },
    _bldButton(add, i) {
      this._bldRead();
      const s = this._bld.spec;
      if (add && s.buttons.length < 3) s.buttons.push({ title: '', then: [] });
      if (!add) s.buttons.splice(i, 1);
      this._bldShow();
      const ins = this._$.modal.querySelectorAll('input[name="nbbt"]');
      if (add && ins.length) ins[ins.length - 1].focus();
    },
    _bldWhy(spec, name, raw) {
      if (!name) return T('nb_need_name');
      if (!spec.message.trim()) return T('nb_need_message');
      if (raw && Array.isArray(raw.buttons) && raw.buttons.some((b) => !String((b && b.title) || '').trim())) return T('nb_need_btn_title');
      if (!notifyPhones(spec).length && !(spec.tts && spec.speakers.length)) return T('nb_need_to');
      if (spec.buttons.length && !notifyPhones(spec).length) return T('nb_need_phone');
      return null;
    },
    _bldNewId(name) {
      const base = slugify(name) || 'notification';
      let id = base, n = 2;
      while (this._hass.states['script.' + id] || this._entMap.has('script.' + id)) id = base + '_' + n++;
      return id;
    },
    async _bldSave() {
      if (!this._full()) return;
      this._bldRead();
      const b = this._bld, m = this._$.modal, val = m.querySelector('.aval'), btn = m.querySelector('[data-act="nb-save"]');
      const spec = cleanNotify(b.spec), why = this._bldWhy(spec, b.name, b.spec);
      if (why) { val.textContent = why; return; }
      const label = b.label, oid = b.oid || this._bldNewId(b.name), key = 'script.' + oid;
      const cfg = notifyScript(spec, { alias: b.name, icon: b.icon, description: b.desc });
      const before = b.oid ? await this._fetchConfig(key) : null, L = this._layout(label), had = L.builders && L.builders[key] ? L.builders[key].spec : null;
      btn.disabled = true;
      const put = async (c, sp) => {
        await this._saveCfg('script', oid, c);
        const LL = this._layout(label);
        LL.builders = Object.assign({}, LL.builders || {});
        if (sp) LL.builders[key] = { kind: 'notify', spec: sp }; else delete LL.builders[key];
        this._save();
      };
      try { await put(cfg, spec); } catch (e) { val.textContent = T('nb_not_saved', { e: (e && (e.message || e.code)) || e }); btn.disabled = false; return; }
      let labelled = null;
      if (!b.oid) labelled = await this._bldLabel(key, label);
      this._closeModal();
      this._bld = null;
      const gone = async () => {
        await this._api('DELETE', `config/script/config/${encodeURIComponent(oid)}`);
        this._store.changed('cfg:');
        const LL = this._layout(label); LL.builders = Object.assign({}, LL.builders || {}); delete LL.builders[key]; this._save();
      };
      this._history({
        label, text: b.oid ? T('nb_step_edit', { name: b.name }) : T('nb_step_new', { name: b.name }),
        undo: () => (before ? put(before, had) : gone()),
        redo: async () => { await put(cfg, spec); if (!before) await this._bldLabel(key, label); },
      });
      this._toast(b.oid ? T('nb_saved', { name: b.name }) : labelled === false ? T('nb_made_unlabelled', { name: b.name }) : T('nb_made', { name: b.name, fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
    },
    async _bldLabel(key, label) {
      for (let i = 0; i < 50 && !this._hass.states[key]; i++) await this._clock.pause(200);
      for (let i = 0; i < 10; i++) {
        try { await this._label(key, label, true, true); return true; } catch (e) { await this._clock.pause(300); }
      }
      return false;
    },
    async _bldTry() {
      this._bldRead();
      const b = this._bld, spec = cleanNotify(b.spec), why = this._bldWhy(spec, b.name || T('nb_default_name'), b.spec);
      if (why) { this._$.modal.querySelector('.aval').textContent = why; return; }
      const key = 'script.' + (b.oid || this._bldNewId(b.name || T('nb_default_name')));
      const cfg = notifyScript(spec, { alias: b.name || T('nb_default_name'), icon: b.icon, description: b.desc });
      this._closeModal();
      await this._openSandbox({ extra: { id: key, cfg } });
      if (!this._sbxOn()) return;
      this._toast(T('nb_tried', { name: b.name || T('nb_default_name') }), [{ text: T('nb_back'), fn: () => this._bldShow() }]);
      await this._sbxStep({ op: 'run', id: key, conds: true });
    },
    _bldHA() {
      const b = this._bld, n = this._model && this._model.nodes.get('script.' + b.oid);
      this._closeModal(); this._bld = null;
      if (n) this._openItem(n, true);
    },

    // ---- Automation Recipes (#11 Left-open / Left-on alert, #12 Motion-activated light) ----
    _arNew(kind) {
      const k = AUTO_RECIPE_KINDS.has(kind) ? kind : 'auto_left_open';
      this._arOpen({ kind: k, key: null, oid: null, name: '', desc: '', spec: cleanAutoRecipe(k, {}) });
    },
    _arOpen(b) {
      this._closeMenu();
      this._bld = Object.assign({ mode: 'auto', label: this._data.ui.current, sel: {}, kept: {} }, b);
      this._arShow();
    },
    _arShow() {
      const b = this._bld;
      if (!b || b.mode !== 'auto' || !this._data || this._data.ui.current !== b.label) return;
      const s = b.spec, m = this._$.modal, full = this._full();
      b.sel = {}; b.kept = {};
      const mine = new Set(this._model ? this._model.nodes.keys() : []);
      const listOf = (re) => Object.keys(this._hass.states).filter((k) => !re || re.test(k)).sort((a, c) => (mine.has(c) - mine.has(a)) || this._boxName(a).localeCompare(this._boxName(c)));
      const opt = (v, l, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
      const ck = (name, value, on, text) => `<label class="chk"><input type="checkbox" name="${name}" value="${esc(value)}"${on ? ' checked' : ''}>${text}</label>`;
      let body = '';
      if (b.kind === 'auto_left_open') {
        const ents = listOf(/^(cover|binary_sensor|lock|light|switch|fan|input_boolean)\./);
        const conds = listOf(/^(input_boolean|binary_sensor|person|switch)\./);
        body = `<label>${T('ar_watch_ent')}<select name="ar_ent">${opt('', T('ts_pick_entity'), !s.entity)}${ents.map((k) => opt(k, `${this._boxName(k)} (${k})`, s.entity === k)).join('')}</select></label>
          <div class="tsrow2"><label>${T('ar_watch_state')}<input name="ar_state" value="${esc(s.state)}" placeholder="open"></label><label>${T('ar_for_min')}<input type="number" name="ar_min" min="1" max="1440" value="${esc(s.minutes)}"></label></div>
          <div class="selbox" data-nbsel="then">${this._bldActSel('then', s.then, T('ar_then_act'))}</div>
          <div class="tsrow2"><label>${T('ar_repeat_min')}<input type="number" name="ar_rep" min="0" max="1440" value="${esc(s.repeat)}"></label>
          <label>${T('ar_only_if')}<select name="ar_cond">${opt('', T('ar_always'), !s.conditionEntity)}${conds.map((k) => opt(k, this._boxName(k), s.conditionEntity === k)).join('')}</select></label></div>
          <div class="selbox" data-nbsel="cleared">${this._bldActSel('cleared', s.cleared, T('ar_cleared_act'))}</div>`;
      } else {
        const sens = listOf(/^(binary_sensor|input_boolean)\./), lights = listOf(/^(light|switch)\./), lux = listOf(/^sensor\./), ovr = listOf(/^input_boolean\./);
        const sSet = new Set(s.sensors), lSet = new Set(s.lights);
        body = `<fieldset><legend>${T('ar_motion_sens')}</legend><div class="nblist">${sens.slice(0, 60).map((k) => ck('ar_sens', k, sSet.has(k), esc(this._boxName(k)))).join('') || `<span class="muted">${T('ts_ents_none')}</span>`}</div></fieldset>
          <fieldset><legend>${T('ar_target_lights')}</legend><div class="nblist">${lights.slice(0, 60).map((k) => ck('ar_lights', k, lSet.has(k), esc(this._boxName(k)))).join('') || `<span class="muted">${T('ts_ents_none')}</span>`}</div></fieldset>
          <div class="tsrow2"><label>${T('ar_off_after')}<input type="number" name="ar_to" min="1" max="240" value="${esc(s.timeout)}"></label><label>${T('ar_brightness')}<input type="number" name="ar_bri" min="0" max="100" value="${esc(s.brightness)}" placeholder="0 = default"></label></div>
          ${ck('ar_dark', '1', s.onlyDark, T('ar_only_dark'))}
          <div class="tsrow2"><label>${T('ar_lux_ent')}<select name="ar_lux">${opt('', T('ts_none'), !s.luxEntity)}${lux.slice(0, 80).map((k) => opt(k, this._boxName(k), s.luxEntity === k)).join('')}</select></label><label>${T('ar_lux_below')}<input type="number" name="ar_luxv" min="0" max="100000" value="${esc(s.luxBelow)}"></label></div>
          <label>${T('ar_override')}<select name="ar_ovr">${opt('', T('ts_none'), !s.overrideEntity)}${ovr.map((k) => opt(k, this._boxName(k), s.overrideEntity === k)).join('')}</select></label>`;
      }
      const title = b.kind === 'auto_left_open' ? T('ar_left_open') : T('ar_motion_light');
      const desc = b.kind === 'auto_left_open' ? T('ar_left_open_d') : T('ar_motion_light_d');
      m.hidden = false;
      m.innerHTML = `<div class="dlg nbdlg ardlg"><h3>${b.oid ? T('nb_h_edit', { name: esc(b.name) }) : title}</h3><div class="nbbody">
        <div class="hint">${desc}</div>
        <label>${T('name')}<input name="arname" value="${esc(b.name)}" placeholder="${esc(title)}"></label>
        <label>${T('description')}<input name="ardesc" value="${esc(b.desc)}"></label>
        ${body}
        <div class="aval" role="alert"></div></div>
        <div class="btns">${b.oid ? `<button data-act="ar-ha">${T('ar_open_ha')}</button>` : ''}<button data-act="ar-try" title="${esc(T('ar_try_t'))}">${T('ver_try')}</button><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="ar-save"${full ? '' : ` disabled title="${esc(T('full_manager_only_switch_it'))}"`}>${T('save')}</button></div></div>`;
      if (b.kind === 'auto_left_open') this._bldMount();
      this._clock.after('focus', 50, () => { const i = m.querySelector('input[name="arname"]'); if (i && !m.contains(this.shadowRoot.activeElement)) i.focus(); });
    },
    _arRead() {
      const b = this._bld, s = b.spec, m = this._$.modal, q = (x) => m.querySelector(x);
      if (!q('.ardlg')) return;
      const val = (n) => { const e = q(`[name="${n}"]`); return e ? e.value : ''; };
      b.name = val('arname').trim(); b.desc = val('ardesc').trim();
      if (b.kind === 'auto_left_open') {
        s.entity = val('ar_ent'); s.state = val('ar_state').trim() || 'open';
        s.minutes = +val('ar_min') || 10; s.repeat = +val('ar_rep') || 0;
        s.conditionEntity = val('ar_cond');
        s.then = this._bldActs('then'); s.cleared = this._bldActs('cleared');
      } else {
        s.sensors = [...m.querySelectorAll('input[name="ar_sens"]:checked')].map((x) => x.value);
        s.lights = [...m.querySelectorAll('input[name="ar_lights"]:checked')].map((x) => x.value);
        s.timeout = +val('ar_to') || 5; s.brightness = +val('ar_bri') || 0;
        s.onlyDark = !!q('input[name="ar_dark"]:checked');
        s.luxEntity = val('ar_lux'); s.luxBelow = +val('ar_luxv') || 50;
        s.overrideEntity = val('ar_ovr');
      }
    },
    _arWhy(kind, spec, name) {
      if (!name) return T('nb_need_name');
      if (kind === 'auto_left_open') {
        if (!spec.entity) return T('ts_need_entity');
        if (!spec.then.length) return T('ar_need_then');
      } else {
        if (!spec.sensors.length) return T('ar_need_sensor');
        if (!spec.lights.length) return T('ar_need_light');
      }
      return null;
    },
    async _arSave() {
      if (!this._full()) return;
      this._arRead();
      const b = this._bld, m = this._$.modal, val = m.querySelector('.aval'), btn = m.querySelector('[data-act="ar-save"]');
      const spec = cleanAutoRecipe(b.kind, b.spec), why = this._arWhy(b.kind, spec, b.name);
      if (why) { val.textContent = why; return; }
      const label = b.label, oid = b.oid || String(Date.now());
      const cfg = generateAutoRecipe(b.kind, spec, { alias: b.name, description: b.desc });
      const before = b.oid && b.key ? await this._fetchConfig(b.key) : null;
      const L = this._layout(label), had = b.key && L.builders && L.builders[b.key] ? L.builders[b.key] : null;
      btn.disabled = true;
      let key = b.key;
      try {
        await this._saveCfg('automation', oid, Object.assign({ id: oid }, cfg));
        if (!key) {
          for (let i = 0; i < 30 && !key; i++) {
            const match = Object.entries(this._hass.states).find(([k, st]) => k.startsWith('automation.') && st && st.attributes && String(st.attributes.id) === String(oid));
            if (match) key = match[0];
            else await this._clock.pause(200);
          }
          if (!key) key = 'automation.' + slugify(b.name);
          await this._bldLabel(key, label);
        }
        const LL = this._layout(label);
        LL.builders = Object.assign({}, LL.builders || {});
        LL.builders[key] = { kind: b.kind, spec };
        this._save();
      } catch (e) { val.textContent = T('nb_not_saved', { e: (e && (e.message || e.code)) || e }); btn.disabled = false; return; }
      this._closeModal();
      this._bld = null;
      const finalKey = key;
      this._history({
        label, text: b.oid ? T('nb_step_edit', { name: b.name }) : T('nb_step_new', { name: b.name }),
        undo: async () => {
          if (before) await this._saveCfg('automation', oid, before);
          else await this._api('DELETE', `config/automation/config/${encodeURIComponent(oid)}`);
          this._store.changed('cfg:');
          const LL = this._layout(label); LL.builders = Object.assign({}, LL.builders || {});
          if (had) LL.builders[finalKey] = had; else delete LL.builders[finalKey];
          this._save();
        },
        redo: async () => {
          await this._saveCfg('automation', oid, Object.assign({ id: oid }, cfg));
          if (!before) await this._bldLabel(finalKey, label);
          const LL = this._layout(label); LL.builders = Object.assign({}, LL.builders || {}); LL.builders[finalKey] = { kind: b.kind, spec }; this._save();
        },
      });
      this._toast(b.oid ? T('nb_saved', { name: b.name }) : T('nb_made', { name: b.name, fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
    },
    async _arTry() {
      this._arRead();
      const b = this._bld, name = b.name || (b.kind === 'auto_left_open' ? T('ar_left_open') : T('ar_motion_light'));
      const spec = cleanAutoRecipe(b.kind, b.spec), why = this._arWhy(b.kind, spec, name);
      if (why) { this._$.modal.querySelector('.aval').textContent = why; return; }
      const key = b.key || 'automation.' + slugify(name);
      const cfg = generateAutoRecipe(b.kind, spec, { alias: name, description: b.desc });
      this._closeModal();
      await this._openSandbox({ extra: { id: key, cfg } });
      if (!this._sbxOn()) return;
      this._toast(T('nb_tried', { name }), [{ text: T('nb_back'), fn: () => this._arShow() }]);
    },
    _arHA() {
      const b = this._bld, n = b && b.key && this._model && this._model.nodes.get(b.key);
      this._closeModal(); this._bld = null;
      if (n) this._openItem(n, true);
    },
};
