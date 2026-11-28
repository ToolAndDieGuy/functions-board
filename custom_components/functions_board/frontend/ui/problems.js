import { EXACT_RE, P, QUIET_DAYS, T, TGT_RE, analyze, bothWays, cleanCheck, condText, esc, findProblems, findQuietAutomations, fmtDurLong, markProblems, probKey, runCheck, sbxDoStep, sbxZwLabel, shorten, splitDismissed, uid } from '../lib/index.js';

export const problemsPart = {
    /* ======================================================================================================
       part: problems: problems and saved checks: counting, the drawer, dismissing, replaying checks Owns _probs,
       _checkRes, _probScanning, _chkEdit (PARTS): only its own methods use them; the other parts ask its methods.
       ====================================================================================================== */
    _checkCompact() {
      // narrow board (phone, small dashboard column): the list becomes a drawer over the board, closed by default.
      // A detached or hidden board reports width 0: that says nothing about its size, so keep the mode.
      const w = this._$.board.clientWidth;
      if (!w || !this.isConnected) return;
      const c = w < 760;
      if (c === !!this._compact) return;
      this._compact = c; this._listOpen = false; this._legendOpen = false;
      this._$.board.classList.toggle('compact', c);
      this._renderList(); this._renderLegend();
      if (this._model && this._data) {
        // the board changed size class (window resized, phone rotated): use that size's own view
        const v = this._viewFor(this._model.label);
        if (v) { this._view = Object.assign({ x: 40, y: 40, k: 1 }, v); this._applyView(); } else this._fit();
      }
    },
    /* ---------- saved checks (0.9.0): keep a sandbox run with what should come of it; replayed on the current
       configs after every change, a failing one is a problem ---------- */
    // the states a check starts from: the function's own entities and what they point at (big attributes left out)
    _checkStart(states) {
      const out = {}, m = this._model;
      if (!m) return out;
      [...m.nodes.keys()].filter((k) => EXACT_RE.test(k) && states[k]).forEach((k) => {
        const a = {};
        Object.entries(states[k].attributes || {}).forEach(([n, v]) => { try { if (JSON.stringify(v).length <= 400) a[n] = v; } catch (e) { /* not kept */ } });
        out[k] = { state: String(states[k].state), attributes: a };
      });
      return out;
    },
    _checkName(k) { return this._model && this._model.nodes.has(k) ? this._model.nodes.get(k).name : this._nameOf(k); },
    _chkStepText(s) {
      const nm = (k) => esc(this._checkName(k));
      if (s.op === 'set' && s.attrs && s.state == null) return T('chk_s_attr', { name: nm(s.id), what: esc(Object.entries(s.attrs).map(([k, v]) => `${k} ${v}`).join(', ')) });
      if (s.op === 'set') return T('chk_s_set', { name: nm(s.id), state: esc(s.attrs && s.attrs.event_type ? s.attrs.event_type : s.state) });
      if (s.op === 'press') return T('chk_s_press', { what: esc(((() => { try { const o = JSON.parse(s.key); return [o.type, o.subtype].filter(Boolean).join(' · '); } catch (e) { return ''; } })()) || '') });
      if (s.op === 'zwave') {
        const z = this._sbx && this._sbx.eng && this._sbx.eng.zw.get(s.dev), v = z && z.byId.get(s.id);
        return T('chk_s_zwave', { dev: nm('device:' + s.dev), what: esc((v && (v.label || v.property_name || v.property)) || s.id), val: esc(v ? sbxZwLabel(v, s.value) : String(s.value)) });
      }
      if (s.op === 'behave') return T('chk_s_behave', { name: nm(s.id), how: esc(s.how === 'slow' && s.ms ? `${s.how} (${fmtDurLong(s.ms)})` : s.how) });
      if (s.op === 'ha') return s.event === 'shutdown' ? T('sbx_ha_stops') : T('sbx_ha_starts');
      if (s.op === 'webhook') return T('sbx_webhook_called', { id: esc(s.id) });
      if (s.op === 'tag') return T('sbx_tag_scanned', { tag: esc(s.tag) });
      if (s.op === 'calendar') return s.event === 'end' ? T('sbx_cal_ends', { name: nm(s.id), summary: esc(s.summary) }) : T('sbx_cal_starts', { name: nm(s.id), summary: esc(s.summary) });
      if (s.op === 'say') return T('sbx_said', { s: esc(s.text) });
      if (s.op === 'event') return T('chk_s_event', { type: esc(s.type) });
      if (s.op === 'mqtt') return T('chk_s_mqtt', { topic: esc(s.topic), payload: esc(shorten(s.payload, 40)) });
      if (s.op === 'run') return T('chk_s_run', { name: nm(s.id) });
      if (s.op === 'advance') return T('chk_s_advance', { dur: esc(fmtDurLong(s.ms)) });
      return T('chk_s_next');
    },
    // what the run in the sandbox suggests checking: states that changed, and how each automation and script ended
    _checkSuggest() {
      const g = this._sbx, eng = g.eng, out = [];
      // what the function changed (whatever you set yourself is a step, not an outcome), as it ended
      const byFn = new Set(eng.log.filter((e) => e.kind === 'state' && e.by !== 'you' && EXACT_RE.test(e.key || '') && !/^(automation|script)\./.test(e.key)).map((e) => e.key));
      byFn.forEach((k) => { const v = eng.get(k); if (v) out.push({ x: { k: 'state', id: k, state: String(v.state) }, on: true }); });
      const runs = new Map();
      eng.log.filter((e) => e.kind === 'run').forEach((e) => { const r = runs.get(e.key) || []; r.push(e.outcome); runs.set(e.key, r); });
      runs.forEach((r, k) => { if (r.includes('finished')) out.push({ x: { k: 'ran', id: k }, on: true }); else if (r.includes('stopped')) out.push({ x: { k: 'stopped', id: k }, on: true }); });
      [...this._model.nodes.values()].filter((n) => n.kind === 'member' && /^(automation|script)$/.test(n.domain) && !runs.has(n.key)).forEach((n) => out.push({ x: { k: 'notran', id: n.key }, on: false }));
      return out;
    },
    _renderChecks(soft) {
      const box = this._$.drawer.querySelector('.sbchk'), g = this._sbx;
      if (!box || !g) return;
      const label = g.label, list = this._ver ? [] : this._checksOf(label), have = this._checkRes.get(label) || {}, res = have.res || new Map();
      const can = !this._ver && !!g.rec && g.rec.steps.length > 0, sig = [list.length, can, have.at || 0].join('|');
      if (soft && box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      const mark = (c) => {
        const r = res.get(c.id);
        if (r) {
          if (r.unsure) return `<span class="ckst unsure" title="${esc(r.unsure)}">?</span>`;
          return r.ok ? `<span class="ckst ok" title="${T('chk_passes')}">&#10003;</span>` : `<span class="ckst bad" title="${T('chk_fails')}">&#10005;</span>`;
        }
        return `<span class="ckst muted" title="${T('chk_not_run')}">·</span>`;
      };
      const row = (c) => `<div class="ckrow" data-id="${esc(c.id)}">${mark(c)}<span class="ckname" title="${esc(c.steps.map((x) => this._chkStepText(x).replace(/<[^>]+>/g, '')).join(' → '))}">${esc(c.name)}</span><button class="ib" data-act="chk-run" data-id="${esc(c.id)}" title="${T('chk_run_t')}"><ha-icon icon="mdi:play-circle-outline"></ha-icon></button><button class="ib" data-act="chk-replay" data-id="${esc(c.id)}" title="${T('chk_replay_t')}"><ha-icon icon="mdi:movie-open-play-outline"></ha-icon></button><button class="ib" data-act="chk-edit" data-id="${esc(c.id)}" title="${T('chk_edit_t')}"><ha-icon icon="mdi:pencil-outline"></ha-icon></button><button class="ib" data-act="chk-export" data-id="${esc(c.id)}" title="${T('chk_export_t')}"><ha-icon icon="mdi:export-variant"></ha-icon></button><button class="ib" data-act="chk-del" data-id="${esc(c.id)}" title="${T('chk_del_t')}"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`;
      this._put(box, this._ver ? '' : `<div class="ckhead"><span>${P('chk_n', list.length)}</span>${list.length ? `<button class="ib" data-act="chk-run" title="${T('chk_run_all_t')}"><ha-icon icon="mdi:play-box-multiple-outline"></ha-icon></button>` : ''}<button class="chip" data-act="chk-save"${can ? '' : ' disabled'} title="${can ? T('chk_save_t') : T('chk_save_none')}"><ha-icon icon="mdi:content-save-check-outline"></ha-icon>${T('chk_save')}</button><button class="ib" data-act="chk-import" title="${T('chk_import_t')}"><ha-icon icon="mdi:import"></ha-icon></button></div>${list.map(row).join('')}`);
    },
    _checkSaveDlg() {
      const g = this._sbx;
      if (!g || !g.rec || !g.rec.steps.length || this._ver) return;
      const sug = this._checkSuggest(), m = this._$.modal;
      this._chkDraft = { sug };
      m.hidden = false;
      m.innerHTML = `<div class="dlg ckdlg"><h3>${T('chk_save_h')}</h3><p class="dtext">${T('chk_save_lead')}</p>`
        + `<label>${T('chk_name')}<input name="ckname" maxlength="160" value="${esc(this._chkStepText(g.rec.steps[0]).replace(/<[^>]+>/g, ''))}"></label>`
        + `<h4>${T('chk_steps_h')}</h4><ol class="cksteps">${g.rec.steps.map((x) => `<li>${this._chkStepText(x)}</li>`).join('')}</ol>`
        + `<h4>${T('chk_expect_h')}</h4>${sug.length ? sug.map((s, i) => `<label class="chk"><input type="checkbox" name="ckx" value="${i}"${s.on ? ' checked' : ''}>${this._expText(s.x)}</label>`).join('') : `<p class="muted">${T('chk_expect_none')}</p>`}`
        + `<div class="dval"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="chk-save-go">${T('chk_save_b')}</button></div></div>`;
      const n = m.querySelector('input[name="ckname"]'); if (n) { n.focus(); n.select(); }
    },
    _checkSaveGo() {
      const g = this._sbx, m = this._$.modal, d = this._chkDraft;
      if (!g || !d) return;
      const expect = [...m.querySelectorAll('input[name="ckx"]:checked')].map((x) => d.sug[+x.value].x);
      if (!expect.length) { m.querySelector('.dval').textContent = T('chk_pick_one'); return; }
      const c = cleanCheck({ id: uid(), name: m.querySelector('input[name="ckname"]').value.trim() || T('chk_default'), at: g.rec.at, start: g.rec.start, items: g.rec.items, steps: g.rec.steps, answers: g.rec.answers, expect });
      if (!c) { m.querySelector('.dval').textContent = T('chk_cant'); return; }
      const label = g.label;
      this._setChecks(label, this._checksOf(label).concat([c]));
      this._save();
      this._closeModal();
      this._toast(T('chk_saved', { name: c.name }));
      this._renderChecks();
      this._runChecks(label, [c.id], true);
    },
    _checkDel(id) {
      const label = this._data.ui.current, cur = this._checksOf(label), c = cur.find((x) => x.id === id);
      if (!c) return;
      this._setChecks(label, cur.filter((x) => x.id !== id));
      const r = this._checkRes.get(label); if (r) r.res.delete(id);
      this._save();
      this._renderChecks();
      this._applyCheckProblems(label);
      this._toast(T('chk_deleted', { name: c.name }));
    },
    _checksSoon(label) { this._clock.after('checks', 400, () => this._runChecks(label)); },
    // ---- editing a saved check (0.11.2): its name, its steps (order, values, taking one out) and what it expects
    // (each one's state, taking one out, adding one); saved through cleanCheck as a new one is
    _checkEditDlg(id) {
      const c = this._checksOf(this._data.ui.current).find((x) => x.id === id);
      if (!c || this._ver) return;
      this._chkEdit = { id, c: JSON.parse(JSON.stringify(c)) };
      this._checkEditDraw();
      const n = this._$.modal.querySelector('input[name="ckname"]'); if (n) n.focus();
    },
    // what's typed in the dialog, into the draft (before it's drawn again or saved)
    _checkEditRead() {
      const d = this._chkEdit, m = this._$.modal;
      if (!d) return;
      const n = m.querySelector('input[name="ckname"]'); if (n) d.c.name = n.value;
      m.querySelectorAll('input[data-ckst]').forEach((x) => {
        const s = d.c.steps[+x.dataset.ckst];
        if (!s) return;
        if (s.op === 'set') s.state = x.value;
        else if (s.op === 'advance') { const v = parseFloat(x.value); if (isFinite(v) && v >= 0) s.ms = Math.round(v * 1000); }
        else if (s.op === 'event') s.type = x.value;
      });
      m.querySelectorAll('input[data-ckx]').forEach((x) => { const e = d.c.expect[+x.dataset.ckx]; if (e && e.k === 'state') e.state = x.value; });
    },
    _checkEditDraw() {
      const d = this._chkEdit, m = this._$.modal, c = d.c;
      const field = (i, s) => (s.op === 'set' ? `<input data-ckst="${i}" aria-label="${esc(T('chk_e_value', { name: this._checkName(s.id) }))}" value="${esc(s.state == null ? '' : s.state)}">`
        : s.op === 'advance' ? `<input data-ckst="${i}" type="number" min="0" step="1" aria-label="${esc(T('chk_e_seconds'))}" value="${Math.round((s.ms || 0) / 1000)}"><span class="muted">${T('chk_e_s')}</span>`
          : s.op === 'event' ? `<input data-ckst="${i}" aria-label="${esc(T('sbx_event_type'))}" value="${esc(s.type || '')}">` : '');
      const off = (x) => (x ? ' disabled' : '');
      const steps = c.steps.map((s, i) => `<li class="ckeo" data-key="st${i}"><span class="cket">${this._chkStepText(s)}</span>${field(i, s)}`
        + `<button class="ib" data-act="chk-st-up" data-i="${i}" title="${esc(T('chk_e_up'))}"${off(i === 0)}><ha-icon icon="mdi:arrow-up"></ha-icon></button>`
        + `<button class="ib" data-act="chk-st-down" data-i="${i}" title="${esc(T('chk_e_down'))}"${off(i === c.steps.length - 1)}><ha-icon icon="mdi:arrow-down"></ha-icon></button>`
        + `<button class="ib" data-act="chk-st-del" data-i="${i}" title="${esc(T('chk_e_drop_step'))}"${off(c.steps.length < 2)}><ha-icon icon="mdi:close"></ha-icon></button></li>`).join('');
      const exps = c.expect.map((x, i) => `<li class="ckeo" data-key="x${i}"><span class="cket">${x.k === 'state' ? T('chk_x_state', { name: esc(this._checkName(x.id)), state: '' }) : this._expText(x)}</span>${x.k === 'state' ? `<input data-ckx="${i}" aria-label="${esc(T('chk_e_state'))}" value="${esc(x.state)}">` : ''}`
        + `<button class="ib" data-act="chk-x-del" data-i="${i}" title="${esc(T('chk_e_drop_x'))}"${off(c.expect.length < 2)}><ha-icon icon="mdi:close"></ha-icon></button></li>`).join('');
      // what an expectation can be about: what it starts from, what took part, and what's on the board
      const ids = [...new Set(Object.keys(c.start).concat(c.items, this._model ? [...this._model.nodes.keys()].filter((k) => !k.includes(':')) : []))].sort((a, b) => this._checkName(a).localeCompare(this._checkName(b)));
      const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
      m.hidden = false;
      m.innerHTML = `<div class="dlg ckdlg"><h3>${T('chk_edit_h')}</h3>`
        + `<label>${T('chk_name')}<input name="ckname" maxlength="160" value="${esc(c.name)}"></label>`
        + `<h4>${T('chk_steps_h')}</h4><ol class="cksteps cked">${steps}</ol>`
        + `<h4>${T('chk_expect_h')}</h4><ul class="cksteps cked">${exps}</ul>`
        + `<div class="ckadd"><select name="ckxk" aria-label="${esc(T('chk_e_kind'))}">${opt('state', T('chk_e_k_state'))}${opt('ran', T('chk_e_k_ran'))}${opt('stopped', T('chk_e_k_stopped'))}${opt('notran', T('chk_e_k_notran'))}</select>`
        + `<select name="ckxid" aria-label="${esc(T('chk_e_what'))}">${ids.map((k) => opt(k, this._checkName(k))).join('')}</select><input name="ckxs" aria-label="${esc(T('chk_e_state'))}" placeholder="${esc(T('chk_e_state'))}"><button class="chip" data-act="chk-x-add">${T('chk_e_add')}</button></div>`
        + `<div class="dval"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="chk-edit-go">${T('save')}</button></div></div>`;
    },
    _checkEditMove(i, by) {
      const d = this._chkEdit;
      if (!d) return;
      this._checkEditRead();
      const st = d.c.steps, j = i + by;
      if (j < 0 || j >= st.length) return;
      [st[i], st[j]] = [st[j], st[i]];
      this._checkEditDraw();
    },
    _checkEditDrop(what, i) {
      const d = this._chkEdit;
      if (!d || d.c[what].length < 2) return;
      this._checkEditRead();
      d.c[what].splice(i, 1);
      this._checkEditDraw();
    },
    _checkEditAdd() {
      const d = this._chkEdit, m = this._$.modal;
      if (!d) return;
      this._checkEditRead();
      const k = m.querySelector('select[name="ckxk"]').value, id = m.querySelector('select[name="ckxid"]').value, st = m.querySelector('input[name="ckxs"]').value.trim();
      if (!id) return;
      if (k === 'state' && !st) { m.querySelector('.dval').textContent = T('chk_e_need_state'); return; }
      if (k !== 'state' && !/^(automation|script)\./.test(id)) { m.querySelector('.dval').textContent = T('chk_e_need_run'); return; }
      d.c.expect.push(k === 'state' ? { k, id, state: st } : { k, id });
      this._checkEditDraw();
    },
    _checkEditGo() {
      const d = this._chkEdit, m = this._$.modal;
      if (!d) return;
      this._checkEditRead();
      const c = cleanCheck(Object.assign({}, d.c, { name: (d.c.name || '').trim() || T('chk_default') }));
      if (!c) { m.querySelector('.dval').textContent = T('chk_cant'); return; }
      const label = this._data.ui.current;
      this._setChecks(label, this._checksOf(label).map((x) => (x.id === d.id ? c : x)));
      const r = this._checkRes.get(label); if (r) r.res.delete(d.id);
      this._chkEdit = null;
      this._save();
      this._closeModal();
      this._toast(T('chk_edited', { name: c.name }));
      this._renderChecks();
      this._runChecks(label, [c.id], true);
    },
    // ---- sharing one (0.11.2): as text to copy, and back in from text (cleanCheck takes what's safe of it)
    _checkExport(id) {
      const c = this._checksOf(this._data.ui.current).find((x) => x.id === id);
      if (!c) return;
      const out = Object.assign({ functions_board_check: 1 }, c);
      delete out.id;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg ckdlg"><h3>${T('chk_export_h', { name: esc(c.name) })}</h3><p class="dtext">${T('chk_export_lead')}</p>`
        + `<textarea class="ckjson" readonly rows="12" aria-label="${esc(T('chk_export_h', { name: c.name }))}">${esc(JSON.stringify(out, null, 2))}</textarea>`
        + `<div class="dval"></div><div class="btns"><button data-act="modal-cancel">${T('close')}</button><button class="primary" data-act="chk-copy">${T('chk_copy')}</button></div></div>`;
      const t = m.querySelector('textarea'); if (t) { t.focus(); t.select(); }
    },
    async _checkCopy() {
      const m = this._$.modal, t = m.querySelector('textarea.ckjson');
      if (!t) return;
      try { await navigator.clipboard.writeText(t.value); m.querySelector('.dval').textContent = T('chk_copied'); }
      catch (e) { t.focus(); t.select(); m.querySelector('.dval').textContent = T('chk_copy_by_hand'); }
    },
    _checkImportDlg() {
      if (this._ver) return;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg ckdlg"><h3>${T('chk_import_h')}</h3><p class="dtext">${T('chk_import_lead')}</p>`
        + `<textarea class="ckjson" rows="12" aria-label="${esc(T('chk_import_h'))}" placeholder="{ &quot;functions_board_check&quot;: 1, … }"></textarea>`
        + `<div class="dval"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="chk-import-go">${T('chk_import_b')}</button></div></div>`;
      const t = m.querySelector('textarea'); if (t) t.focus();
    },
    _checkImportGo() {
      const m = this._$.modal, t = m.querySelector('textarea.ckjson'), say = (x) => { m.querySelector('.dval').textContent = x; };
      if (!t) return;
      let o;
      try { o = JSON.parse(t.value); } catch (e) { say(T('chk_import_bad')); return; }
      if (!o || typeof o !== 'object' || o.functions_board_check !== 1) { say(T('chk_import_bad')); return; }
      const c = cleanCheck(Object.assign({}, o, { id: uid() }));
      if (!c) { say(T('chk_cant')); return; }
      const label = this._data.ui.current;
      this._setChecks(label, this._checksOf(label).concat([c]));
      this._save();
      this._closeModal();
      this._toast(T('chk_imported', { name: c.name }));
      this._renderChecks();
      this._runChecks(label, [c.id], true);
    },
    // replay checks on the function's current configs; results kept until the configs change. given: the configs
    // the scan already read (another function's)
    async _runChecks(label, ids, force, given) {
      const list = this._checksOf(label).filter((c) => !ids || ids.includes(c.id));
      if (!list.length || this._ver) return;
      const gen = this._cfgGen || 0, have = this._checkRes.get(label);
      if (!force && have && have.gen === gen && list.every((c) => have.res.has(c.id))) return;
      const members = this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id).filter((e) => /^(automation|script)\./.test(e));
      const cfgOf = new Map((given || []).map((x) => [x.id, x.cfg]));
      const itemsFor = async (c) => {
        const ids = [...new Set(members.concat(c.items || []))];
        const cfgs = await Promise.all(ids.map((e) => (cfgOf.has(e) ? cfgOf.get(e) : this._fetchConfig(e))));
        return ids.map((e, i) => ({ id: e, cfg: cfgs[i] })).filter((x) => x.cfg);
      };
      const resolve = (ref) => { if (ref.startsWith('device:')) return this._ents.filter((e) => e.device_id === ref.slice(7)).map((e) => e.entity_id); const t = this._tgt.get(ref); return t ? t.entities : []; };
      const own = this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => [e.entity_id, { kind: 'member' }]);
      const o = { states: this._hass.states, tz: this._hass.config && this._hass.config.time_zone, tpl: (t, v, e, o) => this._sbxTpl(t, v, e, o), resolve,
        fetch: (id) => this._fetchConfig(id), name: (id) => this._boxName(id), condText: (c) => condText(c, (x) => this._boxName(x)),
        entityOf: (x) => this._entOfReg(x), scene: (id) => this._sceneCfg(id), derived: await this._followRules(own, this._hass.states) };
      const rec = have && have.gen === gen ? have : { gen, res: new Map() };
      for (const c of list) {
        try {
          const items = await itemsFor(c);
          const cfgs = items.map((x) => x.cfg);
          const r = await runCheck(c, Object.assign({ items, devMqtt: (await this._devTrigs(this._devIdsIn(cfgs, true), true)).mqtt, zwave: await this._zwFor(this._zwDevIds(cfgs)), devOf: (e) => this._devOfEnt(e) }, o));
          rec.res.set(c.id, { ok: r.ok, unsure: r.unsure, res: r.res });
        }
        catch (e) { rec.res.set(c.id, { ok: false, unsure: (e && e.message) || String(e), res: [] }); }
      }
      rec.at = Date.now();
      this._checkRes.set(label, rec);
      this._applyCheckProblems(label);
      if (this._sbx && this._sbx.label === label) this._renderChecks();
    },
    _checkProblems(label) {
      const r = this._checkRes.get(label), out = [];
      if (!r) return out;
      this._checksOf(label).forEach((c) => {
        const x = r.res.get(c.id);
        if (!x || x.ok) return;
        if (x.unsure) { out.push({ sev: 'warn', kind: 'c_unsure', ref: 'check:' + c.id, by: [], name: c.name, detail: x.unsure }); return; }
        const i = x.res.findIndex((y) => !y.ok);
        out.push({ sev: 'error', kind: 'c_failed', ref: 'check:' + c.id, by: [], name: c.name, detail: i >= 0 ? this._expText(c.expect[i], x.res[i].got).replace(/<[^>]+>/g, '') : '' });
      });
      return out;
    },
    _applyCheckProblems(label) {
      const m = this._model;
      if (!m || m.label !== label || this._ver) return;
      const all = (m.problems || []).concat(m.dismissed || [], m.ignored || []).filter((p) => !/^c_/.test(p.kind)).concat(this._checkProblems(label))
        .sort((x, y) => (x.sev === y.sev ? 0 : x.sev === 'error' ? -1 : 1));
      // checks' results are only known once they've run; quiet-automation dismissals (q|) stay until undone
      const sp = this._splitProbs(label, all, (k) => !k.startsWith('q|') && (!k.startsWith('c_') || this._checkRes.has(label)));
      m.problems = sp.shown; m.dismissed = sp.hidden; m.ignored = sp.ignored || [];
      this._noteProblems(label, m.problems);
      this._renderHeader();
      if (this._drawer && this._drawer.mode === 'problems') this._openProblems();
    },
    // a check played in the sandbox, step by step on the board: its states, its clock, its steps, its answers
    async _checkReplay(id) {
      const label = this._data.ui.current, c = this._checksOf(label).find((x) => x.id === id);
      if (!c || !this._model) return;
      if (this._sbxOn()) this._closeDrawer();
      await this._openSandbox({ check: c });
      for (const s of c.steps) {
        if (!this._sbxOn()) return;
        const g = this._sbx;
        await this._sbxDo((e) => { this._sbxRec(s); return sbxDoStep(e, s); });
        if (this._sbx !== g) return;
        if (!(await this._clock.sleep(300))) return;
      }
      this._toast(T('chk_replayed', { name: c.name }));
    },

    /* ---------- problems (0.9.0) ---------- */
    _probCtx(label) {
      const L = this._layout(label), svcs = this._hass.services || {};
      return {
        state: (id) => this._hass.states[id], ent: (id) => this._entMap.get(id), dev: (id) => this._devMap.get(id),
        area: (id) => this._areaMap && this._areaMap.get(id), floor: (id) => this._floorMap && this._floorMap.get(id), label: (id) => this._labelMap.get(id),
        service: (d, s) => !!(svcs[d] && svcs[d][s]), paused: Array.isArray(L.paused) && L.paused.length > 0,
      };
    },
    // a function's problems, without the ones dismissed; keeps the dismissals' bookkeeping (and saves it)
    _splitProbs(label, problems, covers) {
      const L = this._liveLayout(label);
      if (!(L.dismissed || []).length) return { shown: problems, hidden: [], ignored: [] };
      const r = splitDismissed(problems, L.dismissed, Date.now(), covers);
      if (r.changed) { L.dismissed = r.dismissed; this._save(); }
      return r;
    },
    // how: 'off' dismisses, 'back' brings back, 'ever' ignores for good (0.11.1), 'unever' makes every one ignored for
    // good a plain dismissal again (k unused)
    _probDismiss(k, how) {
      const m = this._model, label = this._data.ui.current;
      if (!m || m.label !== label || this._ver) return;
      const L = this._liveLayout(label), all = (m.problems || []).concat(m.dismissed || [], m.ignored || []), p = all.find((x) => probKey(x) === k);
      const was = (L.dismissed || []).find((d) => d.k === k);
      if (how === 'unever') L.dismissed = (L.dismissed || []).map((d) => (d.ever ? { k: d.k, at: d.at } : d));
      else {
        L.dismissed = (L.dismissed || []).filter((d) => d.k !== k);
        if (how === 'off') L.dismissed.push({ k, at: Date.now() });
        if (how === 'ever') L.dismissed.push({ k, at: Date.now(), ever: true });
      }
      this._save();
      const sp = splitDismissed(all, L.dismissed, Date.now(), () => false);
      m.problems = sp.shown; m.dismissed = sp.hidden; m.ignored = sp.ignored;
      markProblems(m.nodes, m.edges, m.problems);
      this._noteProblems(label, m.problems);
      this._renderHeader();
      this._render();
      this._drawEdges();
      if (this._drawer && this._drawer.mode === 'problems') this._openProblems(this._drawer.dismissed && m.dismissed.length > 0);
      if (this._sbxOn()) this._renderSbx();
      const undo = [{ text: T('undo'), fn: () => this._probDismiss(k, was ? (was.ever ? 'ever' : 'off') : 'back') }];
      if (how === 'off' && (p || String(k || '').startsWith('q|'))) this._toast(T('prob_dismissed_toast'), undo);
      if (how === 'ever') this._toast(T('prob_ignored_toast'), undo);
    },
    // what the problems of a function's boxes depend on in Home Assistant's states (0.10.0): which are missing,
    // unavailable, or automations turned off (an automation turned off since the board was built is a warning)
    _probSig(m, states) {
      return [...m.nodes.keys()].filter((k) => !k.includes(':')).map((k) => { const st = states[k]; return !st ? k + '=-' : st.state === 'unavailable' ? k + '=u' : k.startsWith('automation.') && st.state === 'off' ? k + '=o' : ''; }).filter(Boolean).join('|');
    },
    // the list's count for a function: { e, w } (errors, warnings), once counted
    _probCount(label) { return this._probs.get(label) || null; },
    _noteProblems(label, problems) {
      const e = problems.filter((p) => p.sev === 'error').length, w = problems.length - e, was = this._probs.get(label);
      this._probs.set(label, { e, w });
      if (!was || was.e !== e || was.w !== w) this._renderList();
    },
    // every function on the board, in the background: the counts on the list (configs come from the cache)
    async _scanProblems() {
      if (!this._data || !this._hass || this._probScanning || !this._ents) return;
      this._probScanning = true;
      try {
        const known = (x) => this._known(x);
        for (const label of this._data.functions.slice()) {
          if (this._model && this._model.label === label && !this._ver) { this._noteProblems(label, this._model.problems || []); continue; }
          const members = this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id);
          const devs = this._devs.filter((d) => (d.labels || []).includes(label)).map((d) => 'device:' + d.id);
          const logic = members.filter((e) => /^(automation|script)\./.test(e));
          const cfgs = await Promise.all(logic.map((e) => this._fetchConfig(e)));
          // the open function's own result is newer than anything read before it was built
          if (this._model && this._model.label === label && !this._ver) { this._noteProblems(label, this._model.problems || []); continue; }
          const items = logic.map((e, i) => ({ key: e, refs: cfgs[i] ? analyze(cfgs[i], e.startsWith('script.'), known).refs : [], both: bothWays(cfgs[i]) }));
          const base = findProblems(items, members.concat(devs), this._probCtx(label));
          if (this._checksOf(label).length) await this._runChecks(label, null, false, logic.map((e, i) => ({ id: e, cfg: cfgs[i] })).filter((x) => x.cfg));
          this._noteProblems(label, this._splitProbs(label, base.concat(this._checkProblems(label)), (k) => !k.startsWith('q|') && (!k.startsWith('c_') || this._checkRes.has(label))).shown);
          // (a turn for the page between functions; a board taken off the page stops counting)
          if (!(await this._clock.sleep(0))) return;
        }
      } catch (e) { /* the counts stay as they were */ } finally { this._probScanning = false; }
    },
    _probBadge(c) {
      if (!c.e && !c.w) return '';
      const say = c.e ? P('prob_n_errors', c.e) + (c.w ? ' · ' + P('prob_n_warnings', c.w) : '') : P('prob_n_warnings', c.w);
      return `<span class="pbadge p-${c.e ? 'error' : 'warn'}" title="${esc(say)}"><span aria-hidden="true">${c.e || c.w}</span><span class="srt">${esc(say)}</span></span>`;
    },
    _quietDays() {
      const v = this._data && this._data.ui && this._data.ui.quietDays;
      return QUIET_DAYS.includes(v) ? v : 30;
    },
    _quietOf(label) {
      const m = this._model && this._model.label === label ? this._model : null;
      if (!m || !this._hass) return { shown: [], hidden: [] };
      const members = [...m.nodes.values()].filter((n) => n.kind === 'member' && n.domain === 'automation').map((n) => n.key);
      const L = this._layout(label);
      return findQuietAutomations(members, this._probCtx(label), { days: this._quietDays(), dismissed: (L && L.dismissed) || [] });
    },
    _setQuietDays(days) {
      if (!this._data) return;
      this._data.ui.quietDays = QUIET_DAYS.includes(days) ? days : 30;
      this._save();
      this._renderHeader();
      if (this._drawer && this._drawer.mode === 'problems') this._openProblems(!!this._drawer.dismissed);
    },
    async _quietTurnOff(key) {
      const nm = this._nameOf(key);
      try {
        await this._svc('automation', 'turn_off', {}, { entity_id: key });
        // Undo turns it back on (0.16.1): every change the board makes can be taken back
        this._toast(T('pq_off_done', { name: nm }), [{ text: T('undo'), fn: () => this._svc('automation', 'turn_on', {}, { entity_id: key }) }]);
        this._clock.after('quiet-refresh', 400, () => {
          this._renderHeader();
          if (this._drawer && this._drawer.mode === 'problems') this._openProblems(!!this._drawer.dismissed);
        });
      } catch (e) {
        this._toast(T('pq_off_err', { name: nm, e: (e && (e.message || e.code)) || e }));
      }
    },
    _probChip() {
      const label = this._data && this._data.ui.current;
      const m = this._model && this._model.label === label ? this._model : null, ps = (m && m.problems) || [], ds = (m && m.dismissed) || [];
      const e = ps.filter((p) => p.sev === 'error').length;
      const q = m && !this._ver ? this._quietOf(label).shown.length : 0;
      return (ps.length ? `<button class="pchip p-${e ? 'error' : 'warn'}" data-act="problems" title="${T('prob_chip_t')}"><ha-icon icon="${e ? 'mdi:alert-circle' : 'mdi:alert'}"></ha-icon>${P('prob_n', ps.length)}</button>` : '')
        + (q ? `<button class="pqchip" data-act="problems" title="${T('pq_chip_t')}"><ha-icon icon="mdi:sleep"></ha-icon>${P('pq_chip', q)}</button>` : '')
        + (ds.length ? `<button class="pdchip" data-act="pdis-list" title="${T('prob_dismissed_t')}"><ha-icon icon="mdi:eye-off-outline"></ha-icon>${P('prob_dismissed_n', ds.length)}</button>` : '');
    },
    _probWhat(ref) {
      if (ref.startsWith('device:')) { const d = this._devMap.get(ref.slice(7)); return d ? d.name_by_user || d.name || ref.slice(7) : ref.slice(7); }
      if (TGT_RE.test(ref)) return ref.slice(ref.indexOf(':') + 1);
      return EXACT_RE.test(ref) ? this._nameOf(ref) + (this._nameOf(ref) !== ref ? ` (${ref})` : '') : ref;
    },
    _probText(p) {
      const what = esc(this._probWhat(p.ref));
      switch (p.kind) {
        case 'e_missing': return T('prob_e_missing', { what });
        case 'e_notloaded': return T('prob_e_notloaded', { what });
        case 'e_disabled': return T('prob_e_disabled', { what });
        case 'e_unavail': return T('prob_e_unavail', { what });
        case 'd_missing': return T('prob_d_missing', { what });
        case 'd_disabled': return T('prob_d_disabled', { what });
        case 't_missing': return T('prob_t_missing', { what });
        case 't_both': return T('prob_t_both', { what, ent: esc((p.ents || []).map((x) => this._nameOf(x)).join(', ')), from: esc((p.from || []).join(', ')) });
        case 's_missing': return T('prob_s_missing', { what });
        case 'm_broken': return T('prob_m_broken', { what });
        case 'm_off': return T('prob_m_off', { what });
        case 'c_failed': return T('prob_c_failed', { name: esc(p.name), what: esc(p.detail) });
        case 'c_unsure': return T('prob_c_unsure', { name: esc(p.name), what: esc(p.detail) });
        default: return what;
      }
    },
    _probTitle(key) {
      const ps = ((this._model && this._model.problems) || []).filter((p) => p.ref === key || p.by.includes(key));
      return ps.map((p) => this._probText(p).replace(/<[^>]+>/g, '')).join('\n');
    },
    // the problems drawer; dismissed: the ones dismissed instead
    _openProblems(dismissed) {
      const label = this._data.ui.current;
      if (!label || !this._model) return;
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'problems', dismissed: !!dismissed };
      const d = this._$.drawer, ps = (dismissed ? this._model.dismissed : this._model.problems) || [], ds = this._model.dismissed || [];
      d.hidden = false;
      const nm = (k) => esc(this._model.nodes.has(k) ? this._model.nodes.get(k).name : this._nameOf(k));
      const row = (p) => {
        const showKey = this._model.nodes.has(p.ref) ? p.ref : (p.kind === 's_missing' && this._model.nodes.has('svc:' + p.ref) ? 'svc:' + p.ref : null);
        return `<div class="prow p-${p.sev}"><ha-icon icon="${p.sev === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}"></ha-icon><div class="pbody"><div class="ptxt">${this._probText(p)}</div>`
        + (p.by.length ? `<div class="pby">${T('prob_in')} ${p.by.map((b) => `<button class="lnk" data-act="prob-go" data-key="${esc(b)}">${nm(b)}</button>`).join(', ')}</div>` : '')
        + `<div class="pact">${showKey ? `<button data-act="prob-go" data-key="${esc(showKey)}"><ha-icon icon="mdi:crosshairs-gps"></ha-icon>${T('prob_show')}</button>` : ''}`
        + p.by.filter((b) => /^(automation|script)\./.test(b)).map((b) => `<button data-act="prob-open" data-key="${esc(b)}"><ha-icon icon="mdi:pencil-outline"></ha-icon>${T('prob_edit', { name: nm(b) })}</button>`).join('')
        + (/^c_/.test(p.kind) ? `<button data-act="chk-replay" data-id="${esc(p.ref.slice(6))}"><ha-icon icon="mdi:flask-outline"></ha-icon>${T('chk_replay')}</button>` : '')
        + (!p.by.length && /^(automation|script)\./.test(p.ref) ? `<button data-act="prob-open" data-key="${esc(p.ref)}"><ha-icon icon="mdi:pencil-outline"></ha-icon>${T('prob_edit', { name: nm(p.ref) })}</button>` : '')
        + (this._ver ? '' : dismissed
          ? `<button data-act="pdis-back" data-k="${esc(probKey(p))}" aria-label="${esc(T('prob_undismiss_a', { what: this._probText(p).replace(/<[^>]+>/g, '') }))}"><ha-icon icon="mdi:eye-outline"></ha-icon>${T('prob_undismiss')}</button>`
          : `<button data-act="pdis" data-k="${esc(probKey(p))}" title="${T('prob_dismiss_t')}" aria-label="${esc(T('prob_dismiss_a', { what: this._probText(p).replace(/<[^>]+>/g, '') }))}"><ha-icon icon="mdi:eye-off-outline"></ha-icon>${T('prob_dismiss')}</button>`)
        + (this._ver ? '' : `<button data-act="pdis-ever" data-k="${esc(probKey(p))}" title="${T('prob_ignore_t')}" aria-label="${esc(T('prob_ignore_a', { what: this._probText(p).replace(/<[^>]+>/g, '') }))}"><ha-icon icon="mdi:cancel"></ha-icon>${T('prob_ignore')}</button>`)
        + `</div></div></div>`;
      };
      const nev = this._ver ? 0 : (this._layout(label).dismissed || []).filter((x) => x.ever).length;
      const other = (dismissed ? `<button class="lnk" data-act="problems">${T('prob_back')}</button>`
        : ds.length ? `<button class="lnk" data-act="pdis-list">${P('prob_dismissed_n', ds.length)}</button>` : '')
        + (nev ? `<span class="pever">${P('prob_ignored_n', nev)} · <button class="lnk" data-act="pdis-unever" title="${T('prob_unignore_t')}">${T('prob_unignore')}</button></span>` : '');
      const qDays = this._quietDays();
      const qList = !dismissed && !this._ver ? this._quietOf(label).shown : [];
      const qOpts = [[30, T('pq_d30')], [90, T('pq_d90')], [365, T('pq_d365')], [0, T('pq_never_opt')]];
      const qRow = (q) => {
        const qk = 'q|' + q.id, when = q.never ? T('pq_never') : P('pq_days_ago', q.daysAgo);
        return `<div class="pqrow"><ha-icon icon="mdi:sleep"></ha-icon><div class="pbody"><div class="ptxt"><b>${nm(q.id)}</b> · ${esc(when)}</div>`
          + `<div class="pact"><button data-act="prob-go" data-key="${esc(q.id)}"><ha-icon icon="mdi:crosshairs-gps"></ha-icon>${T('prob_show')}</button>`
          + `<button data-act="pquiet-off" data-key="${esc(q.id)}"><ha-icon icon="mdi:pause-circle-outline"></ha-icon>${T('pq_off_btn')}</button>`
          + `<button data-act="pdis" data-k="${esc(qk)}" title="${T('prob_dismiss_t')}" aria-label="${esc(T('prob_dismiss_a', { what: this._nameOf(q.id) }))}"><ha-icon icon="mdi:eye-off-outline"></ha-icon>${T('prob_dismiss')}</button>`
          + `<button data-act="pdis-ever" data-k="${esc(qk)}" title="${T('prob_ignore_t')}" aria-label="${esc(T('prob_ignore_a', { what: this._nameOf(q.id) }))}"><ha-icon icon="mdi:cancel"></ha-icon>${T('prob_ignore')}</button>`
          + `</div></div></div>`;
      };
      const hasAutos = [...this._model.nodes.values()].some((n) => n.kind === 'member' && n.domain === 'automation');
      const quietSec = !dismissed && !this._ver && hasAutos
        ? `<div class="pquiet"><div class="pqhead"><b><ha-icon icon="mdi:sleep"></ha-icon>${T('pq_head')}</b><div class="pqtabs">${qOpts.map(([dVal, lbl]) => `<button class="chip${qDays === dVal ? ' on' : ''}" data-act="pquiet-days" data-days="${dVal}">${esc(lbl)}</button>`).join('')}</div></div><div class="vnote">${T('pq_note')}</div>${qList.length ? qList.map(qRow).join('') : `<div class="muted pad">${T('pq_none')}</div>`}</div>`
        : '';
      this._put(d, `<div class="dhead"><span class="dtitle">${dismissed ? T('prob_dismissed_title', { fnName: esc(this._fnName(label)) }) : T('prob_title', { fnName: esc(this._fnName(label)) })}</span><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div>`
        + `<div class="probs"><div class="vnote">${dismissed ? T('prob_dismissed_note') : T('prob_note')}</div>${ps.length ? ps.map(row).join('') : `<div class="muted pad">${dismissed ? T('prob_none_dismissed') : T('prob_none')}</div>`}${other ? `<div class="pother">${other}</div>` : ''}${quietSec}</div>`);
      this._fitLitbar && this._fitLitbar();
    },

};
