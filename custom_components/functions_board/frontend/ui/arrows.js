import { P, T, TGT_RE, VERB, analyze, canon, dropRefs, esc, fill, fmtValue, getPath, humanize, refPlace, refsTo, scalar, shorten, toList, toYaml } from '../lib/index.js';

export const arrowsPart = {
    /* ======================================================================================================
       part: arrows: the arrow editor: an arrow's bar, its dialog, drawing a new arrow, an arrow's template tip Owns
       _arw, _tt (PARTS): only its own methods use them; the other parts ask its methods.
       ====================================================================================================== */

    _edgeTitle(e) {
      const a = this._model.nodes.get(e.from), b = this._model.nodes.get(e.to);
      if (e.role === 'tool') return a.kind === 'tool' ? T('tests_2', { name: a.name, name2: b.name }) : T('lists', { name: b.name, name2: a.name });
      const via = e.via && this._model.nodes.get(e.via);
      return fill(VERB[e.role] || '{a} → {b}', { a: a.name, b: b.name }) + (e.svcs.size ? ` (${[...e.svcs].join(', ')})` : '')
        + (via ? T('through_the', { domain: via.domain, name: via.name.replace(/ \(\d+\)$/, '') }) : '')
        + (e.loop ? T('part_of_a_loop_this') : '');
    },

    // ---- live template values (9.3): hovering an arrow that comes from a template shows what it gives now
    _edgeHover(id, ev) {
      const m = this._model, e = m && m.edges.find((x) => x.id === id);
      if (!e || !e.tpls || !e.tpls.size) { this._edgeHoverEnd(); return; }
      if (this._tt && this._tt.id === id) { this._ttMove(ev); return; }
      this._edgeHoverEnd();
      const tpls = [...e.tpls].slice(0, 3), tt = { id, vals: tpls.map(() => '…'), unsubs: [] };
      this._tt = tt;
      tpls.forEach((t, i) => {
        const p = this._haConn.subscribeMessage((msg) => {
          if (this._tt !== tt) return;
          tt.vals[i] = msg && msg.error ? '⚠ ' + (/trigger|this\b/.test(msg.error) ? T('uses_the_data_of_what') : msg.error) : fmtValue(msg && msg.result);
          this._ttRender(e, tpls);
        }, { type: 'render_template', template: t, strict: false, report_errors: true, timeout: 3 });
        p.catch((err) => { if (this._tt === tt) { tt.vals[i] = '⚠ ' + ((err && (err.message || err.code)) || 'error'); this._ttRender(e, tpls); } });
        tt.unsubs.push(p);
      });
      this._ttRender(e, tpls);
      this._ttMove(ev);
    },
    _ttRender(e, tpls) {
      const tip = this._$.ttip, tt = this._tt;
      if (!tt) return;
      tip.innerHTML = `<div class="tth">${esc(this._edgeTitle(e))}</div>` + tpls.map((t, i) => `<div class="ttt"><code>${esc(shorten(t, 180))}</code><div class="ttv">${esc(tt.vals[i])}</div></div>`).join('');
      tip.hidden = false;
    },
    // the pointer over the arrows: an arrow's template tip follows it, and goes when the pointer leaves that arrow
    _ttPointerMove(e) { if (this._tt) this._ttMove(e); },
    _ttPointerOut(e) { const p = e.target.closest('path.hit'); if (p && this._tt && this._tt.id === p.dataset.e) this._edgeHoverEnd(); },
    _ttMove(ev) {
      const tip = this._$.ttip, r = this._$.vp.getBoundingClientRect();
      if (!ev || tip.hidden) return;
      const x = Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8), y = Math.min(ev.clientY - r.top + 14, r.height - tip.offsetHeight - 8);
      tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
    },
    _edgeHoverEnd() {
      const tt = this._tt;
      if (!tt) return;
      this._tt = null;
      tt.unsubs.forEach((p) => this._ha.drop(p));
      this._$.ttip.hidden = true;
    },

    /* ---------- the arrow editor (7.5, decision D8): an arrow is a reference in an automation or script config,
       so drawing or removing one edits that config, through the same API Home Assistant's own editor uses ---------- */
    // the automation or script whose config an arrow comes from, and the box it names there
    _arrowEnds(e) {
      const logic = (k) => /^(automation|script)\./.test(k);
      if ((e.role === 'trigger' || e.role === 'condition') && logic(e.to)) return { owner: e.to, other: e.from };
      if ((e.role === 'action' || e.role === 'call') && logic(e.from)) return { owner: e.from, other: e.to };
      return null;
    },
    // clicking an arrow selects it: what it means, and what can be done with it
    _edgeClick(id, ev) {
      const m = this._model, e = m && m.edges.find((x) => x.id === id);
      if (!e || e.role === 'tool') return;
      this._selEdge = id;
      this._sel = null;
      this._applyFocus();
      const bar = this._$.edgebar, ends = this._arrowEnds(e), owner = ends && m.nodes.get(ends.owner);
      const full = this._full(), why = !ends ? (e.role === 'source' ? T('this_arrow_comes_from_the') : T('this_arrow_doesn_t_come')) : '';
      this._put(bar, `<span class="ebtxt">${esc(this._edgeTitle(e))}</span><button data-act="arw-remove" ${!ends || !full ? 'disabled' : ''} title="${esc(!ends ? why : full ? T('remove_what_this_arrow_stands') : T('full_manager_only_switch_it'))}"><ha-icon icon="mdi:link-variant-remove"></ha-icon><span>${T('remove_2')}</span></button>${owner ? `<button data-act="arw-open" title="${T('open_in_its_editor', { name: esc(owner.name) })}"><ha-icon icon="mdi:pencil-outline"></ha-icon><span>${T('edit', { name: esc(owner.name) })}</span></button>` : ''}`);
      bar.hidden = false;
      const r = this._$.vp.getBoundingClientRect();
      bar.style.left = Math.max(6, Math.min(ev.clientX - r.left - 20, this._openWidth() - bar.offsetWidth - 6)) + 'px';
      bar.style.top = Math.max(6, Math.min(ev.clientY - r.top + 14, r.height - bar.offsetHeight - 6)) + 'px';
    },
    _clearEdgeSel() {
      if (!this._selEdge && this._$.edgebar.hidden) return;
      this._selEdge = null;
      this._$.edgebar.hidden = true;
      this._drawEdges();
    },
    // removing an arrow: each reference behind it, ticked, with the YAML that goes
    async _arrowRemoveDialog(id) {
      const m = this._model, e = m && m.edges.find((x) => x.id === id), ends = e && this._arrowEnds(e);
      this._clearEdgeSel();
      if (!ends || !this._full()) return;
      const md = this._$.modal;
      md.hidden = false;
      md.innerHTML = `<div class="dlg wide"><h3>${T('remove_an_arrow')}</h3><div class="muted">${T('reading_the_config')}</div></div>`;
      const o = await this._ownerCfg(ends.owner), other = m.nodes.get(ends.other);
      if (o.err) {
        md.innerHTML = `<div class="dlg"><h3>${T('remove_an_arrow')}</h3><p class="dtext">${esc(o.err)}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button><button class="primary" data-act="arw-edit" data-key="${esc(ends.owner)}">${T('open_the_editor')}</button></div></div>`;
        return;
      }
      const refs = refsTo(o.cfg, o.isScript, ends.other);
      const indirect = analyze(o.cfg, o.isScript, (x) => this._known(x)).refs.filter((r) => r.ref === ends.other && r.tpl).length;
      this._arw = { mode: 'remove', o, refs, sel: new Set(refs.map((r, i) => i)), owner: ends.owner, other: ends.other, otherName: other ? other.name : ends.other };
      const row = (r, i) => {
        const node = getPath(o.cfg, r.path);
        const what = r.mode === 'node' ? T('removes_this', { extra: r.kind === 'trigger' ? 'trigger' : r.kind === 'condition' ? 'condition' : 'step' }) : T('takes_out_of_its_list', { otherName: this._arw.otherName });
        return `<label class="aref"><input type="checkbox" data-aref="${i}" checked><span><b>${esc(refPlace(r))}</b> <span class="muted small">${esc(what)}</span><pre>${esc(shorten(toYaml(node), 600))}</pre></span></label>`;
      };
      md.innerHTML = `<div class="dlg wide adlg"><h3>${esc(this._arw.otherName)} and ${esc(o.n.name)}</h3>${refs.length ? `<div class="hint">${T('what_s_config_says_about', { name: esc(o.n.name), otherName: esc(this._arw.otherName) })}</div><div class="arefs">${refs.map(row).join('')}</div>`
          : `<p class="dtext">${T('doesn_t_name_directly_so', { name: esc(o.n.name), otherName: esc(this._arw.otherName), extra: e.via ? ` ${T('the_arrow_comes_through', { boxName: esc(this._boxName(e.via)) })}` : '' })}</p>`}${indirect ? `<div class="hint">${T('it_is_also_read_inside', { indirect: P('n_templates', indirect) })}</div>` : ''}${this._yamlWarn(o.dom)}<div class="aval hint"></div><div class="btns"><button data-act="arw-edit" data-key="${esc(ends.owner)}">${T('open_the_editor')}</button><span class="cnt"></span><button data-act="modal-cancel">${T('cancel')}</button>${refs.length ? `<button class="primary danger" data-act="arw-save">${T('remove')}</button>` : ''}</div></div>`;
    },
    // rev: the arrow is to go into this box, from the box picked next
    _startLink(key, drag, rev) {
      if (!this._full()) { this._toast(T('drawing_arrows_needs_full_manager')); return; }
      const n = this._model && this._model.nodes.get(key);
      if (!this._canLink(n)) return;
      this._linking = { from: key, drag: !!drag, moved: false, rev: !!rev };
      this._$.board.classList.add('linking');
      this._toast(rev ? T('now_click_the_box_that_leads_to', { name: n.name }) : T('now_click_the_box_to', { name: n.name }));
    },
    _linkMove(ev) {
      const L = this._linking, m = this._model, n = L && m && m.nodes.get(L.from);
      if (!n) return;
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      const x = (ev.clientX - r.left - v.x) / v.k, y = (ev.clientY - r.top - v.y) / v.k;
      const sx = L.rev ? n.x : x >= n.x + n.w / 2 ? n.x + n.w : n.x, sy = n.y + n.h / 2;
      this._$.links.innerHTML = `<path class="ltmp" d="M${sx},${sy} C${(sx + x) / 2},${sy} ${(sx + x) / 2},${y} ${x},${y}"></path>`;
      L.moved = true;
    },
    _endLink() {
      this._linking = null;
      this._$.board.classList.remove('linking');
      this._$.links.innerHTML = '';
    },
    async _linkDialog(from, to) {
      const m = this._model, a = m.nodes.get(from), b = m.nodes.get(to), how = this._linkKinds(from, to);
      if (!how) { this._toast(T('an_arrow_can_t_go', { name: a.name, name2: b.name })); return; }
      const md = this._$.modal;
      md.hidden = false;
      md.innerHTML = `<div class="dlg wide"><h3>${T('connect')}</h3><div class="muted">${T('reading_what_home_assistant_offers')}</div></div>`;
      const o = await this._ownerCfg(how.owner);
      if (o.err) {
        md.innerHTML = `<div class="dlg"><h3>${T('connect')}</h3><p class="dtext">${esc(o.err)}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button></div></div>`;
        return;
      }
      const choices = await this._linkChoices(how);
      if (!choices.length) { md.innerHTML = `<div class="dlg"><h3>${T('connect')}</h3><p class="dtext">${T('home_assistant_offers_nothing_that')}</p><div class="btns"><button data-act="modal-cancel">${T('close')}</button></div></div>`; return; }
      this._arw = { mode: 'add', o, how, choices, pick: 0, vals: {}, owner: how.owner, other: how.other };
      this._renderLinkDlg();
    },
    // what an arrow can mean, from Home Assistant's own lists for the box (get_triggers_for_target and the others)
    async _linkChoices(how) {
      const k = how.other, out = [], target = TGT_RE.test(k) ? { [{ area: 'area_id', floor: 'floor_id', label: 'label_id' }[k.slice(0, k.indexOf(':'))]]: k.slice(k.indexOf(':') + 1) } : { entity_id: k };
      const get = (type) => (k.includes(':') && !TGT_RE.test(k) ? Promise.resolve([]) : this._ws({ type, target }, { optional: 'a Home Assistant before 2025.12 has no purpose-specific triggers or conditions', fallback: [] }));
      const names = await this._ptNamesFor(how.kinds);
      const ok = (desc) => !desc || Object.values(desc.fields || {}).every((f) => !f.required || f.default !== undefined);
      for (const kind of how.kinds) {
        if (kind === 'trigger') {
          if (k.startsWith('event:')) out.push({ kind, text: T('it_triggers_it'), item: { trigger: 'event', event_type: k.slice(6) } });
          else if (k.startsWith('nact:')) { const b = this._buttonEvent(this._model.nodes.get(k)); out.push({ kind, text: T('pressing_it_triggers_it'), item: { trigger: 'event', event_type: b.event_type, event_data: b.event_data } }); }
          else {
            out.push({ kind, text: T('it_changes_state'), state: 'to', item: { trigger: 'state', entity_id: k } });
            ((await get('get_triggers_for_target')) || []).filter((t) => ok((this._trigDesc || {})[t])).sort().forEach((t) => out.push({ kind, text: names[t] || humanize(t), item: { trigger: t, target: { entity_id: k } } }));
          }
        } else if (kind === 'condition') {
          out.push({ kind, text: T('its_state_is'), state: 'state', item: { condition: 'state', entity_id: k, state: '' } });
          ((await get('get_conditions_for_target')) || []).filter((t) => ok((this._condDesc || {})[t])).sort().forEach((t) => out.push({ kind, text: names[t] || humanize(t), item: { condition: t, target: { entity_id: k } } }));
        } else if (kind === 'call') {
          out.push({ kind, text: T('it_runs_it'), item: { action: k }, fields: await this._scriptFields(k).then((fs) => fs.filter((f) => f.required)) });
        } else if (kind === 'action') {
          ((await get('get_services_for_target')) || []).filter((s) => !s.startsWith('homeassistant.')).sort().forEach((s) => {
            const [d, sv] = s.split('.'), desc = ((this._hass.services || {})[d] || {})[sv] || {};
            const fields = Object.entries(desc.fields || {}).filter(([, f]) => f && f.required).map(([name, f]) => ({ name, type: 'selector', label: f.name || name, selector: f.selector || { text: {} }, required: true }));
            out.push({ kind, text: desc.name || humanize(s), item: Object.assign({ action: s, target }), fields });
          });
        }
      }
      return out;
    },
    // names of the purpose-specific triggers and conditions, in the user's language when Home Assistant has them
    async _ptNamesFor(kinds) {
      const cat = [].concat(kinds.includes('trigger') ? ['triggers'] : [], kinds.includes('condition') ? ['conditions'] : []);
      const out = {};
      for (const c of cat) {
        try {
          const r = await this._ws({ type: 'frontend/get_translations', language: this._hass.language || 'en', category: c });
          Object.entries((r && r.resources) || {}).forEach(([key, v]) => { const mm = key.match(/^component\.([^.]+)\.(?:triggers|conditions)\.([^.]+)\.name$/); if (mm) out[mm[1] + '.' + mm[2]] = v; });
        } catch (e) { /* the ids then */ }
      }
      return out;
    },
    _renderLinkDlg() {
      const w = this._arw, md = this._$.modal, c = w.choices[w.pick], m = this._model;
      const a = m.nodes.get(w.how.other), owner = w.o.n;
      const lead = { trigger: T('triggers_when', { name: a.name, name2: owner.name }), condition: T('checks_only_if', { name: owner.name, name2: a.name }), action: T('changes_it', { name: owner.name, name2: a.name }), call: T('runs_2', { name: owner.name, name2: a.name }) };
      const kinds = [...new Set(w.choices.map((x) => x.kind))];
      md.innerHTML = `<div class="dlg wide adlg"><h3>${T('connect_and_2', { name: esc(a.name), name2: esc(owner.name) })}</h3>${kinds.length > 1 ? `<div class="tchoice">${kinds.map((k) => `<button class="chip ${c.kind === k ? 'on' : ''}" data-act="lnk-kind" data-k="${k}">${k === 'trigger' ? T('it_triggers_it') : T('it_is_checked_by_it')}</button>`).join('')}</div>` : ''}<div class="tone">${esc(lead[c.kind])}</div><div class="tchoice">${w.choices.map((x, i) => (x.kind === c.kind ? `<button class="chip ${i === w.pick ? 'on' : ''}" data-act="lnk-pick" data-i="${i}">${esc(x.text)}</button>` : '')).join('')}</div>${c.state ? `<label>${c.state === 'to' ? T('to_empty_any_change') : T('state')}<input name="lstate" value="${esc(w.vals.state || '')}" list="fblstates"><datalist id="fblstates">${this._stateHints(a).map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>` : ''}${c.fields && c.fields.length ? `<div class="tfields">${c.fields.map((f, i) => this._fieldHTML(f, i, w.vals)).join('')}</div>` : ''}<div class="hint">${T('adds_to', { name: esc(owner.name) })}</div><pre class="yprev"></pre>${this._yamlWarn(w.o.dom)}<div class="aval hint"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="arw-save">${T('add')}</button></div></div>`;
      if (c.fields && c.fields.length) { this._tst = { key: w.how.other, specs: [{ id: 'l', fields: c.fields }], pick: 'l', vals: w.vals }; this._mountFields(this._tst.specs[0]); }
      this._linkPreview();
    },
    // the item a link adds, from the choice and what was typed
    _linkItem() {
      const w = this._arw, c = w.choices[w.pick], item = JSON.parse(JSON.stringify(c.item)), md = this._$.modal;
      const st = md.querySelector('input[name="lstate"]');
      if (c.state) { const v = st ? st.value.trim() : ''; if (v) item[c.state] = v; else delete item[c.state]; }
      (c.fields || []).forEach((f, i) => {
        const el = md.querySelector(`[name="tf${i}"]`), box = md.querySelector(`.selbox[data-f="${i}"]`);
        const v = box && box.dataset.mounted ? w.vals[f.name] : el ? scalar(el.value) : undefined;
        if (v !== undefined && v !== '' && v !== null) (item.data || (item.data = {}))[f.name] = v;
      });
      return item;
    },
    // the arrow dialog: which references to remove (ticked), and the preview as fields change or are typed into
    _arwChange(t) {
      if (!this._arw) return false;
      if (t.dataset && t.dataset.aref != null) { const i = +t.dataset.aref; if (t.checked) this._arw.sel.add(i); else this._arw.sel.delete(i); return true; }
      if (t.closest && t.closest('.adlg')) { this._linkPreview(); return true; }
      return false;
    },
    // the arrow dialog closed
    _arwDone() { this._arw = null; },
    _arwInput(t) { if (this._arw && t.closest && t.closest('.adlg')) { this._linkPreview(); return true; } return false; },
    _linkPreview() {
      const w = this._arw, pre = this._$.modal.querySelector('.yprev');
      if (!w || w.mode !== 'add' || !pre) return;
      const c = w.choices[w.pick], key = this._linkKey(c.kind, w.o.isScript, w.o.cfg);
      pre.textContent = toYaml({ [key]: [this._linkItem()] });
    },
    // the new config: a link appended to its list, or the ticked references removed
    _arwResult() {
      const w = this._arw, cfg = JSON.parse(JSON.stringify(w.o.cfg));
      if (w.mode === 'remove') return dropRefs(cfg, w.refs.filter((r, i) => w.sel.has(i)));
      const c = w.choices[w.pick], key = this._linkKey(c.kind, w.o.isScript, cfg), item = this._linkItem();
      if (c.state === 'state' && !item.state) throw new Error(T('enter_the_state_it_checks'));
      const miss = (c.fields || []).find((f) => f.required && !(item.data && f.name in item.data));
      if (miss) throw new Error(T('fill_in', { label: miss.label }));
      cfg[key] = toList(cfg[key]).concat([item]);
      return cfg;
    },
    async _arwSave() {
      const w = this._arw, md = this._$.modal, val = md.querySelector('.aval'), btn = md.querySelector('[data-act="arw-save"]');
      if (!w) return;
      let after;
      try { after = this._arwResult(); } catch (e) { if (val) val.textContent = e.message || String(e); return; }
      if (w.mode === 'remove' && !w.sel.size) { if (val) val.textContent = T('tick_at_least_one'); return; }
      // Home Assistant checks the new config first; nothing is saved when it doesn't accept it
      const lists = w.o.isScript ? { actions: after.sequence || [] } : { triggers: after.triggers != null ? after.triggers : after.trigger || [], conditions: after.conditions != null ? after.conditions : after.condition || [], actions: after.actions != null ? after.actions : after.action || [] };
      if (btn) btn.disabled = true;
      let res = null;
      try { res = await this._ws(Object.assign({ type: 'validate_config' }, lists)); } catch (e) { res = null; }
      const bad = res && Object.entries(res).filter(([, v]) => v && v.valid === false);
      if (bad && bad.length) {
        if (val) val.innerHTML = `<b>${T('home_assistant_doesn_t_accept')}</b> ${bad.map(([k, v]) => esc(k + ': ' + v.error)).join('; ')}`;
        if (btn) btn.disabled = false;
        return;
      }
      const { dom, id, n } = w.o, before = w.o.cfg, label = this._model && this._model.label;
      const text = w.mode === 'add' ? T('connect_and', { boxName: this._boxName(w.other), name: n.name }) : T('remove_from', { boxName: this._boxName(w.other), name: n.name });
      try { await this._saveCfg(dom, id, after); } catch (e) {
        if (val) val.textContent = T('could_not_save_2', { e: (e && (e.message || e.body)) || e });
        if (btn) btn.disabled = false;
        return;
      }
      if (!this._data.ui.yamlOk) { this._data.ui.yamlOk = true; this._save(); }
      this._arw = null; this._tst = null;
      this._closeModal();
      // put back exactly the config it had, unless someone has changed it since
      const same = async (want) => { const now = await this._api('GET', `config/${dom}/config/${encodeURIComponent(id)}`, undefined, { fallback: null }); return canon(now) === canon(want); };
      this._history({ label, text, check: (dir) => same(dir === 'undo' ? after : before), undo: () => this._saveCfg(dom, id, before), redo: () => this._saveCfg(dom, id, after) });
      this._toast(T('saved_through_home_assistant_s', { text }), [{ text: T('undo'), fn: () => this._undo() }]);
      this._configChanged();
    },

};
