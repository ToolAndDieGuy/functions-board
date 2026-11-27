import { P, T, cleanNotify, esc, nbDesc, nbSame, notifyPhones, notifyScript, notifyTargets, slugify, toList } from '../lib/index.js';

export const buildersPart = {
    /* ======================================================================================================
       part: builders: the builders (0.11.3): a script made from what the person picks (the notification builder),
       opened in it again while it's still what the builder made Owns _bld (PARTS): only its own methods use it; the
       other parts ask its methods.
       ====================================================================================================== */
    // the spec a script of the open function was made from, if a builder made it
    _bldSpec(key) {
      const label = this._data && this._data.ui.current, L = label && this._data.layouts[label];
      const b = L && L.builders && L.builders[key];
      return b && b.kind === 'notify' ? b.spec : null;
    },
    _bldHas(key) { return !this._ver && !!this._bldSpec(key); },
    // Edit on a script a builder made: the builder, while the script is still what it made; edited by hand past
    // that, Home Assistant's editor (and it says so)
    async _bldEdit(n) {
      const spec = this._bldSpec(n.key), cfg = spec ? await this._fetchConfig(n.key) : null;
      if (!spec || !nbSame(cfg, spec)) { if (spec) this._toast(T('nb_by_hand')); this._openItem(n, true); return; }
      this._bldOpen({ key: n.key, oid: this._itemId(n), spec: JSON.parse(JSON.stringify(spec)), name: cfg.alias || n.name, icon: cfg.icon || null, desc: nbDesc(cfg.description) });
    },
    // Recipes: the builders, each a script made from what's picked (the notification builder first)
    _bldMenu(btn) {
      this._menu(btn, [
        { act: 'nb-new', icon: 'mdi:bell-plus-outline', text: T('nb_button'), title: this._full() ? T('nb_new_t') : T('nb_new_t') + ' ' + T('full_manager_only_switch_it') },
      ], T('rcp_h'));
    },
    // a new notification for the open function
    _bldNew() {
      const tg = this._bldTargets();
      this._bldOpen({ key: null, oid: null, name: '', icon: null, desc: '',
        spec: { title: '', message: '', phones: [], people: [], speakers: [], tts: tg.tts.length ? tg.tts[0].id : null, say: '', speakAlways: false, level: 'normal', tag: '', buttons: [], wait: 30, timeout: [], clear: true, quiet: null } });
    },
    _bldOpen(b) {
      this._closeMenu();
      this._bld = Object.assign({ label: this._data.ui.current, sel: {}, kept: {}, qf: '22:00', qt: '07:00' }, b);
      this._bldShow();
    },
    _bldTargets() {
      return notifyTargets({ states: this._hass.states, entities: this._ents, devices: this._devs, services: (this._hass.services || {}).notify });
    },
    // the dialog, from what's picked so far (_bldRead keeps the form in _bld before it's drawn again)
    _bldShow() {
      const b = this._bld;
      if (!b || !this._data || this._data.ui.current !== b.label) return;
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
      this._clock.after('focus', 50, () => { const i = m.querySelector('input[name="nbname"]'); if (i) i.focus(); });
    },
    // what a button does (or what's done when nobody answers): Home Assistant's own action editor once it's loaded;
    // until then a script or scene to run, or what was set up there before
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
    // the scripts and scenes a button can run: the function's first
    _bldRunnable() {
      const b = this._bld, mine = new Set(this._model ? this._model.nodes.keys() : []), self = b.oid ? 'script.' + b.oid : null;
      const ids = Object.keys(this._hass.states).filter((k) => /^(script|scene)\./.test(k) && k !== self);
      ids.sort((x, y) => (mine.has(y) - mine.has(x)) || this._boxName(x).localeCompare(this._boxName(y)));
      return ids.map((k) => [(k.startsWith('scene.') ? 'scene:' : 'run:') + k, (k.startsWith('scene.') ? T('nb_scene_x', { name: this._boxName(k) }) : T('nb_run_x', { name: this._boxName(k) }))]);
    },
    _bldMount() {
      const b = this._bld, m = this._$.modal;
      this._ensureSelector().then((ok) => {
        if (!ok || this._bld !== b || !m.querySelector('.nbdlg')) return;
        m.querySelectorAll('.selbox[data-nbsel]').forEach((box) => {
          const k = box.dataset.nbsel, i = k === 'timeout' ? -1 : +k.slice(1), acts = i < 0 ? b.spec.timeout : (b.spec.buttons[i] || {}).then;
          const el = document.createElement('ha-selector');
          el.hass = this._hass; el.selector = { action: {} }; el.label = i < 0 ? T('nb_timeout') : T('nb_then'); el.value = toList(acts);
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
    // the form into _bld (as typed: cleanNotify keeps only what can be kept when it's saved)
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
    // the form's own switches: quiet hours' times and what happens on an answer show only when they matter
    _bldChange(t) {
      if (!this._bld || !t.closest || !t.closest('.nbdlg')) return false;
      const m = this._$.modal;
      if (t.name === 'nbq') { const r = m.querySelector('.nbqh'); if (r) r.hidden = !t.checked; }
      if (t.name === 'nbaway' && t.checked) { const p = m.querySelector(`input[name="nbp"][value="${CSS.escape(t.value)}"]`); if (p && !p.disabled) p.checked = true; }
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
    // what's wrong with it as picked, in words (null: it can be saved)
    _bldWhy(spec, name, raw) {
      if (!name) return T('nb_need_name');
      if (!spec.message.trim()) return T('nb_need_message');
      if (raw && Array.isArray(raw.buttons) && raw.buttons.some((b) => !String((b && b.title) || '').trim())) return T('nb_need_btn_title');
      if (!notifyPhones(spec).length && !(spec.tts && spec.speakers.length)) return T('nb_need_to');
      if (spec.buttons.length && !notifyPhones(spec).length) return T('nb_need_phone');
      return null;
    },
    // a new script's id: its name, as Home Assistant's script editor makes one, not taken
    _bldNewId(name) {
      const base = slugify(name) || 'notification';
      let id = base, n = 2;
      while (this._hass.states['script.' + id] || this._entMap.has('script.' + id)) id = base + '_' + n++;
      return id;
    },
    // Save: the script is written (Full manager only), its spec kept in the function's layout, and a new one put in
    // the function; one undo step
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
    // a script just made joins the function, once Home Assistant has it (it loads it after the save)
    async _bldLabel(key, label) {
      for (let i = 0; i < 50 && !this._hass.states[key]; i++) await this._clock.pause(200);
      for (let i = 0; i < 10; i++) {
        try { await this._label(key, label, true, true); return true; } catch (e) { await this._clock.pause(300); }
      }
      return false;
    },
    // Try in sandbox: the script as picked, saved or not, run once in the sandbox; its buttons can be pressed there
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
    // Home Assistant's editor, for what the builder doesn't do (and then it's the script as edited there)
    _bldHA() {
      const b = this._bld, n = this._model && this._model.nodes.get('script.' + b.oid);
      this._closeModal(); this._bld = null;
      if (n) this._openItem(n, true);
    },

};
