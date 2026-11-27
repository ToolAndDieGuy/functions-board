import { DBG_BACK, DBG_FILTERS, DBG_ICON, DBG_QUIET, OUTCOME, T, clock, clockShort, esc, runPath, srcKey, toList, trigVar, whyStopped } from '../lib/index.js';

export const debugPart = {
    /* ======================================================================================================
       part: debug: the debugger and the runs: recording, the timeline, why a run did or didn't happen Owns _dbg,
       _dbgSel, _dbgFlt, _dbgScrolled, _dbgSeq (PARTS): only its own methods use them; the other parts ask its
       methods.
       ====================================================================================================== */
    async _openRuns() {
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'runs' };
      const d = this._$.drawer;
      d.hidden = false;
      this._put(d, `<div class="dhead"><span class="dtitle">${T('runs_3', { fnName: esc(this._fnName(this._data.ui.current)) })}</span><button data-act="refresh" title="${T('refresh')}"><ha-icon icon="mdi:refresh"></ha-icon></button><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="runs"><div class="muted pad">${T('loading')}</div></div>`);
      this._fitLitbar();
      await this._loadRuns();
      this._renderRuns();
    },
    async _loadRuns() {
      const m = this._model;
      if (!m) return;
      const map = new Map();
      m.nodes.forEach((n, k) => {
        if (n.kind === 'outside' || (n.domain !== 'automation' && n.domain !== 'script')) return;
        const id = this._itemId(n);
        if (id) map.set(n.domain + ':' + id, k);
      });
      let runs = [];
      if (map.size) {
        const lists = await Promise.all(['automation', 'script'].map((dom) => this._ws({ type: 'trace/list', domain: dom }, { fallback: [] })
          .then((l) => (l || []).map((r) => Object.assign({}, r, { domain: dom })))));
        runs = lists.flat().filter((r) => map.has(r.domain + ':' + r.item_id)).map((r) => Object.assign(r, { key: map.get(r.domain + ':' + r.item_id) }));
        const t = (r) => Date.parse((r.timestamp && r.timestamp.start) || '') || 0;
        runs.sort((a, b) => t(b) - t(a));
      }
      if (m !== this._model) return;
      this._runs = runs;
      const latest = new Map();
      runs.forEach((r) => { if (!latest.has(r.key)) latest.set(r.key, r); });
      this._errKeys = new Set([...latest.values()].filter((r) => r.error || r.script_execution === 'error').map((r) => r.key));
      this._refreshStates();
    },
    _renderRuns() {
      const box = this._$.drawer.querySelector('.runs');
      if (!box) return;
      const runs = this._runs.slice(0, 100);
      if (!runs.length) { this._put(box, `<div class="muted pad">${T('no_stored_runs_yet_for')}</div>`); return; }
      this._put(box, `<div class="muted pad small">${T('every_automation_and_script_in')}</div>${runs.map((r, i) => {
          const n = this._model && this._model.nodes.get(r.key), o = OUTCOME(r);
          return `<button class="run ${o.cls}" data-run="${i}" data-key="${esc(r.key)}"><span class="rt">${esc(clock(r.timestamp && r.timestamp.start))}</span>`
            + `<span class="rn"><b>${esc(n ? n.name : r.item_id)}</b><span>${esc(r.trigger || (r.domain === 'script' ? 'started' : ''))}</span></span>`
            + `<span class="ro" title="${esc(o.text)}">${esc(o.text)}</span></button>`;
        }).join('')}`);
    },
    // a run lights its path on the board (4.5); its trace is a click away in the bar
    _openRun(i) {
      const r = this._runs[i];
      if (!r) return;
      this._$.drawer.querySelectorAll('.run.on').forEach((x) => x.classList.remove('on'));
      const row = this._$.drawer.querySelector(`.run[data-run="${i}"]`);
      if (row) row.classList.add('on');
      this._showRun({ kind: 'run', key: r.key, t: Date.parse((r.timestamp && r.timestamp.start) || '') || Date.now(), run: { domain: r.domain, item_id: r.item_id, run_id: r.run_id } }, null);
    },

    // ---- the function debugger (9.4): a timeline of what happens to the function while the panel is open, with
    // what caused each step. Picking a step lights the chain that led to it on the board, one step at a time.
    _dbgNew(label) { return { label, rec: false, entries: [], byId: new Map(), subs: [], poll: null, since: Date.now(), users: new Map(), seen: null, ents: new Set(), logbook: null }; },
    async _openDebug() {
      const label = this._data.ui.current;
      if (!label || !this._model) return;
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'debug' };
      const d = this._$.drawer;
      d.hidden = false;
      this._put(d, `<div class="dhead"><span class="dtitle">${T('debug', { fnName: esc(this._fnName(label)) })}</span><span class="rec" title="${T('the_debugger_records_while_this')}"><i></i>${T('recording')}</span><button data-act="dbg-mon" title="${T('add_a_monitor_box_the')}"><ha-icon icon="mdi:monitor-eye"></ha-icon></button><button data-act="dbg-clear" title="${T('clear_the_timeline')}"><ha-icon icon="mdi:broom"></ha-icon></button><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dbg"><div class="dflt"></div><div class="dwhy" hidden></div><div class="dtl"><div class="muted pad">${T('reading_the_last_15_minutes')}</div></div></div>`);
      this._fitLitbar();
      if (!this._dbg || this._dbg.label !== label) this._dbg = this._dbgNew(label);
      await this._dbgStart();
      this._renderDbg();
      this._renderWhy();
    },
    // the function's entities, and the entities behind its devices and its area, floor and label targets
    _dbgEntities() {
      const m = this._model, out = new Set();
      if (!m) return [];
      m.nodes.forEach((n, k) => {
        if (n.kind === 'tool') return;
        if (!k.includes(':') && this._hass.states[k]) out.add(k);
        (n.targets || []).forEach((x) => out.add(x));
        if (k.startsWith('device:')) this._ents.forEach((e) => { if (e.device_id === k.slice(7) && this._hass.states[e.entity_id]) out.add(e.entity_id); });
      });
      return [...out];
    },
    async _dbgStart() {
      const g = this._dbg;
      if (!g || g.rec) return;
      g.rec = true;
      const c = this._haConn, back = new Date(Date.now() - DBG_BACK).toISOString(), ents = this._dbgEntities();
      g.ents = new Set(ents);
      if (g.entries.length) this._dbgAdd({ kind: 'note', t: Date.now(), text: T('recording_again') });
      // this session's own tests (events have no entity, so the logbook below doesn't list them)
      this._testsSince(Date.now() - DBG_BACK).forEach((x) => this._dbgAdd(Object.assign({ id: 'test:' + x.t + ':' + x.key }, x)));
      // what happened to its entities, and what caused it: the logbook, the last 15 minutes first, then live
      if (ents.length) {
        const p = c.subscribeMessage((msg) => this._dbgLogbook(msg), { type: 'logbook/event_stream', start_time: back, entity_ids: ents.slice(0, 500) });
        g.subs.push(p);
        try { await p; g.logbook = true; } catch (e) {
          g.logbook = false;
          this._dbgAdd({ kind: 'note', t: Date.now(), text: T('the_logbook_isn_t_available') });
        }
      }
      if (!g.rec) return;
      // action calls: Home Assistant's action history for the last 15 minutes, then live
      this._ws({ type: 'logbook/get_action_calls', start_time: back }).then((rows) => { (rows || []).forEach((r) => this._dbgCall(r)); this._renderDbgSoon(); }, () => {});
      g.subs.push(c.subscribeEvents((ev) => this._dbgCallEvent(ev), 'call_service'));
      // states the logbook leaves out (counters, measurements), or all of them without a logbook
      g.seen = new Map(ents.map((k) => { const s = this._hass.states[k]; return [k, s ? s.last_changed : null]; }));
      // every run, also the ones a condition stopped, from the traces
      await this._dbgTraces();
      if (g.rec) this._clock.every('dbg-poll', 4000, () => this._dbgTraces()); else this._clock.cancel('dbg-poll');
      if (!g.users.size) this._ws({ type: 'config/auth/list' }).then((us) => { (us || []).forEach((u) => g.users.set(u.id, u.name)); this._renderDbgSoon(); }, () => {});
    },
    // the open debugger follows the open function (another function: start again; new members: listen for them too)
    _dbgFollow(label) {
      if (!this._drawer || this._drawer.mode !== 'debug') return;
      const g = this._dbg;
      if (!g || g.label !== label) { this._dbgStop(true); this._dbg = null; this._openDebug(); }
      else if (g.rec) {
        // new members: listen for them too
        const ents = this._dbgEntities();
        if (ents.length !== g.ents.size || ents.some((k) => !g.ents.has(k))) { this._dbgStop(true); this._dbgStart(); }
      }
    },
    // back on the page: an open debugger records again
    _dbgResume() { if (this._drawer && this._drawer.mode === 'debug' && this._dbg && !this._dbg.rec) this._dbgStart(); },
    // a note from elsewhere (a test step, a trigger that would fire) while the debugger records this function
    _dbgNote(entry, anyFn) { const g = this._dbg; if (g && g.rec && (anyFn || g.label === (this._model && this._model.label))) this._dbgAdd(entry); },
    _dbgStop(quiet) {
      const g = this._dbg;
      if (!g || !g.rec) return;
      g.rec = false;
      this._clock.cancel('dbg-poll');
      g.subs.forEach((p) => this._ha.drop(p));
      g.subs = [];
      if (!quiet) this._dbgAdd({ kind: 'note', t: Date.now(), text: T('stopped_recording') });
    },
    _dbgAdd(e) {
      const g = this._dbg;
      if (!g) return null;
      // Clear starts the list again: what happened before it stays out, also when the traces are read again
      if (g.cleared && e.t && e.t < g.cleared) return null;
      if (!e.id) e.id = e.kind + ':' + (++this._dbgSeq);
      if (g.byId.has(e.id)) return g.byId.get(e.id);
      g.byId.set(e.id, e);
      // in time order: most arrive last, the 15 minutes read at the start can come in between
      let i = g.entries.length;
      while (i > 0 && g.entries[i - 1].t > e.t) i--;
      g.entries.splice(i, 0, e);
      if (g.entries.length > 500) g.byId.delete(g.entries.shift().id);
      // a run can arrive after the calls and changes it made: they now know their cause
      if (e.kind === 'run' && e.ctx) this._dbgOwn(e);
      this._renderDbgSoon();
      return e;
    },
    _dbgOwn(run) {
      const g = this._dbg, by = { kind: run.run.domain === 'script' ? 'script' : 'auto', key: run.key, text: this._nameOf(run.key) };
      g.entries.forEach((x) => { if (x !== run && x.ctx === run.ctx && x.kind !== 'run' && (!x.by || (x.by.kind !== 'auto' && x.by.kind !== 'script'))) x.by = by; });
    },
    _userName(id) {
      if (!id) return T('a_user');
      if (this._hass.user && id === this._hass.user.id) return T('you');
      return (this._dbg && this._dbg.users.get(id)) || T('a_user');
    },
    // what caused a logbook entry or an action call, from the context Home Assistant attached to it
    _dbgCause(ev) {
      const et = ev.context_event_type;
      if ((et === 'automation_triggered' || et === 'script_started') && ev.context_entity_id) {
        return { kind: et === 'script_started' ? 'script' : 'auto', key: ev.context_entity_id, text: ev.context_name || this._nameOf(ev.context_entity_id) };
      }
      if (et === 'automation_triggered' || et === 'script_started') return { kind: 'pending', text: ev.context_name || T('an_automation_or_script') };
      if (et === 'call_service') return { kind: 'user', text: (ev.context_user_id ? this._userName(ev.context_user_id) : T('an_action')) + (ev.context_domain ? ` (${ev.context_domain}.${ev.context_service})` : '') };
      if (ev.context_user_id) return { kind: 'user', text: this._userName(ev.context_user_id) };
      if (et) return { kind: 'event', text: et };
      return { kind: 'self', text: T('its_device_or_integration') };
    },
    _dbgLogbook(msg) {
      const g = this._dbg;
      if (!g || !msg || !Array.isArray(msg.events)) return;
      msg.events.forEach((ev) => {
        const t = Math.round((+ev.when || 0) * 1000), k = ev.entity_id;
        if (ev.domain === 'functions_board' || ev.name === 'Functions Board') {
          // a test: this session's are listed already; ones from another board come from the logbook
          if (!this._testsSince(t - 5000).some((x) => Math.abs(x.t - t) < 5000)) this._dbgAdd({ id: 'lbt:' + t, kind: 'test', t, key: k || null, text: T('test', { message: String(ev.message || '').replace(/^test: /, '') }), by: { kind: 'user', text: T('another_board') } });
          return;
        }
        if (ev.run_id && (ev.domain === 'automation' || ev.domain === 'script')) {
          const id = 'run:' + ev.run_id, was = g.byId.get(id), by = this._dbgCause(ev);
          if (was) { was.ctx = was.ctx || ev.context_id; if (!was.src) was.src = ev.source || ''; if (by.kind === 'auto' || by.kind === 'script') was.by = by; return; }
          this._dbgAdd({ id, kind: 'run', t, key: k, run: { domain: ev.domain, item_id: ev.item_id, run_id: ev.run_id }, src: ev.source || '', ctx: ev.context_id, by, state: 'running' });
          return;
        }
        if (k && ev.state != null) {
          if (k.startsWith('script.')) return;  // on and off are its runs, listed already
          this._dbgAdd({ id: 'st:' + k + ':' + t, kind: 'state', t, key: k, state: ev.state, by: this._dbgCause(ev) });
          return;
        }
        if (ev.message) this._dbgAdd({ kind: 'log', t, key: k || null, text: `${ev.name || (k ? this._nameOf(k) : '')} ${ev.message}`.trim(), by: this._dbgCause(ev) });
      });
      this._renderDbgSoon();
    },
    // an action call that touches the function: one of its entities, devices or areas, one of its scripts or
    // action boxes, or a call made by one of its automations or scripts
    _dbgCall(r, live) {
      const g = this._dbg, m = this._model;
      if (!g || !m || !r || !r.domain || DBG_QUIET.has(r.domain)) return;
      const sd = r.service_data || {}, ents = toList(sd.entity_id).filter((x) => typeof x === 'string');
      const by = r.context_entity_id && m.nodes.get(r.context_entity_id);
      const svcKey = 'svc:' + r.domain + '.' + r.service, scKey = r.domain === 'script' ? 'script.' + r.service : null;
      const mine = (by && by.kind === 'member') || ents.some((x) => g.ents.has(x)) || toList(sd.device_id).some((x) => m.nodes.has('device:' + x))
        || toList(sd.area_id).some((x) => m.nodes.has('area:' + x)) || toList(sd.floor_id).some((x) => m.nodes.has('floor:' + x))
        || toList(sd.label_id).some((x) => m.nodes.has('label:' + x)) || (scKey && m.nodes.has(scKey)) || m.nodes.has(svcKey);
      if (!mine) return;
      const t = Math.round((+r.when || 0) * 1000);
      let id = 'call:' + (r.context_id || '') + ':' + r.domain + '.' + r.service + ':' + ents.join(',') + ':' + Math.round(t / 1000);
      if (live && g.byId.has(id) && g.byId.get(id)._live) {
        let n = 2;
        while (g.byId.has(id + '#' + n)) n++;
        id = id + '#' + n;
      }
      this._dbgAdd({ id, kind: 'call', t, _live: !!live,
        key: ents.find((x) => m.nodes.has(x)) || (scKey && m.nodes.has(scKey) ? scKey : m.nodes.has(svcKey) ? svcKey : null),
        svc: r.domain + '.' + r.service, ents, ctx: r.context_id, by: this._dbgCause(r) });
    },
    _dbgCallEvent(ev) {
      const d = (ev && ev.data) || {}, cx = (ev && ev.context) || {}, run = this._dbgRunByCtx(cx.id);
      // the same shape as a row of the action history
      const r = { domain: d.domain, service: d.service, service_data: Object.assign({}, d.service_data || {}), context_id: cx.id, when: (Date.parse(ev.time_fired) || Date.now()) / 1000, context_user_id: cx.user_id };
      if (run) Object.assign(r, { context_event_type: run.run.domain === 'script' ? 'script_started' : 'automation_triggered', context_entity_id: run.key, context_name: this._nameOf(run.key) });
      // made from within a run the logbook hasn't listed yet: its run fills in the name when it arrives (_dbgOwn)
      else if (cx.parent_id && !cx.user_id) Object.assign(r, { context_event_type: 'automation_triggered', context_name: T('an_automation_or_script') });
      this._dbgCall(r, true);
    },
    _dbgRunByCtx(id) {
      const g = this._dbg;
      if (!id || !g) return null;
      for (let i = g.entries.length - 1; i >= 0; i--) { const e = g.entries[i]; if (e.kind === 'run' && e.ctx === id) return e; }
      return null;
    },
    // runs from the traces: those a condition stopped, and why; the logbook only lists the ones that went ahead
    async _dbgTraces() {
      const g = this._dbg, m = this._model;
      if (!g || !g.rec || !m || g.tracing || m.label !== g.label) return;
      const ids = new Map();
      m.nodes.forEach((n, k) => { if (n.kind === 'member' && (n.domain === 'automation' || n.domain === 'script')) { const id = this._itemId(n); if (id) ids.set(n.domain + ':' + id, k); } });
      if (!ids.size) return;
      g.tracing = true;
      try {
        const doms = ['automation', 'script'].filter((d) => [...ids.keys()].some((x) => x.startsWith(d + ':')));
        const lists = await Promise.all(doms.map((dom) => this._ws({ type: 'trace/list', domain: dom }).then((l) => (l || []).map((r) => Object.assign({}, r, { domain: dom })), () => [])));
        const from = g.since - DBG_BACK;
        lists.flat().forEach((r) => {
          const key = ids.get(r.domain + ':' + r.item_id), t = Date.parse((r.timestamp && r.timestamp.start) || '') || 0;
          if (!key || t < from) return;
          const id = 'run:' + r.run_id, e = g.byId.get(id), upd = { state: r.state, exec: r.script_execution, err: r.error || null, nt: !!r.not_triggered };
          if (e) {
            if (e.state !== upd.state || e.exec !== upd.exec) { Object.assign(e, upd); if (!e.src && r.trigger) e.src = r.trigger; this._dbgExplain(e); this._renderDbgSoon(); }
            return;
          }
          this._dbgExplain(this._dbgAdd(Object.assign({ id, kind: 'run', t, key, run: { domain: r.domain, item_id: r.item_id, run_id: r.run_id }, src: r.trigger || '' }, upd)));
        });
      } finally { g.tracing = false; }
    },
    async _dbgExplain(e) {
      if (!e || e.why || e.explaining || e.state !== 'stopped' || !(e.nt || e.exec === 'failed_conditions' || e.exec === 'error' || e.err)) return;
      e.explaining = true;
      const tr = await this._ws({ type: 'trace/get', domain: e.run.domain, item_id: e.run.item_id, run_id: e.run.run_id }, { optional: 'a trace can be gone: Home Assistant keeps only the last few runs', fallback: null });
      e.explaining = false;
      if (!tr) return;
      e.why = whyStopped(tr, (x) => this._nameOf(x));
      if (!e.ctx && tr.context) e.ctx = tr.context.id;
      this._renderDbgSoon();
    },
    // the board sees every state; the logbook leaves counters and measurements out
    _dbgStates() {
      const g = this._dbg;
      if (!g || !g.rec || !g.seen) return;
      g.seen.forEach((was, k) => {
        const s = this._hass.states[k];
        if (!s || s.last_changed === was) return;
        g.seen.set(k, s.last_changed);
        const d = k.split('.')[0];
        if (g.logbook && !(d === 'counter' || d === 'proximity' || (d === 'sensor' && (s.attributes.unit_of_measurement || s.attributes.state_class)))) return;
        if (d === 'script') return;
        const cx = s.context || {}, run = this._dbgRunByCtx(cx.id), t = Date.parse(s.last_changed) || Date.now();
        const by = run ? { kind: run.run.domain === 'script' ? 'script' : 'auto', key: run.key, text: this._nameOf(run.key) }
          : this._sim.get(k) === cx.id ? { kind: 'user', text: T('a_test_simulated') } : cx.user_id ? { kind: 'user', text: this._userName(cx.user_id) } : { kind: 'self', text: T('its_device_or_integration') };
        this._dbgAdd({ id: 'st:' + k + ':' + t, kind: 'state', t, key: k, state: s.state, by });
      });
    },
    _renderDbgSoon() { this._clock.once('dbg', 200, () => this._renderDbg()); },
    _renderDbg() {
      const g = this._dbg, d = this._$.drawer;
      if (!g || !this._drawer || this._drawer.mode !== 'debug') return;
      const box = d.querySelector('.dtl'), fl = d.querySelector('.dflt'), rec = d.querySelector('.rec');
      if (!box) return;
      if (rec) rec.classList.toggle('on', !!g.rec);
      const F = DBG_FILTERS, cur = F[this._dbgFlt] ? this._dbgFlt : 'all';
      const count = (kinds) => g.entries.filter((e) => e.kind !== 'note' && (!kinds || kinds.includes(e.kind))).length;
      if (fl) fl.innerHTML = Object.entries(F).map(([k, [t, kinds]]) => `<button class="chip ${k === cur ? 'on' : ''}" data-act="dbg-flt" data-f="${k}">${t}<span>${count(kinds)}</span></button>`).join('');
      const kinds = F[cur][1], list = g.entries.filter((e) => !kinds || kinds.includes(e.kind) || e.kind === 'note');
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
      this._put(box, list.length ? list.map((e) => this._dbgRow(e)).join('')
        : `<div class="muted pad">${T('nothing_yet_whatever_happens_to')}</div>`);
      if (atEnd || !this._dbgScrolled) { box.scrollTop = box.scrollHeight; this._dbgScrolled = true; }
    },
    _dbgRow(e) {
      const nm = (k) => (k ? this._boxName(k) : '');
      if (e.kind === 'note') return `<div class="dbrow note"><span class="rt">${esc(clockShort(e.t))}</span><span class="dm">${esc(e.text)}</span></div>`;
      let main = '', sub = '', cls = '';
      if (e.kind === 'state') { main = `${nm(e.key)} → ${this._fmtState(e.key, e.state)}`; sub = e.by ? T('by', { text: e.by.text }) : ''; }
      else if (e.kind === 'run') {
        const o = e.nt ? { text: T('didn_t_fire_2'), cls: 'muted' } : !e.exec && e.state === 'running' ? { text: T('running'), cls: 'blue' } : OUTCOME({ state: e.state, script_execution: e.exec, error: e.err });
        main = `${nm(e.key)} · ${o.text.charAt(0).toLowerCase() + o.text.slice(1)}`; cls = o.cls;
        sub = (e.by && (e.by.kind === 'auto' || e.by.kind === 'script') && e.by.key !== e.key ? T('started_by', { text: e.by.text }) : e.src ? T('triggered_by_2', { src: e.src }) : '') + (e.why ? ' · ' + e.why : '');
      } else if (e.kind === 'call') { main = e.svc + (e.ents && e.ents.length ? ' → ' + e.ents.map(nm).join(', ') : ''); sub = e.by ? T('by', { text: e.by.text }) : ''; }
      else { main = e.text || ''; sub = e.by ? T('by', { text: e.by.text }) : e.kind === 'test' ? T('from_this_board') : ''; }
      return `<button class="dbrow k-${e.kind} ${cls} ${this._dbgSel === e.id ? 'on' : ''}" data-act="dbg-pick" data-id="${esc(e.id)}" data-key="${esc(e.key || '')}">`
        + `<span class="rt">${esc(clockShort(e.t))}</span><ha-icon icon="${DBG_ICON[e.kind] || 'mdi:circle-small'}"></ha-icon><span class="dm"><b>${esc(main)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span></button>`;
    },
    async _dbgPick(id) {
      const g = this._dbg, e = g && g.byId.get(id);
      if (!e) return;
      this._dbgSel = id;
      this._renderDbg();
      const steps = this._dbgChain(e);
      if (e.kind === 'run') await this._showRun(e, steps);
      else this._lightSteps(steps);
    },
    // what led to a step, as far back as the timeline goes: a change was made by a run, a run was set off by a change
    _dbgChain(e0) {
      const g = this._dbg, steps = [e0], seen = new Set([e0.id]);
      if (!g) return steps;
      const last = (pred, before, within) => {
        for (let i = g.entries.length - 1; i >= 0; i--) {
          const x = g.entries[i];
          if (x === before || seen.has(x.id) || x.kind === 'note' || x.t > before.t + 150) continue;
          if (before.t - x.t > (within || 600000)) break;
          if (pred(x)) return x;
        }
        return null;
      };
      let cur = e0;
      for (let n = 0; n < 12 && cur; n++) {
        let prev = null;
        if (cur.by && (cur.by.kind === 'auto' || cur.by.kind === 'script') && cur.by.key && cur.by.key !== cur.key) prev = last((x) => x.kind === 'run' && x.key === cur.by.key, cur);
        if (!prev && cur.kind === 'run') { const src = srcKey(cur.src); if (src) prev = last((x) => (x.kind === 'state' || x.kind === 'test' || x.kind === 'call') && x.key === src, cur, 60000); }
        if (!prev && cur.kind === 'state' && cur.by && cur.by.kind === 'user') prev = last((x) => (x.kind === 'test' || x.kind === 'call') && (x.key === cur.key || (x.ents || []).includes(cur.key)), cur, 5000);
        if (!prev) break;
        steps.unshift(prev); seen.add(prev.id); cur = prev;
      }
      return steps;
    },
    // a run on the board (4.5): its trigger arrow and the arrows to what it actually called, with its trace a click away
    async _showRun(e, steps) {
      const r = e.run;
      let tr = null;
      try { tr = await this._ws({ type: 'trace/get', domain: r.domain, item_id: r.item_id, run_id: r.run_id }); }
      catch (err) { this._toast(T('could_not_read_its_trace', { err: (err && (err.message || err.code)) || err })); }
      if (!this._model) return;
      const path = tr ? runPath(e.key, tr, this._model.edges) : { keys: [e.key], edges: [] };
      let chain = steps || [e];
      // an event trigger carries what fired it (a timer, say): follow the chain from that change
      const tv = tr && trigVar(tr), from = tv && ((tv.event && tv.event.data && tv.event.data.entity_id) || tv.entity_id);
      if (this._dbg && chain.length === 1 && typeof from === 'string') {
        const before = this._dbg.entries.slice().reverse().find((x) => x.kind === 'state' && x.key === from && x.t <= e.t + 150 && e.t - x.t < 60000);
        if (before) chain = this._dbgChain(before).concat([e]);
      }
      this._lightSteps(chain, { keys: path.keys, edges: path.edges, e, tr });
    },

};
