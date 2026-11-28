import { ENTITY_RE, EXACT_RE, OUTCOME, P, SBX_OTHER, SBX_PRELUDE, SBX_PRESS, SBX_RAW, SVC_RE, Sandbox, T, WD, analyze, anchor, clock, condText, esc, fill, flowCrossings, flowPath, fmtDur, fmtDurLong, lessMotion, localAt, parseHMS, parseLoose, runCheck, sbxCompare, sbxCoverage, sbxDevFields, sbxDevPressable, sbxDoStep, sbxExplore, sbxHistory, sbxKnownPayloads, sbxNum, sbxPayloadFor, sbxPressHits, sbxPressKey, sbxPyEq, sbxRewrite, sbxTopic, sbxZwCoerce, shorten, toList, tzParts } from '../lib/index.js';

export const sandboxPart = {
    /* ======================================================================================================
       part: sandbox: the sandbox and a run followed on the board (the flow, lit steps) Owns nothing of its own
       (PARTS): only its own methods use them; the other parts ask its methods.
       ====================================================================================================== */

    _sbxOn() { return !!(this._sbx && this._sbx.eng && this._drawer && this._drawer.mode === 'sandbox'); },
    // every time it opens: what the sandbox is for, and everything it can't do, to click through
    _sbxIntro() {
      const m = this._$.modal, li = (xs) => xs.map((x) => `<li>${x}</li>`).join(''), open = this._sbxOn();
      m.hidden = false;
      m.innerHTML = `<div class="dlg sbxdlg"><h3><ha-icon icon="mdi:flask-outline"></ha-icon> ${T('sbxi_title')}</h3>`
        + `<p>${T('sbxi_why')}</p>`
        + `<div class="okbox"><ha-icon icon="mdi:shield-check-outline"></ha-icon><span>${T('sbxi_safe')}</span></div>`
        + `<h4>${T('sbxi_limits_h')}</h4><ol class="sbxl">${li([T('sbxi_l_board'), T('sbxi_l_devices'), T('sbxi_l_calls'), T('sbxi_l_triggers'), T('sbxi_l_ask'), T('sbxi_l_tpl'), T('sbxi_l_nodered'), T('sbxi_l_copy'), T('sbxi_l_time')])}</ol>`
        + `<div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${T('sbxi_bottom')}</span></div>`
        + `<label class="chk"><input type="checkbox" name="sbxwhole"${this._data.ui.sbxWhole ? ' checked' : ''}>${T('sbxi_whole')}</label>`
        + `<label class="chk"><input type="checkbox" name="sbxskip"${this._data.ui.sbxIntro === false ? ' checked' : ''}>${T('sbxi_skip')}</label>`
        + `<div class="btns">${open ? '' : `<button data-act="modal-cancel">${T('cancel')}</button>`}<button class="primary" data-act="sbx-start">${open ? T('close') : T('sbxi_go')}</button></div></div>`;
      const b = m.querySelector('[data-act="sbx-start"]');
      if (b) b.focus();
    },
    async _openSandbox(opt = {}) {
      const label = this._data.ui.current;
      if (!label || !this._model) return;
      this._leaveDrawerMode();
      this._capture = null;
      this._clearLit(true);
      this._drawer = { mode: 'sandbox' };
      const d = this._$.drawer;
      d.hidden = false;
      this._put(d, `<div class="dhead"><span class="dtitle">${T('sbx_title', { fnName: esc(this._fnName(label) + (this._ver ? ' · ' + this._ver.name : '')) })}</span><span class="sbclock"></span><button data-act="sbx-about" title="${T('sbx_about_t')}"><ha-icon icon="mdi:information-outline"></ha-icon></button><button data-act="sbx-reset" title="${T('sbx_reset_t')}"><ha-icon icon="mdi:restore"></ha-icon></button><button data-act="close" title="${T('sbx_close_t')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dbg sbx"><div class="sbnote">${T('sbx_note')}</div><div class="sbask"></div><div class="sbctl"></div><div class="sbrec"></div><div class="sbchk"></div><div class="sbdue"></div><div class="sbtabs" role="tablist" aria-label="${T('sbx_tabs')}"><button role="tab" data-act="sbx-tab" data-tab="tl" aria-selected="true">${T('sbx_tab_tl')}</button><button role="tab" data-act="sbx-tab" data-tab="st" aria-selected="false">${T('sbx_tab_st')}</button><button role="tab" data-act="sbx-tab" data-tab="ex" aria-selected="false">${T('sbx_tab_ex')}</button><button role="tab" data-act="sbx-tab" data-tab="cov" aria-selected="false">${T('sbx_tab_cov')}</button></div><div class="sbhp" hidden></div><div class="dtl sbtl" role="tabpanel"><div class="muted pad">${T('reading_configs')}</div></div><div class="sbvp" hidden></div><div class="dtl sbpane sbst" role="tabpanel" hidden></div><div class="dtl sbpane sbex" role="tabpanel" hidden></div><div class="dtl sbpane sbcov" role="tabpanel" hidden></div></div>`);
      this._$.board.classList.add('sbx');
      this._$.sbxpill.hidden = false;
      this._fitLitbar();
      await this._sbxNew(label, opt.check, opt.extra);
      if (!this._sbxOn()) return;
      this._renderSbxCtl();
      this._renderChecks();
      this._renderSbx();
      this._refreshStates();
      this._renderNodebar();
      this._renderLegend();
    },
    // extra (0.11.3): a script not saved yet (a builder's, tried), or one in place of its saved config
    async _sbxNew(label, check, extra) {
      const m = this._model;
      const ids = [...m.nodes.keys()].filter((k) => /^(automation|script)\./.test(k));
      const cfgs = await Promise.all(ids.map((k) => this._fetchConfig(k)));
      if (extra && extra.cfg) { const i = ids.indexOf(extra.id); if (i < 0) { ids.push(extra.id); cfgs.push(extra.cfg); } else cfgs[i] = extra.cfg; }
      // whole home: the automations outside the function that its changes reach run too (a check that had some
      // replays them as well)
      const outside = new Set(check ? (check.items || []).filter((k) => k.startsWith('automation.') && !ids.includes(k)) : []);
      if (this._data.ui.sbxWhole && !check) (await this._sbxReach(ids, cfgs)).forEach((k) => outside.add(k));
      const more = [...outside], moreCfgs = await Promise.all(more.map((k) => this._fetchConfig(k)));
      more.forEach((k, i) => { if (moreCfgs[i]) { ids.push(k); cfgs.push(moreCfgs[i]); } });
      const g = { label, asks: [], tplN: 0, pre: check ? check.answers.slice() : [], outside, extra: extra || null };
      // what you do from here, so the run can be kept as a check: the states it starts from, the clock, the steps
      const now = check ? check.at : Date.now(), states = Object.assign({}, this._hass.states);
      if (extra && extra.cfg && !states[extra.id]) states[extra.id] = { entity_id: extra.id, state: 'off', attributes: { friendly_name: extra.cfg.alias || extra.id, mode: extra.cfg.mode || 'single' }, last_changed: new Date(now).toISOString(), last_updated: new Date(now).toISOString(), context: {} };
      if (extra && extra.state) states[extra.id] = extra.state;
      if (check) Object.entries(check.start).forEach(([k, v]) => { states[k] = Object.assign({}, states[k] || {}, { state: v.state, attributes: Object.keys(v.attributes || {}).length ? v.attributes : (states[k] || {}).attributes || {} }); });
      g.rec = { at: now, start: this._checkStart(states), items: ids.slice(), steps: [], answers: [] };
      const resolve = (ref) => {
        if (ref.startsWith('device:')) return this._ents.filter((e) => e.device_id === ref.slice(7)).map((e) => e.entity_id);
        const t = this._tgt.get(ref);
        return t ? t.entities : [];
      };
      // the engine's settings, kept: rewinding makes a new one from the same start, and so does the explorer (0.11.2)
      // the helpers that follow what they read: their rules, asked now if the board let go of them (a config changed)
      const derived = this._model ? await this._followRules(this._model.nodes, states) : {};
      if (extra && extra.derived) derived[extra.id] = extra.derived;
      // the triggers of the function's devices (0.13.0): every one the Press row can offer, and MQTT ones' topics
      const dt = await this._devTrigs(this._sbxDevIds(cfgs));
      g.devPress = dt.press;
      // and the values of its Z-Wave devices (0.13.0)
      const zw = await this._zwFor(this._zwDevIds(cfgs, this._sbxDevIds(cfgs)));
      if (!this._drawer || this._drawer.mode !== 'sandbox') return;
      const wholeNote = outside.size ? [P('sbx_whole_n', outside.size, { list: [...outside].map((k) => this._boxName(k)).join(', ') })] : [];
      g.opts = {
        states, items: ids.map((id, i) => ({ id, cfg: cfgs[i], outside: outside.has(id) })), now, tz: this._hass.config && this._hass.config.time_zone, notes: wholeNote,
        tpl: (t, v, e, o) => this._sbxTpl(t, v, e, o), ask: (q) => this._sbxAsk(q), resolve, fetch: (id) => this._fetchConfig(id),
        name: (id) => this._boxName(id), condText: (c) => condText(c, (x) => this._boxName(x)), onLog: () => this._sbxLogged(),
        entityOf: (x) => this._entOfReg(x), scene: (id) => this._sceneCfg(id), actText: (a) => this._actText(a),
        onPause: () => this._renderSbx(),
        derived, devMqtt: dt.mqtt, pressMore: (t) => this._pressMore(t), zwave: zw, devOf: (e) => this._devOfEnt(e),
      };
      g.eng = new Sandbox(g.opts);
      g.tab = 'tl';
      this._sbx = g;
      await g.eng.start();
    },
    // an action in a few words, for step-through and coverage
    _actText(a) {
      if (!a || typeof a !== 'object') return '';
      const svc = typeof a.action === 'string' ? a.action : typeof a.service === 'string' ? a.service : null;
      const tg = a.target || {}, who = toList(tg.entity_id || a.entity_id).concat(toList(tg.area_id), toList(tg.device_id).map((d) => 'device:' + d)).map((x) => this._boxName(String(x))).join(', ');
      if (svc) return who ? `${svc} → ${who}` : svc;
      if (a.delay !== undefined) return T('sbx_a_delay');
      if (a.wait_template !== undefined || a.wait_for_trigger !== undefined) return T('sbx_a_wait');
      if (a.choose !== undefined) return T('sbx_a_choose');
      if (a.if !== undefined) return T('sbx_a_if');
      if (a.repeat) return T('sbx_a_repeat');
      if (a.parallel !== undefined) return T('sbx_a_parallel');
      if (a.variables) return T('sbx_a_vars');
      if (a.event !== undefined) return T('sbx_fires', { type: String(a.event) });
      if (a.scene !== undefined) return 'scene.turn_on → ' + this._boxName(String(a.scene));
      if (a.stop !== undefined) return T('sbx_a_stop');
      return Object.keys(a)[0] || '';
    },
    // the entity id for an entity registry id (a device trigger, condition or action made in the editor keeps those)
    _entOfReg(x) {
      const e = this._ents.find((y) => y.id === x);
      return e ? e.entity_id : null;
    },
    // a scene's config (what it sets), for one made in the editor; one in YAML has none to read
    async _sceneCfg(id) {
      const st = this._hass.states[id], sid = st && st.attributes && st.attributes.id;
      if (sid == null) return null;
      return this._api('GET', `config/scene/config/${encodeURIComponent(sid)}`, null, { optional: 'a scene set up in YAML has no config to read', fallback: null });
    },
    _sbxEnd() {
      const g = this._sbx;
      if (!g) return;
      g.ended = true;
      g.asks.forEach((a) => a.res(false));
      g.asks = [];
      if (g.eng) { g.eng.stopAll(); g.eng.resumeAll(); }
      g.speed = 0; g.exStop = true;
      this._clock.cancel('sbxplay');
      this._sbx = null;
      this._$.board.classList.remove('sbx');
      this._$.sbxpill.hidden = true;
      this._clearLit(true);
      this._refreshStates();
      this._renderNodebar();
      this._renderLegend();
    },
    // whole home (0.11.2): the automations outside the function that what it touches reaches, and those theirs reach in
    // turn (at most 200). What it touches is everything its automations and scripts read or change (what you'd set in
    // the sandbox, and what they set); one outside is reached when a trigger of it is on such an entity (an area's, a
    // device's) or on an event fired, and then what it changes reaches further. Only automations that are loaded (have
    // a state: not disabled) are looked at.
    async _sbxReach(ids, cfgs) {
      const ents = (ref) => (ref.startsWith('event:') ? [ref] : this._refEnts(ref));
      const known = (x) => this._known(x);
      const refs = (cfg, id, role) => { const out = new Set(); analyze(cfg, id.startsWith('script.'), known).refs.filter((r) => r.role === role).forEach((r) => ents(r.ref).forEach((x) => out.add(x))); return out; };
      const mine = new Set(ids), reached = new Set();
      ids.forEach((id, i) => { if (cfgs[i]) ['trigger', 'condition', 'action'].forEach((role) => refs(cfgs[i], id, role).forEach((x) => reached.add(x))); });
      const cands = Object.keys(this._hass.states).filter((k) => k.startsWith('automation.') && !mine.has(k)).sort();
      const cfgOf = new Map(), got = await Promise.all(cands.map((k) => this._fetchConfig(k)));
      cands.forEach((k, i) => { if (got[i]) cfgOf.set(k, got[i]); });
      const out = [], left = new Set(cfgOf.keys());
      for (let grew = true; grew && out.length < 200;) {
        grew = false;
        for (const k of [...left]) {
          if (out.length >= 200) break;
          if (![...refs(cfgOf.get(k), k, 'trigger')].some((x) => reached.has(x))) continue;
          out.push(k); left.delete(k); grew = true;
          refs(cfgOf.get(k), k, 'action').forEach((x) => reached.add(x));
        }
      }
      return out;
    },
    // a notification's buttons (0.11.2): every button the function's automations and scripts would put on one (not
    // one whose id is a template), by its title; pressed in the sandbox, the phone's answer is fired. First (0.11.3)
    // the buttons of the notifications sent in this sandbox, newest first, ids rendered (each run's own)
    _sbxButtons() {
      const g = this._sbx, out = new Map(), known = (x) => this._known(x);
      g.eng.log.slice().reverse().forEach((e) => {
        const acts = e.kind === 'call' && /^notify\./.test(e.svc || '') && e.data && e.data.data && Array.isArray(e.data.data.actions) ? e.data.data.actions : [];
        acts.forEach((x) => { if (x && typeof x.action === 'string' && x.action && x.action !== 'URI' && !out.has(x.action)) out.set(x.action, String(x.title || x.action)); });
      });
      g.opts.items.forEach((it) => {
        if (!it.cfg) return;
        analyze(it.cfg, it.id.startsWith('script.'), known).refs.forEach((r) => { if (r.role === 'action' && r.ref.startsWith('nact:') && !out.has(r.ref.slice(5))) out.set(r.ref.slice(5), r.title || r.ref.slice(5)); });
      });
      return [...out].map(([action, title]) => ({ action, title }));
    },
    // ---- a device's own triggers (0.13.0) ----
    // the devices whose triggers the Press row offers: the device boxes on the board, the devices of its entities, and
    // those the automations' device triggers name (at most 60)
    _sbxDevIds(cfgs) {
      const out = new Set();
      [...this._model.nodes.keys()].forEach((k) => {
        if (k.startsWith('device:')) out.add(k.slice(7));
        else if (!k.includes(':')) { const e = this._entMap.get(k); if (e && e.device_id) out.add(e.device_id); }
      });
      this._devIdsIn(cfgs).forEach((d) => out.add(d));
      return [...out].filter((d) => this._devMap.has(d)).slice(0, 60);
    },
    // the devices named by the device triggers in these configs (mqtt: only MQTT ones)
    _devIdsIn(cfgs, mqtt) {
      const out = new Set();
      const walk = (x) => {
        if (Array.isArray(x)) { x.forEach(walk); return; }
        if (!x || typeof x !== 'object') return;
        if ((x.trigger || x.platform) === 'device' && typeof x.device_id === 'string' && (!mqtt || x.domain === 'mqtt')) out.add(x.device_id);
        Object.values(x).forEach(walk);
      };
      walk(cfgs);
      return [...out];
    },
    // what these devices' triggers offer: press, [{ key, t, fields, dev }] (with no entity, as sbxDevPressable),
    // and mqtt, the MQTT ones' topics and payloads. onlyMqtt: just those, asked only of devices with MQTT triggers
    async _devTrigs(ids, onlyMqtt) {
      const press = [], mqtt = [];
      const held = await Promise.all(ids.map((id) => this._ha.quiet(this._store.asOfNow('dtrig:' + id, 3e5), 'each call it makes reports its own failure', null)));
      held.forEach((h, i) => {
        if (!h) return;
        mqtt.push(...h.mqtt);
        if (onlyMqtt) return;
        h.trigs.forEach((x) => press.push({ key: sbxPressKey(x.t), t: x.t, fields: x.fields, dev: ids[i] }));
      });
      return { press, mqtt };
    },
    // one device's triggers, as Home Assistant lists them for its automation editor, with the choices each offers
    // (its capabilities) and, for an MQTT device, each trigger's topic and payload (its discovery config, from the
    // device's MQTT debug info). Kept in the store as 'dtrig:<device>' (five minutes; a device registry change makes
    // it stale)
    async _readDevTrig(id) {
      const list = await this._ws({ type: 'device_automation/trigger/list', device_id: id }, { optional: 'a device whose integration lists no triggers, or one just removed', fallback: [] });
      const own = toList(list).filter((t) => t && typeof t === 'object' && t.entity_id == null && t.device_id === id);
      const caps = await Promise.all(own.map((t) => this._ws({ type: 'device_automation/trigger/capabilities', trigger: t }, { optional: 'an integration that has no settings to offer for its trigger', fallback: {} })));
      const trigs = own.map((t, i) => ({ t, caps: caps[i] })).filter((x) => sbxDevPressable(x.t, x.caps)).map((x) => ({ t: x.t, fields: sbxDevFields(x.caps) }));
      let mqtt = [];
      if (own.some((t) => t.domain === 'mqtt')) {
        const info = await this._ws({ type: 'mqtt/device/debug_info', device_id: id }, { optional: 'MQTT not loaded, or the device just removed', fallback: null });
        mqtt = toList(info && info.triggers).map((x) => {
          const p = (x && x.discovery_data && x.discovery_data.payload) || {};
          return { device_id: id, type: p.type, subtype: p.subtype, discovery_id: Array.isArray(x.trigger_key) ? x.trigger_key[1] : null, topic: typeof p.topic === 'string' ? p.topic : null, payload: p.payload != null ? String(p.payload) : null, value_template: typeof p.value_template === 'string' ? p.value_template : null };
        }).filter((d) => d.topic && d.type != null && d.subtype != null);
      }
      return { trigs, mqtt };
    },
    // ---- Z-Wave values (0.13.0) ----
    // the Z-Wave devices among these, and those the configs' Z-Wave triggers name (a value updated's devices and
    // entities, a Z-Wave event's device)
    _zwDevIds(cfgs, more) {
      const out = new Set(more || []);
      const walk = (x) => {
        if (Array.isArray(x)) { x.forEach(walk); return; }
        if (!x || typeof x !== 'object') return;
        const p = x.trigger || x.platform;
        if (p === 'zwave_js.value_updated') { toList(x.device_id).forEach((d) => out.add(String(d))); toList(x.entity_id).forEach((e) => { const d = this._devOfEnt(String(e)); if (d) out.add(d); }); }
        if (p === 'device' && x.domain === 'zwave_js' && typeof x.device_id === 'string') out.add(x.device_id);
        if (p === 'event' && /^zwave_js_/.test(String(x.event_type)) && x.event_data && typeof x.event_data.device_id === 'string') out.add(x.event_data.device_id);
        Object.values(x).forEach(walk);
      };
      walk(cfgs);
      return [...out].filter((d) => { const dev = this._devMap.get(d); return dev && (dev.identifiers || []).some((i) => i[0] === 'zwave_js'); }).slice(0, 60);
    },
    _devOfEnt(e) { const x = this._entMap.get(e) || this._entMap.get(this._regIdMap.get(e)); return x ? x.device_id || null : null; },
    async _zwFor(ids) {
      if (this._storeMode !== 'shared' || !ids.length) return {};
      const got = await Promise.all(ids.map((id) => this._ha.quiet(this._store.asOfNow('zw:' + id, 6e4), 'each call it makes reports its own failure', null)));
      return Object.fromEntries(ids.map((id, i) => [id, got[i]]).filter(([, v]) => v && Array.isArray(v.values)));
    },
    // a Z-Wave device's values (functions_board/zwave_values), kept in the store as 'zw:<device>' for a minute
    _readZw(id) { return this._ws({ type: 'functions_board/zwave_values', device_id: id }, { optional: 'an integration before 0.13 has no such command', fallback: null }); },
    // the Z-Wave row's values: those the automations listen for first, then each device's others
    _sbxZwList() {
      const g = this._sbx, eng = g.eng, used = new Map(((g.ins && g.ins.zwave) || []).map((x) => [x.dev + '|' + x.id, x.name])), out = [];
      eng.zw.forEach((z, dev) => z.byId.forEach((v, id) => {
        const k = dev + '|' + id;
        if (!used.has(k) && (v.readable === false || v.cc === 112)) return;
        out.push({ k, dev, v, used: used.has(k), l: `${eng._zwName(dev, v)} · ${v.cc_name}` });
      }));
      return out.sort((a, b) => (b.used - a.used) || a.l.localeCompare(b.l));
    },
    // what the value picked can report: its states, true or false, or what it is now and its range; Other… for any
    _sbxZwVals() {
      const g = this._sbx, sel = this._$.drawer.querySelector('.sbzw');
      if (!g || !sel) return;
      const i = sel.value.indexOf('|'), z = g.eng.zw.get(sel.value.slice(0, i)), v = z && z.byId.get(sel.value.slice(i + 1));
      if (!v) return;
      const cur = g.eng.zwv.has(sel.value) ? g.eng.zwv.get(sel.value) : v.value, opts = [];
      const put = (raw, l) => { if (raw != null && !opts.some((o) => o.v === JSON.stringify(raw))) opts.push({ v: JSON.stringify(raw), l }); };
      (v.states || []).forEach(([raw, l]) => put(raw, sbxPyEq(raw, cur) ? T('sbx_state_now', { state: l }) : l));
      if (v.type === 'boolean') { put(true, 'true'); put(false, 'false'); }
      put(cur, T('sbx_state_now', { state: String(cur) }));
      [v.min, v.max].forEach((x) => put(x, String(x)));
      const first = opts.find((o) => o.v !== JSON.stringify(cur));
      if (first) first.pick = true;
      this._sbxOpts('sbzwv', opts, 'pick');
    },
    // a device trigger's choices, as the device's list names them (a scene button's KeyHeldDown), for its name
    _pressMore(t) {
      if (!t || typeof t.device_id !== 'string') return '';
      const h = this._store.get('dtrig:' + t.device_id), x = h && h.trigs.find((y) => sbxPressHits(Object.assign({ trigger: 'device' }, y.t), t));
      if (!x) return '';
      return x.fields.filter((f) => t[f.name] != null).map((f) => { const o = f.options.find((y) => String(y[0]) === String(t[f.name])); return o ? o[1] : String(t[f.name]); }).join(' · ');
    },
    // the choices of the trigger picked on the Press row, one dropdown each
    _sbxPressFields() {
      const d = this._$.drawer, sel = d.querySelector('.sbpress'), box = d.querySelector('.sbpressx'), g = this._sbx;
      if (!sel || !box || !g) return;
      const x = (g.devPress || []).find((y) => y.key === sel.value), fields = x ? x.fields : [];
      box.innerHTML = fields.map((f) => `<select class="sbpf" data-f="${esc(f.name)}" aria-label="${esc(T('sbx_press_field', { name: f.name }))}">${f.options.map(([v, l]) => `<option value="${esc(String(v))}">${esc(l)}</option>`).join('')}</select>`).join('');
      box.hidden = !fields.length;
    },
    // the event a phone fires for a button: the companion apps' mobile_app_notification_action, or the old iOS one if
    // that's what the function listens to
    _sbxNotifyEvent() {
      const txt = JSON.stringify(this._sbx.opts.items.map((x) => x.cfg));
      return txt.includes('ios.notification_action_fired') && !txt.includes('mobile_app_notification_action') ? ['ios.notification_action_fired', 'actionName'] : ['mobile_app_notification_action', 'action'];
    },
    // the entities a reference stands for: itself, a device's, an area's, floor's or label's (none for anything else)
    _refEnts(ref) {
      if (ref.startsWith('device:')) return this._ents.filter((e) => e.device_id === ref.slice(7)).map((e) => e.entity_id);
      if (/^(area|floor|label):/.test(ref)) return (this._tgt.get(ref) || {}).entities || [];
      return ref.includes(':') ? [] : [ref];
    },
    // ---- replay from history (0.11.2): the sandbox starts from the home's states at the start of a period and is
    // given the real changes of what the function reads, in order, with the clock; then what it changed only itself,
    // and when its automations ran, are put beside what really happened (sbxHistory, sbxCompare)
    _sbxPeriod(kind) {
      const now = Date.now(), H = 3600e3, tz = this._hass.config && this._hass.config.time_zone;
      if (kind === 'night') {
        let to = localAt(now, [8, 0], tz);
        if (to > now) to = localAt(now - 24 * H, [8, 0], tz);
        return { from: localAt(to - 12 * H, [18, 0], tz), to };
      }
      return { from: now - (kind === 'h6' ? 6 : kind === 'h12' ? 12 : 24) * H, to: now };
    },
    async _sbxHistory(kind) {
      const g = this._sbx;
      if (!g || g.busy || this._ver) return;
      const { from, to } = this._sbxPeriod(kind), known = (x) => this._known(x), reads = new Set(), writes = new Set();
      g.opts.items.forEach((it) => {
        if (!it.cfg) return;
        analyze(it.cfg, it.id.startsWith('script.'), known).refs.forEach((r) => {
          const set = r.role === 'trigger' || r.role === 'condition' ? reads : r.role === 'action' ? writes : null;
          if (set) this._refEnts(r.ref).forEach((x) => set.add(x));
        });
      });
      const have = (k) => !!this._hass.states[k] && !/^(automation|script)\./.test(k);
      const inputs = [...reads].filter(have).slice(0, 300), outputs = [...writes].filter((k) => have(k) && !reads.has(k)).slice(0, 300);
      const autos = g.opts.items.filter((x) => x.id.startsWith('automation.') && !x.outside).map((x) => x.id);
      const ask = (ids, attrs) => (ids.length ? this._ws({ type: 'history/history_during_period', start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString(), entity_ids: ids,
        include_start_time_state: true, significant_changes_only: false, minimal_response: false, no_attributes: !attrs }) : Promise.resolve({}));
      g.busy = true;
      this._renderSbx();
      let hist;
      try { const [a, b] = await Promise.all([ask(inputs.concat(autos), true), ask(outputs, false)]); hist = Object.assign({}, a, b); }
      catch (e) { g.busy = false; this._renderSbx(); this._toast(T('sbx_hist_none')); return; }
      g.busy = false;
      if (this._sbx !== g) return;
      const h = sbxHistory(hist, { inputs, outputs, autos, from, to });
      // from the home as it was then, the same automations (and outside ones, whole home), the real changes in order
      await this._sbxNew(g.label, { at: from, start: h.start, answers: [], items: g.opts.items.map((x) => x.id) }, g.extra);
      const g2 = this._sbx;
      if (!g2) return;
      this._renderSbxCtl();
      await this._sbxDo(async (e) => { for (const st of h.steps) { this._sbxRec(st); await sbxDoStep(e, st); } }, true);
      if (this._sbx !== g2) return;
      g2.hist = { kind, from, to, n: h.n, cut: h.cut, inputs: inputs.length, cmp: sbxCompare(h, g2.eng.log) };
      g2.tab = 'tl';
      this._renderSbxCtl();
      this._renderSbx();
    },
    // how the replay compares, over the timeline
    _sbxHistPane() {
      const g = this._sbx, H = g && g.hist;
      if (!H) return '';
      const t = (ms) => esc(this._sbxWhen(ms, true)), nm = (k) => esc(this._boxName(k));
      const diff = H.cmp.filter((x) => !x.same), same = H.cmp.filter((x) => x.same && (x.real.length || x.here.length));
      const row = (x) => {
        const f = x.first;
        if (x.kind === 'runs') return `<li class="bad">${T('sbx_hist_runs_diff', { name: nm(x.id), real: f.real ? t(f.real.t) : T('sbx_hist_never'), here: f.here ? t(f.here.t) : T('sbx_hist_never'), nr: x.real.length, nh: x.here.length })}</li>`;
        return `<li class="bad">${T('sbx_hist_state_diff', { name: nm(x.id), real: f.real ? esc(this._fmtState(x.id, f.real.s)) + ' ' + t(f.real.t) : T('sbx_hist_nothing'), here: f.here ? esc(this._fmtState(x.id, f.here.s)) + ' ' + t(f.here.t) : T('sbx_hist_nothing') })}</li>`;
      };
      return `<div class="sbhistp" role="status"><b>${P('sbx_hist_done', H.n, { from: t(H.from), to: t(H.to) })}</b>${H.cut ? ` <span class="warn">${T('sbx_hist_cut')}</span>` : ''}`
        + (H.cmp.length ? (diff.length ? `<ul>${diff.map(row).join('')}</ul>` : `<p>${T('sbx_hist_same')}</p>`) + (same.length ? `<p class="muted">${T('sbx_hist_same_list', { list: same.map((x) => nm(x.id)).join(', ') })}</p>` : '') : `<p class="muted">${T('sbx_hist_nothing_to')}</p>`)
        + '</div>';
    },
    async _sbxReset() {
      if (!this._sbx) return;
      const label = this._sbx.label;
      this._sbx.asks.forEach((a) => a.res(false));
      this._sbx.eng.stopAll();
      this._sbx.eng.resumeAll();
      this._sbx.speed = 0; this._sbx.exStop = true;
      this._clock.cancel('sbxplay');
      this._clearLit(true);
      await this._sbxNew(label, null, this._sbx.extra);
      this._renderSbxCtl();
      this._renderChecks();
      this._renderSbx();
      this._refreshStates();
    },
    // Home Assistant renders the template, pointed at the sandbox's states and clock (sbxRewrite)
    // the engine that asks (the open sandbox's, or a saved check's being replayed) is the one whose states are read.
    // opt.raw: the text as rendered, as Home Assistant's MQTT platforms take it (render_template would read "64.0" as
    // the number 64; marked at both ends it stays text)
    async _sbxTpl(t, vars, engine, opt) {
      const g = this._sbx, eng = engine || (g && g.eng);
      if (!eng) return { ok: false, err: 'closed' };
      if (this._asFn == null) this._asFn = await this._renderRaw('{%- macro m(returns) -%}{%- do returns(1) -%}{%- endmacro -%}{{ (m | as_function)() }}', {}).then((v) => String(v) === '1', () => false);
      if (!this._asFn) return { ok: false, err: T('sbx_needs_newer') };
      const rw = sbxRewrite(t), fb_s = {};
      const add = (id) => { const s = eng.get(id); if (s) fb_s[id] = { state: String(s.state), attributes: s.attributes || {}, last_changed: s.last_changed, last_updated: s.last_updated }; };
      eng.changed.forEach((v, id) => add(id));
      for (const x of String(t).matchAll(ENTITY_RE)) add(x[0]);
      let variables = {};
      try { variables = JSON.parse(JSON.stringify(vars || {})); } catch (e) { /* only what can be sent */ }
      Object.assign(variables, { fb_s, fb_t: new Date(eng.now).toISOString() });
      if (g && eng === g.eng) g.tplN++;
      const raw = !!(opt && opt.raw);
      try {
        const v = await this._renderRaw(SBX_PRELUDE + (raw ? SBX_RAW + rw.text + SBX_RAW : rw.text), variables);
        return { ok: true, value: raw ? String(v).slice(SBX_RAW.length, -SBX_RAW.length) : v, partly: rw.leftovers };
      } catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
    },
    // what the sandbox can't know, answered by you
    _sbxAsk(q) {
      const g = this._sbx;
      if (!g) return Promise.resolve(false);
      const key = q.run ? q.run.item.id || '' : '';
      const pre = g.pre.findIndex((a) => a.key === key && a.text === q.text);
      if (pre >= 0) { const v = g.pre.splice(pre, 1)[0].value; g.rec.answers.push({ key, text: q.text, value: v }); return Promise.resolve(v); }
      return new Promise((res) => {
        g.asks.push({ q, res: (v) => { g.asks = g.asks.filter((a) => a.q !== q); g.rec.answers.push({ key, text: q.text, value: v }); res(v); this._renderSbx(); } });
        this._renderSbx();
        if (q.key) this._centerOn(q.key);
      });
    },
    _sbxLogged() {
      this._clock.once('sbx', 120, () => {
        this._renderSbx(); this._refreshStates();
        // a notification sent with buttons of its own (0.11.3): they're there to press
        const g = this._sbx;
        if (g && g.btnSig !== undefined && this._sbxOn() && this._sbxButtons().map((x) => x.action).join('|') !== g.btnSig) this._renderSbxCtl();
      });
    },
    // the drawer's controls (0.11.1: everything a dropdown, with Other… to type anything else). Set: every entity or
    // attribute the automations read (triggers, waits, conditions), with the values that matter to them, then the
    // rest of the board's. A row for each other thing that starts one of them, when one does: a device's own
    // button, an event, MQTT, a webhook, a tag, a calendar, Assist, Home Assistant starting or stopping. Run, and the
    // clock: advance by, jump to a time, what's due next
    _renderSbxCtl() {
      const g = this._sbx, box = this._$.drawer.querySelector('.sbctl');
      if (!g || !box) return;
      const m = this._model, nm = (k) => this._boxName(k), byName = (a, b) => nm(a).localeCompare(nm(b));
      const ins = g.ins = g.eng.inputs();
      const read = [...new Set(ins.ents.map((x) => x.id))].filter((k) => g.eng.get(k)).sort(byName);
      const rest = [...m.nodes.keys()].filter((k) => !k.includes(':') && g.eng.get(k) && !read.includes(k)).sort(byName);
      const ents = read.concat(rest);
      const evs = [...m.nodes.keys()].filter((k) => k.startsWith('event:')).map((k) => k.slice(6));
      ['timer.finished', 'timer.cancelled'].forEach((x) => { if (!evs.includes(x) && ents.some((e) => e.startsWith('timer.'))) evs.push(x); });
      const runs = [...g.eng.items.keys()].sort(byName);
      const topics = new Set([...m.nodes.keys()].filter((k) => k.startsWith('mqtt:')).map((k) => k.slice(5)));
      g.eng.items.forEach((it) => { if (it.kind === 'automation') g.eng._trigs(it).forEach((t) => { if (g.eng._plat(t) === 'mqtt' && t.topic && !/[+#]/.test(t.topic)) topics.add(String(t.topic)); }); });
      const opt = (k) => `<option value="${esc(k)}">${esc(nm(k))}</option>`, o2 = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
      const row = (label, body) => `<div class="sbrow"><span class="sbl">${label}</span>${body}</div>`;
      // the rows in sections under a header each (0.13.1): what you change, the events you send, runs and replays, the
      // clock, and how the sandbox behaves; a header folds its section away, remembered as your own display setting
      const sec = { change: [], events: [], run: [], time: [], setup: [] };
      const sel = (cls, aria, opts) => `<select class="${cls}" aria-label="${esc(aria)}">${opts}</select>`;
      const entOpts = (read.length && rest.length ? `<optgroup label="${esc(T('sbx_g_read'))}">${read.map(opt).join('')}</optgroup><optgroup label="${esc(T('sbx_g_rest'))}">${rest.map(opt).join('')}</optgroup>` : ents.map(opt).join(''));
      sec.change.push(row(T('sbx_set'), sel('sbent', T('sbx_entity'), entOpts) + sel('sbattr', T('sbx_attr'), '') + this._sbxField('sbval', [], T('sbx_state')) + `<button class="chip" data-act="sbx-set">${T('sbx_set_b')}</button>`));
      // what the automations' triggers press, then (0.13.0) the devices' other triggers, each with its choices
      const used = ins.presses, more = (g.devPress || []).filter((x) => !used.some((u) => u.key === x.key)).map((x) => ({ key: x.key, label: g.eng._pressText(Object.assign({ trigger: 'device' }, x.t)) })).sort((a, b) => a.label.localeCompare(b.label));
      const pOpts = (l) => l.map((x) => o2(x.key, x.label)).join('');
      if (used.length || more.length) sec.change.push(row(T('sbx_press'), sel('sbpress', T('sbx_press_what'), used.length && more.length ? `<optgroup label="${esc(T('sbx_g_used'))}">${pOpts(used)}</optgroup><optgroup label="${esc(T('sbx_g_devtrig'))}">${pOpts(more)}</optgroup>` : pOpts(used.concat(more))) + '<span class="sbpressx" hidden></span>' + `<button class="chip" data-act="sbx-press">${T('sbx_press_b')}</button>`));
      // the values of its Z-Wave devices to report (0.13.0)
      const zwl = this._sbxZwList(), zopt = (l) => l.map((x) => o2(x.k, x.l)).join('');
      if (zwl.length) {
        const used = zwl.filter((x) => x.used), rest = zwl.filter((x) => !x.used);
        sec.change.push(row(T('sbx_zw'), sel('sbzw', T('sbx_zw_what'), used.length && rest.length ? `<optgroup label="${esc(T('sbx_g_zw_used'))}">${zopt(used)}</optgroup><optgroup label="${esc(T('sbx_g_rest'))}">${zopt(rest)}</optgroup>` : zopt(zwl)) + this._sbxField('sbzwv', [], T('sbx_zw_val')) + `<button class="chip" data-act="sbx-zw">${T('sbx_zw_b')}</button>`));
      }
      sec.events.push(row(T('sbx_event'), this._sbxField('sbev', evs.map((x) => ({ v: x, l: x })), T('sbx_event_type')) + this._sbxField('sbevd', [], T('sbx_event_data_ph')) + `<button class="chip" data-act="sbx-fire">${T('sbx_fire')}</button>`));
      const btns = this._sbxButtons();
      g.btnSig = btns.map((x) => x.action).join('|');
      if (btns.length) sec.events.push(row(T('sbx_nact'), sel('sbnact', T('sbx_nact_what'), btns.map((x) => o2(x.action, x.title === x.action ? x.title : T('sbx_nact_opt', { t: x.title, id: x.action }))).join('')) + `<button class="chip" data-act="sbx-nact" title="${esc(T('sbx_nact_t'))}">${T('sbx_nact_b')}</button>`));
      if (topics.size) sec.change.push(row('MQTT', this._sbxField('sbtop', [...topics].map((x) => ({ v: x, l: x })), T('sbx_topic')) + this._sbxField('sbpay', [], T('sbx_payload')) + `<button class="chip" data-act="sbx-mqtt">${T('sbx_send')}</button>`));
      if (ins.hooks.length) sec.events.push(row(T('sbx_webhook'), sel('sbhook', T('sbx_webhook'), ins.hooks.map((x) => o2(x.id, x.id)).join('')) + sel('sbhookm', T('sbx_method'), '') + this._sbxField('sbhookd', [{ v: '{}', l: T('sbx_body_empty') }], T('sbx_body_ph')) + `<button class="chip" data-act="sbx-hook">${T('sbx_call')}</button>`));
      if (ins.tags.length) sec.events.push(row(T('sbx_tag'), this._sbxField('sbtag', ins.tags.map((x) => ({ v: x, l: x })), T('sbx_tag_id')) + `<button class="chip" data-act="sbx-tag">${T('sbx_scan')}</button>`));
      if (ins.cals.length) sec.events.push(row(T('sbx_calendar'), sel('sbcal', T('sbx_calendar'), ins.cals.map((x) => opt(x.id)).join('')) + sel('sbcalev', T('sbx_cal_what'), o2('start', T('sbx_cal_start')) + o2('end', T('sbx_cal_end'))) + this._sbxField('sbcals', [{ v: T('sbx_cal_summary'), l: T('sbx_cal_summary') }], T('sbx_cal_title')) + `<button class="chip" data-act="sbx-cal">${T('sbx_go')}</button>`));
      if (ins.says.length) sec.events.push(row(T('sbx_say'), this._sbxField('sbsay', ins.says.map((x) => ({ v: x.v, l: T('sbx_say_as', { s: x.v, name: x.name }) })), T('sbx_sentence')) + `<button class="chip" data-act="sbx-say">${T('sbx_say_b')}</button>`));
      if (ins.ha.length) sec.events.push(row(T('sbx_ha'), sel('sbha', T('sbx_ha'), ins.ha.map((x) => o2(x, x === 'shutdown' ? T('sbx_ha_stops') : T('sbx_ha_starts'))).join('')) + `<button class="chip" data-act="sbx-ha">${T('sbx_go')}</button>`));
      sec.run.push(row(T('sbx_run'), sel('sbrun', T('sbx_run_what'), runs.map(opt).join('')) + `<select class="sbtrig" aria-label="${T('sbx_as_if')}"></select>` + `<span class="sbvarsw" hidden>${this._sbxField('sbvars', [], T('sbx_vars_ph'))}</span>` + `<label class="sbcb"><input type="checkbox" class="sbconds" checked>${T('sbx_check_conds')}</label>` + `<button class="chip" data-act="sbx-run">${T('sbx_run_b')}</button>`));
      // what if: a few things at once (0.11.2)
      const presets = this._sbxPresets();
      sec.run.push(row(T('sbx_whatif'), sel('sbwhat', T('sbx_whatif'), presets.map((x) => o2(x.k, x.l)).join('')) + `<button class="chip" data-act="sbx-whatif">${T('sbx_go')}</button>`));
      // how a device answers what the automations ask of it (0.11.2)
      const outs = this._sbxOutputs();
      if (outs.length) sec.setup.push(row(T('sbx_device'), sel('sbdev', T('sbx_device_what'), outs.map(opt).join('')) + sel('sbhow', T('sbx_how'), o2('ok', T('sbx_how_ok')) + o2('slow', T('sbx_how_slow')) + o2('fails', T('sbx_how_fails')) + o2('unavailable', T('sbx_how_unav'))) + this._sbxField('sbms', [[5e3, '5 s'], [15e3, '15 s'], [3e4, '30 s'], [6e4, '1 min'], [3e5, '5 min']].map(([v, l]) => ({ v: String(v), l: T('sbx_after_t', { t: l }), pick: v === 15e3 })), T('sbx_ms_ph'), T('sbx_after_a')) + `<button class="chip" data-act="sbx-behave">${T('sbx_apply')}</button>`));
      // step-through: pause before every condition and action (breakpoints: Pause here on a box)
      sec.run.push(row(T('sbx_replay'), sel('sbhist', T('sbx_replay_when'), [['night', T('sbx_hist_night')], ['h6', T('sbx_hist_h6')], ['h12', T('sbx_hist_h12')], ['h24', T('sbx_hist_h24')]].map(([v, l]) => o2(v, l)).join('')) + `<button class="chip" data-act="sbx-history" title="${esc(T('sbx_replay_t'))}">${T('sbx_replay_b')}</button>`));
      sec.setup.push(row(T('sbx_home'), `<label class="sbcb" title="${esc(T('sbx_whole_t'))}"><input type="checkbox" class="sbwhole"${this._data.ui.sbxWhole ? ' checked' : ''}>${T('sbx_whole')}</label>${g.outside.size ? `<span class="muted">${esc(P('sbx_whole_k', g.outside.size))}</span>` : ''}`));
      sec.setup.push(row(T('sbx_debug'), `<label class="sbcb"><input type="checkbox" class="sbstep"${g.eng.stepping ? ' checked' : ''}>${T('sbx_step_through')}</label><span class="sbbrk muted">${g.eng.breaks.size ? P('sbx_breaks_n', g.eng.breaks.size) : T('sbx_breaks_how')}</span>`));
      const steps = [[1e3, '1 s'], [1e4, '10 s'], [6e4, '1 min'], [3e5, '5 min'], [6e5, '10 min'], [18e5, '30 min'], [36e5, '1 h'], [108e5, '3 h'], [216e5, '6 h'], [432e5, '12 h'], [864e5, T('sbx_1day')], [6048e5, T('sbx_1week')]];
      sec.time.push(row(T('sbx_clock'), this._sbxField('sbadv', steps.map(([v, l]) => ({ v: String(v), l: '+' + l, pick: v === 6e4 })), T('sbx_adv_ph'), T('sbx_adv_by')) + `<button class="chip" data-act="sbx-advby">${T('sbx_advance')}</button>` + `<button class="chip sbnext" data-act="sbx-next"></button>` + sel('sbspeed', T('sbx_speed'), [[0, T('sbx_speed_0')], [1, '1×'], [10, '10×'], [60, '60×'], [600, '600×']].map(([v, l]) => o2(String(v), l)).join(''))));
      sec.time.push(row(T('sbx_jump'), this._sbxField('sbjump', [], T('sbx_jump_ph'), T('sbx_jump')) + `<button class="chip" data-act="sbx-jump">${T('sbx_go')}</button>`));
      const shut = new Set(this._data.ui.sbxShut || []);
      const heads = { change: T('sbx_sec_change'), events: T('sbx_sec_events'), run: T('sbx_sec_run'), time: T('sbx_sec_time'), setup: T('sbx_sec_setup') };
      this._put(box, Object.keys(sec).filter((k) => sec[k].length).map((k) => `<section class="sbsec" data-key="sec-${k}" aria-labelledby="sbsech-${k}">`
        + `<h3 class="sbsech"><button id="sbsech-${k}" data-act="sbx-sec" data-k="${k}" aria-expanded="${shut.has(k) ? 'false' : 'true'}" aria-controls="sbsecb-${k}"><ha-icon icon="mdi:chevron-down"></ha-icon>${heads[k]}</button></h3>`
        + `<div class="sbsecb" id="sbsecb-${k}"${shut.has(k) ? ' hidden' : ''}>${sec[k].join('')}</div></section>`).join(''));
      const spd = box.querySelector('.sbspeed');
      if (spd) spd.value = String(g.speed || 0);
      const pick = this._sel && ents.includes(this._sel) ? this._sel : ents[0];
      if (pick) this._sbxPick(pick);
      this._sbxTrigs();
      this._sbxPressFields();
      this._sbxZwVals();
      this._sbxEvData();
      this._sbxPayloads();
      this._sbxHookM();
      this._sbxJumps();
    },
    // what if (0.11.2): a few things at once, as steps you could have done one by one
    _sbxPresets() {
      const g = this._sbx, ins = g.ins || { ents: [] }, read = [...new Set(ins.ents.map((x) => x.id))].filter((k) => g.eng.get(k));
      const people = read.filter((k) => /^(person|device_tracker)\./.test(k)), out = [];
      if (people.length) { out.push({ k: 'leave', l: T('sbx_w_leave') }); out.push({ k: 'home', l: T('sbx_w_home') }); }
      if (g.cut) out.push({ k: 'back', l: T('sbx_w_back') }); else if (read.length) out.push({ k: 'cut', l: T('sbx_w_cut') });
      out.push({ k: 'restart', l: T('sbx_w_restart') });
      if (g.eng.get('sun.sun')) { out.push({ k: 'sunset', l: T('sbx_w_sunset') }); out.push({ k: 'sunrise', l: T('sbx_w_sunrise') }); }
      out.push({ k: 'night', l: T('sbx_w_night') }, { k: 'morning', l: T('sbx_w_morning') }, { k: 'day', l: T('sbx_w_day') }, { k: 'week', l: T('sbx_w_week') });
      return out;
    },
    async _sbxWhatIf(k) {
      const g = this._sbx, eng = g.eng, ins = g.ins || { ents: [] }, read = [...new Set(ins.ents.map((x) => x.id))].filter((x) => eng.get(x));
      const skip = /^(sun|zone|automation|script|person|device_tracker|input_[a-z]+|counter|timer|schedule)\./;
      const steps = [];
      const to = (at) => { if (at != null && at > eng.now) steps.push({ op: 'advance', ms: at - eng.now }); };
      if (k === 'leave') read.filter((x) => /^(person|device_tracker)\./.test(x)).forEach((id) => steps.push({ op: 'set', id, state: 'not_home' }));
      if (k === 'home') read.filter((x) => /^(person|device_tracker)\./.test(x)).forEach((id) => steps.push({ op: 'set', id, state: 'home' }));
      if (k === 'cut') { g.cut = new Map(); read.filter((x) => !skip.test(x)).forEach((id) => { g.cut.set(id, eng.get(id).state); steps.push({ op: 'set', id, state: 'unavailable' }); }); }
      if (k === 'back' && g.cut) { g.cut.forEach((st, id) => steps.push({ op: 'set', id, state: st })); g.cut = null; }
      if (k === 'restart') steps.push({ op: 'ha', event: 'shutdown' }, { op: 'ha', event: 'start' });
      if (k === 'sunset' || k === 'sunrise') to(eng._sunAt(k, eng.now));
      if (k === 'night') to(eng._timeAt('23:00:00', eng.now));
      if (k === 'morning') to(eng._timeAt('07:00:00', eng.now));
      if (k === 'day') steps.push({ op: 'advance', ms: 864e5 });
      if (k === 'week') steps.push({ op: 'advance', ms: 6048e5 });
      if (!steps.length) { this._toast(T('sbx_w_nothing')); return; }
      await this._sbxDo(async (e) => { for (const st of steps) { this._sbxRec(st); await sbxDoStep(e, st); } });
      this._renderSbxCtl();
    },
    // what the automations change (the entities their calls reach), for how a device answers
    _sbxOutputs() {
      const m = this._model, g = this._sbx, out = new Set();
      m.edges.forEach((e) => {
        if (e.role !== 'action') return;
        if (e.to.startsWith('device:') || /^(area|floor|label):/.test(e.to)) { const t = e.to.startsWith('device:') ? this._ents.filter((x) => x.device_id === e.to.slice(7)).map((x) => x.entity_id) : ((this._tgt.get(e.to) || {}).entities || []); t.forEach((x) => out.add(x)); }
        else if (!e.to.includes(':')) out.add(e.to);
      });
      return [...out].filter((k) => g.eng.get(k) && !/^(automation|script|notify|tts|scene|timer|counter|schedule|input_[a-z]+)\./.test(k)).sort((a, b) => this._boxName(a).localeCompare(this._boxName(b)));
    },
    // the attributes the automations read of the entity picked, as a choice beside its state
    _sbxAttrs(k) {
      const g = this._sbx, sel = this._$.drawer.querySelector('.sbattr');
      if (!g || !sel) return;
      const attrs = [...new Set(((g.ins && g.ins.ents) || []).filter((x) => x.id === k && x.attr).map((x) => x.attr))];
      // the rest of its attributes too, for whoever wants them (0.11.2)
      const st = g.eng.get(k), rest = Object.keys((st && st.attributes) || {}).filter((a) => !attrs.includes(a) && !['friendly_name', 'icon', 'entity_picture', 'supported_features', 'attribution'].includes(a)).sort();
      const o = (a) => `<option value="${esc(a)}">${esc(a)}</option>`;
      sel.innerHTML = `<option value="">${esc(T('sbx_state'))}</option>` + (attrs.length && rest.length ? `<optgroup label="${esc(T('sbx_g_read'))}">${attrs.map(o).join('')}</optgroup><optgroup label="${esc(T('sbx_g_attrs'))}">${rest.map(o).join('')}</optgroup>` : attrs.concat(rest).map(o).join(''));
      sel.hidden = !attrs.length && !rest.length;
    },
    // the values for the entity (or attribute) picked: the ones that matter to an automation first, with why, then
    // its usual states, then unavailable and unknown
    _sbxValOpts(k, attr) {
      const g = this._sbx, n = this._model.nodes.get(k), s = g.eng.get(k);
      const now = s ? (attr ? (s.attributes || {})[attr] : s.state) : null, nowS = now == null ? null : typeof now === 'object' ? JSON.stringify(now) : String(now);
      const out = [], seen = new Set(), put = (v, l, pick) => { if (seen.has(v)) return; seen.add(v); out.push({ v, l, pick }); };
      ((g.ins && g.ins.ents) || []).filter((x) => x.id === k && (x.attr || '') === (attr || '')).forEach((x) => x.vals.forEach((y) => {
        if (y.v.startsWith(SBX_PRESS)) put(y.v, y.why, true);
        else put(y.v, y.why ? T('sbx_v_l', { v: y.v === nowS ? T('sbx_state_now', { state: y.v }) : y.v, why: y.why }) : y.v, y.v !== nowS);
      }));
      const dom = k.split('.')[0];
      if (!attr) {
        if (['button', 'input_button', 'scene'].includes(dom)) put(SBX_PRESS, T('sbx_press_now'), true);
        if (dom === 'event') toList(s && s.attributes && s.attributes.event_types).forEach((ty) => put(SBX_PRESS + ty, T('sbx_press_type', { type: ty }), true));
        (n ? this._stateHints(n) : []).forEach((x) => put(x, x === nowS ? T('sbx_state_now', { state: x }) : x, x !== nowS));
      }
      if (nowS != null) put(nowS, T('sbx_state_now', { state: nowS }), false);
      if (!attr) ['unavailable', 'unknown'].forEach((x) => put(x, x, false));
      // the first value that changes something is picked, so Set does something
      const first = out.find((o) => o.pick);
      out.forEach((o) => { o.pick = o === first; });
      return { opts: out, now: nowS };
    },
    _sbxPick(k, soft) {
      const d = this._$.drawer, sel = d.querySelector('.sbent'), val = d.querySelector('input.sbval');
      if (!sel || !this._sbx) return;
      if (soft && sel.value !== k) return;
      sel.value = k;
      if (!soft) this._sbxAttrs(k);
      this._sbxVals(soft);
    },
    _sbxVals(soft) {
      const d = this._$.drawer, sel = d.querySelector('.sbent'), at = d.querySelector('.sbattr'), val = d.querySelector('input.sbval');
      if (!sel || !this._sbx) return;
      const { opts, now } = this._sbxValOpts(sel.value, at && !at.hidden ? at.value : '');
      this._sbxOpts('sbval', opts, soft ? true : 'pick');
      if (val) { if (!soft) val.value = ''; val.placeholder = now != null ? T('sbx_now_is', { state: now }) : T('sbx_state'); }
    },
    // a webhook's methods, as its trigger allows them
    _sbxHookM() {
      const d = this._$.drawer, h = d.querySelector('.sbhook'), m = d.querySelector('.sbhookm'), g = this._sbx;
      if (!h || !m || !g) return;
      const x = (g.ins.hooks || []).find((y) => y.id === h.value);
      m.innerHTML = (x ? x.methods : ['POST']).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    },
    // the times worth jumping to: what's due, sunrise and sunset, the function's time triggers and the edges of its
    // time conditions, and midnight; each with how far off it is
    _sbxJumps() {
      const g = this._sbx;
      if (!g || !this._$.drawer.querySelector('.sbjump-sel')) return;
      const eng = g.eng, out = new Map(), put = (at, l) => { if (at != null && at > eng.now && !out.has(at)) out.set(at, l); };
      eng.pending().forEach((x) => put(x.at, x.label));
      put(eng._sunAt('sunrise', eng.now), T('sbx_sunrise'));
      put(eng._sunAt('sunset', eng.now), T('sbx_sunset'));
      eng.items.forEach((it) => eng._walk(it, (t) => { if (eng._plat(t) === 'time') toList(t.at).forEach((a) => put(eng._timeAt(a, eng.now), T('sbx_time_label', { name: this._boxName(it.id) }))); }, (c) => {
        if (c.condition !== 'time') return;
        [['after', c.after], ['before', c.before]].forEach(([w, v]) => { if (v != null && !EXACT_RE.test(String(v))) put(eng._timeAt(v, eng.now), T('sbx_time_edge', { name: this._boxName(it.id), w: w === 'after' ? T('sbx_after') : T('sbx_before'), t: String(v) })); });
      }));
      put(localAt(eng.now + 86400000, [0, 0, 0], eng.tz), T('sbx_midnight'));
      const opts = [...out].sort((a, b) => a[0] - b[0]).slice(0, 30).map(([at, l]) => ({ v: String(at), l: T('sbx_jump_l', { t: this._sbxWhen(at), what: l, d: fmtDurLong(at - eng.now) }) }));
      const sel = this._$.drawer.querySelector('.sbjump-sel'), inp = this._$.drawer.querySelector('input.sbjump');
      this._sbxOpts('sbjump', opts, sel.value !== SBX_OTHER || (inp && inp.value) ? true : 'pick');
    },
    // a time on the sandbox clock: Fri 20 Nov, 22:00:53 (the day only when it isn't today)
    _sbxWhen(ms, full) {
      const eng = this._sbx && this._sbx.eng, tz = eng ? eng.tz : undefined, p = tzParts(ms, tz), q = eng ? tzParts(eng.now, tz) : p;
      const hms = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}:${String(p.s).padStart(2, '0')}`;
      if (!full && p.y === q.y && p.mo === q.mo && p.d === q.d) return hms;
      let day = `${WD[p.wd]} ${p.d}/${p.mo}`;
      try { day = new Intl.DateTimeFormat(this._hass.language || undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz || undefined }).format(new Date(ms)); } catch (e) { /* the plain one */ }
      return `${day}, ${hms}`;
    },
    // a time typed under Jump to: 21:30 (the next one), 2026-11-21 07:00, or +90 min / +2 h / +1 d
    _sbxParseWhen(txt) {
      const eng = this._sbx.eng, s = String(txt || '').trim();
      let m = /^\+\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day|days|w|week)?$/i.exec(s);
      if (m) { const u = (m[2] || 'min').toLowerCase()[0]; return eng.now + parseFloat(m[1]) * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[u]); }
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
      if (m) { const base = Date.UTC(+m[1], +m[2] - 1, +m[3], 12); return localAt(base, [+m[4], +m[5], +(m[6] || 0)], eng.tz); }
      const hms = parseHMS(s);
      return hms ? eng._timeAt(s, eng.now) : null;
    },
    // a dropdown of what fits, ending with Other… which opens a box to type anything else
    _sbxField(cls, opts, ph, aria) {
      const pick = opts.find((o) => o.pick), sel = (o) => (o === pick ? ' selected' : '');
      return `<span class="sbf"><select class="sbsel ${cls}-sel" data-f="${cls}" aria-label="${esc(aria || ph)}">${opts.map((o) => `<option value="${esc(o.v)}"${sel(o)}>${esc(o.l)}</option>`).join('')}<option value="${SBX_OTHER}">${T('sbx_other')}</option></select><input class="${cls}" placeholder="${esc(ph)}" aria-label="${esc(aria || ph)}"${opts.length ? ' hidden' : ''}></span>`;
    },
    _sbxOpts(cls, opts, keep) {
      const sel = this._$.drawer.querySelector(`.${cls}-sel`);
      if (!sel) return;
      const was = sel.value;
      sel.innerHTML = opts.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('') + `<option value="${SBX_OTHER}">${T('sbx_other')}</option>`;
      // keep: what was picked stays (a refresh); otherwise the suggested one, else the first
      if (keep === true && [...sel.options].some((o) => o.value === was)) sel.value = was;
      else if (opts.length) sel.value = (opts.find((o) => o.pick) || opts[0]).v;
      this._sbxOther(sel);
    },
    // Other… shows the typing box (and focuses it); anything picked from the list hides it
    _sbxOther(sel, focus) {
      const inp = sel.parentNode.querySelector('input');
      if (!inp) return;
      const other = sel.value === SBX_OTHER;
      inp.hidden = !other;
      if (other && focus) inp.focus();
    },
    _sbxVal(cls) {
      const d = this._$.drawer, sel = d.querySelector(`.${cls}-sel`), inp = d.querySelector(`input.${cls}`);
      return sel && sel.value !== SBX_OTHER ? sel.value : inp ? inp.value.trim() : '';
    },
    // the data an event can carry: what the function's own event triggers for that type look for
    _sbxEvData() {
      const g = this._sbx;
      if (!g) return;
      const type = this._sbxVal('sbev'), out = [], seen = new Set();
      g.eng.items.forEach((it) => {
        if (it.kind !== 'automation') return;
        g.eng._trigs(it).forEach((t) => {
          if (g.eng._plat(t) !== 'event' || !toList(t.event_type).includes(type) || !t.event_data || typeof t.event_data !== 'object') return;
          const v = JSON.stringify(t.event_data);
          if (seen.has(v)) return;
          seen.add(v);
          out.push({ v, l: T('sbx_data_as', { name: this._boxName(it.id), data: shorten(Object.entries(t.event_data).map(([a, b]) => `${a}: ${typeof b === 'object' ? JSON.stringify(b) : b}`).join(', '), 60) }), pick: true });
        });
      });
      out.push({ v: '', l: T('sbx_data_none') });
      this._sbxOpts('sbevd', out, 'pick');
    },
    // the payloads the function's MQTT triggers on that topic wait for
    _sbxPayloads() {
      const g = this._sbx;
      if (!g || !this._$.drawer.querySelector('.sbpay-sel')) return;
      const topic = this._sbxVal('sbtop'), out = [], seen = new Set();
      g.eng.items.forEach((it) => {
        if (it.kind !== 'automation') return;
        g.eng._trigs(it).forEach((t) => {
          if (g.eng._plat(t) !== 'mqtt' || t.payload == null || !(t.topic === topic || sbxTopic(String(t.topic || ''), topic))) return;
          const v = sbxPayloadFor(t);
          if (seen.has(v)) return;
          seen.add(v);
          out.push({ v, l: T('sbx_payload_as', { name: this._boxName(it.id), payload: shorten(v, 50) }), pick: true });
        });
      });
      // what well-known integrations send on their topics (Frigate's events, counts and motion)
      sbxKnownPayloads(topic).forEach((x) => { if (!seen.has(x.v)) { seen.add(x.v); out.push({ v: x.v, l: T('sbx_payload_known', { what: x.what }) }); } });
      out.push({ v: '', l: T('sbx_payload_none') });
      this._sbxOpts('sbpay', out, 'pick');
    },
    // the triggers of the automation picked under Run: run it as if one of them fired
    _sbxTrigs() {
      const d = this._$.drawer, run = d.querySelector('.sbrun'), sel = d.querySelector('.sbtrig'), g = this._sbx;
      if (!run || !sel || !g) return;
      const it = g.eng.items.get(run.value), ts = it && it.kind === 'automation' ? g.eng._trigs(it) : [];
      const what = (t) => {
        const p = g.eng._plat(t), spec = g.eng._espec(p);
        const ents = p === 'state' || p === 'numeric_state' ? toList(t.entity_id) : spec ? g.eng._etargets(t, spec) : [];
        const x = ents.length ? ents.map((e) => this._boxName(e)).join(', ') : p === 'event' ? toList(t.event_type).join(', ') : p === 'mqtt' ? t.topic : p === 'time' ? toList(t.at).join(', ') : '';
        return `${p}${x ? ': ' + x : ''}${t.id != null ? ` (id ${t.id})` : ''}`;
      };
      sel.innerHTML = ts.map((t, i) => `<option value="${i}">${esc(T('sbx_as_trigger', { n: i + 1, what: shorten(what(t), 50) }))}</option>`).join('') + `<option value="">${esc(T('sbx_no_trigger'))}</option>`;
      sel.hidden = !ts.length;
      // a script's fields: its defaults or examples to start from, none, or your own
      const vw = d.querySelector('.sbvarsw'), fields = it && it.kind === 'script' && it.cfg.fields && typeof it.cfg.fields === 'object' ? it.cfg.fields : null;
      if (vw) vw.hidden = !fields;
      if (fields) {
        const ex = {};
        Object.entries(fields).forEach(([k, f]) => { const v = f && (f.default !== undefined ? f.default : f.example); if (v !== undefined) ex[k] = v; });
        const opts = Object.keys(ex).length ? [{ v: JSON.stringify(ex), l: T('sbx_vars_ex', { v: shorten(Object.entries(ex).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', '), 60) }), pick: true }] : [];
        opts.push({ v: '', l: T('sbx_vars_none') });
        this._sbxOpts('sbvars', opts, 'pick');
      }
    },
    // the sandbox drawer's own fields
    _sbxChange(t) {
      if (!t.classList) return false;
      if (t.classList.contains('sbent')) { this._sbxPick(t.value); return true; }
      if (t.classList.contains('sbattr')) { this._sbxVals(); return true; }
      if (t.classList.contains('sbrun')) { this._sbxTrigs(); return true; }
      if (t.classList.contains('sbhook')) { this._sbxHookM(); return true; }
      if (t.classList.contains('sbpress')) { this._sbxPressFields(); return true; }
      if (t.classList.contains('sbzw')) { this._sbxZwVals(); return true; }
      if (t.classList.contains('sbwhole')) { if (t.checked) this._data.ui.sbxWhole = true; else delete this._data.ui.sbxWhole; this._save(); this._ha.soft(this._sbxReset(), 'starting the sandbox again (whole home)', null); return true; }
      if (t.classList.contains('sbstep')) { this._sbx.eng.stepping = t.checked; if (!t.checked) { this._sbx.eng.resumeAll(); this._sbxAfterResume(); } return true; }
      if (t.classList.contains('sbspeed')) { this._sbxSpeed(+t.value); return true; }
      if (t.classList.contains('sbstf')) { this._sbx.stf = t.value; this._sbxStates(); return true; }
      if (t.classList.contains('sbcovmine')) { this._sbx.covMine = t.checked; this._renderSbx(); return true; }
      if (t.classList.contains('sbsel')) {
        this._sbxOther(t, true);
        if (t.dataset.f === 'sbev') this._sbxEvData();
        if (t.dataset.f === 'sbtop') this._sbxPayloads();
        // an example sentence with a {slot} in it: to be filled in, in the box
        if (t.dataset.f === 'sbsay' && /\{/.test(t.value)) { const inp = t.parentNode.querySelector('input'); const v = t.value; t.value = SBX_OTHER; this._sbxOther(t, true); if (inp) inp.value = v; }
        return true;
      }
      return false;
    },
    async _sbxDo(fn, keepHist) {
      const g = this._sbx;
      if (!g || g.busy) return;
      if (!keepHist) g.hist = null;
      g.busy = true;
      this._renderSbx();
      const from = g.eng.seq, step0 = g.rec.steps.length;
      try { await fn(g.eng); } finally { g.busy = false; }
      if (this._sbx !== g) return;
      // everything one thing you did set off is one flow, played on the board step by step; it knows which of your
      // steps it was (for going back to before it) and says in a sentence what came of it (0.11.2)
      const act = { a: from + 1, b: g.eng.seq, step0 };
      // a clock move added to the one before it: going back to before this is going back to before that one
      if (g.rec.steps.length === step0 && step0 > 0 && g.lastAdv === g.rec.steps[step0 - 1]) act.step0 = step0 - 1;
      act.sum = this._sbxSum(act);
      if (act.b >= act.a) (g.acts = g.acts || []).push(act);
      this._renderSbx();
      this._refreshStates();
      if (act.b >= act.a) this._sbxLight(act.a, true);
    },
    // the box bar's sandbox buttons fill in the drawer's controls; the rest are the drawer's own
    _sbxBox(act, el) {
      const d = this._$.drawer, k = this._sel;
      if (act === 'sbx-setbox' && k) { this._sbxPick(k); const v = d.querySelector('.sbval-sel'); if (v) v.focus(); return; }
      if (act === 'sbx-runbox' && k) { const r = d.querySelector('.sbrun'); if (r) r.value = k; this._sbxAction('sbx-run', el); return; }
      if (act === 'sbx-break' && k) { const br = this._sbx.eng.breaks; if (br.has(k)) br.delete(k); else br.add(k); this._renderNodebar(); this._renderSbxCtl(); this._toast(br.has(k) ? T('sbx_break_set', { name: this._boxName(k) }) : T('sbx_break_gone', { name: this._boxName(k) })); return; }
      if (act === 'sbx-setv') {
        const id = el.dataset.k, v = el.dataset.v;
        this._sbxPick(id);
        const step = v.startsWith(SBX_PRESS) ? { op: 'set', id, state: this._sbx.eng.iso(), attrs: v.length > SBX_PRESS.length ? { event_type: v.slice(SBX_PRESS.length) } : undefined, press: true } : { op: 'set', id, state: v };
        this._sbxStep(step).then(() => this._renderNodebar());
        return;
      }
      if (act === 'sbx-firebox' && k) {
        const sel = d.querySelector('.sbev-sel'), inp = d.querySelector('input.sbev'), type = k.slice(6);
        if (sel) { if ([...sel.options].some((o) => o.value === type)) sel.value = type; else { sel.value = SBX_OTHER; if (inp) inp.value = type; } this._sbxOther(sel); this._sbxEvData(); const n = d.querySelector('.sbevd-sel'); if (n) n.focus(); }
        return;
      }
      this._sbxAction(act, el);
    },
    // the clock at speed (0.11.2): every real second it moves on speed seconds, as if you'd advanced it
    _sbxSpeed(x) {
      const g = this._sbx;
      if (!g) return;
      g.speed = x;
      this._clock.cancel('sbxplay');
      if (!x) return;
      this._clock.every('sbxplay', 1000, () => {
        if (this._sbx !== g || !g.speed) { this._clock.cancel('sbxplay'); return; }
        if (g.busy || g.eng.paused.size || g.asks.length) return;
        this._sbxStep({ op: 'advance', ms: 1000 * g.speed });
      });
    },
    // a paused run let go: what it does next shows, and if it pauses again, that does
    async _sbxAfterResume() {
      const g = this._sbx;
      if (!g) return;
      const from = g.eng.seq;
      await g.eng.settle();
      if (this._sbx !== g) return;
      if (g.eng.seq >= from + 1) { const act = { a: from + 1, b: g.eng.seq, step0: g.rec.steps.length }; act.sum = this._sbxSum(act); (g.acts = g.acts || []).push(act); }
      this._renderSbx();
      this._refreshStates();
    },
    // one thing you do, recorded for a check and done on the sandbox
    _sbxStep(step) { return this._sbxDo((e) => { this._sbxRec(step); return sbxDoStep(e, step); }); },
    _sbxAction(act, el) {
      const d = this._$.drawer, q = (s) => d.querySelector(s);
      switch (act) {
        case 'sbx-set': {
          const id = q('.sbent').value, v = this._sbxVal('sbval'), at = q('.sbattr'), attr = at && !at.hidden ? at.value : '';
          if (!id || !v) { this._toast(T('sbx_pick_state')); return; }
          if (q('input.sbval')) q('input.sbval').value = '';
          // a press: its state becomes the time (an event entity's with its event type); an attribute: as a number,
          // true or false when it reads as one
          const asVal = (x) => (/^-?\d+(\.\d+)?$/.test(x) ? parseFloat(x) : x === 'true' ? true : x === 'false' ? false : x === 'null' ? null : x);
          const step = v.startsWith(SBX_PRESS) ? { op: 'set', id, state: this._sbx.eng.iso(), attrs: v.length > SBX_PRESS.length ? { event_type: v.slice(SBX_PRESS.length) } : undefined, press: true }
            : attr ? { op: 'set', id, state: null, attrs: { [attr]: asVal(v) } } : { op: 'set', id, state: v };
          this._sbxDo((e) => { this._sbxRec(step); return sbxDoStep(e, step); }).then(() => this._sbxPick(id, true));
          break;
        }
        case 'sbx-press': {
          let key = q('.sbpress').value;
          if (!key) break;
          // with the choices picked (0.13.0): the press is the trigger with them set
          const fs = [...d.querySelectorAll('.sbpressx:not([hidden]) .sbpf')];
          if (fs.length) { const o = JSON.parse(key); fs.forEach((f) => { o[f.dataset.f] = sbxNum(f.value); }); key = sbxPressKey(o); }
          this._sbxStep({ op: 'press', key });
          break;
        }
        case 'sbx-ha': this._sbxStep({ op: 'ha', event: q('.sbha').value }); break;
        case 'sbx-zw': {
          const k = q('.sbzw').value, i = k.indexOf('|'), raw = this._sbxVal('sbzwv');
          if (!k || raw === '') { this._toast(T('sbx_pick_state')); return; }
          // what's picked is JSON (a number, true, text); what's typed is read as Home Assistant reads a value
          let value;
          try { value = JSON.parse(raw); } catch (e) { value = sbxZwCoerce(raw); }
          this._sbxStep({ op: 'zwave', dev: k.slice(0, i), id: k.slice(i + 1), value }).then(() => this._sbxZwVals());
          break;
        }
        case 'sbx-hook': {
          const raw = this._sbxVal('sbhookd');
          let data = {};
          if (raw) { try { data = JSON.parse(raw); } catch (e) { const p = parseLoose(raw); if (p && typeof p === 'object') data = p; else { this._toast(T('sbx_bad_data')); return; } } }
          this._sbxStep({ op: 'webhook', id: q('.sbhook').value, method: q('.sbhookm').value, data });
          break;
        }
        case 'sbx-tag': { const tag = this._sbxVal('sbtag'); if (!tag) { this._toast(T('sbx_pick_tag')); return; } this._sbxStep({ op: 'tag', tag }); break; }
        case 'sbx-cal': this._sbxStep({ op: 'calendar', id: q('.sbcal').value, event: q('.sbcalev').value, summary: this._sbxVal('sbcals') || T('sbx_cal_summary') }); break;
        case 'sbx-say': { const text = this._sbxVal('sbsay'); if (!text || /\{/.test(text)) { this._toast(T('sbx_fill_slots')); return; } this._sbxStep({ op: 'say', text }); break; }
        case 'sbx-tab': { this._sbx.tab = el.dataset.tab; this._renderSbx(); break; }
        case 'sbx-stepone': { this._sbx.eng.resume(+el.dataset.id); this._sbxAfterResume(); break; }
        case 'sbx-continue': { const e = this._sbx.eng; e.stepping = false; e.resumeAll(); const cb = q('.sbstep'); if (cb) cb.checked = false; this._sbxAfterResume(); break; }
        case 'sbx-again': {
          const st = this._sbx.rec.steps[+el.dataset.i];
          if (!st) break;
          // a press again is a new press: its time is now on the sandbox clock
          this._sbxStep(Object.assign({}, st, st.op === 'set' && st.press ? { state: this._sbx.eng.iso() } : {}));
          break;
        }
        case 'sbx-undo': this._sbxRewind(this._sbx.acts && this._sbx.acts.length ? this._sbx.acts[this._sbx.acts.length - 1].step0 : this._sbx.rec.steps.length - 1); break;
        case 'sbx-whatif': this._sbxWhatIf(q('.sbwhat').value); break;
        case 'sbx-behave': {
          const id = q('.sbdev').value, how = q('.sbhow').value, raw = this._sbxVal('sbms'), ms = /^\d+$/.test(raw) ? +raw : (() => { const at = this._sbxParseWhen(/^\+/.test(raw) ? raw : '+' + raw); return at == null ? 0 : at - this._sbx.eng.now; })();
          if (!id) break;
          this._sbxRec({ op: 'behave', id, how, ms });
          this._sbx.eng.setBehave(id, how, ms);
          this._toast(how === 'ok' ? T('sbx_how_set_ok', { name: this._boxName(id) }) : T('sbx_how_set', { name: this._boxName(id), how: q('.sbhow').selectedOptions[0].textContent }));
          break;
        }
        case 'sbx-st-set': { this._sbx.tab = 'tl'; this._renderSbx(); this._sbxPick(el.dataset.k); const v = q('.sbval-sel'); if (v) v.focus(); break; }
        case 'sbx-st-reset': {
          const k = el.dataset.k, real = this._sbx.eng.real[k];
          if (real) this._sbxStep({ op: 'set', id: k, state: real.state, attrs: Object.assign({}, real.attributes || {}) });
          break;
        }
        case 'sbx-explore': this._sbxExplore(); break;
        case 'sbx-nact': { const id = q('.sbnact') && q('.sbnact').value; if (!id) return; const [type, key] = this._sbxNotifyEvent(); this._sbxStep({ op: 'event', type, data: { [key]: id } }); break; }
        case 'sbx-ex-stop': this._sbx.exStop = true; break;
        case 'sbx-ex-show': this._sbxExShow(+el.dataset.i); break;
        case 'sbx-cov-run': this._sbxCovRun(); break;
        case 'sbx-vars-close': this._sbx.sel = null; this._renderSbx(); break;
        case 'sbx-advby': {
          const raw = this._sbxVal('sbadv'), ms = /^\d+$/.test(raw) ? +raw : (() => { const at = this._sbxParseWhen(/^\+/.test(raw) ? raw : '+' + raw); return at == null ? null : at - this._sbx.eng.now; })();
          if (!ms || ms <= 0) { this._toast(T('sbx_bad_time')); return; }
          this._sbxStep({ op: 'advance', ms });
          break;
        }
        case 'sbx-jump': {
          const raw = this._sbxVal('sbjump'), at = /^\d{10,}$/.test(raw) ? +raw : this._sbxParseWhen(raw), ms = at == null ? null : at - this._sbx.eng.now;
          if (ms == null || ms <= 0) { this._toast(T('sbx_bad_time')); return; }
          this._sbxStep({ op: 'advance', ms });
          break;
        }
        case 'sbx-to': { const ms = +el.dataset.at - this._sbx.eng.now; if (ms > 0) this._sbxStep({ op: 'advance', ms }); break; }
        case 'sbx-fire': {
          const type = this._sbxVal('sbev'), raw = this._sbxVal('sbevd');
          if (!type) { this._toast(T('sbx_pick_event')); return; }
          let data = {};
          if (raw) { try { data = JSON.parse(raw); } catch (e) { const p = parseLoose(raw); if (p && typeof p === 'object') data = p; else { this._toast(T('sbx_bad_data')); return; } } }
          this._sbxDo((e) => { this._sbxRec({ op: 'event', type, data }); return e.userEvent(type, data); });
          break;
        }
        case 'sbx-run': {
          const id = q('.sbrun').value, tv = q('.sbtrig') && !q('.sbtrig').hidden ? q('.sbtrig').value : '';
          const conds = q('.sbconds').checked, ti = tv === '' ? null : +tv, vw = q('.sbvarsw');
          let vars;
          if (vw && !vw.hidden) { const raw = this._sbxVal('sbvars'); if (raw) { try { vars = JSON.parse(raw); } catch (e) { const p = parseLoose(raw); if (p && typeof p === 'object') vars = p; else { this._toast(T('sbx_bad_data')); return; } } } }
          if (id) this._sbxStep(Object.assign({ op: 'run', id, conds, ti }, vars ? { vars } : {}));
          break;
        }
        case 'sbx-mqtt': {
          const topic = this._sbxVal('sbtop');
          if (!topic) { this._toast(T('sbx_pick_topic')); return; }
          const payload = this._sbxVal('sbpay');
          this._sbxDo((e) => { this._sbxRec({ op: 'mqtt', topic, payload }); return e.userMqtt(topic, payload); });
          break;
        }
        case 'sbx-next': this._sbxDo((e) => { this._sbxRec({ op: 'next' }); return e.toNext(); }); break;
        case 'sbx-reset': this._sbxReset(); break;
        case 'sbx-ans': { const a = this._sbx && this._sbx.asks[+el.dataset.i]; if (!a) return; if (a.q.value) { const inp = d.querySelector(`.sbav[data-i="${el.dataset.i}"]`); a.res(parseLoose(inp ? inp.value : '')); } else a.res(el.dataset.v === '1'); break; }
        case 'sbx-pick': this._sbxLight(+el.dataset.id); break;
        default: break;
      }
    },
    // ---- the flow view: what one thing you did set off, step by step on the board. Each step lights its arrow (or
    // its box), gets a number, and a dot runs along it; what isn't on the board gets a temporary dashed box
    _sbxLight(id, auto) {
      const g = this._sbx;
      if (!g) return;
      g.sel = id;
      const act = (g.acts || []).find((x) => id >= x.a && id <= x.b);
      const f = act && (this._flow && this._flow.act === act ? this._flow : this._flowBuild(act));
      if (!f || !f.steps.length) { if (!auto) this._renderSbx(); return; }
      const fresh = f !== this._flow;
      this._clock.cancel('lit');
      this._flow = f;
      this._sel = null;
      // the whole run in view if it reads at that size; otherwise the view follows the steps as they play
      if (fresh) { const all = this._flowRects(f, f.steps.map((x, i) => i)); if (all && this._fitK(all) >= 0.6) this._frameKeys(f.keys, [...f.ghosts.values()]); }
      this._renderSbx();
      if (auto) { this._flowPlay(); return; }
      let i = f.steps.findIndex((x) => x.e.id === id);
      if (i < 0) i = Math.max(0, f.steps.filter((x) => x.e.id < id).length - 1);
      this._flowGo(i, true);
    },
    _flowBuild(act) {
      const g = this._sbx, eng = g.eng, vis = this._visibleKeys(), E = this._visEdges();
      const by = new Map(eng.log.map((e) => [e.id, e])), es = eng.log.filter((e) => e.id >= act.a && e.id <= act.b && e.kind !== 'note');
      // a board box for a key: itself, the MQTT box a topic is under (zigbee2mqtt/lamp for zigbee2mqtt/lamp/set), the
      // device box of an entity the board shows only as its device (an action on a device runs on its entities,
      // 0.11.1), the area, floor or label box it was reached through, or a temporary one
      const res = (k) => {
        if (!k) return null;
        if (vis.has(k)) return k;
        if (k.startsWith('mqtt:')) {
          const t = k.slice(5);
          for (const n of vis) if (n.startsWith('mqtt:')) { const b = n.slice(5); if (b === t || t.startsWith(b + '/') || sbxTopic(b, t)) return n; }
        }
        const reg = this._entMap.get(k);
        if (reg && reg.device_id && vis.has('device:' + reg.device_id)) return 'device:' + reg.device_id;
        for (const n of vis) if (/^(area|floor|label):/.test(n)) { const t = this._tgt.get(n); if (t && t.entities.includes(k)) return n; }
        return '~' + k;
      };
      const edgeFor = (a, b, role) => {
        const c = E.filter((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
        return c.find((x) => x.role === role && x.from === a) || c.find((x) => x.from === a) || c[0] || null;
      };
      // a call's MQTT messages and events are drawn as its arrows
      const kids = new Map();
      es.forEach((e) => { const c = by.get(e.cause); if ((e.kind === 'mqtt' || e.kind === 'event') && c && c.kind === 'call') { if (!kids.has(c.id)) kids.set(c.id, []); kids.get(c.id).push(e.key); } });
      const ghosts = new Map(), keys = new Set(), steps = [];
      const ghost = (gk, anchor, before) => {
        if (gk[0] !== '~' || ghosts.has(gk)) return;
        const k = gk.slice(1), p = k.indexOf(':'), pre = p > 0 && !k.slice(0, p).includes('.') ? k.slice(0, p) : '';
        const name = pre === 'mqtt' || pre === 'event' || pre === 'svc' ? k.slice(p + 1) : pre === 'device' ? T('sbx_g_device') : this._boxName(k);
        const kind = pre === 'mqtt' ? T('sbx_g_mqtt') : pre === 'event' ? T('sbx_g_event') : pre === 'svc' ? T('sbx_g_svc') : T('sbx_g_out');
        const icon = pre === 'mqtt' ? 'mdi:access-point' : pre === 'event' ? 'mdi:lightning-bolt-outline' : pre === 'svc' ? (k.startsWith('svc:notify.') ? 'mdi:bell-outline' : 'mdi:cog-outline') : pre === 'device' ? 'mdi:devices' : 'mdi:shape-outline';
        ghosts.set(gk, { key: gk, k, name, kind, icon, title: T('sbx_g_title', { k }), anchor: anchor && anchor[0] !== '~' ? anchor : null, before, w: Math.round(Math.max(140, Math.min(260, 58 + Math.max(name.length * 7.4, kind.length * 6)))), h: 46 });
      };
      es.forEach((e) => {
        const c = by.get(e.cause), links = [];
        let box = null, from = [], to = [];
        // something you did that isn't a box (Home Assistant starting, a webhook): the step is on what it started; a
        // device's button pressed comes from the device's box when it's on the board
        if (e.kind === 'trigger') { const src = e.src || (c && ['state', 'event', 'mqtt'].includes(c.kind) ? c.key : c && c.kind === 'did' ? (vis.has(c.key) ? c.key : null) : e.ent); if (src) from = [src]; else box = e.key; to = [e.key]; }
        else if (e.kind === 'cond') { from = e.ents || []; to = [e.key]; if (!from.length) box = e.key; }
        else if (e.kind === 'call') {
          to = [...new Set((e.ents || []).concat(kids.get(e.id) || []))];
          if (!to.length && SVC_RE.test(e.svc || '')) to = ['svc:' + e.svc];
          if (e.key) from = [e.key]; else { box = to[0] || null; to = []; }
          if (!to.length) box = e.key;
        } else box = e.key;
        const role = { trigger: 'trigger', cond: 'condition', call: 'call' }[e.kind];
        from.forEach((x) => to.forEach((y) => {
          const a = res(x), b = res(y);
          if (!a || !b || a === b) return;
          // a box that stands in for what was reached (a device for its entity, an area for its lights) says which
          const via = b !== y && b[0] !== '~' && !y.startsWith('mqtt:') ? y : null, old = links.find((l) => l.a === a && l.b === b);
          if (old) { if (via && !old.via.includes(via)) old.via.push(via); return; }
          const ed = a[0] !== '~' && b[0] !== '~' ? edgeFor(a, b, role) : null;
          links.push({ a, b, edge: ed ? ed.id : null, rev: !!ed && ed.from !== a, via: via ? [via] : [] });
          ghost(a, b, true); ghost(b, a, false);
          [a, b].forEach((k) => { if (k[0] !== '~') keys.add(k); });
        }));
        const was = box;
        if (box) { box = res(box); ghost(box, links.length ? links[0].a : null, false); if (box[0] !== '~') keys.add(box); }
        if (!links.length && !box) return;
        steps.push({ e, links, box: links.length ? null : box, via: box && box !== was && box[0] !== '~' && !was.startsWith('mqtt:') ? [was] : [] });
      });
      const f = { act, steps, ghosts, keys: [...keys], at: -1, cond: new Map(), reached: new Set() };
      this._flowPlace(f);
      return f;
    },
    // temporary boxes go next to what they touch: sources before it, the rest after, clear of the board's boxes, at the
    // nearest spot whose arrow runs through the fewest of them
    _flowPlace(f) {
      const m = this._model, V = this._vert(), M = 14;
      const rects = [...this._visibleKeys()].map((k) => m.nodes.get(k)).filter(Boolean).map((n) => ({ k: n.key, x: n.x, y: n.y, w: n.w, h: n.h }));
      const hit = (r) => rects.some((o) => r.x < o.x + o.w + M && o.x < r.x + r.w + M && r.y < o.y + o.h + M && o.y < r.y + r.h + M);
      const first = f.keys.length ? m.nodes.get(f.keys[0]) : null;
      f.ghosts.forEach((g) => {
        const n = (g.anchor && m.nodes.get(g.anchor)) || first || { key: null, x: 0, y: 0, w: 0, h: 0 };
        const others = rects.filter((o) => o.k !== n.key);
        let best = null;
        // across the flow (beside it, then a step further out) and along it, above and below
        for (const gap of [64, 200]) for (const before of [true, false]) for (let i = 0; i < 13; i++) {
          const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (V ? g.w + 16 : g.h + 14);
          const r = V ? { x: n.x + (n.w - g.w) / 2 + off, y: before ? n.y - gap - g.h : n.y + n.h + gap, w: g.w, h: g.h }
            : { x: before ? n.x - gap - g.w : n.x + n.w + gap, y: n.y + (n.h - g.h) / 2 + off, w: g.w, h: g.h };
          if (hit(r)) continue;
          const p = g.before ? flowPath(r, n, V) : flowPath(n, r, V);
          const score = Math.hypot(r.x + r.w / 2 - n.x - n.w / 2, r.y + r.h / 2 - n.y - n.h / 2) + 600 * flowCrossings(p.segs, others) + (before !== g.before ? 160 : 0);
          if (!best || score < best.score) best = { r, score };
        }
        const r = best ? best.r : V ? { x: n.x, y: n.y + n.h + 64, w: g.w, h: g.h } : { x: n.x + n.w + 64, y: n.y, w: g.w, h: g.h };
        Object.assign(g, { x: Math.round(r.x), y: Math.round(r.y) });
        rects.push({ k: g.key, x: g.x, y: g.y, w: g.w, h: g.h });
      });
    },
    _flowPlay() {
      const f = this._flow;
      if (!f) return;
      this._clock.cancel('lit');
      if (lessMotion()) { this._flowGo(f.steps.length - 1, false); return; }
      let i = 0;
      const tick = () => {
        if (this._flow !== f) return;
        this._flowGo(i, true);
        // a long flow plays a little faster: ten seconds or so in all. A step with words over a box waits long enough
        // to read them (0.11.1)
        const words = this._flowSays(f.steps[i]).reduce((n, [, t]) => n + t.length, 0);
        const ms = Math.max(450, Math.min(850, 10000 / f.steps.length), words ? Math.min(5000, 1200 + 45 * words) : 0);
        if (++i < f.steps.length) this._clock.after('lit', ms, tick);
      };
      tick();
    },
    _flowGo(i, anim) {
      const f = this._flow;
      if (!f || !f.steps.length) return;
      f.at = Math.max(0, Math.min(f.steps.length - 1, i));
      f.anim = !!anim;
      const keys = new Set(), edges = new Set();
      f.cond = new Map(); f.reached = new Set();
      f.steps.slice(0, f.at + 1).forEach((s) => {
        const touch = (k) => { if (!k) return; if (k[0] === '~') f.reached.add(k); else keys.add(k); };
        touch(s.box);
        s.links.forEach((l) => {
          touch(l.a); touch(l.b);
          if (l.edge) edges.add(l.edge);
          if (s.e.kind === 'cond') f.cond.set(l.edge || l.a + '>' + l.b, { ok: s.e.ok, title: T('sbx_cond_mark', { text: s.e.text, res: s.e.ok ? T('sbx_true') : T('sbx_false') }) + (s.e.why ? '\n' + s.e.why : '') });
        });
      });
      const cur = f.steps[f.at];
      f.now = cur.box || cur.links[cur.links.length - 1].b;
      this._lit = { keys, edges, now: f.now[0] === '~' ? null : f.now };
      if (this._sbx) this._sbx.sel = cur.e.id;
      this._applyFocus();
      this._flowBar();
      this._flowFollow(f, f.at);
      this._flowRows();
      if (anim) {
        const el = f.now[0] === '~' ? this._$.flow.querySelector(`.ghost[data-g="${CSS.escape(f.now)}"]`) : this._els.get(f.now);
        if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
      }
    },
    // a step in words, by name: who called what, who waits
    _flowText(e) {
      const nm = (k) => this._boxName(k), t = this._sbxText(e).main;
      if (e.kind === 'call' && e.key) {
        const to = (e.ents || []).map(nm).join(', ');
        if (/^script\./.test(e.svc || '') || ((e.svc || '').startsWith('script.turn_on') && to)) return T('sbx_f_runs', { a: nm(e.key), b: to || nm(e.svc) });
        return T('sbx_f_calls', { a: nm(e.key), svc: e.svc, to: to ? ' → ' + to : '' });
      }
      if (e.kind === 'wait' && e.key) return T('sbx_f_waits', { a: nm(e.key), w: String(e.text || '').replace(/^./, (c) => c.toLowerCase()) });
      if (e.kind === 'cond' && e.key) return T('sbx_f_checks', { a: nm(e.key), c: t });
      return t;
    },
    // a step's words over the boxes that stand in for what it reached: [[box, words]]
    _flowSays(st) {
      return st.links.filter((l) => l.via.length).map((l) => [l.b, l.via]).concat(st.box && st.via.length ? [[st.box, st.via]] : [])
        .map(([k, via]) => [k, this._flowSay(st.e, via)]).filter(([, t]) => t);
    },
    // what a step did to the entities a box stands in for: the call, to which of them, with its settings; or the change
    _flowSay(e, via) {
      const nm = (k) => this._boxName(k);
      if (e.kind === 'call') {
        const set = Object.entries(e.data || {}).filter(([k, v]) => !/^(entity_id|device_id|area_id|floor_id|label_id)$/.test(k) && v != null && typeof v !== 'object').slice(0, 2).map(([k, v]) => `${k}: ${v}`);
        return `${e.svc} → ${via.map(nm).join(', ')}${set.length ? ' (' + set.join(', ') + ')' : ''}`;
      }
      return this._sbxText(e).main;
    },
    // the boxes of some steps, as one rectangle on the board
    _flowRects(f, idx) {
      const m = this._model, rs = [];
      idx.forEach((i) => { const s = f.steps[i]; [s.box, ...s.links.flatMap((l) => [l.a, l.b])].forEach((k) => { const r = k && (k[0] === '~' ? f.ghosts.get(k) : m.nodes.get(k)); if (r) rs.push(r); }); });
      if (!rs.length) return null;
      const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
      return { x0, y0, x1: Math.max(...rs.map((r) => r.x + r.w)), y1: Math.max(...rs.map((r) => r.y + r.h)) };
    },
    // the part of the board left free by the drawer and the bar along its foot, and the zoom a rectangle fits at
    _flowArea() { return { W: this._openWidth(), H: this._$.vp.clientHeight - (this._$.litbar.hidden ? 20 : this._$.litbar.offsetHeight + 30), pad: 50 }; },
    // a step out of view: glide to it, at the same zoom unless it doesn't fit
    _flowFollow(f, i) {
      let R = this._flowRects(f, [i]);
      if (!R) return;
      // a step too long to fit even zoomed out: the box it reaches
      if (this._fitK(R) < 0.35 && f.now) { const n = f.now[0] === '~' ? f.ghosts.get(f.now) : this._model.nodes.get(f.now); if (n) R = { x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h }; }
      const a = this._flowArea(), v = this._view;
      if (R.x0 * v.k + v.x >= a.pad / 2 && R.y0 * v.k + v.y >= a.pad / 2 && R.x1 * v.k + v.x <= a.W - a.pad / 2 && R.y1 * v.k + v.y <= a.H - a.pad / 2) return;
      const k = Math.max(0.35, Math.min(v.k, this._fitK(R)));
      const to = { k, x: a.W / 2 - ((R.x0 + R.x1) / 2) * k, y: a.H / 2 - ((R.y0 + R.y1) / 2) * k }, from = { ...v }, t0 = performance.now(), ms = lessMotion() ? 0 : 380;
      this._clock.cancel('follow');
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this._view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        this._applyView();
        if (t < 1) this._clock.frame('follow', step); else this._saveView();
      };
      this._clock.frame('follow', step);
    },
    _flowBar() {
      const f = this._flow, b = this._$.litbar;
      if (!f) return;
      const cur = f.steps[f.at], ct = { main: this._flowText(cur.e), sub: this._sbxText(cur.e).sub };
      const chips = f.steps.map((s, i) => { const t = this._flowText(s.e); return `<button class="lstep fstep ${i <= f.at ? 'on' : ''} ${i === f.at ? 'cur' : ''}" data-act="flow-go" data-i="${i}" title="${esc(t)}"><i class="fsn">${i + 1}</i>${esc(shorten(t, 34))}</button>`; }).join('<span class="larr">→</span>');
      b.classList.add('flowbar');
      b.innerHTML = `<div class="fhead"><button data-act="flow-prev" title="${T('sbx_step_prev')}" ${f.at <= 0 ? 'disabled' : ''}><ha-icon icon="mdi:chevron-left"></ha-icon></button><button data-act="flow-next" title="${T('sbx_step_next')}" ${f.at >= f.steps.length - 1 ? 'disabled' : ''}><ha-icon icon="mdi:chevron-right"></ha-icon></button><span class="fpos">${esc(T('sbx_flow_n', { n: f.at + 1, total: f.steps.length }))}</span><span class="fcur" title="${esc(ct.main + (ct.sub ? '\n' + ct.sub : ''))}">${esc(ct.main)}</span><button data-act="flow-play">${T('replay')}</button>${this._sbx && f.act && f.act.step0 != null ? `<button data-act="flow-undo" title="${T('sbx_flow_undo_t')}">${T('sbx_flow_undo')}</button>` : ''}<button data-act="lit-clear">${T('clear')}</button></div><div class="fsteps">${chips}</div>`;
      b.hidden = false;
      this._litSteps = null; this._litRun = null;
      this._fitLitbar();
      const c = b.querySelector('.fstep.cur'), row = b.querySelector('.fsteps');
      if (c && row) { const l = c.offsetLeft - row.offsetLeft; if (l < row.scrollLeft || l + c.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = Math.max(0, l - row.clientWidth / 3); }
    },
    // the timeline in the drawer follows: the current step's row, and the flow's rows numbered
    _flowRows() {
      const f = this._flow, box = this._$.drawer.querySelector('.sbtl');
      if (!f || !box) return;
      const cur = f.steps[f.at] && f.steps[f.at].e.id;
      box.querySelectorAll('.dbrow').forEach((r) => {
        const on = +r.dataset.id === cur;
        r.classList.toggle('on', on);
        if (on) { const top = r.offsetTop - box.offsetTop; if (top < box.scrollTop || top + r.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3); }
      });
    },
    // the parts of the flow drawn over the board: temporary boxes and their arrows, step numbers, and what's waiting
    _paintFlow() {
      const box = this._$.flow, svg = this._$.flowx, g = this._sbx, f = this._flow, m = this._model;
      if (!box || !svg) return;
      if (!g || !m || !this._sbxOn()) { box.innerHTML = ''; svg.innerHTML = ''; return; }
      const rect = (k) => (k && k[0] === '~' ? f && f.ghosts.get(k) : m.nodes.get(k));
      const html = [], arr = [], spots = new Map();
      const spot = (x, y, i, cur) => {
        const id = Math.round(x / 4) + ',' + Math.round(y / 4), s = spots.get(id) || { x, y, ns: [], cur: false };
        s.ns.push(i); s.cur = s.cur || cur; spots.set(id, s);
      };
      const mark = (ok, x, y, title) => `<g class="cres ${ok === true ? 'ok' : ok === false ? 'bad' : 'unk'}" transform="translate(${x},${y})"><circle r="8"></circle>${ok === true ? '<path d="M-3.6,0.2 L-1.1,2.8 L3.8,-2.6"></path>' : ok === false ? '<path d="M-3,-3 L3,3 M3,-3 L-3,3"></path>' : '<text y="3.6" text-anchor="middle">?</text>'}<title>${esc(title)}</title></g>`;
      if (f && f.at >= 0) {
        f.ghosts.forEach((gh) => html.push(`<div class="ghost${f.reached.has(gh.key) ? '' : ' far'}${f.now === gh.key ? ' now' : ''}" data-act="flow-ghost" data-g="${esc(gh.key)}" style="left:${gh.x}px;top:${gh.y}px;width:${gh.w}px;height:${gh.h}px" title="${esc(gh.title)}"><ha-icon icon="${gh.icon}"></ha-icon><span class="gt"><b>${esc(gh.name)}</b><small>${esc(gh.kind)}</small></span></div>`));
        f.steps.slice(0, f.at + 1).forEach((s, i) => {
          const cur = i === f.at;
          s.links.forEach((l, j) => {
            let mid = l.edge && this._edgeMid ? this._edgeMid.get(l.edge) : null;
            if (!l.edge) {
              const A = rect(l.a), B = rect(l.b);
              if (!A || !B) return;
              const p = flowPath(A, B, this._vert());
              arr.push(`<path class="fx${cur ? ' cur' : ''}${s.e.kind === 'cond' ? ' cond' : ''}" d="${p.d}" marker-end="url(#fb-amber)"></path>`);
              if (cur && f.anim && j === 0) arr.push(`<circle class="fdot" r="5.5"><animateMotion begin="indefinite" dur="0.65s" fill="freeze" path="${p.d}"></animateMotion></circle>`);
              const c = s.e.kind === 'cond' && f.cond.get(l.a + '>' + l.b);
              if (c) arr.push(mark(c.ok, p.mid[0], p.mid[1], c.title));
              mid = p.mid;
            }
            if (mid && j === 0) spot(mid[0] + 15, mid[1] + 15, i + 1, cur);
          });
          if (!s.links.length && s.box) { const R = rect(s.box); if (R) spot(R.x, R.y, i + 1, cur); }
        });
      }
      // steps in words over a box that stands in for what they reached: which of a device's entities was called and
      // with what, or changed to what (0.11.1). Each box keeps the words of the last step to reach it until a later
      // one does; the current step's are marked
      if (f && f.at >= 0) {
        const say = new Map();
        f.steps.slice(0, f.at + 1).forEach((st, i) => this._flowSays(st).forEach(([k, t]) => say.set(k, { t, now: i === f.at })));
        say.forEach(({ t, now }, k) => { const R = rect(k); if (R) html.push(`<div class="fsay${now ? ' now' : ''}" data-key="${esc(k)}" style="left:${R.x + R.w / 2}px;top:${R.y - 12}px" title="${esc(t)}">${esc(t)}</div>`); });
      }
      // what's waiting in the sandbox, and for how long on its clock
      const due = new Map();
      g.eng.pending().forEach((p) => { if (p.key && !due.has(p.key) && m.nodes.has(p.key)) due.set(p.key, p); });
      due.forEach((p, k) => { const R = m.nodes.get(k); html.push(`<div class="fwait" style="left:${R.x + R.w - 6}px;top:${R.y}px" title="${esc(p.label)}"><ha-icon icon="mdi:timer-sand"></ha-icon>${esc(fmtDur(Math.max(0, p.at - g.eng.now)))}</div>`); });
      spots.forEach((s) => html.push(`<div class="fnum${s.cur ? ' cur' : ''}" data-act="flow-go" data-i="${s.ns[0] - 1}" style="left:${s.x}px;top:${s.y}px">${s.ns.length > 3 ? `${s.ns[0]} ${s.ns[1]} … ${s.ns[s.ns.length - 1]}` : s.ns.join(' ')}</div>`));
      box.innerHTML = html.join('');
      svg.innerHTML = arr.join('');
      if (f && f.anim) svg.querySelectorAll('animateMotion').forEach((x) => { try { x.beginElement(); } catch (er) { /* no SMIL */ } });
    },
    _sbxText(e) {
      const nm = (k) => (k ? this._boxName(k) : ''), g = this._sbx, by = (x) => g && g.eng.log.find((y) => y.id === x);
      switch (e.kind) {
        case 'state': return { main: `${nm(e.key)} → ${this._fmtState(e.key, e.to)}`, sub: [e.from != null ? T('sbx_was', { s: this._fmtState(e.key, e.from) }) : '', e.by === 'you' ? T('sbx_by_you') : e.follows ? T('sbx_follows', { name: nm(e.follows) }) : (by(e.cause) && by(e.cause).kind === 'call' ? T('sbx_by', { name: nm(by(e.cause).key) }) : '')].filter(Boolean).join(' · ') };
        case 'did': return { main: e.text, sub: T('sbx_by_you') };
        case 'pause': return { main: e.text, sub: this._boxName(e.key), cls: 'blue' };
        case 'event': return { main: T('sbx_event_x', { type: e.text }), sub: e.by === 'you' ? T('sbx_by_you') : (by(e.cause) && by(e.cause).key ? T('sbx_by', { name: nm(by(e.cause).key) }) : '') };
        case 'trigger': return { main: T('sbx_triggered', { name: nm(e.key) }), sub: e.ent ? `${nm(e.ent)} → ${this._fmtState(e.ent, e.to)}` : e.text, cls: 'blue' };
        case 'cond': return { main: `${e.text}: ${e.ok ? T('sbx_true') : T('sbx_false')}`, sub: e.why || '', cls: e.ok ? '' : 'red' };
        case 'call': return { main: `${e.svc}${e.ents && e.ents.length ? ' → ' + e.ents.map(nm).join(', ') : ''}`, sub: e.msg ? T('sbx_msg') : e.unknown ? T('sbx_unknown') : nm(e.key), cls: e.unknown && !e.msg ? 'amber' : '' };
        case 'mqtt': return { main: `MQTT ${e.text}${e.payload ? ': ' + shorten(e.payload, 60) : ''}`, sub: e.by === 'you' ? T('sbx_by_you') : (by(e.cause) && by(e.cause).key ? T('sbx_by', { name: nm(by(e.cause).key) }) : '') };
        case 'run': return { main: `${nm(e.key)} · ${({ stopped: T('sbx_out_stopped'), cancelled: T('sbx_out_cancelled'), error: T('sbx_out_error') })[e.outcome] || T('sbx_out_finished')}`, sub: e.why || '', cls: e.outcome === 'error' ? 'red' : e.outcome === 'finished' ? '' : 'muted' };
        case 'ask': return { main: e.text, sub: e.answer === undefined ? T('sbx_waiting_you') : T('sbx_you_said', { a: typeof e.answer === 'boolean' ? (e.answer ? T('sbx_true') : T('sbx_false')) : JSON.stringify(e.answer) }), cls: 'amber' };
        default: return { main: e.text || '', sub: '', cls: e.warn ? 'amber' : '' };
      }
    },
    _renderSbx() {
      this._renderChecks(true);
      const g = this._sbx, d = this._$.drawer;
      if (!g || !this._sbxOn()) return;
      const eng = g.eng, box = d.querySelector('.sbtl');
      const ck = d.querySelector('.sbclock');
      // the sandbox clock: the day and the time to the second, how far it is from now, and the sun (0.11.1)
      if (ck) {
        const off = eng.now - g.rec.at, sun = eng.get('sun.sun');
        ck.textContent = this._sbxWhen(eng.now, true);
        ck.title = T('sbx_clock_t', { d: off > 999 ? fmtDurLong(off) : '0 s', tz: eng.tz || '' }) + (sun ? ' · ' + (sun.state === 'above_horizon' ? T('sbx_sun_up') : T('sbx_sun_down')) : '');
      }
      const nx = d.querySelector('.sbnext'), due = eng.pending();
      if (nx) {
        nx.disabled = !due.length || g.busy;
        nx.textContent = due.length ? T('sbx_next', { label: due[0].label, d: fmtDur(due[0].at - eng.now) }) : T('sbx_nothing_due');
      }
      d.querySelectorAll('.sbctl button:not([data-act="sbx-sec"])').forEach((b) => { if (b !== nx) b.disabled = !!g.busy; });
      const dueBox = d.querySelector('.sbdue');
      // what's coming up, each a button that runs the clock to it
      if (dueBox) this._put(dueBox, due.length ? `<span class="muted">${T('sbx_due')}</span> ` + due.slice(0, 8).map((x) => `<button class="sbd" data-act="sbx-to" data-at="${x.at}" data-key="${x.at}|${esc(x.label)}" title="${esc(T('sbx_to_t', { t: this._sbxWhen(x.at) }))}">${esc(x.label)} · ${esc(fmtDur(x.at - eng.now))}</button>`).join('') : '');
      this._sbxJumps();
      const ask = d.querySelector('.sbask');
      // a run paused (step-through or a breakpoint): Step, or Continue
      const paused = [...eng.paused.keys()].map((lid) => eng.log.find((e) => e.id === lid)).filter(Boolean);
      if (ask) ask.innerHTML = paused.map((e) => `<div class="sbq sbpause"><ha-icon icon="mdi:pause-circle-outline"></ha-icon><span><b>${esc(this._boxName(e.key))}</b> · ${esc(e.text)}</span><button class="chip" data-act="sbx-stepone" data-id="${e.id}">${T('sbx_step')}</button><button class="chip" data-act="sbx-continue">${T('sbx_continue')}</button></div>`).join('')
        + g.asks.map((a, i) => `<div class="sbq"><ha-icon icon="mdi:account-question-outline"></ha-icon><span>${esc(a.q.text)}</span>${a.q.value
        ? `<input class="sbav" data-i="${i}" aria-label="${T('sbx_value')}"><button class="chip" data-act="sbx-ans" data-i="${i}">${T('sbx_use')}</button>`
        : `<button class="chip" data-act="sbx-ans" data-i="${i}" data-v="1">${T('sbx_true')}</button><button class="chip" data-act="sbx-ans" data-i="${i}" data-v="0">${T('sbx_false')}</button>`}</div>`).join('');
      // the last few things you did, to do again; and Undo (0.11.2)
      const rec = d.querySelector('.sbrec');
      if (rec) {
        const seen = new Set(), last = [];
        for (let i = g.rec.steps.length - 1; i >= 0 && last.length < 5; i--) { const st = g.rec.steps[i], t = this._chkStepText(st).replace(/<[^>]+>/g, ''); if (st.op === 'behave' || seen.has(t)) continue; seen.add(t); last.push([i, t]); }
        this._put(rec, g.rec.steps.length ? `<span class="muted">${T('sbx_again')}</span>` + last.map(([i, t]) => `<button class="chip" data-act="sbx-again" data-i="${i}" data-key="again-${esc(t)}" title="${esc(T('sbx_again_t', { what: t }))}">${esc(shorten(t, 36))}</button>`).join('') + `<button class="chip" data-act="sbx-undo" title="${T('sbx_undo_t')}"><ha-icon icon="mdi:undo"></ha-icon>${T('sbx_undo')}</button>` : '');
        rec.querySelectorAll('button').forEach((b) => { b.disabled = !!g.busy; });
      }
      // how a replay from history compares, over the timeline
      const hp = d.querySelector('.sbhp');
      if (hp) { const h = this._sbxHistPane(); hp.hidden = !h || (g.tab || 'tl') !== 'tl'; this._put(hp, h); }
      // the tabs: the timeline, the states, the explorer, coverage
      d.querySelectorAll('.sbtabs [role="tab"]').forEach((b) => { const on = b.dataset.tab === (g.tab || 'tl'); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      [['tl', '.sbtl'], ['st', '.sbst'], ['ex', '.sbex'], ['cov', '.sbcov']].forEach(([k, q]) => { const p = d.querySelector(q); if (p) p.hidden = (g.tab || 'tl') !== k; });
      if (g.tab === 'st') this._sbxStates();
      if (g.tab === 'ex') this._sbxExPane();
      if (g.tab === 'cov') this._sbxCovPane();
      this._sbxVarsPane();
      this._sbxCovPaint();
      if (!box) return;
      const icon = { pause: 'mdi:pause-circle-outline', did: 'mdi:gesture-tap', mqtt: 'mdi:access-point', state: 'mdi:swap-horizontal', event: 'mdi:lightning-bolt-outline', trigger: 'mdi:play-circle-outline', cond: 'mdi:help-rhombus-outline', call: 'mdi:arrow-right-bold-outline', run: 'mdi:flag-checkered', wait: 'mdi:timer-sand', note: 'mdi:information-outline', ask: 'mdi:account-question-outline' };
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
      const fl = this._flow, fnum = new Map(fl ? fl.steps.map((s, i) => [s.e.id, i + 1]) : []);
      // a note about a problem the board knows (a trigger that starts both ways, 0.11.1) can be dismissed from here;
      // one dismissed, or ignored for good, isn't said again
      const off = this._ver ? new Set() : new Set((this._layout(this._data.ui.current).dismissed || []).map((x) => x.k));
      const log = eng.log.filter((e) => !(e.pk && off.has(e.pk)));
      // each thing you did starts with a sentence of what came of it
      const sums = new Map((g.acts || []).filter((a) => a.sum).map((a) => [a.a, a.sum]));
      this._put(box, log.length ? log.map((e) => {
        const sum = sums.has(e.id) ? `<div class="sbsum" data-key="sum-${e.id}"><ha-icon icon="mdi:text-short"></ha-icon><span>${esc(sums.get(e.id))}</span></div>` : '';
        return sum + this._sbxRow(e, eng, g, fl, fnum, icon);
      }).join('') : `<div class="muted pad">${T('sbx_empty')}</div>`);
      if (atEnd || !g.scrolled) { box.scrollTop = box.scrollHeight; g.scrolled = true; }
      this._paintFlow();
    },
    // one row of the timeline
    _sbxRow(e, eng, g, fl, fnum, icon) {
      const t = this._sbxText(e), p = tzParts(e.t, eng.tz), tm = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}:${String(p.s).padStart(2, '0')}`;
      const ic = e.kind === 'cond' ? (e.ok ? 'mdi:check-circle-outline' : 'mdi:close-circle-outline') : e.msg ? 'mdi:message-text-outline' : icon[e.kind] || 'mdi:circle-small';
      const partly = e.partly && e.partly.length ? `<span class="sbpart">${T('sbx_partly', { what: e.partly.map((x) => ({ states: T('sbx_reads_states'), closest: T('sbx_reads_places'), distance: T('sbx_reads_places'), state_translated: T('sbx_reads_translated') })[x] || T('sbx_reads_other')).join(', ') })}</span>` : '';
      const fn = fnum.get(e.id), inf = fl && e.id >= fl.act.a && e.id <= fl.act.b;
      if (e.pk && !this._ver) return `<div class="dbrow k-${e.kind} ${t.cls || ''}" data-id="${e.id}"><span class="rt">${tm}</span><ha-icon icon="${ic}"></ha-icon><span class="dm"><b>${esc(t.main)}</b><span class="sbpk"><button data-act="sbx-pdis" data-k="${esc(e.pk)}" title="${T('sbx_pdis_t')}"><ha-icon icon="mdi:eye-off-outline"></ha-icon>${T('prob_dismiss')}</button></span></span></div>`;
      return `<button class="dbrow k-${e.kind} ${t.cls || ''} ${g.sel === e.id ? 'on' : ''}${inf ? ' fin' : ''}" data-act="sbx-pick" data-id="${e.id}"><span class="rt">${fn ? `<i class="fsn">${fn}</i>` : ''}${tm}</span><ha-icon icon="${ic}"></ha-icon><span class="dm"><b>${esc(t.main)}</b>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}${partly}</span></button>`;
    },
    // ---- the variables at the row you picked (0.11.2): the trigger, repeat, wait and response variables, as they were
    _sbxVarsPane() {
      const g = this._sbx, box = this._$.drawer.querySelector('.sbvp');
      if (!g || !box) return;
      const e = (g.tab || 'tl') === 'tl' && g.sel ? g.eng.log.find((x) => x.id === g.sel) : null;
      box.hidden = !(e && e.vars);
      if (box.hidden) { box.innerHTML = ''; return; }
      const txt = JSON.stringify(e.vars, null, 2);
      this._put(box, `<div class="sbvph"><b>${T('sbx_vars_at')}</b><span class="muted">${esc(this._sbxText(e).main)}</span><button class="chip" data-act="sbx-vars-close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><pre class="sbvpre" tabindex="0" aria-label="${esc(T('sbx_vars_at'))}">${esc(txt)}</pre>`);
    },
    // ---- the states (0.11.2): every entity the sandbox holds that the function reads or shows, as it is here and in
    // your home; set one from here, or put it back
    _sbxStates() {
      const g = this._sbx, box = this._$.drawer.querySelector('.sbst');
      if (!g || !box) return;
      const eng = g.eng, m = this._model, nm = (k) => this._boxName(k), f = g.stf || 'all';
      const read = new Set(((g.ins && g.ins.ents) || []).map((x) => x.id));
      const ids = [...new Set([...read, ...[...m.nodes.keys()].filter((k) => !k.includes(':'))])].filter((k) => eng.get(k));
      const changed = (k) => eng.changed.has(k);
      const list = ids.filter((k) => (f === 'changed' ? changed(k) : f === 'read' ? read.has(k) : true)).sort((a, b) => (changed(b) - changed(a)) || nm(a).localeCompare(nm(b)));
      const attrs = (st) => Object.entries((st && st.attributes) || {}).filter(([a]) => !['friendly_name', 'icon', 'entity_picture'].includes(a));
      const val = (v) => (v != null && typeof v === 'object' ? JSON.stringify(v) : String(v));
      const rows = list.map((k) => {
        const here = eng.get(k), real = eng.real[k], ch = changed(k);
        const diff = attrs(here).filter(([a, v]) => !real || val((real.attributes || {})[a]) !== val(v));
        return `<details class="sbsr${ch ? ' ch' : ''}" data-key="${esc(k)}"><summary><span class="sbsn">${esc(nm(k))}</span><span class="sbsv">${esc(here.state)}</span>${ch ? `<span class="sbsw">${esc(T('sbx_st_was', { s: real ? real.state : '—' }))}</span>` : ''}</summary>`
          + `<div class="sbsd"><code>${esc(k)}</code><button class="chip" data-act="sbx-st-set" data-k="${esc(k)}">${T('sbx_st_set')}</button>${ch ? `<button class="chip" data-act="sbx-st-reset" data-k="${esc(k)}">${T('sbx_st_reset')}</button>` : ''}</div>`
          + `<table class="sbsa"><tbody>${attrs(here).map(([a, v]) => `<tr${diff.some(([x]) => x === a) && ch ? ' class="ch"' : ''}><th>${esc(a)}</th><td>${esc(shorten(val(v), 120))}</td></tr>`).join('')}</tbody></table></details>`;
      });
      this._put(box, `<div class="sbsf"><label>${T('sbx_st_show')} <select class="sbstf" aria-label="${T('sbx_st_show')}"><option value="all"${f === 'all' ? ' selected' : ''}>${T('sbx_st_all')}</option><option value="changed"${f === 'changed' ? ' selected' : ''}>${T('sbx_st_changed')}</option><option value="read"${f === 'read' ? ' selected' : ''}>${T('sbx_g_read')}</option></select></label><span class="muted">${esc(P('sbx_st_n', list.length))}</span></div>` + (rows.join('') || `<div class="muted pad">${T('sbx_st_none')}</div>`));
    },
    // ---- the explorer (0.11.2): every thing you could do, each on its own from the start, and what looks wrong
    _sbxExPane() {
      const g = this._sbx, box = this._$.drawer.querySelector('.sbex');
      if (!g || !box) return;
      const x = g.ex, nm = (k) => this._boxName(k);
      if (!x) { this._put(box, `<div class="pad"><p class="muted">${T('sbx_ex_about')}</p><button class="chip primary" data-act="sbx-explore"><ha-icon icon="mdi:compass-outline"></ha-icon>${T('sbx_ex_go')}</button></div>`); return; }
      if (x.running) { this._put(box, `<div class="pad"><p>${esc(T('sbx_ex_running', { i: x.i || 0, n: x.n || '…' }))}</p><progress max="${x.n || 1}" value="${x.i || 0}" aria-label="${esc(T('sbx_ex_go'))}"></progress> <button class="chip" data-act="sbx-ex-stop">${T('sbx_ex_stop')}</button></div>`); return; }
      const flagText = (f) => {
        if (f.kind === 'never') return T('sbx_ex_never', { name: nm(f.id) });
        if (f.kind === 'cond_false') return T('sbx_ex_cond', { name: nm(f.id), c: f.cond.text || '' });
        if (f.kind === 'fight') return T('sbx_ex_fight', { name: nm(f.id), a: nm(f.a[0]), av: f.a[1], b: nm(f.b[0]), bv: f.b[1] });
        if (f.kind === 'loop') return T('sbx_ex_loop', { what: x.runs[f.run].what });
        return T('sbx_ex_unknown', { svc: f.svc, name: nm(f.by) });
      };
      const flags = x.flags.map((f, i) => `<div class="sbxf k-${f.kind}" data-key="f${i}"><ha-icon icon="${f.kind === 'fight' || f.kind === 'loop' ? 'mdi:alert-outline' : 'mdi:information-outline'}"></ha-icon><span>${esc(flagText(f))}</span>${f.run != null ? `<button class="chip" data-act="sbx-ex-show" data-i="${f.run}">${T('sbx_ex_show')}</button>` : ''}</div>`).join('');
      const runs = x.runs.map((r, i) => `<tr data-key="r${i}"><td>${esc(r.what)}</td><td>${esc(r.started.map(nm).join(', ') || '—')}</td><td>${r.changes.length}</td><td><button class="chip" data-act="sbx-ex-show" data-i="${i}">${T('sbx_ex_show')}</button></td></tr>`).join('');
      this._put(box, `<div class="pad"><p><b>${esc(P('sbx_ex_done', x.runs.length))}</b> ${x.stopped ? esc(T('sbx_ex_stopped')) : ''}</p>${flags || `<p class="muted">${T('sbx_ex_clean')}</p>`}<details class="sbexr"><summary>${esc(P('sbx_ex_tries', x.runs.length))}</summary><table class="sbsa"><thead><tr><th>${T('sbx_ex_did')}</th><th>${T('sbx_ex_started')}</th><th>${T('sbx_ex_changed')}</th><th></th></tr></thead><tbody>${runs}</tbody></table></details><button class="chip" data-act="sbx-explore"><ha-icon icon="mdi:refresh"></ha-icon>${T('sbx_ex_again')}</button></div>`);
    },
    async _sbxExplore() {
      const g = this._sbx;
      if (!g || (g.ex && g.ex.running)) return;
      g.ex = { running: true, i: 0, n: 0 };
      g.exStop = false;
      this._renderSbx();
      // each try: a new engine from the same start; nothing is asked (a question is answered no, and said)
      const mk = () => new Sandbox(Object.assign({}, g.opts, { onLog: null, onPause: null, ask: () => Promise.resolve(false) }));
      let out;
      try {
        out = await sbxExplore(mk, { max: 200, stopped: () => g.exStop || this._sbx !== g, onProgress: (i, n) => { g.ex.i = i; g.ex.n = n; if (this._sbx === g && g.tab === 'ex') this._sbxExPane(); } });
      } catch (e) { this._toast(T('sbx_ex_failed', { e: (e && e.message) || String(e) })); g.ex = null; this._renderSbx(); return; }
      if (this._sbx !== g) return;
      g.ex = Object.assign(out, { running: false, stopped: g.exStop });
      this._renderSbx();
    },
    // one of the explorer's tries, shown in the sandbox: back to the start, the same step, the clock on as it went
    async _sbxExShow(i) {
      const g = this._sbx, r = g && g.ex && g.ex.runs[i], e = g && g.ex && g.ex.engs[i];
      if (!r) return;
      await this._sbxRewind(0);
      // the same start, so the same step (a press keeps its time) and the clock run on as far as it went
      const ms = e ? e.now - g.eng.now : 0;
      await this._sbxStep(Object.assign({}, r.step));
      if (ms > 0 && r.step.op !== 'advance') await this._sbxStep({ op: 'advance', ms });
      g.tab = 'tl';
      this._renderSbx();
    },
    // ---- coverage (0.11.2): what the function's saved checks reach (and, ticked, what you've done here)
    async _sbxCovRun() {
      const g = this._sbx, label = this._data.ui.current;
      if (!g) return;
      g.cov = { running: true };
      this._renderSbx();
      const checks = this._checksOf(label);
      const items = g.opts.items, engs = [];
      for (const c of checks) {
        try { const r = await runCheck(c, Object.assign({}, g.opts, { items, onLog: null, onPause: null })); if (r.eng) engs.push(r.eng); } catch (e) { /* a check that can't run shows in Problems */ }
      }
      if (this._sbx !== g) return;
      g.cov = { running: false, n: engs.length, engs };
      this._renderSbx();
    },
    _sbxCovList() {
      const g = this._sbx;
      if (!g || !g.cov || g.cov.running) return null;
      const engs = g.cov.engs.concat(g.covMine ? [g.eng] : []);
      return sbxCoverage(engs, g.opts.items.filter((x) => !x.outside), (k, x) => (k === 'trigger' ? this._trigWords(x) : k === 'cond' ? condText(x, (y) => this._boxName(y)) : k === 'option' ? T('sbx_cov_option') : k === 'branch' ? '' : this._actText(x)));
    },
    _trigWords(t) {
      const p = t.trigger || t.platform || '';
      const who = toList(t.entity_id || (t.target && t.target.entity_id)).map((x) => this._boxName(String(x))).join(', ');
      return [p, who, t.to != null ? '→ ' + toList(t.to).join('/') : '', t.at != null ? toList(t.at).join(', ') : ''].filter(Boolean).join(' ');
    },
    _sbxCovPane() {
      const g = this._sbx, box = this._$.drawer.querySelector('.sbcov');
      if (!g || !box) return;
      const nChecks = this._checksOf(this._data.ui.current).length;
      const head = `<div class="sbsf"><button class="chip" data-act="sbx-cov-run"><ha-icon icon="mdi:refresh"></ha-icon>${T('sbx_cov_go')}</button><label class="sbcb"><input type="checkbox" class="sbcovmine"${g.covMine ? ' checked' : ''}>${T('sbx_cov_mine')}</label></div>`;
      if (!g.cov) { this._put(box, head + `<p class="muted pad">${esc(nChecks ? P('sbx_cov_about', nChecks) : T('sbx_cov_none'))}</p>`); return; }
      if (g.cov.running) { this._put(box, head + `<p class="muted pad">${T('sbx_cov_running')}</p>`); return; }
      const list = this._sbxCovList(), by = new Map();
      list.forEach((x) => { if (!by.has(x.id)) by.set(x.id, []); by.get(x.id).push(x); });
      const mark = (x) => (x.kind === 'cond' ? (x.t && x.f ? ['ok', T('sbx_cov_both')] : x.t ? ['part', T('sbx_cov_true')] : x.f ? ['part', T('sbx_cov_false')] : ['no', T('sbx_cov_never')]) : x.hit ? ['ok', T('sbx_cov_hit')] : ['no', T('sbx_cov_never')]);
      const kindW = { trigger: T('sbx_cov_k_trigger'), cond: T('sbx_cov_k_cond'), action: T('sbx_cov_k_action'), option: T('sbx_cov_k_option'), branch: T('sbx_cov_k_branch') };
      const all = list.length, done = list.filter((x) => mark(x)[0] === 'ok').length;
      const sec = [...by].map(([id, xs]) => {
        const n = xs.filter((x) => mark(x)[0] === 'ok').length;
        return `<details class="sbcv" data-key="${esc(id)}"${n < xs.length ? ' open' : ''}><summary><b>${esc(this._boxName(id))}</b> <span class="muted">${n}/${xs.length}</span></summary><ul>${xs.map((x) => { const [c, w] = mark(x); return `<li class="cv-${c}" data-key="${esc(x.path)}"><span class="cvk">${esc(kindW[x.kind] || x.kind)}${x.branch ? ' ' + esc(x.branch) : ''}</span> ${esc(x.text || '')} <span class="cvw">${esc(w)}</span></li>`; }).join('')}</ul></details>`;
      }).join('');
      this._put(box, head + `<p class="pad"><b>${esc(T('sbx_cov_sum', { done, all, n: g.cov.n }))}</b></p>` + sec);
    },
    // on the board, while Coverage is open: an automation or script nothing reached is marked
    _sbxCovPaint() {
      const g = this._sbx, on = g && g.tab === 'cov' && g.cov && !g.cov.running;
      const none = new Set();
      if (on) { const by = new Map(); this._sbxCovList().forEach((x) => { const v = by.get(x.id) || 0; by.set(x.id, v + (x.hit ? 1 : 0)); }); by.forEach((v, k) => { if (!v) none.add(k); }); }
      this._$.board.querySelectorAll('.node').forEach((n) => n.classList.toggle('uncov', none.has(n.dataset.key)));
    },
    // a test in the sandbox: done on its states instead of your home's
    async _sbxTest(t) {
      const id = t.target, run = (fn) => this._sbxDo(fn);
      switch (t.kind) {
        case 'state': await run((e) => e.userSet(id, t.state)); return true;
        case 'event': await run((e) => e.userEvent(t.event_type, t.event_data || {})); return true;
        case 'run': await run((e) => e.userRun(id, !t.skip_condition)); return true;
        case 'action': await run((e) => e.userCall(t.service, t.data || {}, [id])); return true;
        case 'notify': await run((e) => e.userCall(t.service, t.data || {}, id.includes(':') ? [] : [id])); return true;
        case 'mqtt': await run((e) => e.userMqtt(t.topic, t.payload)); return true;
        default: this._toast(T('sbx_no_test')); return false;
      }
    },
    _lightSteps(steps, run) {
      const m = this._model;
      if (!m) return;
      const keys = [], edges = [];
      steps.forEach((s) => { if (s.key && m.nodes.has(s.key) && keys[keys.length - 1] !== s.key) keys.push(s.key); });
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i], e = m.edges.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
        edges.push(e ? e.id : null);
      }
      this._clock.cancel('lit');
      if (!keys.length && !(run && run.keys.length)) { this._toast(T('nothing_in_this_step_is')); return; }
      this._sel = null;
      this._frameKeys(keys.concat(run ? run.keys : []));
      let i = 0;
      const tick = () => {
        i = Math.min(i + 1, Math.max(keys.length, 1));
        const ks = new Set(keys.slice(0, i)), es = new Set(edges.slice(0, i - 1).filter(Boolean));
        if (i >= keys.length && run) { run.keys.forEach((k) => ks.add(k)); run.edges.forEach((x) => es.add(x)); }
        this._lit = { keys: ks, edges: es, now: keys[i - 1] || null };
        this._applyFocus();
        this._litBar(steps, i, run);
        if (i < keys.length) this._clock.after('lit', 650, tick);
      };
      tick();
    },
    _litBar(steps, at, run) {
      const b = this._$.litbar;
      const runPart = run && run.tr ? `<span class="lrun"><b>${esc(this._boxName(run.e.key))}</b> · ${esc(clock(run.tr.timestamp && run.tr.timestamp.start))} · ${esc((run.tr.not_triggered ? { text: T('didn_t_fire') } : OUTCOME(run.tr)).text)}</span>` : '';
      b.classList.remove('flowbar');
      b.innerHTML = `<div class="lsteps">${steps.map((s, i) => `<span class="lstep ${i < at ? 'on' : ''}">${esc(this._stepText(s))}</span>`).join('<span class="larr">→</span>')}</div><div class="lbtns">${runPart}${steps.length > 1 ? `<button data-act="lit-replay">${T('replay')}</button>` : ''}${run && run.e && run.e.run ? `<button data-act="lit-trace">${T('open_trace')}</button>` : ''}<button data-act="lit-clear">${T('clear')}</button></div>`;
      b.hidden = false;
      this._litSteps = steps; this._litRun = run || null;
      this._fitLitbar();
    },
    _clearLit(quiet) {
      this._clock.cancel('lit');
      const was = !!this._lit, fl = !!this._flow;
      this._lit = null; this._litSteps = null; this._litRun = null; this._flow = null;
      this._$.litbar.hidden = true;
      this._$.litbar.classList.remove('flowbar');
      if (was && !quiet) this._applyFocus();
      else if (fl) { this._paintFlow(); this._drawEdges(); }
    },
    _openLitTrace() {
      const run = this._litRun, r = run && run.e && run.e.run;
      if (!r) return;
      this._drawerBack = this._drawer && this._drawer.mode === 'debug' ? 'debug' : 'runs';
      this._openDrawer(`/config/${r.domain}/trace/${encodeURIComponent(r.item_id)}?run_id=${encodeURIComponent(r.run_id)}`,
        T('trace', { boxName: this._boxName(run.e.key), extra: run.tr ? ' · ' + clock(run.tr.timestamp && run.tr.timestamp.start) : '' }), { back: true });
    },
    // a step you did, kept for a check; two clock moves in a row are one
    _sbxRec(step) {
      const g = this._sbx;
      if (!g || !g.rec) return;
      const last = g.rec.steps[g.rec.steps.length - 1];
      if (step.op === 'advance' && last && last.op === 'advance' && g.lastAdv === last) { last.ms += step.ms; return; }
      g.rec.steps.push(step);
      g.lastAdv = step.op === 'advance' ? step : null;
    },
    // what one thing you did came to, in a sentence: what it started, what it changed, what it left waiting
    _sbxSum(act) {
      const g = this._sbx, log = g.eng.log.filter((e) => e.id >= act.a && e.id <= act.b), nm = (k) => this._boxName(k);
      const started = [...new Set(log.filter((e) => e.kind === 'trigger').map((e) => e.key))];
      const changed = new Map();
      log.filter((e) => e.kind === 'state' && e.by !== 'you').forEach((e) => changed.set(e.key, e.to));
      const due = g.eng.pending().filter((x) => x.at > g.eng.now);
      const list = (xs, n) => xs.slice(0, n).join(', ') + (xs.length > n ? ' ' + T('sbx_sum_more', { n: xs.length - n }) : '');
      const parts = [];
      parts.push(started.length ? P('sbx_sum_started', started.length) + ': ' + list(started.map(nm), 3) : T('sbx_sum_none'));
      if (changed.size) parts.push(T('sbx_sum_changed', { what: list([...changed].map(([k, v]) => `${nm(k)} → ${v}`), 3) }));
      if (log.some((e) => e.kind === 'pause')) parts.push(T('sbx_sum_paused'));
      else if (due.length) parts.push(T('sbx_sum_next', { what: due[0].label, t: this._sbxWhen(due[0].at) }));
      return parts.join('; ') + '.';
    },
    // back to before one of your steps (0.11.2): a new engine from the same start, your steps before it done again
    // (answers you gave reused), the rest dropped
    async _sbxRewind(k) {
      const g = this._sbx;
      if (!g || g.busy) return;
      const steps = g.rec.steps.slice(0, Math.max(0, k)), answers = g.rec.answers.slice(), breaks = new Set(g.eng.breaks), stepping = g.eng.stepping;
      g.busy = true;
      g.speed = 0; this._clock.cancel('sbxplay');
      g.asks.forEach((a) => a.res(false)); g.asks = [];
      g.eng.stopAll(); g.eng.resumeAll();
      this._clearLit(true);
      this._renderSbx();
      g.pre = answers; g.rec.steps = []; g.rec.answers = []; g.acts = []; g.lastAdv = null; g.sel = null; g.hist = null;
      const eng = g.eng = new Sandbox(g.opts);
      eng.breaks = breaks;
      await eng.start();
      try {
        for (const st of steps) {
          const from = eng.seq, step0 = g.rec.steps.length;
          g.rec.steps.push(st);
          await sbxDoStep(eng, st);
          await eng.settle();
          if (eng.seq > from) { const act = { a: from + 1, b: eng.seq, step0 }; act.sum = this._sbxSum(act); g.acts.push(act); }
        }
      } finally { g.busy = false; }
      // how devices answer comes back with your steps (it's one of them); breakpoints and stepping stay as they were
      eng.stepping = stepping;
      if (this._sbx !== g) return;
      this._renderSbxCtl();
      this._renderSbx();
      this._refreshStates();
      this._toast(steps.length ? P('sbx_rewound', steps.length) : T('sbx_rewound_0'));
    },

};
