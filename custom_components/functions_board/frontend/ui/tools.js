import { FULL_ONLY_TEST, NO_MONITOR, OUTCOME, P, T, TEST_WARN, XW, clock, clockShort, esc, parseLoose, scalar, shorten, toList, whyStopped } from '../lib/index.js';

export const toolsPart = {
    /* ======================================================================================================
       part: tools: the developer tools on the board: test steps, monitors, watched triggers, the messages drawer Owns
       _pendingTest, _tw, _monSubs, _monData, _monCount, _monKind, _testLog, _testOk, _msgs (PARTS): only its own
       methods use them; the other parts ask its methods.
       ====================================================================================================== */
    // keep a box in place: Auto-arrange (and an import's) leaves it where it is
    _toggleKeep(key) {
      const m = this._model, n = m && m.nodes.get(key);
      if (!n) return;
      const label = m.label, L = this._layout(label), before = this._snap(label), keep = new Set(L.keep || []);
      if (keep.has(key)) keep.delete(key);
      else { keep.add(key); L.nodes[key] = { x: n.x, y: n.y }; }
      if (keep.size) L.keep = [...keep]; else delete L.keep;
      this._save();
      this._layoutStep(label, before, keep.has(key) ? T('keep_name_in_place', { name: n.name }) : T('let_auto_arrange_move_name', { name: n.name }));
      this._render();
    },

    /* ---------- developer tools on the board (Phase 9): tests, monitors, the function debugger ---------- */

    // ---- tests (9.2): a helper changes through its own actions; anything else gets a simulated state (Home
    // Assistant's copy only); an event is fired; an automation or script runs; a notification is sent.
    // Full manager only. The first test of a session asks first, and every test is written to the logbook.
    _canTest(n) {
      if (!n || n.kind === 'tool') return false;
      const k = n.key;
      if (/^(event|nact):/.test(k) || k.startsWith('svc:notify.')) return true;
      if (k.startsWith('mqtt:')) return !!this._hass.services.mqtt;
      return !k.includes(':') && !!this._hass.states[k];
    },
    async _testSpecs(n) {
      if (!this._canTest(n)) return [];
      const k = n.key, d = n.domain, st = this._hass.states[k], A = (st && st.attributes) || {};
      const act = (id, text, service, fields) => ({ id, text, kind: 'action', service, fields: fields || [] });
      if (k.startsWith('event:')) return [{ id: 'fire', text: T('fire_the_event'), kind: 'event', fields: [{ name: 'event_data', type: 'object', label: T('event_data'), value: this._prefill(n, 'event') }] }];
      if (k.startsWith('nact:')) return [{ id: 'press', text: T('press_the_button'), kind: 'event', fields: [] }];
      if (k.startsWith('mqtt:')) return [{ id: 'pub', text: T('publish_a_message'), kind: 'mqtt', fields: [{ name: 'payload', type: 'text', label: T('payload'), value: this._prefill(n, 'mqtt') }] }];
      if (k.startsWith('svc:notify.') || d === 'notify') return [{ id: 'notify', text: T('send_a_test_notification'), kind: 'notify', fields: [{ name: 'data', type: 'object', label: T('what_to_send'), value: this._prefill(n, 'notify') }] }];
      if (d === 'automation') return [{ id: 'run', text: T('run_it'), kind: 'run', fields: [{ name: 'check', type: 'bool', label: T('check_its_conditions_first'), value: true }] }];
      if (d === 'script') return [{ id: 'run', text: T('run_it'), kind: 'run', fields: await this._scriptFields(k) }];
      if (d === 'scene') return [act('on', T('activate'), 'scene.turn_on')];
      if (d === 'input_boolean') return [act('on', T('turn_on'), 'input_boolean.turn_on'), act('off', T('turn_off'), 'input_boolean.turn_off'), act('toggle', T('toggle'), 'input_boolean.toggle')];
      if (d === 'input_button') return [act('press', T('press_2'), 'input_button.press')];
      if (d === 'input_number') return [act('set', T('set_the_value'), 'input_number.set_value', [{ name: 'value', type: 'number', label: T('value'), value: st.state, min: A.min, max: A.max, step: A.step }])];
      if (d === 'input_text') return [act('set', T('set_the_text'), 'input_text.set_value', [{ name: 'value', type: 'text', label: T('text'), value: st.state }])];
      if (d === 'input_select') return [act('set', T('pick_an_option'), 'input_select.select_option', [{ name: 'option', type: 'select', label: T('option'), options: A.options || [], value: st.state }])];
      if (d === 'input_datetime') {
        const s = String(st.state), [dt, tm] = A.has_date && A.has_time ? s.split(' ') : A.has_date ? [s, ''] : ['', s];
        return [act('set', T('set_it'), 'input_datetime.set_datetime', (A.has_date ? [{ name: 'date', type: 'date', label: T('date'), value: dt }] : [])
          .concat(A.has_time ? [{ name: 'time', type: 'time', label: T('time'), value: tm }] : []))];
      }
      if (d === 'counter') {
        return [act('inc', T('increment'), 'counter.increment'), act('dec', T('decrement'), 'counter.decrement'), act('reset', T('reset'), 'counter.reset'),
          act('set', T('set_the_value'), 'counter.set_value', [{ name: 'value', type: 'number', label: T('value'), value: st.state, min: A.minimum, max: A.maximum, step: A.step || 1 }])];
      }
      if (d === 'timer') {
        return [act('start', T('start'), 'timer.start', [{ name: 'duration', type: 'text', label: T('duration_such_as_00_00'), value: '' }]),
          act('finish', T('finish_now'), 'timer.finish'), act('cancel', T('cancel'), 'timer.cancel'), act('pause', T('pause'), 'timer.pause')];
      }
      return [{ id: 'state', text: T('simulate_a_state'), kind: 'state', fields: [{ name: 'state', type: 'text', label: T('state'), value: st.state, options: this._stateHints(n) }] }];
    },
    async _testDialog(key, toolId) {
      if (!this._full()) { this._toast(FULL_ONLY_TEST); return; }
      const n = this._model && this._model.nodes.get(key);
      if (!n) { this._toast(T('what_this_test_changes_isn')); return; }
      const specs = await this._testSpecs(n);
      if (!specs.length) { this._toast(T('there_s_no_test_for', { name: n.name })); return; }
      const tool = toolId ? this._toolById(toolId) : null, prev = tool && tool.type === 'inject' ? tool.test : null;
      const pick = (prev && specs.find((s) => s.kind === prev.kind && (s.kind !== 'action' || s.service === prev.service))) || specs[0];
      this._tst = { key, specs, pick: pick.id, vals: prev ? this._valsOf(pick, prev) : {}, toolId: toolId || null };
      this._renderTestDlg();
    },
    _renderTestDlg() {
      const t = this._tst, n = t && this._model && this._model.nodes.get(t.key);
      if (!n) { this._closeModal(); return; }
      const spec = t.specs.find((s) => s.id === t.pick) || t.specs[0];
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg tdlg"><h3>${T('test_4', { name: esc(n.name) })}</h3>${t.specs.length > 1 ? `<div class="tchoice">${t.specs.map((s) => `<button class="chip ${s.id === spec.id ? 'on' : ''}" data-act="test-pick" data-id="${esc(s.id)}">${esc(s.text)}</button>`).join('')}</div>` : `<div class="tone">${esc(spec.text)}</div>`}${spec.fields.length ? `<div class="tfields">${spec.fields.map((f, i) => this._fieldHTML(f, i, t.vals)).join('')}</div>` : ''}<div class="hint twhat"></div>${this._testOk ? '' : `<div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${esc(TEST_WARN)}</span></div>`}${t.toolId ? '' : `<label class="chk"><input type="checkbox" name="keep">${T('keep_this_test_on_the')}</label>`}<div class="btns"><button data-act="modal-cancel">${T('cancel')}</button>${t.toolId ? `<button data-act="test-save">${T('save')}</button>` : ''}<button class="primary" data-act="test-run">${T('run_test')}</button></div></div>`;
      this._mountFields(spec);
      this._testWhat();
    },
    // Home Assistant's own editors for event data, notification data and script fields, once they are loaded
    _mountFields(spec) {
      const m = this._$.modal, t = this._tst;
      const want = spec.fields.map((f, i) => [f, i]).filter(([f]) => f.type === 'object' || f.type === 'selector');
      if (!want.length) return;
      this._ensureSelector().then((ok) => {
        if (!ok || this._tst !== t || t.pick !== spec.id) return;
        want.forEach(([f, i]) => {
          const box = m.querySelector(`.selbox[data-f="${i}"]`);
          if (!box) return;
          const el = document.createElement('ha-selector');
          el.hass = this._hass; el.selector = f.type === 'object' ? { object: {} } : f.selector; el.label = f.label; el.required = !!f.required;
          const v = f.name in t.vals ? t.vals[f.name] : f.value;
          if (v !== undefined) el.value = v;
          if (f.hint) el.helper = f.hint;
          el.addEventListener('value-changed', (e) => {
            e.stopPropagation();
            if (e.detail && e.detail.isValid === false) { t.bad = f.label; return; }
            t.bad = null; t.vals[f.name] = e.detail.value; el.value = e.detail.value; this._testWhat(); this._linkPreview();
          });
          box.innerHTML = ''; box.appendChild(el); box.dataset.mounted = '1';
        });
      });
    },
    _readFields(spec) {
      const m = this._$.modal, t = this._tst, out = {};
      spec.fields.forEach((f, i) => {
        const box = m.querySelector(`.selbox[data-f="${i}"]`);
        if (box && box.dataset.mounted) { if (f.name in t.vals) out[f.name] = t.vals[f.name]; else if (f.value !== undefined) out[f.name] = f.value; return; }
        const el = m.querySelector(`[name="tf${i}"]`);
        if (!el) return;
        if (f.type === 'bool') out[f.name] = el.checked;
        else if (f.type === 'number') out[f.name] = el.value === '' ? '' : +el.value;
        else if (f.type === 'object') out[f.name] = parseLoose(el.value);
        else if (f.type === 'selector') out[f.name] = el.value === '' ? '' : scalar(el.value);
        else out[f.name] = el.value;
      });
      return out;
    },
    _buildTest(spec, vals) {
      const k = this._tst.key, n = this._model.nodes.get(k);
      const keep = (x) => x !== '' && x != null && !(typeof x === 'number' && isNaN(x));
      switch (spec.kind) {
        case 'action': {
          const data = {};
          spec.fields.forEach((f) => { if (keep(vals[f.name])) data[f.name] = vals[f.name]; });
          return { kind: 'action', target: k, service: spec.service, data };
        }
        case 'state': return { kind: 'state', target: k, state: String(vals.state == null ? '' : vals.state).trim() };
        case 'event': return k.startsWith('nact:') ? Object.assign({ kind: 'event', target: k }, this._buttonEvent(n))
          : { kind: 'event', target: k, event_type: k.slice(6), event_data: vals.event_data && typeof vals.event_data === 'object' ? vals.event_data : {} };
        case 'mqtt': return { kind: 'mqtt', target: k, topic: k.slice(5), payload: String(vals.payload == null ? '' : vals.payload) };
        case 'notify': return { kind: 'notify', target: k, service: k.startsWith('svc:') ? k.slice(4) : 'notify.send_message', data: vals.data && typeof vals.data === 'object' ? vals.data : {} };
        case 'run': {
          if (n.domain === 'automation') return { kind: 'run', target: k, skip_condition: !vals.check };
          const variables = {};
          spec.fields.forEach((f) => { if (keep(vals[f.name])) variables[f.name] = vals[f.name]; });
          return { kind: 'run', target: k, variables };
        }
        default: return null;
      }
    },
    _testProblem(test, spec) {
      if (!test) return T('nothing_to_run');
      if (this._tst && this._tst.bad) return T('fix_first', { bad: this._tst.bad });
      if (test.kind === 'state' && !test.state) return T('enter_the_state_to_simulate');
      if (test.kind === 'action') {
        const f = spec.fields.find((x) => (x.name === 'value' || x.name === 'option') && !(x.name in test.data));
        if (f) return T('fill_in', { label: f.label });
        if (test.service === 'input_datetime.set_datetime' && !test.data.date && !test.data.time) return T('fill_in_the_date_or');
      }
      if (test.kind === 'run' && test.variables) { const f = spec.fields.find((x) => x.required && !(x.name in test.variables)); if (f) return T('fill_in', { label: f.label }); }
      if (test.kind === 'notify' && !(test.data && test.data.message)) return T('a_notification_needs_a_message');
      return null;
    },
    _testWhat() {
      const t = this._tst, el = this._$.modal.querySelector('.twhat');
      if (!t || !el) return;
      const spec = t.specs.find((s) => s.id === t.pick) || t.specs[0];
      let test = null;
      try { test = this._buildTest(spec, this._readFields(spec)); } catch (e) { el.textContent = String((e && e.message) || e); return; }
      const auto = test && test.kind === 'run' && test.target.startsWith('automation.');
      const extra = {
        action: T('a_real_change_whatever_reacts'),
        state: T('only_home_assistant_s_copy'),
        event: T('every_automation_waiting_for_this'),
        mqtt: T('publishes_it_to_the_broker'),
        notify: T('sends_it_for_real_templates'),
        run: auto ? (test.skip_condition ? T('runs_its_actions_straight_away') : T('checks_its_conditions_then_runs')) : T('runs_it_with_these_fields'),
      };
      el.textContent = (test ? this._describeTest(test) + '. ' : '') + (extra[spec.kind] || '');
    },
    async _testRunDlg(saveOnly) {
      const t = this._tst;
      if (!t) return;
      const spec = t.specs.find((s) => s.id === t.pick) || t.specs[0];
      let test, vals;
      try { vals = this._readFields(spec); test = this._buildTest(spec, vals); } catch (e) { this._toast(T('check_the_fields', { e: (e && e.message) || e })); return; }
      const bad = this._testProblem(test, spec);
      if (bad) { this._toast(bad); return; }
      const keep = !!(this._$.modal.querySelector('input[name="keep"]') || {}).checked;
      if (t.toolId) this._saveTool(t.toolId, test);
      else if (keep) this._keepTest(test);
      this._tst = null;
      this._closeModal();
      if (!saveOnly) await this._doTest(test);
    },
    async _execTest(t) {
      const id = t.target;
      const call = (svc, data, target) => { const i = svc.indexOf('.'); return this._svc(svc.slice(0, i), svc.slice(i + 1), data || {}, target); };
      switch (t.kind) {
        case 'action': return call(t.service, t.data, { entity_id: id });
        case 'state': {
          // Home Assistant's copy only: the next update from the device or its integration puts the real state back
          const st = this._hass.states[id];
          const r = await this._api('POST', 'states/' + id, { state: t.state, attributes: st ? st.attributes : {} });
          if (r && r.context && r.context.id) { this._sim.set(id, r.context.id); this._simAt.set(id, Date.parse(r.last_updated) || Date.now()); }
          this._refreshStates();
          return r;
        }
        case 'event': return this._ws({ type: 'fire_event', event_type: t.event_type, event_data: t.event_data || {} });
        case 'mqtt': return call('mqtt.publish', { topic: t.topic, payload: t.payload });
        case 'notify': return call(t.service, await this._fillTemplates(t.data || {}), id.includes(':') ? undefined : { entity_id: id });
        case 'run': return id.startsWith('automation.') ? call('automation.trigger', { skip_condition: !!t.skip_condition }, { entity_id: id })
          : call('script.turn_on', { variables: t.variables || {} }, { entity_id: id });
        default: throw new Error(T('unknown_test'));
      }
    },
    async _doTest(test) {
      if (this._sbxOn()) return this._sbxTest(test);
      if (!this._full()) { this._toast(FULL_ONLY_TEST); return false; }
      this._testOk = true;
      let err = null;
      try { await this._execTest(test); } catch (e) { err = (e && (e.message || e.code)) || String(e); }
      this._logTest(test, err);
      const text = this._describeTest(test);
      if (err) this._toast(T('test_failed', { text, err }));
      else this._toast(T('test_sent_tests_can_t', { text }), this._drawer && this._drawer.mode === 'debug' ? [] : [{ text: T('debug_2'), fn: () => this._openDebug() }]);
      return !err;
    },
    // this session's own test steps since a time (the debugger lists them)
    // the test dialog's fields: what the step will do, said again as they change (changed or typed into)
    _testChange(t) { if (this._tst && t.closest && t.closest('.tdlg')) { this._testWhat(); return true; } return false; },
    _testsSince(t) { return this._testLog.filter((x) => x.t > t); },
    _logTest(test, err) {
      const text = this._describeTest(test);
      const entry = { kind: 'test', t: Date.now(), key: test.target, text: T('test_3', { text, extra: err ? ` ${T('failed_2', { err })}` : '' }) };
      this._testLog.push(entry);
      if (this._testLog.length > 100) this._testLog.shift();
      this._dbgNote(Object.assign({}, entry));
      if (err || !this._hass.services.logbook || !this._hass.services.logbook.log) return;
      const ent = !String(test.target).includes(':') && this._hass.states[test.target] ? test.target : null;
      this._svc('logbook', 'log', Object.assign({ name: 'Functions Board', message: 'test: ' + text, domain: 'functions_board' }, ent ? { entity_id: ent } : {}), undefined, { fallback: null });
    },

    // ---- boxes that live in the layout, not in Home Assistant: kept tests (9.2) and monitors (9.3)
    _toolById(id) { const m = this._model, L = m && this._layout(m.label); return (L && (L.tools || []).find((t) => t.id === id)) || null; },
    _toolNodes(label, nodes, edges) {
      (this._layout(label).tools || []).forEach((t) => {
        const key = 'tool:' + t.id, inj = t.type === 'inject';
        nodes.set(key, { key, kind: 'tool', domain: inj ? 'inject' : 'monitor', tool: t, name: t.title || (inj ? T('test_2') : t.topic),
          icon: inj ? 'mdi:play-circle-outline' : 'mdi:monitor-eye', badges: new Set(), writers: 0, x: 0, y: 0, w: inj ? XW : 280, h: inj ? 48 : 176 });
        const tgt = inj ? t.test && t.test.target : t.target, mk = (from, to) => ({ id: from + '>' + to, from, to, role: 'tool', svcs: new Set(), tfs: [], anyTrig: false, via: null, loop: false });
        if (tgt && nodes.has(tgt)) edges.push(inj ? mk(key, tgt) : mk(tgt, key));
      });
    },
    _delTool(id) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.tools = (L.tools || []).filter((t) => t.id !== id);
      delete L.nodes['tool:' + id];
      this._stopMonitor(id); this._monData.delete(id);
      if (this._sel === 'tool:' + id) this._sel = null;
      this._save(); this._syncTools(); this._place(); this._render();
      this._layoutStep(label, before, T('remove_a_box'));
    },
    async _toolRun(id) {
      const t = this._toolById(id);
      if (!t || t.type !== 'inject') return;
      if (!this._full()) { this._toast(FULL_ONLY_TEST); return; }
      const k = t.test.target;
      if (!this._model.nodes.has(k) && !this._hass.states[k] && !/^(event|mqtt|nact|svc):/.test(k)) { this._toast(T('what_this_test_changes_is')); return; }
      const el = this._els.get('tool:' + id);
      if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
      if (!this._testOk) { this._confirmTest(t.test); return; }
      await this._doTest(t.test);
    },
    // the first test of a session, from a kept test button: say what tests do, once
    _confirmTest(test) {
      this._pendingTest = test;
      const m = this._$.modal;
      m.hidden = false;
      m.innerHTML = `<div class="dlg"><h3>${T('run_this_test_2')}</h3><div class="tone">${esc(this._describeTest(test))}</div><div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${esc(TEST_WARN)}</span></div><div class="hint">${T('the_board_asks_once_per')}</div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="test-confirm">${T('run_test')}</button></div></div>`;
    },
    _toolHTML(n) {
      const t = n.tool, pos = `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`;
      if (t.type === 'inject') {
        return `<div class="node tool t-inj" data-key="${esc(n.key)}" role="button" tabindex="-1" style="${pos}"><button class="tplay" data-act="tool-run" data-tid="${esc(t.id)}" title="${esc(this._full() ? T('run_this_test') : FULL_ONLY_TEST)}"><ha-icon icon="mdi:play"></ha-icon></button>`
          + `<div class="txt"><div class="name">${esc(n.name)}</div><div class="sub"></div></div></div>`;
      }
      return `<div class="node tool t-mon" data-key="${esc(n.key)}" role="button" tabindex="-1" style="${pos}"><div class="mhead"><ha-icon icon="mdi:monitor-eye"></ha-icon><span class="name">${esc(n.name)}</span><span class="mcnt"></span></div>`
        + `<div class="mlist" data-tid="${esc(t.id)}"></div></div>`;
    },

    // ---- monitors (9.3): a box that lists the last 10 events of one type, or MQTT messages, while its function is open
    _monitorFor(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      let spec;
      if (key.startsWith('mqtt:')) {
        if (!(this._hass.config.components || []).includes('mqtt')) { this._toast(T('mqtt_isn_t_set_up')); return; }
        spec = { what: 'mqtt', topic: key.slice(5), title: T('mqtt_3', { key: key.slice(5) }) };
      } else if (key.startsWith('nact:')) {
        const b = this._buttonEvent(n);
        spec = { what: 'event', topic: b.event_type, title: T('button_presses', { event_type: b.event_type }) };
      } else spec = { what: 'event', topic: key.slice(6), title: T('events_2', { key: key.slice(6) }) };
      this._addMonitor(Object.assign(spec, { target: key }));
    },
    async _monitorDlg() {
      if (!this._model) return;
      const m = this._$.modal, mq = (this._hass.config.components || []).includes('mqtt');
      this._monKind = 'event';
      m.hidden = false;
      m.innerHTML = `<div class="dlg mdlg"><h3>${T('monitor_box')}</h3><div class="hint">${T('a_box_on_the_board', { extra: mq ? T('or_the_last_10_messages') : '' })}</div>${mq ? `<div class="tchoice"><button class="chip on" data-act="mon-kind" data-k="event">${T('event_type')}</button><button class="chip" data-act="mon-kind" data-k="mqtt">${T('mqtt_topic')}</button></div>` : ''}<label><span class="mlab">${T('event_type')}</span><input name="topic" list="fbevtypes" placeholder="mobile_app_notification_action"><datalist id="fbevtypes"></datalist></label><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button class="primary" data-act="mon-make">${T('add')}</button></div></div>`;
      this._clock.after('focus', 50, () => { const i = m.querySelector('input[name=topic]'); if (i) i.focus(); });
      const types = await this._api('GET', 'events', undefined, { fallback: [] });
      const dl = m.querySelector('#fbevtypes');
      if (dl) dl.innerHTML = (types || []).map((x) => x && x.event).filter((x) => x && !NO_MONITOR.has(x)).sort().map((x) => `<option value="${esc(x)}">`).join('');
    },
    _monitorMake() {
      const m = this._$.modal, i = m.querySelector('input[name=topic]'), topic = ((i && i.value) || '').trim();
      if (!topic) { if (i) i.focus(); return; }
      if (this._monKind === 'event' && !/^[A-Za-z0-9_.:-]+$/.test(topic)) { this._toast(T('an_event_type_has_no')); return; }
      if (this._monKind === 'event' && NO_MONITOR.has(topic)) { this._toast(T('fires_too_often_for_a', { topic })); return; }
      this._closeModal();
      this._addMonitor({ what: this._monKind, topic });
    },
    // listen for the open function's monitor boxes; stop the ones that are gone
    _startMonitors() {
      const m = this._model, want = new Map();
      if (m) m.nodes.forEach((n) => { if (n.kind === 'tool' && n.tool.type === 'monitor') want.set(n.tool.id, n.tool); });
      [...this._monSubs.keys()].forEach((id) => { const t = want.get(id); if (!t || this._monSubs.get(id).sig !== t.what + '|' + t.topic) this._stopMonitor(id); });
      want.forEach((t, id) => {
        if (this._monSubs.has(id)) return;
        const c = this._haConn, s = { sig: t.what + '|' + t.topic, p: null };
        this._monSubs.set(id, s);
        s.p = t.what === 'mqtt'
          ? c.subscribeMessage((msg) => this._monAdd(id, { t: Date.now(), text: String(msg && msg.payload), full: msg }), { type: 'mqtt/subscribe', topic: t.topic })
          : c.subscribeEvents((ev) => this._monAdd(id, { t: Date.parse(ev.time_fired) || Date.now(), text: JSON.stringify(ev.data || {}), full: ev.data }), t.topic);
        s.p.catch((e) => { if (this._monSubs.get(id) === s) this._monAdd(id, { t: Date.now(), err: (e && (e.message || e.code)) || 'error' }); });
      });
      this._renderMons();
    },
    _stopMonitor(id) { const s = this._monSubs.get(id); this._monSubs.delete(id); if (s && s.p) this._ha.drop(s.p); },
    _stopMonitors() { [...this._monSubs.keys()].forEach((id) => this._stopMonitor(id)); },
    _monAdd(id, item) {
      const list = this._monData.get(id) || [];
      list.unshift(item);
      this._monData.set(id, list.slice(0, 10));
      if (!item.err) this._monCount.set(id, (this._monCount.get(id) || 0) + 1);
      this._clock.once('mon:' + id, 250, () => this._renderMon(id));
      const el = this._els.get('tool:' + id);
      if (el && !item.err) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
    },
    _renderMons() { if (this._model) this._model.nodes.forEach((n) => { if (n.kind === 'tool' && n.tool.type === 'monitor') this._renderMon(n.tool.id); }); },
    _renderMon(id) {
      const box = this._$.nodes.querySelector(`.mlist[data-tid="${CSS.escape(id)}"]`);
      if (!box) return;
      const list = this._monData.get(id) || [], n = this._monCount.get(id) || 0;
      box.innerHTML = list.length ? list.map((x) => `<div class="mrow${x.err ? ' err' : ''}" title="${esc(shorten(x.err || JSON.stringify(x.full, null, 1) || '', 1200))}"><span class="mt">${esc(clockShort(x.t))}</span><span class="mv">${esc(x.err ? T('can_t_listen', { err: x.err }) : x.text)}</span></div>`).join('')
        : `<div class="mrow muted">${this._monSubs.has(id) ? T('listening_nothing_yet') : T('not_listening')}</div>`;
      const c = box.parentElement && box.parentElement.querySelector('.mcnt');
      if (c) c.textContent = n ? String(n) : '';
    },

    // ---- watch triggers (9.3): arm an automation's triggers without running it; its trigger arrows pulse when one
    // would fire, even while it is off. Pause plus Watch is a dry run.
    async _toggleWatch(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      if (this._tw.has(key)) { this._stopWatch(key); this._toast(T('stopped_watching', { name: n.name })); this._refreshStates(); this._renderNodebar(); return; }
      const cfg = await this._fetchConfig(key), trig = cfg && (cfg.triggers != null ? cfg.triggers : cfg.trigger);
      if (!trig || !toList(trig).length) { this._toast(T('has_no_triggers_to_watch', { name: n.name })); return; }
      const w = { label: this._model.label, hits: 0, unsub: null };
      this._tw.set(key, w);
      try {
        w.unsub = await this._haConn.subscribeMessage((msg) => this._onWatch(key, msg), { type: 'subscribe_trigger', trigger: trig, variables: {} });
      } catch (e) {
        if (this._tw.get(key) === w) this._tw.delete(key);
        this._toast(T('could_not_watch_its_triggers', { e: (e && (e.message || e.code)) || e }));
        this._refreshStates(); this._renderNodebar();
        return;
      }
      if (this._tw.get(key) !== w) { try { w.unsub(); } catch (e) { /* gone */ } return; }
      const st = this._hass.states[key];
      this._toast(T('watching_its_trigger_arrows_pulse', { name: n.name, extra: st && st.state === 'on' ? T('pause_the_function_too_for') : '' }));
      this._refreshStates(); this._renderNodebar();
    },
    _onWatch(key, msg) {
      const w = this._tw.get(key), m = this._model;
      if (!w) return;
      w.hits++;
      const tr = (msg && msg.variables && msg.variables.trigger) || {}, idx = tr.idx != null ? +tr.idx : -1;
      if (m && m.label === w.label) {
        m.edges.filter((e) => e.to === key && e.role !== 'tool' && (e.trigs || []).some((t) => t.i === idx)).forEach((e) => this._liveE.set(e.id, Date.now() + 2500));
        const el = this._els.get(key);
        if (el) { el.classList.remove('wpulse'); void el.offsetWidth; el.classList.add('wpulse'); }
        this._drawEdges();
        this._clock.after('live', 2600, () => this._drawEdges());
        this._refreshStates();
      }
      const n = m && m.nodes.get(key);
      this._dbgNote({ kind: 'watch', t: Date.now(), key, text: T('trigger_would_fire', { name: n ? n.name : key, n: idx + 1, extra: tr.description ? ' (' + tr.description + ')' : '' }), by: { kind: 'watch', text: T('watch_triggers') } }, true);
    },
    // a trigger watch on this box, if any ({ hits, label … })
    _watching(key) { return this._tw.get(key) || null; },
    _stopWatch(key) { const w = this._tw.get(key); this._tw.delete(key); if (w && w.unsub) { try { w.unsub(); } catch (e) { /* gone */ } } },
    _stopWatches(keepLabel) { [...this._tw.entries()].forEach(([k, w]) => { if (!keepLabel || w.label !== keepLabel) this._stopWatch(k); }); },

    // ---- live checks (9.3): each check arrow shows whether its condition passes right now
    _testCondsSoon(ms) { this._clock.after('conds', ms == null ? 400 : ms, () => this._testConds()); },
    async _testConds() {
      const m = this._model;
      if (!m || this._data.ui.condres === false || this._sbxOn()) { if (this._cond.size) { this._cond = new Map(); this._drawEdges(); } this._condKeys = null; return; }
      const E = m.edges.filter((e) => e.conds && e.conds.length);
      this._condKeys = new Set(E.map((e) => e.from).filter((k) => !k.includes(':')));
      if (!E.length) { if (this._cond.size) { this._cond = new Map(); this._drawEdges(); } return; }
      const memo = new Map(), bad = this._condBad || (this._condBad = new Map());
      const test = (c) => {
        if (c && typeof c === 'object' && c.enabled === false) return Promise.resolve({ off: true });
        const j = JSON.stringify(c);
        // one Home Assistant couldn't read is not asked again this session (it logs each refused message)
        if (bad.has(j)) return Promise.resolve({ err: bad.get(j) });
        if (!memo.has(j)) {
          memo.set(j, this._ws({ type: 'test_condition', condition: c }).then((r) => ({ ok: !!(r && r.result) }), (e) => {
            const err = (e && (e.message || e.code)) || 'error';
            if (e && (e.code === 'invalid_format' || e.code === 'unknown_error')) bad.set(j, err);
            return { err };
          }));
        }
        return memo.get(j);
      };
      const out = new Map();
      await Promise.all(E.map(async (e) => {
        const res = await Promise.all(e.conds.map((x) => test(x.c)));
        const items = e.conds.map((x, i) => Object.assign({ i: x.i }, res[i])), live = items.filter((x) => !x.off);
        const ok = live.some((x) => x.ok === false) ? false : live.length && live.every((x) => x.ok === true) ? true : null;
        out.set(e.id, { ok, items });
      }));
      if (m !== this._model) return;
      const sig = (mp) => JSON.stringify([...mp].map(([k, v]) => [k, v.ok, v.items.map((x) => (x.off ? 'off' : x.err ? 'err' : x.ok))]));
      const changed = sig(out) !== sig(this._cond);
      this._cond = out;
      if (changed) this._drawEdges();
    },
    _condTitle(e, c) {
      const a = this._model.nodes.get(e.from), b = this._model.nodes.get(e.to);
      return T('checks_2', { name: b.name, name2: a.name }) + c.items.map((x) => {
        const where = x.i >= 0 ? T('condition', { n: x.i + 1 }) : T('a_check_among_its_actions');
        if (x.off) return T('turned_off', { where });
        if (x.err) return T('can_t_be_checked_now', { where, err: /trigger|this\b/.test(x.err) ? T('it_uses_the_data_of') : x.err });
        return T('right_now', { where, extra: x.ok ? 'passes' : 'fails' });
      }).join('\n');
    },
    // "why did or didn't it run?": the selected automation's recent attempts, from its traces
    async _renderWhy() {
      const d = this._$.drawer, box = d && d.querySelector('.dwhy');
      if (!box || !this._drawer || this._drawer.mode !== 'debug') return;
      const k = this._sel, n = k && this._model && this._model.nodes.get(k);
      const id = n && n.domain === 'automation' && n.kind !== 'tool' ? this._itemId(n) : null;
      if (!id) { box.hidden = true; return; }
      box.hidden = false;
      const tok = this._whyTok = (this._whyTok || 0) + 1;
      this._put(box, `<div class="wh"><b>${esc(n.name)}</b>${T('why_did_or_didn_t')}</div><div class="muted small">${T('reading_its_traces')}</div>`);
      const list = await this._ws({ type: 'trace/list', domain: 'automation', item_id: id }, { optional: 'an automation without an id keeps no traces', fallback: [] });
      if (tok !== this._whyTok) return;
      const recent = (list || []).slice().sort((a, b) => Date.parse(b.timestamp.start) - Date.parse(a.timestamp.start)).slice(0, 5);
      const rows = await Promise.all(recent.map(async (r) => {
        if (!(r.not_triggered || r.script_execution === 'failed_conditions' || r.error || r.script_execution === 'error')) return { r, why: '' };
        const tr = await this._ws({ type: 'trace/get', domain: 'automation', item_id: id, run_id: r.run_id }, { optional: 'a trace can be gone: Home Assistant keeps only the last few runs', fallback: null });
        return { r, why: tr ? whyStopped(tr, (x) => this._nameOf(x)) : '' };
      }));
      if (tok !== this._whyTok) return;
      const st = this._hass.states[k];
      this._put(box, `<div class="wh"><b>${esc(n.name)}</b>${T('why_did_or_didn_t')}</div>${st && st.state === 'off' ? `<div class="wwarn">${T('it_is_turned_off_nothing')}</div>` : ''}${this._tw.has(k) ? `<div class="muted small">${T('watching_its_triggers_so_far', { hits: P('n_would_be_runs', this._tw.get(k).hits) })}</div>` : ''}${rows.length ? rows.map(({ r, why }) => {
          const o = r.not_triggered ? { text: T('didn_t_fire'), cls: 'muted' } : OUTCOME(r);
          return `<button class="wrow ${o.cls}" data-act="why-run" data-rid="${esc(r.run_id)}" data-item="${esc(id)}" data-key="${esc(k)}"><span class="rt">${esc(clock(r.timestamp && r.timestamp.start))}</span>`
            + `<span class="dm"><b>${esc(o.text)}</b><span>${esc((r.trigger ? T('triggered_by', { trigger: r.trigger }) : '') + (why ? ' · ' + why : ''))}</span></span></button>`;
        }).join('') : `<div class="muted small">${T('no_attempts_stored_home_assistant')}</div>`}`);
    },

    // ---- notifications (9.5): what a notify box sent lately, from the traces of what sends it
    async _openMessages(key) {
      const m = this._model, n = m && m.nodes.get(key);
      if (!n) return;
      this._leaveDrawerMode();
      this._capture = null;
      this._drawer = { mode: 'msgs', key };
      const d = this._$.drawer;
      d.hidden = false;
      this._put(d, `<div class="dhead"><span class="dtitle">${T('last_messages', { name: esc(n.name) })}</span><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="runs msgs"><div class="muted pad">${T('reading_traces')}</div></div>`);
      this._fitLitbar();
      const callers = [...new Set(m.edges.filter((e) => e.to === key && e.role === 'action' && /^(automation|script)\./.test(e.from)).map((e) => e.from))];
      const mine = (p) => (key.startsWith('svc:') ? p.domain + '.' + p.service === key.slice(4)
        : p.domain === 'notify' && toList((p.target || {}).entity_id).concat(toList((p.service_data || {}).entity_id)).includes(key));
      const out = [];
      await Promise.all(callers.map(async (c) => {
        const cn = m.nodes.get(c), id = cn && this._itemId(cn);
        if (!id) return;
        const list = await this._ws({ type: 'trace/list', domain: cn.domain, item_id: id }, { optional: 'an automation without an id keeps no traces', fallback: [] });
        const recent = (list || []).filter((r) => r.state === 'stopped').sort((a, b) => Date.parse(b.timestamp.start) - Date.parse(a.timestamp.start)).slice(0, 8);
        await Promise.all(recent.map(async (r) => {
          const tr = await this._ws({ type: 'trace/get', domain: cn.domain, item_id: id, run_id: r.run_id }, { optional: 'a trace can be gone: Home Assistant keeps only the last few runs', fallback: null });
          Object.values((tr && tr.trace) || {}).forEach((els) => (els || []).forEach((el) => {
            const p = el && el.result && el.result.params;
            if (p && mine(p)) out.push({ t: Date.parse(el.timestamp) || Date.parse(r.timestamp.start) || 0, from: c, data: p.service_data || {}, run: { domain: cn.domain, item_id: id, run_id: r.run_id } });
          }));
        }));
      }));
      if (!this._drawer || this._drawer.mode !== 'msgs' || this._drawer.key !== key) return;
      out.sort((a, b) => b.t - a.t);
      this._msgs = out;
      const box = d.querySelector('.msgs');
      if (!box) return;
      this._put(box, out.length ? `<div class="muted pad small">${T('what_this_sent_lately_newest')}</div>${out.slice(0, 40).map((x, i) => {
          const dd = x.data || {}, btns = dd.data && Array.isArray(dd.data.actions) ? dd.data.actions.map((a) => a && a.title).filter(Boolean) : [];
          return `<button class="run msg" data-act="msg-run" data-i="${i}" data-key="${esc(x.from)}"><span class="rt">${esc(clock(new Date(x.t).toISOString()))}</span>`
            + `<span class="rn"><b>${esc(dd.title || T('no_title'))}</b><span>${esc(shorten(dd.message == null ? '' : typeof dd.message === 'object' ? JSON.stringify(dd.message) : dd.message, 300))}</span>${btns.length ? `<span class="mb">${T('buttons', { btns: esc(btns.join(', ')) })}</span>` : ''}</span>`
            + `<span class="ro">${esc(this._boxName(x.from))}</span></button>`;
        }).join('')}`
        : `<div class="muted pad">${T('nothing_found_home_assistant_keeps')}</div>`);
    },
    // the drawer: a labelled region beside the board; focus moves into it when it opens, back when it closes
    _watchDrawer() {
      const d = this._$.drawer;
      d.setAttribute('role', 'complementary');
      new MutationObserver(() => {
        const open = !d.hidden && !!d.firstElementChild, t = d.querySelector('.dtitle');
        if (t && d.getAttribute('aria-label') !== t.textContent) d.setAttribute('aria-label', t.textContent);
        if (open && !this._drawerOpen) {
          this._drawerOpen = true;
          const a = this.shadowRoot.activeElement;
          this._drawerFocusBack = a && !d.contains(a) ? a : null;
          this._clock.after('drawer-focus', 0, () => {
            if (d.hidden || !this._$.modal.hidden || d.contains(this.shadowRoot.activeElement)) return;
            const h = d.querySelector('.dtitle');
            if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
          });
        } else if (!open && this._drawerOpen) {
          this._drawerOpen = false;
          const back = this._drawerFocusBack && this._drawerFocusBack.isConnected ? this._drawerFocusBack : null, box = this._roveKey && this._els && this._els.get(this._roveKey);
          this._drawerFocusBack = null;
          const a = this.shadowRoot.activeElement;
          if (!a || a === d || d.contains(a) || a === this.shadowRoot.host) { if (back) back.focus({ preventScroll: true }); else if (box) box.focus({ preventScroll: true }); }
        }
      }).observe(d, { attributes: true, attributeFilter: ['hidden'], childList: true });
    },
    // dialogs: named, focus moves in and stays in, and goes back where it was when they close
    _watchModal() {
      const md = this._$.modal;
      new MutationObserver(() => {
        const open = !md.hidden && !!md.firstElementChild;
        const dlg = md.querySelector('.dlg');
        if (dlg && !dlg.hasAttribute('role')) {
          dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
          const h = dlg.querySelector('h3');
          if (h) { h.id = 'fbdlgtitle'; dlg.setAttribute('aria-labelledby', 'fbdlgtitle'); }
        }
        if (open && !this._modalOpen) {
          this._modalOpen = true;
          this._modalBack = this.shadowRoot.activeElement;
          this._clock.after('modal-focus', 60, () => { if (md.hidden) return; const f = md.querySelector('input:not([type=hidden]):not([disabled]), textarea, select, button.primary:not([disabled])') || md.querySelector('button'); if (f && !md.contains(this.shadowRoot.activeElement)) f.focus(); });
        } else if (!open && this._modalOpen) {
          this._modalOpen = false;
          const back = this._modalBack && this._modalBack.isConnected ? this._modalBack : null, box = this._roveKey && this._els.get(this._roveKey);
          this._modalBack = null;
          if (back) back.focus(); else if (box) box.focus();
        }
      }).observe(md, { attributes: true, attributeFilter: ['hidden'], childList: true });
      md.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || md.hidden) return;
        const list = [...md.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"], ha-selector')].filter((x) => x.offsetParent !== null);
        if (!list.length) return;
        const cur = this.shadowRoot.activeElement, i = list.indexOf(cur);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); list[list.length - 1].focus(); }
        else if (!e.shiftKey && (i === list.length - 1 || i < 0)) { e.preventDefault(); list[0].focus(); }
      });
    },

};
