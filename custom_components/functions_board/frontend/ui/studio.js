import { ENTITY_RE, EXACT_RE, JINJA_GLOSSARY, P, SBX_PRELUDE, SBX_RAW, T, TPL_GOAL_TREE, TPL_RECIPES, TPL_RECIPE_KINDS, buildExplainProbe, cleanTplRecipe, esc, explainTemplate, extractTemplatesFromConfig, generateTplRecipe, sbxRewrite, shorten, slugify, suggestStatesForEntities, toList, tplSame } from '../lib/index.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BINARY_CLASSES = ['', 'door', 'window', 'opening', 'garage_door', 'motion', 'occupancy', 'presence', 'light', 'lock', 'moisture', 'problem', 'running', 'safety', 'smoke'];
const SENSOR_CLASSES = ['', 'timestamp', 'temperature', 'humidity', 'power', 'energy', 'battery', 'duration', 'monetary', 'illuminance', 'pressure', 'voltage', 'current', 'signal_strength'];
const ATTR_LOW_PRI = new Set(['friendly_name', 'icon', 'supported_features', 'supported_color_modes', 'entity_picture', 'attribution', 'restored', 'device_class', 'state_class', 'unit_of_measurement']);

const tplMeta = () => [
  ['tpl_count', T('ts_r_count'), T('ts_r_count_d'), 'mdi:counter', 'sensor', T('ts_ex_count')],
  ['tpl_any_all', T('ts_r_any_all'), T('ts_r_any_all_d'), 'mdi:checkbox-multiple-marked-outline', 'binary_sensor', T('ts_ex_any_all')],
  ['tpl_logic', T('ts_r_logic'), T('ts_r_logic_d'), 'mdi:source-branch', 'binary_sensor', T('ts_ex_logic')],
  ['tpl_compare', T('ts_r_compare'), T('ts_r_compare_d'), 'mdi:scale-balance', 'binary_sensor', T('ts_ex_compare')],
  ['tpl_sun_offset', T('ts_r_sun_offset'), T('ts_r_sun_offset_d'), 'mdi:weather-sunset', 'sensor', T('ts_ex_sun_offset')],
  ['tpl_countdown', T('ts_r_countdown'), T('ts_r_countdown_d'), 'mdi:calendar-clock', 'sensor', T('ts_ex_countdown')],
  ['tpl_duration', T('ts_r_duration'), T('ts_r_duration_d'), 'mdi:timer-sand', 'sensor', T('ts_ex_duration')],
  ['tpl_time_window', T('ts_r_time_window'), T('ts_r_time_window_d'), 'mdi:clock-check-outline', 'binary_sensor', T('ts_ex_time_window')],
  ['tpl_attribute', T('ts_r_attribute'), T('ts_r_attribute_d'), 'mdi:tag-text-outline', 'sensor', T('ts_ex_attribute')],
  ['tpl_map_state', T('ts_r_map_state'), T('ts_r_map_state_d'), 'mdi:translate', 'sensor', T('ts_ex_map_state')],
  ['tpl_scale', T('ts_r_scale'), T('ts_r_scale_d'), 'mdi:tune-vertical', 'sensor', T('ts_ex_scale')],
  ['tpl_list_names', T('ts_r_list_names'), T('ts_r_list_names_d'), 'mdi:format-list-text', 'sensor', T('ts_ex_list_names')],
  ['tpl_fallback', T('ts_r_fallback'), T('ts_r_fallback_d'), 'mdi:backup-restore', 'sensor', T('ts_ex_fallback')],
  ['tpl_low_battery', T('ts_r_low_battery'), T('ts_r_low_battery_d'), 'mdi:battery-alert-variant-outline', 'sensor', T('ts_ex_low_battery')],
  ['tpl_band', T('ts_r_band'), T('ts_r_band_d'), 'mdi:gauge', 'sensor', T('ts_ex_band')],
  ['tpl_math', T('ts_r_math'), T('ts_r_math_d'), 'mdi:calculator-variant-outline', 'sensor', T('ts_ex_math')],
  ['tpl_message', T('ts_r_message'), T('ts_r_message_d'), 'mdi:text-box-outline', 'sensor', T('ts_ex_message')],
];

const goalMeta = () => [
  { id: 'bool', icon: 'mdi:toggle-switch-outline', title: T('ts_g_bool'), desc: T('ts_g_bool_d'), ex: T('ts_g_bool_ex') },
  { id: 'number', icon: 'mdi:numeric', title: T('ts_g_num'), desc: T('ts_g_num_d'), ex: T('ts_g_num_ex') },
  { id: 'time', icon: 'mdi:clock-outline', title: T('ts_g_time'), desc: T('ts_g_time_d'), ex: T('ts_g_time_ex') },
  { id: 'text', icon: 'mdi:card-text-outline', title: T('ts_g_text'), desc: T('ts_g_text_d'), ex: T('ts_g_text_ex') },
  { id: 'explain', icon: 'mdi:school-outline', title: T('ts_g_explain'), desc: T('ts_g_explain_d'), ex: T('ts_g_explain_ex') },
];

const helperCats = () => [
  ['all', T('all')],
  ['read', T('ts_hc_read')],
  ['numbers', T('ts_hc_numbers')],
  ['lists', T('ts_hc_lists')],
  ['logic', T('ts_hc_logic')],
  ['time', T('ts_hc_time')],
];

export const studioPart = {
    /* ======================================================================================================
       part: studio: Template Studio (0.15.0): big-picture-to-small-picture goal wizard, interactive Jinja
       helper guide, plain-English walkthrough with live values, unavailable-trap linter, inline simulator,
       sandbox testing, and standard HA Template helper creation. Owns _stu (PARTS).
       ====================================================================================================== */

    _tsOpen(opt = {}) {
      this._closeMenu();
      const label = this._data && this._data.ui.current;
      // Default to the Big-Picture Goal Wizard unless a specific mode or recipe was requested
      const mode = opt.mode || (opt.kind ? 'recipe' : 'wizard');
      const kind = opt.kind && TPL_RECIPES[opt.kind] ? opt.kind : 'tpl_count';
      const spec = opt.spec ? cleanTplRecipe(kind, opt.spec) : TPL_RECIPES[kind].defaultSpec();
      const gen = mode === 'recipe' ? generateTplRecipe(kind, spec) : null;
      const goalOf = (k) => (TPL_GOAL_TREE.find((x) => x.kinds.includes(k)) || {}).id || null;
      this._stu = {
        label,
        mode,
        goal: opt.goal || (mode === 'recipe' ? goalOf(kind) : null),
        kind,
        spec,
        name: opt.name || '',
        entityId: opt.entityId || null,
        entryId: opt.entryId || null,
        domain: opt.domain || (gen ? gen.domain : 'sensor'),
        template: opt.template != null ? opt.template : (gen ? gen.state : ''),
        availability: opt.availability != null ? opt.availability : (gen ? gen.availability : ''),
        unit: opt.unit != null ? opt.unit : (gen ? gen.unit : ''),
        device_class: opt.device_class != null ? opt.device_class : (gen ? gen.device_class : ''),
        state_class: opt.state_class != null ? opt.state_class : (gen ? gen.state_class : ''),
        _genUnit: gen ? gen.unit : '',
        _genDc: gen ? gen.device_class : '',
        _genSc: gen ? gen.state_class : '',
        sources: opt.sources || null,
        srcIdx: 0,
        entFilter: '',
        helpCat: 'all',
        helpKey: 'states',
        helpEnt: '',
        helpQ: '',
        activeConcept: null,
        sim: {},
        simTime: '',
        evalSeq: 0,
        live: null,
      };
      this._tsShow();
      this._tsEvalSoon(true);
    },

    async _tsInspect(key) {
      const m = this._model, n = m && m.nodes.get(key);
      if (!n) return;
      const reg = this._entMap.get(key);
      if ((reg && reg.platform === 'template') || /^(sensor|binary_sensor)\./.test(key)) {
        const res = await this._ws({ type: 'functions_board/sources', entity_ids: [key], include_templates: true }, { optional: 'older integrations do not expose template source text', fallback: null });
        const info = res && res.sources && res.sources[key];
        const tpls = info && info.templates;
        const ruleState = info && info.rule && info.rule.kind === 'template' ? info.rule.state : null;
        const stateTpl = (tpls && tpls.state) || ruleState || '';
        const availTpl = (tpls && tpls.availability) || (info && info.rule && info.rule.availability) || '';
        if (!stateTpl && !tpls) { this._toast(T('ts_no_tpl_found', { name: n.name })); return; }
        const saved = this._bldEntry(key);
        if (saved && TPL_RECIPE_KINDS.has(saved.kind) && tplSame(stateTpl, saved.kind, saved.spec)) {
          const st = this._hass.states[key], attrs = (st && st.attributes) || {};
          this._tsOpen({
            mode: 'recipe', kind: saved.kind, spec: JSON.parse(JSON.stringify(saved.spec)),
            name: n.name, entityId: key, entryId: (tpls && tpls.entry_id) || (reg && reg.config_entry_id) || null,
            domain: n.domain, unit: attrs.unit_of_measurement || '', device_class: attrs.device_class || '', state_class: attrs.state_class || '',
          });
          return;
        }
        const sources = [];
        if (stateTpl) sources.push({ place: T('ts_src_state'), template: stateTpl, avail: availTpl });
        if (availTpl) sources.push({ place: T('ts_src_avail'), template: availTpl, avail: '' });
        if (tpls && tpls.icon) sources.push({ place: T('ts_src_icon'), template: tpls.icon, avail: '' });
        if (tpls && tpls.attributes) Object.entries(tpls.attributes).forEach(([ak, av]) => sources.push({ place: T('ts_src_attr', { attr: ak }), template: av, avail: '' }));
        const st = this._hass.states[key], attrs = (st && st.attributes) || {};
        this._tsOpen({
          mode: 'explain', name: n.name, entityId: key, entryId: (tpls && tpls.entry_id) || (reg && reg.config_entry_id) || null,
          domain: n.domain === 'binary_sensor' ? 'binary_sensor' : 'sensor',
          template: sources[0] ? sources[0].template : '', availability: sources[0] ? sources[0].avail : '',
          unit: attrs.unit_of_measurement || '', device_class: attrs.device_class || '', state_class: attrs.state_class || '',
          sources,
        });
        return;
      }
      if (n.domain === 'automation' || n.domain === 'script') {
        const cfg = await this._fetchConfig(key);
        const found = extractTemplatesFromConfig(cfg);
        if (!found.length) { this._toast(T('ts_no_tpl_in_item', { name: n.name })); return; }
        this._tsOpen({
          mode: 'explain', name: n.name, entityId: key, entryId: null,
          domain: 'sensor', template: found[0].template, availability: '', sources: found,
        });
      }
    },

    async _tsEditRecipe(n, entry) {
      const reg = this._entMap.get(n.key);
      const res = await this._ws({ type: 'functions_board/sources', entity_ids: [n.key], include_templates: true }, { optional: 'older integrations do not expose template source text', fallback: null });
      const info = res && res.sources && res.sources[n.key];
      const liveTpl = (info && info.templates && info.templates.state) || (info && info.rule && info.rule.state) || '';
      if (!liveTpl || !tplSame(liveTpl, entry.kind, entry.spec)) {
        this._toast(T('ts_by_hand'));
        if (liveTpl) { this._tsInspect(n.key); return; }
        this._openItem(n, true);
        return;
      }
      const st = this._hass.states[n.key], attrs = (st && st.attributes) || {};
      this._tsOpen({
        mode: 'recipe', kind: entry.kind, spec: JSON.parse(JSON.stringify(entry.spec)),
        name: n.name, entityId: n.key, entryId: (info && info.templates && info.templates.entry_id) || (reg && reg.config_entry_id) || null,
        domain: n.domain === 'binary_sensor' ? 'binary_sensor' : 'sensor',
        unit: attrs.unit_of_measurement || '', device_class: attrs.device_class || '', state_class: attrs.state_class || '',
      });
    },

    _tsEntityPool(domainRe) {
      const mine = new Set(this._model ? this._model.nodes.keys() : []);
      const ids = Object.keys(this._hass.states || {}).filter((k) => EXACT_RE.test(k) && (!domainRe || domainRe.test(k)));
      ids.sort((a, b) => (mine.has(b) - mine.has(a)) || this._boxName(a).localeCompare(this._boxName(b)));
      return ids.map((id) => ({ id, name: this._boxName(id), state: this._hass.states[id].state, mine: mine.has(id) }));
    },

    _tsShow() {
      const g = this._stu;
      if (!g) return;
      const m = this._$.modal, full = this._full();
      const exp = explainTemplate(g.template, (id) => this._boxName(id));
      g.lastExplain = exp;
      const canSaveHelper = full && (!g.entityId || !!g.entryId);
      const isEditHelper = !!(g.entityId && g.entryId && /^(sensor|binary_sensor)\./.test(g.entityId));
      const inGuided = g.mode === 'wizard' || g.mode === 'recipe';
      const tabs = [
        { id: 'wizard', ic: 'mdi:compass-outline', lbl: T('ts_tab_wizard'), on: inGuided },
        { id: 'custom', ic: 'mdi:code-tags', lbl: T('ts_tab_custom'), on: g.mode === 'custom' },
        { id: 'explain', ic: 'mdi:school-outline', lbl: T('ts_tab_explain'), on: g.mode === 'explain' },
        { id: 'guide', ic: 'mdi:book-education-outline', lbl: T('ts_tab_guide'), on: g.mode === 'guide' },
      ];
      const leftHtml = g.mode === 'wizard' ? this._tsWizardLeft()
        : g.mode === 'recipe' ? this._tsRecipeForm()
          : g.mode === 'explain' ? this._tsExplainLeft(exp)
            : g.mode === 'guide' ? this._tsGuideLeft()
              : this._tsCustomLeft();

      const srcBar = g.sources && g.sources.length > 1
        ? `<div class="tssrc">${g.sources.map((s, i) => `<button class="chip${i === g.srcIdx ? ' on' : ''}" data-act="ts-pick-src" data-i="${i}">${esc(s.place)}</button>`).join('')}</div>`
        : '';

      m.hidden = false;
      m.innerHTML = `<div class="dlg tsdlg">
        <div class="tshead">
          <div class="tstitle"><ha-icon icon="mdi:code-braces-box"></ha-icon><div><h3>${g.entityId ? T('ts_h_of', { name: esc(g.name || g.entityId) }) : T('ts_h')}</h3><div class="hint">${T('ts_lead')}</div></div></div>
          <div class="tsmodes" role="tablist" aria-label="${esc(T('ts_modes_a11y'))}">${tabs.map((x) => `<button role="tab" aria-selected="${x.on ? 'true' : 'false'}" class="chip${x.on ? ' on' : ''}" data-act="ts-mode" data-mode="${x.id}"><ha-icon icon="${x.ic}"></ha-icon>${x.lbl}</button>`).join('')}</div>
        </div>
        ${srcBar}
        <div class="tsgrid">
          <div class="tsleft">${leftHtml}</div>
          <div class="tsright">
            <div class="tspane">
              <div class="tsphead"><span>${T('ts_jinja_h')}</span><button class="chip" data-act="ts-eval" title="${esc(T('ts_eval_t'))}"><ha-icon icon="mdi:play-outline"></ha-icon>${T('ts_eval_b')}</button></div>
              <textarea class="tsed" name="tstpl" rows="6" spellcheck="false" aria-label="${esc(T('ts_jinja_h'))}" placeholder="${esc(T('ts_jinja_ph'))}">${esc(g.template)}</textarea>
              <details class="tsavail"${g.availability ? ' open' : ''}><summary>${T('ts_avail_h')}</summary><textarea class="tsed small" name="tsavail" rows="2" spellcheck="false" aria-label="${esc(T('ts_avail_h'))}" placeholder="{{ has_value('sensor.example') }}">${esc(g.availability)}</textarea></details>
              <div class="tslive">${this._tsLiveHtml()}</div>
              <div class="tslint">${this._tsLintHtml(exp.warnings)}</div>
            </div>
            <div class="tspane">
              <div class="tsphead"><span>${T('ts_explain_h')}</span><span class="muted">${esc(exp.summary)}</span></div>
              <div class="tsclauses">${this._tsClausesHtml(exp)}</div>
              <div class="tsconceptpop">${this._tsConceptPopHtml()}</div>
            </div>
            <div class="tspane tssimbox">
              <div class="tsphead"><span>${T('ts_sim_h')}</span>${Object.keys(g.sim).length || g.simTime ? `<button class="chip" data-act="ts-sim-clear">${T('ts_sim_reset')}</button>` : ''}</div>
              <div class="tssim">${this._tsSimHtml(exp.entities)}</div>
            </div>
          </div>
        </div>
        <div class="aval" role="alert"></div>
        <div class="tsfoot btns">
          ${isEditHelper ? `<button data-act="ts-ha">${T('ts_open_ha')}</button>` : ''}
          <button data-act="ts-copy-yaml" title="${esc(T('ts_copy_yaml_t'))}"><ha-icon icon="mdi:content-copy"></ha-icon>${T('ts_copy_yaml')}</button>
          <button data-act="ts-try-sbx" title="${esc(T('ts_try_sbx_t'))}"><ha-icon icon="mdi:flask-outline"></ha-icon>${T('ver_try')}</button>
          <span class="tsgrow"></span>
          <button data-act="modal-cancel">${T('close')}</button>
          ${!g.entityId || isEditHelper ? `<button class="primary" data-act="ts-save"${canSaveHelper ? '' : ` disabled title="${esc(T('full_manager_only_switch_it'))}"`}>${isEditHelper ? T('ts_update_helper') : T('ts_save_helper')}</button>` : ''}
        </div>
      </div>`;
    },

    _tsRefreshRight() {
      const g = this._stu, m = this._$.modal;
      if (!g || !m.querySelector('.tsdlg')) return;
      const exp = explainTemplate(g.template, (id) => this._boxName(id));
      g.lastExplain = exp;
      const set = (sel, html) => { const el = m.querySelector(sel); if (el) el.innerHTML = html; };
      set('.tslive', this._tsLiveHtml());
      set('.tslint', this._tsLintHtml(exp.warnings));
      set('.tsclauses', this._tsClausesHtml(exp));
      set('.tsconceptpop', this._tsConceptPopHtml());
      set('.tssim', this._tsSimHtml(exp.entities));
      const sum = m.querySelector('.tsright .tspane:nth-of-type(2) .tsphead .muted');
      if (sum) sum.textContent = exp.summary;
    },

    // ---- Step 1 & Step 2: Big-Picture -> Small-Picture Goal Wizard ----
    _tsWizardLeft() {
      const g = this._stu;
      if (!g.goal) {
        const goals = goalMeta();
        return `<div class="tspane tswiz">
          <div class="tsstepbar"><span class="tsstep on">1. ${T('ts_step_big')}</span><span class="tsstep">2. ${T('ts_step_narrow')}</span><span class="tsstep">3. ${T('ts_step_details')}</span></div>
          <div class="tswizh">${T('ts_wiz_q1')}</div>
          <div class="hint">${T('ts_wiz_q1_h')}</div>
          <div class="tsgcards">${goals.map((x) => `<button type="button" class="tsgoalcard" data-act="ts-goal" data-goal="${x.id}"><div class="tsgctop"><ha-icon icon="${x.icon}"></ha-icon><b>${esc(x.title)}</b></div><span>${esc(x.desc)}</span><small>${esc(x.ex)}</small></button>`).join('')}</div>
        </div>`;
      }
      const tree = TPL_GOAL_TREE.find((x) => x.id === g.goal);
      const gm = goalMeta().find((x) => x.id === g.goal);
      const metas = tplMeta();
      const cards = (tree ? tree.kinds : []).map((k) => metas.find(([mk]) => mk === k)).filter(Boolean);
      return `<div class="tspane tswiz">
        <div class="tsstepbar"><button type="button" class="lnk" data-act="ts-goal" data-goal="">&larr; 1. ${esc(gm ? gm.title : T('ts_step_big'))}</button><span class="tsstep on">2. ${T('ts_step_narrow')}</span><span class="tsstep">3. ${T('ts_step_details')}</span></div>
        <div class="tswizh">${T('ts_wiz_q2')}</div>
        <div class="hint">${T('ts_wiz_q2_h')}</div>
        <div class="tsgcards">${cards.map(([k, title, desc, ic, dom, ex]) => `<button type="button" class="tsgoalcard" data-act="ts-pick-recipe" data-kind="${k}"><div class="tsgctop"><ha-icon icon="${ic}"></ha-icon><b>${esc(title)}</b><span class="tsbadge">${esc(dom === 'binary_sensor' ? T('ts_dom_binary') : T('ts_dom_sensor'))}</span></div><span>${esc(desc)}</span><small>${esc(ex)}</small></button>`).join('')}</div>
      </div>`;
    },

    // ---- Interactive Helper Inspector Card (shared by Write Jinja & Jinja Guide tabs) ----
    _tsHelperInspector(key) {
      const g = this._stu, info = JINJA_GLOSSARY[key];
      if (!info) return '';
      const pool = this._tsEntityPool();
      const pickEnt = g.helpEnt || (pool[0] ? pool[0].id : '');
      const preview = info.snippet(pickEnt);
      const entSel = info.needsEntity
        ? `<label>${T('ts_hi_pick_ent')}<select name="ts_help_ent">${pool.slice(0, 80).map((e) => `<option value="${esc(e.id)}"${e.id === pickEnt ? ' selected' : ''}>${esc(e.name)} (${esc(e.state)})</option>`).join('')}</select></label>`
        : '';
      return `<div class="tshicard">
        <div class="tshictop"><b>${esc(info.plainName)}</b><code>${esc(info.syntax)}</code></div>
        <p><b>${T('ts_hi_what')}</b> ${esc(info.what)}</p>
        <p class="tshiwhy"><b>${T('ts_hi_why')}</b> ${esc(info.why)}</p>
        <div class="tshiex"><span class="muted">${T('ts_hi_example')}</span> <code>${esc(info.example)}</code></div>
        ${entSel}
        <div class="tshiact"><code class="tshiprev">${esc(preview)}</code><button type="button" class="primary" data-act="ts-snippet" data-snip="${esc(preview)}"><ha-icon icon="mdi:plus"></ha-icon>${T('ts_hi_insert')}</button></div>
      </div>`;
    },

    _tsHelperBrowser(searchable) {
      const g = this._stu, q = (g.helpQ || '').trim().toLowerCase();
      const cats = helperCats();
      const entries = Object.entries(JINJA_GLOSSARY).filter(([k, v]) => (g.helpCat === 'all' || v.cat === g.helpCat) && (!q || k.includes(q) || v.plainName.toLowerCase().includes(q) || v.what.toLowerCase().includes(q) || v.syntax.toLowerCase().includes(q)));
      const selectedKey = JINJA_GLOSSARY[g.helpKey] ? g.helpKey : (entries[0] ? entries[0][0] : 'states');
      return `<div class="tspane">
        <div class="tsphead"><span>${T('ts_snippets_h')}</span><span class="hint">${T('ts_snippets_sub')}</span></div>
        <div class="tsrpick">${cats.map(([id, lbl]) => `<button type="button" class="chip${g.helpCat === id ? ' on' : ''}" data-act="ts-help-cat" data-cat="${id}">${esc(lbl)}</button>`).join('')}</div>
        ${searchable ? `<input name="ts_hq" value="${esc(g.helpQ || '')}" placeholder="${esc(T('ts_guide_search_ph'))}" aria-label="${esc(T('ts_guide_search_ph'))}">` : ''}
        ${this._tsHelperInspector(selectedKey)}
        <div class="tshlist">${entries.map(([k, v]) => `<button type="button" class="tshrow${selectedKey === k ? ' on' : ''}" data-act="ts-help-pick" data-key="${k}"><b>${esc(v.plainName)}</b><code>${esc(v.syntax)}</code></button>`).join('') || `<div class="muted">${T('rcp_none')}</div>`}</div>
      </div>`;
    },

    _tsCustomLeft() {
      return `<div class="tspane"><div class="tsphead"><span>${T('ts_helper_meta')}</span></div>${this._tsMetaFields()}</div>${this._tsHelperBrowser(false)}`;
    },

    _tsGuideLeft() {
      return this._tsHelperBrowser(true);
    },

    _tsLiveHtml() {
      const g = this._stu, lv = g && g.live;
      const simNote = Object.keys(g.sim).length || g.simTime ? `<span class="tsbadge sim">${T('ts_sim_active')}</span>` : '';
      if (!g.template.trim()) return `<div class="tsres muted">${T('ts_empty_preview')}</div>`;
      if (!lv) return `<div class="tsres muted">${T('ts_evaluating')}</div>`;
      if (!lv.ok) return `<div class="tsres err"><ha-icon icon="mdi:alert-circle-outline"></ha-icon><span>${esc(lv.err)}</span>${simNote}</div>`;
      const availBadge = lv.avail != null ? `<span class="tsbadge ${lv.avail ? 'ok' : 'warn'}">${lv.avail ? T('ts_avail_ok') : T('ts_avail_no')}</span>` : '';
      return `<div class="tsres ok"><span class="tsresl">${T('ts_result_l')}</span><code class="tsresv">${esc(String(lv.value))}</code>${availBadge}${simNote}</div>`;
    },

    _tsLintHtml(warnings) {
      if (!warnings.length) return '';
      return warnings.map((w, i) => `<div class="tswarn ${w.sev}"><ha-icon icon="${w.sev === 'error' ? 'mdi:close-circle-outline' : w.sev === 'info' ? 'mdi:information-outline' : 'mdi:alert-outline'}"></ha-icon><span>${esc(w.msg)}</span>${w.fix ? `<button class="chip" data-act="ts-fix" data-i="${i}">${esc(w.fixLabel)}</button>` : ''}${w.suggestAvail ? `<button class="chip" data-act="ts-use-avail" data-i="${i}">${T('ts_use_avail')}</button>` : ''}</div>`).join('');
    },

    _tsClausesHtml(exp) {
      const g = this._stu, vals = (g && g.live && g.live.clauses) || {};
      if (!exp.clauses.length) return `<div class="muted">${T('ts_no_clauses')}</div>`;
      return exp.clauses.map((c, i) => {
        const v = i in vals ? `<code class="tsclv" title="${esc(T('ts_live_val_t'))}">${esc(shorten(String(vals[i]), 60))}</code>` : '';
        const pills = (c.concepts || []).filter((k) => JINJA_GLOSSARY[k]).map((k) => `<button type="button" class="tsconcept${g.activeConcept === k ? ' on' : ''}" data-act="ts-concept" data-key="${k}" title="${esc(JINJA_GLOSSARY[k].plainName)}">? ${esc(k)}</button>`).join('');
        return `<div class="tscl ${c.kind}" style="margin-left:${Math.min(4, c.depth) * 14}px"><div class="tscltop"><span class="tscle">${esc(c.english)}</span>${v}</div><div class="tsclbot"><code class="tsclr">${esc(c.raw)}</code>${pills ? `<span class="tsclpills">${pills}</span>` : ''}</div></div>`;
      }).join('');
    },

    _tsConceptPopHtml() {
      const g = this._stu, k = g && g.activeConcept, info = k && JINJA_GLOSSARY[k];
      if (!info) return '';
      return `<div class="tshicard compact"><div class="tshictop"><b>${esc(info.plainName)}</b><code>${esc(info.syntax)}</code><button type="button" class="ib" data-act="ts-concept" data-key="" title="${esc(T('close'))}"><ha-icon icon="mdi:close"></ha-icon></button></div><p>${esc(info.what)}</p><p class="tshiwhy"><b>${T('ts_hi_why')}</b> ${esc(info.why)}</p></div>`;
    },

    _tsSimHtml(entities) {
      const g = this._stu;
      const rows = entities.slice(0, 12).map((id) => {
        const real = this._hass.states[id], cur = id in g.sim ? g.sim[id] : (real ? real.state : 'unknown');
        const quick = suggestStatesForEntities([id]).slice(0, 2).concat(['unavailable']);
        return `<div class="tssimrow"><span class="tssimn" title="${esc(id)}">${esc(this._boxName(id))}</span><input class="tssimv" data-simk="${esc(id)}" value="${esc(cur)}" aria-label="${esc(T('ts_sim_val_a11y', { name: this._boxName(id) }))}">${quick.map((q) => `<button class="chip${cur === q ? ' on' : ''}" data-act="ts-sim-preset" data-k="${esc(id)}" data-v="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
      }).join('');
      const timeRow = `<div class="tssimrow"><span class="tssimn">${T('ts_sim_time')}</span><input type="time" name="tssimtime" value="${esc(g.simTime)}" aria-label="${esc(T('ts_sim_time'))}"><span class="hint">${T('ts_sim_time_h')}</span></div>`;
      return (rows || `<div class="muted">${T('ts_sim_none')}</div>`) + timeRow;
    },

    _tsExplainLeft(exp) {
      const g = this._stu;
      const entRows = exp.entities.map((id) => {
        const st = this._hass.states[id];
        return `<div class="tsent"><b>${esc(this._boxName(id))}</b><small>${esc(id)}</small><span class="tsbadge">${esc(st ? st.state : T('ts_missing'))}</span></div>`;
      }).join('');
      return `<div class="tspane">
        <div class="tsphead"><span>${T('ts_summary_h')}</span></div>
        <p class="tssum">${esc(exp.summary)}</p>
        <div class="hint">${T('ts_explain_edit_hint')}</div>
      </div>
      <div class="tspane">
        <div class="tsphead"><span>${P('ts_ents_used', exp.entities.length)}</span></div>
        <div class="tsents">${entRows || `<div class="muted">${T('ts_ents_none')}</div>`}</div>
      </div>
      ${g.entryId ? `<div class="tspane"><div class="tsphead"><span>${T('ts_helper_meta')}</span></div>${this._tsMetaFields()}</div>` : ''}`;
    },

    _tsMetaFields() {
      const g = this._stu;
      const opt = (v, l, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
      const classes = g.domain === 'binary_sensor' ? BINARY_CLASSES : SENSOR_CLASSES;
      const scOpts = [['', T('ts_none')], ['measurement', T('ts_sc_meas')], ['total', T('ts_sc_total')], ['total_increasing', T('ts_sc_inc')]];
      return `<label>${T('name')}<input name="tsname" value="${esc(g.name)}" placeholder="${esc(T('ts_name_ph'))}" maxlength="120"></label>
        <div class="tsrow2">
          <label>${T('ts_helper_type')}<select name="tsdom"${g.entityId ? ' disabled' : ''}>${opt('sensor', T('ts_dom_sensor'), g.domain === 'sensor')}${opt('binary_sensor', T('ts_dom_binary'), g.domain === 'binary_sensor')}</select></label>
          <label>${T('ts_dev_class')}<select name="tsdclass">${classes.map((c) => opt(c, c || T('ts_none'), g.device_class === c)).join('')}</select></label>
        </div>`
        + (g.domain === 'sensor' ? `<div class="tsrow2"><label>${T('ts_unit')}<input name="tsunit" value="${esc(g.unit)}" placeholder="°C, %, W, min…" maxlength="20"></label><label>${T('ts_state_class')}<select name="tssclass">${scOpts.map(([v, l]) => opt(v, l, g.state_class === v)).join('')}</select></label></div>` : '');
    },

    _tsEntityPicker(selected, domainRe, single, nameAttr) {
      const g = this._stu, q = (g.entFilter || '').toLowerCase(), sel = new Set(toList(selected));
      const pool = this._tsEntityPool(domainRe);
      if (single) {
        const cur = toList(selected)[0] || '';
        return `<select name="${nameAttr || 'ts_ent_one'}"><option value="">${T('ts_pick_entity')}</option>${pool.map((e) => `<option value="${esc(e.id)}"${e.id === cur ? ' selected' : ''}>${esc(e.name)} (${esc(e.id)} · ${esc(e.state)})</option>`).join('')}</select>`;
      }
      const filtered = pool.filter((e) => !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
      const shown = filtered.slice(0, 60);
      return `<input name="ts_eflt" value="${esc(g.entFilter || '')}" placeholder="${esc(T('ts_filter_ents'))}" aria-label="${esc(T('ts_filter_ents'))}">
        <div class="tsep">${shown.map((e) => `<button type="button" class="chip${sel.has(e.id) ? ' on' : ''}" data-act="ts-ent-toggle" data-k="${esc(e.id)}" title="${esc(e.id)}">${esc(e.name)} <small>${esc(e.state)}</small></button>`).join('') || `<span class="muted">${T('ts_ents_none')}</span>`}</div>
        <div class="hint">${P('ts_picked_n', sel.size)}</div>`;
    },

    _tsStateChips(entities, currentStates, single) {
      const sug = suggestStatesForEntities(entities), cur = new Set(toList(currentStates));
      return `<div class="tsrpick"><span class="hint">${T('ts_quick_states')}</span>${sug.map((st) => `<button type="button" class="chip${cur.has(st) ? ' on' : ''}" data-act="ts-state-chip" data-st="${esc(st)}" data-single="${single ? '1' : ''}">${esc(st)}</button>`).join('')}</div>`;
    },

    // ---- Step 3: Small-Picture Guided Questions ----
    _tsRecipeForm() {
      const g = this._stu, s = g.spec, metas = tplMeta();
      const opt = (v, l, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
      const meta = metas.find(([k]) => k === g.kind);
      const gm = goalMeta().find((x) => x.id === g.goal);
      const crumb = `<div class="tsstepbar"><button type="button" class="lnk" data-act="ts-goal" data-goal="">&larr; ${T('ts_step_big')}</button>${gm ? `<button type="button" class="lnk" data-act="ts-goal" data-goal="${gm.id}">&larr; ${esc(gm.title)}</button>` : ''}<span class="tsstep on">3. ${esc(meta ? meta[1] : T('ts_step_details'))}</span></div>`;
      let fields = '';
      if (g.kind === 'tpl_count') {
        const labels = this._labels || [];
        fields = `<label>${T('ts_f_scope')}<select name="ts_scope">${opt('entities', T('ts_sc_ents'), s.scope === 'entities')}${opt('domain', T('ts_sc_dom'), s.scope === 'domain')}${opt('area', T('ts_sc_area'), s.scope === 'area')}${opt('label', T('ts_sc_label'), s.scope === 'label')}</select></label>`
          + (s.scope === 'entities' ? `<label>${T('ts_f_entities')}</label>${this._tsEntityPicker(s.entities)}` : '')
          + (s.scope !== 'entities' ? `<label>${T('ts_f_domain')}<select name="ts_rdom">${['light', 'binary_sensor', 'switch', 'cover', 'lock', 'fan', 'person'].map((d) => opt(d, d, s.domain === d)).join('')}</select></label>` : '')
          + (s.scope === 'area' ? `<label>${T('ts_f_area')}<input name="ts_area" value="${esc(s.area)}" placeholder="kitchen"></label>` : '')
          + (s.scope === 'label' ? `<label>${T('ts_f_label')}<select name="ts_label"><option value="">${T('ts_pick_label')}</option>${labels.map((l) => opt(l.label_id, l.name || l.label_id, s.label === l.label_id)).join('')}</select></label>` : '')
          + `<label>${T('ts_f_states')}<input name="ts_states" value="${esc(s.states.join(', '))}" placeholder="on, open"></label>${this._tsStateChips(s.scope === 'entities' ? s.entities : [s.domain + '.x'], s.states, false)}`
          + `<div class="tsrow2"><label>${T('ts_f_format')}<select name="ts_fmt">${opt('number', T('ts_fmt_num'), s.format === 'number')}${opt('phrase', T('ts_fmt_phrase'), s.format === 'phrase')}</select></label>`
          + (s.format === 'phrase' ? `<label>${T('ts_f_phrase')}<input name="ts_phrase" value="${esc(s.phrase)}" placeholder="{n} lights on"></label>` : '<div></div>') + '</div>'
          + `<label class="chk"><input type="checkbox" name="ts_ignunav"${s.ignoreUnavailable ? ' checked' : ''}>${T('ts_f_ignore_unav')}</label>`;
      } else if (g.kind === 'tpl_any_all') {
        fields = `<label>${T('ts_f_entities')}</label>${this._tsEntityPicker(s.entities)}`
          + `<div class="tsrow2"><label>${T('ts_f_mode')}<select name="ts_mode">${opt('any', T('ts_mode_any'), s.mode === 'any')}${opt('all', T('ts_mode_all'), s.mode === 'all')}</select></label>`
          + `<label>${T('ts_f_states')}<input name="ts_states" value="${esc(s.states.join(', '))}" placeholder="on, open"></label></div>`
          + this._tsStateChips(s.entities, s.states, false)
          + `<label class="chk"><input type="checkbox" name="ts_reqall"${s.requireAllAvailable ? ' checked' : ''}>${T('ts_f_req_all')}</label>`;
      } else if (g.kind === 'tpl_compare') {
        fields = `<label>${T('ts_cmp_mode')}<select name="ts_cmpmode">${opt('threshold', T('ts_cmp_num'), s.mode === 'threshold')}${opt('entities', T('ts_cmp_ent'), s.mode === 'entities')}</select></label>`
          + `<label>${T('ts_cmp_ent_a')}${this._tsEntityPicker(s.entityA, /^(sensor|input_number|number|counter)\./, true, 'ts_cmp_a')}</label>`
          + `<label>${T('ts_cmp_op')}<select name="ts_cmpop">${opt('gt', T('ts_op_gt'), s.op === 'gt')}${opt('ge', T('ts_op_ge'), s.op === 'ge')}${opt('lt', T('ts_op_lt'), s.op === 'lt')}${opt('le', T('ts_op_le'), s.op === 'le')}${s.mode === 'threshold' ? opt('between', T('ts_op_between'), s.op === 'between') : ''}</select></label>`
          + (s.mode === 'entities'
            ? `<label>${T('ts_cmp_ent_b')}${this._tsEntityPicker(s.entityB, /^(sensor|input_number|number|counter)\./, true, 'ts_cmp_b')}</label>`
            : `<div class="tsrow2"><label>${s.op === 'between' ? T('ts_cmp_min') : T('ts_cmp_val')}<input type="number" step="any" name="ts_cmpv" value="${esc(s.value)}"></label>${s.op === 'between' ? `<label>${T('ts_cmp_max')}<input type="number" step="any" name="ts_cmpvmax" value="${esc(s.valueMax)}"></label>` : '<div></div>'}</div>`);
      } else if (g.kind === 'tpl_list_names') {
        fields = `<label>${T('ts_f_entities')}</label>${this._tsEntityPicker(s.entities)}`
          + `<label>${T('ts_f_states')}<input name="ts_states" value="${esc(s.states.join(', '))}" placeholder="on, open"></label>${this._tsStateChips(s.entities, s.states, false)}`
          + `<div class="tsrow2"><label>${T('ts_f_prefix')}<input name="ts_prefix" value="${esc(s.prefix)}" placeholder="Open: "></label><label>${T('ts_f_empty')}<input name="ts_empty" value="${esc(s.emptyText)}" placeholder="All closed"></label></div>`;
      } else if (g.kind === 'tpl_duration') {
        fields = `<label>${T('ts_f_entity')}${this._tsEntityPicker(s.entity, null, true)}</label>`
          + `<div class="tsrow2"><label>${T('ts_f_target_state')}<input name="ts_tstate" value="${esc(s.targetState)}" placeholder="open"></label>`
          + `<label>${T('ts_f_format')}<select name="ts_durfmt">${opt('readable', T('ts_dur_read'), s.format === 'readable')}${opt('minutes', T('ts_dur_min'), s.format === 'minutes')}${opt('hours', T('ts_dur_hr'), s.format === 'hours')}</select></label></div>`
          + this._tsStateChips(s.entity ? [s.entity] : [], [s.targetState], true)
          + (s.format === 'readable' ? `<label>${T('ts_f_inactive')}<input name="ts_inact" value="${esc(s.inactiveText)}" placeholder="Closed"></label>` : '');
      } else if (g.kind === 'tpl_fallback') {
        fields = `<label>${T('ts_f_fallback_ents')}</label>${this._tsEntityPicker(s.entities)}`
          + `<div class="tsrow2"><label>${T('ts_f_fallback_val')}<input name="ts_fb" value="${esc(s.fallback)}" placeholder="unknown"></label>`
          + `<label>${T('ts_f_round')}<input type="number" name="ts_round" min="0" max="4" value="${esc(s.round)}"></label></div>`
          + `<label class="chk"><input type="checkbox" name="ts_num"${s.numeric ? ' checked' : ''}>${T('ts_f_numeric')}</label>`;
      } else if (g.kind === 'tpl_low_battery') {
        fields = `<div class="tsrow2"><label>${T('ts_f_threshold')}<input type="number" name="ts_thr" min="1" max="99" value="${esc(s.threshold)}"></label>`
          + `<label>${T('ts_f_output')}<select name="ts_batout">${opt('both', T('ts_bat_both'), s.output === 'both')}${opt('count', T('ts_bat_count'), s.output === 'count')}${opt('list', T('ts_bat_list'), s.output === 'list')}</select></label></div>`
          + `<label>${T('ts_f_scope')}<select name="ts_batscope">${opt('all', T('ts_bat_all'), s.scope === 'all')}${opt('entities', T('ts_bat_pick'), s.scope === 'entities')}</select></label>`
          + (s.scope === 'entities' ? this._tsEntityPicker(s.entities, /^sensor\./) : '')
          + `<label>${T('ts_f_empty')}<input name="ts_empty" value="${esc(s.emptyText)}" placeholder="All batteries OK"></label>`;
      } else if (g.kind === 'tpl_band') {
        fields = `<label>${T('ts_f_entity')}${this._tsEntityPicker(s.entity, /^(sensor|input_number|number)\./, true)}</label>`
          + `<div class="tsbands">${s.bands.map((b, i) => `<div class="tsbrow"><span>&le;</span><input type="number" step="any" data-bmax="${i}" value="${esc(b.max)}" aria-label="${esc(T('ts_band_max'))}"><input data-blbl="${i}" value="${esc(b.label)}" placeholder="Comfortable" aria-label="${esc(T('ts_band_lbl'))}"><button type="button" class="ib" data-act="ts-band-del" data-i="${i}"${s.bands.length < 2 ? ' disabled' : ''} title="${esc(T('remove'))}"><ha-icon icon="mdi:close"></ha-icon></button></div>`).join('')}</div>`
          + `<div class="tsrow2"><button type="button" class="chip" data-act="ts-band-add"><ha-icon icon="mdi:plus"></ha-icon>${T('ts_band_add')}</button><label>${T('ts_band_above')}<input name="ts_above" value="${esc(s.aboveLabel)}" placeholder="Warm"></label></div>`;
      } else if (g.kind === 'tpl_math') {
        fields = `<label>${T('ts_f_entities')}</label>${this._tsEntityPicker(s.entities, /^(sensor|input_number|number|counter)\./)}`
          + `<div class="tsrow2"><label>${T('ts_f_op')}<select name="ts_op">${opt('mean', T('ts_op_mean'), s.op === 'mean')}${opt('min', T('ts_op_min'), s.op === 'min')}${opt('max', T('ts_op_max'), s.op === 'max')}${opt('sum', T('ts_op_sum'), s.op === 'sum')}${opt('diff', T('ts_op_diff'), s.op === 'diff')}</select></label>`
          + `<label>${T('ts_f_round')}<input type="number" name="ts_round" min="0" max="4" value="${esc(s.round)}"></label></div>`;
      } else if (g.kind === 'tpl_time_window') {
        fields = `<div class="tsrow2"><label>${T('nb_from')}<input type="time" name="ts_from" value="${esc(s.from)}"></label><label>${T('nb_until')}<input type="time" name="ts_to" value="${esc(s.to)}"></label></div>`
          + `<div class="tsdays">${WEEKDAYS.map((d, i) => `<button type="button" class="chip${s.days.includes(i) ? ' on' : ''}" data-act="ts-day" data-d="${i}">${d}</button>`).join('')}</div>`;
      } else if (g.kind === 'tpl_message') {
        const pool = this._tsEntityPool();
        fields = `<div class="hint">${T('ts_msg_hint')}</div><div class="tsbands">${s.parts.map((p, i) => `<div class="tsmsgrow"><input data-mtxt="${i}" value="${esc(p.text)}" placeholder="${esc(T('ts_msg_txt_ph'))}" aria-label="${esc(T('ts_msg_txt_ph'))}"><select data-ment="${i}" aria-label="${esc(T('ts_pick_entity'))}"><option value="">${T('ts_msg_no_ent')}</option>${pool.slice(0, 80).map((e) => `<option value="${esc(e.id)}"${e.id === p.entity ? ' selected' : ''}>${esc(e.name)} (${esc(e.state)})</option>`).join('')}</select><button type="button" class="ib" data-act="ts-msg-del" data-i="${i}"${s.parts.length < 2 ? ' disabled' : ''} title="${esc(T('remove'))}"><ha-icon icon="mdi:close"></ha-icon></button></div>`).join('')}</div>`
          + `<div><button type="button" class="chip" data-act="ts-msg-add"><ha-icon icon="mdi:plus"></ha-icon>${T('ts_msg_add')}</button></div>`;
      } else if (g.kind === 'tpl_sun_offset') {
        fields = `<div class="tsrow2"><label>${T('ts_sun_ev')}<select name="ts_sun_ev">${opt('next_setting', T('ts_sun_sunset'), s.event === 'next_setting')}${opt('next_rising', T('ts_sun_sunrise'), s.event === 'next_rising')}${opt('next_noon', T('ts_sun_noon'), s.event === 'next_noon')}${opt('next_midnight', T('ts_sun_midnight'), s.event === 'next_midnight')}</select></label>`
          + `<label>${T('ts_sun_dir')}<select name="ts_sun_dir">${opt('before', T('ts_sun_before'), s.dir === 'before')}${opt('after', T('ts_sun_after'), s.dir === 'after')}</select></label></div>`
          + `<div class="tsrow2"><label>${T('ts_sun_hours')}<input type="number" name="ts_sun_h" min="0" max="23" value="${esc(s.hours)}"></label>`
          + `<label>${T('ts_sun_mins')}<input type="number" name="ts_sun_m" min="0" max="59" value="${esc(s.minutes)}"></label></div>`
          + `<label>${T('ts_sun_out')}<select name="ts_sun_out">${opt('timestamp', T('ts_sun_out_ts'), s.output === 'timestamp')}${opt('clock12', T('ts_sun_out_12'), s.output === 'clock12')}${opt('clock24', T('ts_sun_out_24'), s.output === 'clock24')}${opt('binary', T('ts_sun_out_bin'), s.output === 'binary')}</select></label>`
          + `<div class="hint">${T('ts_sun_hint')}</div>`;
      } else if (g.kind === 'tpl_countdown') {
        fields = `<label>${T('ts_cd_src')}<select name="ts_cd_src">${opt('entity', T('ts_cd_ent'), s.source === 'entity')}${opt('fixed', T('ts_cd_fixed'), s.source === 'fixed')}</select></label>`
          + (s.source === 'entity'
            ? `<label>${T('ts_f_entity')}${this._tsEntityPicker(s.entity, /^(calendar|input_datetime|sensor)\./, true)}</label>`
            : `<label>${T('ts_cd_date')}<input type="date" name="ts_cd_date" value="${esc(s.dateStr.slice(0, 10))}"></label>`)
          + `<div class="tsrow2"><label>${T('ts_cd_dir')}<select name="ts_cd_dir">${opt('until', T('ts_cd_until'), s.dir === 'until')}${opt('since', T('ts_cd_since'), s.dir === 'since')}</select></label>`
          + `<label>${T('ts_cd_unit')}<select name="ts_cd_unit">${opt('days', T('ts_cd_days'), s.unit === 'days')}${opt('hours', T('ts_cd_hours'), s.unit === 'hours')}${opt('minutes', T('ts_cd_mins'), s.unit === 'minutes')}${opt('readable', T('ts_cd_read'), s.unit === 'readable')}</select></label></div>`;
      } else if (g.kind === 'tpl_attribute') {
        const st = s.entity && this._hass.states[s.entity];
        const liveAttrs = Object.entries((st && st.attributes) || {})
          .sort(([a], [b]) => (ATTR_LOW_PRI.has(a) - ATTR_LOW_PRI.has(b)) || a.localeCompare(b));
        const fmtVal = (v) => shorten(typeof v === 'object' ? JSON.stringify(v) : String(v), 28);
        fields = `<label>${T('ts_f_entity')}${this._tsEntityPicker(s.entity, null, true)}</label>`
          + (liveAttrs.length ? `<label>${T('ts_attr_live')}<select name="ts_attr_pick"><option value="">${T('ts_attr_pick_ph')}</option>${liveAttrs.map(([k, v]) => opt(k, `${k} (${fmtVal(v)})`, s.attr === k)).join('')}</select></label>` : '')
          + `<div class="tsrow2"><label>${T('ts_attr_name')}<input name="ts_attr" value="${esc(s.attr)}" placeholder="brightness, hvac_action…"></label>`
          + `<label>${T('ts_attr_tx')}<select name="ts_attr_tx">${opt('raw', T('ts_atx_raw'), s.transform === 'raw')}${opt('number', T('ts_atx_num'), s.transform === 'number')}${opt('pct255', T('ts_atx_pct'), s.transform === 'pct255')}${opt('title', T('ts_atx_title'), s.transform === 'title')}</select></label></div>`
          + (s.transform === 'number'
            ? `<label>${T('ts_f_round')}<input type="number" name="ts_round" min="0" max="4" value="${esc(s.round)}"></label>`
            : s.transform === 'pct255' ? ''
              : `<label>${T('ts_attr_fb')}<input name="ts_fb" value="${esc(s.fallback)}" placeholder="None"></label>`);
      } else if (g.kind === 'tpl_scale') {
        fields = `<label>${T('ts_f_entity')}${this._tsEntityPicker(s.entity, /^(sensor|input_number|number|counter)\./, true)}</label>`
          + `<label>${T('ts_scale_preset')}<select name="ts_preset">${opt('w_to_kw', T('ts_sc_w2kw'), s.preset === 'w_to_kw')}${opt('kw_to_w', T('ts_sc_kw2w'), s.preset === 'kw_to_w')}${opt('c_to_f', T('ts_sc_c2f'), s.preset === 'c_to_f')}${opt('f_to_c', T('ts_sc_f2c'), s.preset === 'f_to_c')}${opt('rate', T('ts_sc_rate'), s.preset === 'rate')}${opt('custom', T('ts_sc_custom'), s.preset === 'custom')}</select></label>`
          + (s.preset === 'rate' || s.preset === 'custom'
            ? `<div class="tsrow2"><label>${T('ts_scale_mult')}<input type="number" step="any" name="ts_mult" value="${esc(s.mult)}"></label>${s.preset === 'custom' ? `<label>${T('ts_scale_off')}<input type="number" step="any" name="ts_off" value="${esc(s.offset)}"></label>` : `<label>${T('ts_f_round')}<input type="number" name="ts_round" min="0" max="4" value="${esc(s.round)}"></label>`}</div>`
            : '')
          + (s.preset !== 'rate' ? `<label>${T('ts_f_round')}<input type="number" name="ts_round" min="0" max="4" value="${esc(s.round)}"></label>` : '');
      } else if (g.kind === 'tpl_logic') {
        const pool = this._tsEntityPool();
        const ops = [['eq', T('ts_rl_eq')], ['ne', T('ts_rl_ne')], ['gt', '>'], ['ge', '>='], ['lt', '<'], ['le', '<='], ['avail', T('ts_rl_avail')]];
        fields = `<label>${T('ts_logic_join')}<select name="ts_join">${opt('and', T('ts_join_and'), s.join === 'and')}${opt('or', T('ts_join_or'), s.join === 'or')}</select></label>`
          + `<div class="tsbands">${s.rules.map((r, i) => `<div class="tsrulerow"><select data-rlent="${i}" aria-label="${esc(T('ts_pick_entity'))}"><option value="">${T('ts_pick_entity')}</option>${pool.slice(0, 80).map((e) => `<option value="${esc(e.id)}"${e.id === r.entity ? ' selected' : ''}>${esc(e.name)} (${esc(e.state)})</option>`).join('')}</select><select data-rlop="${i}" aria-label="${esc(T('ts_cmp_op'))}">${ops.map(([v, l]) => opt(v, l, r.op === v)).join('')}</select><input data-rlval="${i}" value="${esc(r.value)}" placeholder="${esc(T('ts_rl_val'))}" aria-label="${esc(T('ts_rl_val'))}"${r.op === 'avail' ? ' disabled' : ''}><button type="button" class="ib" data-act="ts-rule-del" data-i="${i}"${s.rules.length <= 2 ? ' disabled' : ''} title="${esc(T('remove'))}"><ha-icon icon="mdi:close"></ha-icon></button></div>`).join('')}</div>`
          + `<div><button type="button" class="chip" data-act="ts-rule-add"${s.rules.length >= 8 ? ' disabled' : ''}><ha-icon icon="mdi:plus"></ha-icon>${T('ts_rl_add')}</button></div>`
          + `<label class="chk"><input type="checkbox" name="ts_astext"${s.asText ? ' checked' : ''}>${T('ts_logic_astext')}</label>`
          + (s.asText ? `<div class="tsrow2"><label>${T('ts_logic_true')}<input name="ts_truetxt" value="${esc(s.trueText)}" placeholder="Active"></label><label>${T('ts_logic_false')}<input name="ts_falsetxt" value="${esc(s.falseText)}" placeholder="Normal"></label></div>` : '');
      } else if (g.kind === 'tpl_map_state') {
        fields = `<label>${T('ts_f_entity')}${this._tsEntityPicker(s.entity, null, true)}</label>`
          + `<div class="hint">${T('ts_map_hint')}</div>`
          + `<div class="tsbands">${s.rows.map((r, i) => `<div class="tsmaprow"><input data-mpfrom="${i}" value="${esc(r.from)}" placeholder="${esc(T('ts_map_from'))}" aria-label="${esc(T('ts_map_from'))}"><span>&rarr;</span><input data-mpto="${i}" value="${esc(r.to)}" placeholder="${esc(T('ts_map_to'))}" aria-label="${esc(T('ts_map_to'))}"><button type="button" class="ib" data-act="ts-map-del" data-i="${i}"${s.rows.length < 2 ? ' disabled' : ''} title="${esc(T('remove'))}"><ha-icon icon="mdi:close"></ha-icon></button></div>`).join('')}</div>`
          + `<div class="tsrow2"><div><button type="button" class="chip" data-act="ts-map-add"${s.rows.length >= 12 ? ' disabled' : ''}><ha-icon icon="mdi:plus"></ha-icon>${T('ts_map_add')}</button></div><label>${T('ts_map_fb')}<input name="ts_fb" value="${esc(s.fallback)}" placeholder="Unknown"></label></div>`;
      }
      return `<div class="tspane">${crumb}<div class="hint">${meta ? esc(meta[2]) : ''}</div>${this._tsMetaFields()}${fields}</div>`;
    },

    _tsSyncRecipe(redraw) {
      const g = this._stu, m = this._$.modal;
      if (!g || g.mode !== 'recipe') return;
      const gen = generateTplRecipe(g.kind, g.spec);
      let metaChanged = false;
      if (gen) {
        if (gen.domain !== g.domain) { g.domain = gen.domain; metaChanged = true; }
        g.template = gen.state;
        g.availability = gen.availability;
        if (g.unit === (g._genUnit || '')) { if (g.unit !== gen.unit) metaChanged = true; g.unit = gen.unit; }
        if (g.device_class === (g._genDc || '')) { if (g.device_class !== gen.device_class) metaChanged = true; g.device_class = gen.device_class; }
        if (g.state_class === (g._genSc || '')) { if (g.state_class !== gen.state_class) metaChanged = true; g.state_class = gen.state_class; }
        g._genUnit = gen.unit;
        g._genDc = gen.device_class;
        g._genSc = gen.state_class;
      }
      if (redraw || metaChanged) this._tsShow();
      else {
        const ed = m.querySelector('textarea[name="tstpl"]'); if (ed) ed.value = g.template;
        const av = m.querySelector('textarea[name="tsavail"]'); if (av) av.value = g.availability;
        this._tsRefreshRight();
      }
      this._tsEvalSoon();
    },

    _tsReadMeta(m) {
      const g = this._stu, q = (n) => m.querySelector(`[name="${n}"]`);
      if (q('tsname')) g.name = q('tsname').value;
      if (q('tsdom')) g.domain = q('tsdom').value === 'binary_sensor' ? 'binary_sensor' : 'sensor';
      if (q('tsunit')) g.unit = q('tsunit').value;
      if (q('tsdclass')) g.device_class = q('tsdclass').value;
      if (q('tssclass')) g.state_class = q('tssclass').value;
    },

    _stuChange(t) {
      const g = this._stu;
      if (!g || !t.closest || !t.closest('.tsdlg')) return false;
      const m = this._$.modal;
      this._tsReadMeta(m);
      if (t.name === 'tsdom') {
        const valid = g.domain === 'binary_sensor' ? BINARY_CLASSES : SENSOR_CLASSES;
        if (!valid.includes(g.device_class)) g.device_class = '';
        this._tsShow();
        return true;
      }
      if (t.name === 'ts_help_ent') { g.helpEnt = t.value; this._tsShow(); return true; }
      if (t.name === 'tssimtime') { g.simTime = t.value || ''; this._tsEvalSoon(true); return true; }
      if (t.dataset && t.dataset.simk) { g.sim[t.dataset.simk] = t.value; this._tsEvalSoon(true); return true; }
      if (g.mode === 'recipe') {
        const s = g.spec;
        let redraw = false;
        if (t.name === 'ts_scope') {
          s.scope = t.value;
          if (s.scope === 'label' && !s.label) s.label = g.label || (this._labels && this._labels[0] && this._labels[0].label_id) || '';
          redraw = true;
        }
        else if (t.name === 'ts_rdom') { s.domain = t.value; redraw = true; }
        else if (t.name === 'ts_area') s.area = t.value;
        else if (t.name === 'ts_label') s.label = t.value;
        else if (t.name === 'ts_states') s.states = t.value.split(',').map((x) => x.trim()).filter(Boolean);
        else if (t.name === 'ts_fmt') { s.format = t.value; redraw = true; }
        else if (t.name === 'ts_phrase') s.phrase = t.value;
        else if (t.name === 'ts_ignunav') s.ignoreUnavailable = t.checked;
        else if (t.name === 'ts_mode') s.mode = t.value;
        else if (t.name === 'ts_reqall') s.requireAllAvailable = t.checked;
        else if (t.name === 'ts_prefix') s.prefix = t.value;
        else if (t.name === 'ts_empty') s.emptyText = t.value;
        else if (t.name === 'ts_ent_one') {
          s.entity = t.value;
          if (g.kind === 'tpl_attribute' && t.value) {
            const st = this._hass.states[t.value], attrs = Object.keys((st && st.attributes) || {});
            const sorted = attrs.sort((a, b) => (ATTR_LOW_PRI.has(a) - ATTR_LOW_PRI.has(b)) || a.localeCompare(b));
            if (sorted.length && (!s.attr || !attrs.includes(s.attr))) {
              s.attr = sorted[0];
              if (s.attr === 'brightness') s.transform = 'pct255';
            }
          } else if (g.kind === 'tpl_map_state' && t.value) {
            const sug = suggestStatesForEntities([t.value]);
            const isDef = s.rows.length === 2 && s.rows[0].from === 'on' && s.rows[1].from === 'off';
            if (isDef && sug.length && sug[0] !== 'on') {
              const title = (w) => w.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              s.rows = sug.slice(0, 4).map((st) => ({ from: st, to: title(st) }));
            }
          }
          redraw = true;
        }
        else if (t.name === 'ts_tstate') s.targetState = t.value;
        else if (t.name === 'ts_durfmt') { s.format = t.value; redraw = true; }
        else if (t.name === 'ts_inact') s.inactiveText = t.value;
        else if (t.name === 'ts_fb') s.fallback = t.value;
        else if (t.name === 'ts_num') s.numeric = t.checked;
        else if (t.name === 'ts_round') s.round = +t.value || 0;
        else if (t.name === 'ts_thr') s.threshold = +t.value || 20;
        else if (t.name === 'ts_batout') s.output = t.value;
        else if (t.name === 'ts_batscope') { s.scope = t.value; redraw = true; }
        else if (t.name === 'ts_above') s.aboveLabel = t.value;
        else if (t.name === 'ts_op') s.op = t.value;
        else if (t.name === 'ts_from') s.from = t.value;
        else if (t.name === 'ts_to') s.to = t.value;
        else if (t.name === 'ts_cmpmode') { s.mode = t.value; redraw = true; }
        else if (t.name === 'ts_cmp_a') s.entityA = t.value;
        else if (t.name === 'ts_cmp_b') s.entityB = t.value;
        else if (t.name === 'ts_cmpop') { s.op = t.value; redraw = true; }
        else if (t.name === 'ts_cmpv') s.value = Number(t.value);
        else if (t.name === 'ts_cmpvmax') s.valueMax = Number(t.value);
        else if (t.name === 'ts_sun_ev') s.event = t.value;
        else if (t.name === 'ts_sun_dir') s.dir = t.value;
        else if (t.name === 'ts_sun_h') s.hours = Number(t.value);
        else if (t.name === 'ts_sun_m') s.minutes = Number(t.value);
        else if (t.name === 'ts_sun_out') { s.output = t.value; redraw = true; }
        else if (t.name === 'ts_cd_src') { s.source = t.value; redraw = true; }
        else if (t.name === 'ts_cd_date') s.dateStr = t.value;
        else if (t.name === 'ts_cd_dir') s.dir = t.value;
        else if (t.name === 'ts_cd_unit') { s.unit = t.value; redraw = true; }
        else if (t.name === 'ts_attr_pick') {
          if (t.value) {
            s.attr = t.value;
            if (t.value === 'brightness' && s.transform === 'raw') s.transform = 'pct255';
            redraw = true;
          }
        }
        else if (t.name === 'ts_attr') s.attr = t.value;
        else if (t.name === 'ts_attr_tx') { s.transform = t.value; redraw = true; }
        else if (t.name === 'ts_preset') { s.preset = t.value; s.unit = ''; redraw = true; }
        else if (t.name === 'ts_mult') s.mult = Number(t.value);
        else if (t.name === 'ts_off') s.offset = Number(t.value);
        else if (t.name === 'ts_join') s.join = t.value;
        else if (t.name === 'ts_astext') { s.asText = t.checked; redraw = true; }
        else if (t.name === 'ts_truetxt') s.trueText = t.value;
        else if (t.name === 'ts_falsetxt') s.falseText = t.value;
        else if (t.dataset && t.dataset.bmax != null) s.bands[+t.dataset.bmax].max = Number(t.value);
        else if (t.dataset && t.dataset.blbl != null) s.bands[+t.dataset.blbl].label = t.value;
        else if (t.dataset && t.dataset.mtxt != null) s.parts[+t.dataset.mtxt].text = t.value;
        else if (t.dataset && t.dataset.ment != null) s.parts[+t.dataset.ment].entity = t.value;
        else if (t.dataset && t.dataset.rlent != null) {
          const r = s.rules[+t.dataset.rlent];
          r.entity = t.value;
          if (t.value && (r.op === 'eq' || r.op === 'ne')) {
            const sug = suggestStatesForEntities([t.value]);
            if (sug.length && !sug.includes(r.value)) { r.value = sug[0]; redraw = true; }
          }
        }
        else if (t.dataset && t.dataset.rlop != null) { s.rules[+t.dataset.rlop].op = t.value; redraw = true; }
        else if (t.dataset && t.dataset.rlval != null) s.rules[+t.dataset.rlval].value = t.value;
        else if (t.dataset && t.dataset.mpfrom != null) s.rows[+t.dataset.mpfrom].from = t.value;
        else if (t.dataset && t.dataset.mpto != null) s.rows[+t.dataset.mpto].to = t.value;
        g.spec = cleanTplRecipe(g.kind, s);
        this._tsSyncRecipe(redraw);
      }
      return true;
    },

    _stuInput(t) {
      const g = this._stu;
      if (!g || !t.closest || !t.closest('.tsdlg')) return false;
      const m = this._$.modal;
      if (t.name === 'tstpl') {
        g.template = t.value;
        this._tsRefreshRight();
        this._tsEvalSoon();
        return true;
      }
      if (t.name === 'tsavail') {
        g.availability = t.value;
        this._tsEvalSoon();
        return true;
      }
      if (t.name === 'ts_eflt' || t.name === 'ts_hq') {
        if (t.name === 'ts_eflt') g.entFilter = t.value; else g.helpQ = t.value;
        const pos = t.selectionStart, nm = t.name;
        this._tsShow();
        const ni = m.querySelector(`input[name="${nm}"]`);
        if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (e) { /* non-selectable input */ } }
        return true;
      }
      if (t.name === 'tsname' || t.name === 'tsunit') { this._tsReadMeta(m); return true; }
      return false;
    },

    _tsSetMode(mode) {
      const g = this._stu;
      if (!g) return;
      g.mode = mode;
      if (mode === 'recipe') this._tsSyncRecipe(true);
      else this._tsShow();
    },

    _tsPickGoal(goal) {
      const g = this._stu;
      if (!g) return;
      if (goal === 'explain') { g.mode = 'explain'; this._tsShow(); return; }
      g.mode = 'wizard';
      g.goal = goal || null;
      this._tsShow();
    },

    _tsPickRecipe(kind) {
      const g = this._stu;
      if (!g || !TPL_RECIPES[kind]) return;
      const prevGoal = g.goal;
      g.mode = 'recipe';
      g.kind = kind;
      if (!prevGoal || !(TPL_GOAL_TREE.find((x) => x.id === prevGoal) || { kinds: [] }).kinds.includes(kind)) {
        g.goal = (TPL_GOAL_TREE.find((x) => x.kinds.includes(kind)) || {}).id || g.goal;
      }
      g.spec = TPL_RECIPES[kind].defaultSpec();
      if (kind === 'tpl_sun_offset' && prevGoal === 'bool') g.spec.output = 'binary';
      if (kind === 'tpl_duration' && prevGoal === 'number') g.spec.format = 'minutes';
      g.unit = '';
      g.device_class = '';
      g.state_class = '';
      g._genUnit = '';
      g._genDc = '';
      g._genSc = '';
      this._tsSyncRecipe(true);
    },

    _tsPickSrc(idx) {
      const g = this._stu;
      if (!g || !g.sources || !g.sources[idx]) return;
      g.srcIdx = idx;
      g.template = g.sources[idx].template;
      g.availability = g.sources[idx].avail || '';
      this._tsShow();
      this._tsEvalSoon(true);
    },

    _tsEntToggle(id) {
      const g = this._stu;
      if (!g || g.mode !== 'recipe' || !Array.isArray(g.spec.entities)) return;
      const list = g.spec.entities.slice(), i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1); else list.push(id);
      g.spec.entities = list;
      // Auto-pick a sensible default state the first time an entity is picked (e.g. cover -> open)
      if (list.length === 1 && Array.isArray(g.spec.states)) {
        const sug = suggestStatesForEntities(list);
        if (sug.length && !sug.includes(g.spec.states[0])) g.spec.states = [sug[0]];
      }
      g.spec = cleanTplRecipe(g.kind, g.spec);
      this._tsSyncRecipe(true);
    },

    _tsStateChip(st, single) {
      const g = this._stu;
      if (!g || g.mode !== 'recipe' || !st) return;
      if (single) {
        g.spec.targetState = st;
      } else if (Array.isArray(g.spec.states)) {
        const list = g.spec.states.slice(), i = list.indexOf(st);
        if (i >= 0 && list.length > 1) list.splice(i, 1);
        else if (i < 0) list.push(st);
        g.spec.states = list;
      }
      g.spec = cleanTplRecipe(g.kind, g.spec);
      this._tsSyncRecipe(true);
    },

    _tsBandEdit(add, idx) {
      const g = this._stu;
      if (!g || g.kind !== 'tpl_band') return;
      const bs = g.spec.bands.slice();
      if (add && bs.length < 6) {
        const last = bs[bs.length - 1];
        bs.push({ max: (last ? last.max : 20) + 5, label: 'Level ' + (bs.length + 1) });
      } else if (!add && bs.length > 1) {
        bs.splice(idx, 1);
      }
      g.spec.bands = bs;
      g.spec = cleanTplRecipe(g.kind, g.spec);
      this._tsSyncRecipe(true);
    },

    _tsMsgEdit(add, idx) {
      const g = this._stu;
      if (!g || g.kind !== 'tpl_message') return;
      const ps = g.spec.parts.slice();
      if (add && ps.length < 8) ps.push({ text: ', ', entity: '', fallback: 'offline' });
      else if (!add && ps.length > 1) ps.splice(idx, 1);
      g.spec.parts = ps;
      g.spec = cleanTplRecipe(g.kind, g.spec);
      this._tsSyncRecipe(true);
    },

    _tsRuleEdit(add, idx) {
      const g = this._stu;
      if (!g || g.kind !== 'tpl_logic') return;
      const rs = g.spec.rules.slice();
      if (add && rs.length < 8) rs.push({ entity: '', op: 'eq', value: 'on' });
      else if (!add && rs.length > 2) rs.splice(idx, 1);
      g.spec.rules = rs;
      g.spec = cleanTplRecipe(g.kind, g.spec);
      this._tsSyncRecipe(true);
    },

    _tsMapEdit(add, idx) {
      const g = this._stu;
      if (!g || g.kind !== 'tpl_map_state') return;
      const rows = g.spec.rows.slice();
      if (add && rows.length < 12) rows.push({ from: '', to: '' });
      else if (!add && rows.length > 1) rows.splice(idx, 1);
      g.spec.rows = rows;
      g.spec = cleanTplRecipe(g.kind, g.spec);
      this._tsSyncRecipe(true);
    },

    _tsToggleDay(d) {
      const g = this._stu;
      if (!g || g.kind !== 'tpl_time_window') return;
      const days = g.spec.days.slice(), i = days.indexOf(d);
      if (i >= 0 && days.length > 1) days.splice(i, 1);
      else if (i < 0) days.push(d);
      g.spec.days = days;
      g.spec = cleanTplRecipe(g.kind, g.spec);
      this._tsSyncRecipe(true);
    },

    _tsHelpCat(cat) {
      const g = this._stu;
      if (!g) return;
      g.helpCat = cat || 'all';
      const first = Object.entries(JINJA_GLOSSARY).find(([, v]) => g.helpCat === 'all' || v.cat === g.helpCat);
      if (first) g.helpKey = first[0];
      this._tsShow();
    },

    _tsHelpPick(key) {
      const g = this._stu;
      if (!g || !JINJA_GLOSSARY[key]) return;
      g.helpKey = key;
      this._tsShow();
    },

    _tsConceptToggle(key) {
      const g = this._stu;
      if (!g) return;
      g.activeConcept = key && g.activeConcept !== key ? key : null;
      this._tsRefreshRight();
    },

    _tsInsertSnippet(code) {
      const g = this._stu, ed = this._$.modal.querySelector('textarea[name="tstpl"]');
      if (!g || !ed) return;
      const a = ed.selectionStart || 0, b = ed.selectionEnd || a;
      const isBlock = /^\s*\{%/.test(code);
      const wrap = !isBlock && !/^\s*\|/.test(code) && !/\{\{/.test(g.template.slice(0, a)) ? `{{ ${code} }}` : code;
      g.template = g.template.slice(0, a) + wrap + g.template.slice(b);
      ed.value = g.template;
      ed.focus();
      this._tsRefreshRight();
      this._tsEvalSoon();
    },

    _tsApplyFix(idx, useAvail) {
      const g = this._stu, exp = g && g.lastExplain, w = exp && exp.warnings && exp.warnings[idx];
      if (!g || !w) return;
      if (useAvail && w.suggestAvail) g.availability = w.suggestAvail;
      else if (w.fix) g.template = w.fix(g.template);
      this._tsShow();
      this._tsEvalSoon(true);
    },

    _tsSimPreset(k, v) {
      const g = this._stu;
      if (!g) return;
      g.sim[k] = v;
      this._tsRefreshRight();
      this._tsEvalSoon(true);
    },

    _tsSimClear() {
      const g = this._stu;
      if (!g) return;
      g.sim = {};
      g.simTime = '';
      this._tsShow();
      this._tsEvalSoon(true);
    },

    _tsEvalSoon(immediate) {
      this._clock.after('ts-eval', immediate ? 20 : 280, () => this._tsEvalNow());
    },

    async _tsEvalNow() {
      const g = this._stu;
      if (!g || !g.template.trim()) { if (g) { g.live = null; this._tsRefreshRight(); } return; }
      const seq = ++g.evalSeq;
      const exp = g.lastExplain || explainTemplate(g.template, (id) => this._boxName(id));
      const hasSim = Object.keys(g.sim).length > 0 || !!g.simTime;
      const renderOne = async (tpl, raw) => {
        if (!hasSim) return this._renderRaw(tpl, {});
        if (this._asFn == null) this._asFn = await this._renderRaw('{%- macro m(returns) -%}{%- do returns(1) -%}{%- endmacro -%}{{ (m | as_function)() }}', {}).then((v) => String(v) === '1', () => false);
        if (!this._asFn) return this._renderRaw(tpl, {});
        const rw = sbxRewrite(tpl), fb_s = {};
        const add = (id) => {
          const real = this._hass.states[id];
          const st = id in g.sim ? g.sim[id] : (real ? String(real.state) : 'unknown');
          fb_s[id] = { state: String(st), attributes: (real && real.attributes) || {}, last_changed: (real && real.last_changed) || new Date().toISOString(), last_updated: new Date().toISOString() };
        };
        Object.keys(g.sim).forEach(add);
        for (const x of String(tpl).matchAll(ENTITY_RE)) add(x[0]);
        const simNow = new Date();
        if (g.simTime && /^\d{2}:\d{2}$/.test(g.simTime)) {
          const [hh, mm] = g.simTime.split(':').map(Number);
          simNow.setHours(hh, mm, 0, 0);
        }
        const v = await this._renderRaw(SBX_PRELUDE + (raw ? SBX_RAW + rw.text + SBX_RAW : rw.text), { fb_s, fb_t: simNow.toISOString() });
        return raw ? String(v).slice(SBX_RAW.length, -SBX_RAW.length) : v;
      };
      try {
        const value = await renderOne(g.template, false);
        if (this._stu !== g || g.evalSeq !== seq) return;
        let avail = null;
        if (g.availability.trim()) {
          try {
            const av = await renderOne(g.availability, false);
            avail = ['1', 'true', 'yes', 'on'].includes(String(av).trim().toLowerCase());
          } catch (e) { avail = false; }
        }
        const clauses = {};
        const probe = buildExplainProbe(exp.clauses);
        if (probe) {
          try {
            const raw = await renderOne(probe.template, false);
            const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(arr)) probe.indices.forEach((ci, j) => { if (arr[j] !== undefined) clauses[ci] = arr[j]; });
          } catch (e) { /* clause probe is best-effort; main result still shows */ }
        }
        if (this._stu !== g || g.evalSeq !== seq) return;
        g.live = { ok: true, value, avail, clauses };
      } catch (e) {
        if (this._stu !== g || g.evalSeq !== seq) return;
        g.live = { ok: false, err: (e && e.message) || String(e), clauses: {} };
      }
      this._tsRefreshRight();
    },

    async _tsCopyYaml() {
      const g = this._stu;
      if (!g || !g.template.trim()) return;
      const name = g.name.trim() || 'My Template Helper';
      const ind = (s) => String(s).split('\n').map((l) => '          ' + l).join('\n');
      const lines = ['template:', `  - ${g.domain}:`, `      - name: "${name.replace(/"/g, '\\"')}"`];
      if (g.unit && g.domain === 'sensor') lines.push(`        unit_of_measurement: "${g.unit.replace(/"/g, '\\"')}"`);
      if (g.device_class) lines.push(`        device_class: ${g.device_class}`);
      if (g.state_class && g.domain === 'sensor') lines.push(`        state_class: ${g.state_class}`);
      lines.push('        state: >', ind(g.template));
      if (g.availability.trim()) lines.push('        availability: >', ind(g.availability));
      const yaml = lines.join('\n');
      try { await navigator.clipboard.writeText(yaml); this._toast(T('ts_copied_yaml')); }
      catch (e) { this._toast(T('ts_copy_failed')); }
    },

    async _tsTrySandbox() {
      const g = this._stu;
      if (!g || !g.template.trim()) { this._$.modal.querySelector('.aval').textContent = T('ts_need_tpl'); return; }
      const name = g.name.trim() || T('ts_default_name');
      const key = g.entityId || `${g.domain}.${slugify(name) || 'template_helper'}`;
      const rule = Object.assign({ kind: 'template', state: g.template }, g.availability.trim() ? { availability: g.availability } : {});
      const reads = (g.lastExplain && g.lastExplain.entities) || [];
      const initVal = g.live && g.live.ok ? String(g.live.value) : 'unknown';
      const state = {
        entity_id: key,
        state: g.domain === 'binary_sensor' ? (['1', 'true', 'on', 'yes'].includes(initVal.trim().toLowerCase()) ? 'on' : 'off') : initVal,
        attributes: Object.assign({ friendly_name: name }, g.unit ? { unit_of_measurement: g.unit } : {}, g.device_class ? { device_class: g.device_class } : {}),
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        context: {},
      };
      this._closeModal();
      await this._openSandbox({ extra: { id: key, derived: { rule, reads }, state } });
      if (!this._sbxOn()) return;
      this._toast(T('ts_tried', { name }), [{ text: T('nb_back'), fn: () => this._tsShow() }]);
    },

    async _tsSave() {
      if (!this._full()) return;
      const g = this._stu, m = this._$.modal, val = m.querySelector('.aval'), btn = m.querySelector('[data-act="ts-save"]');
      if (!g) return;
      this._tsReadMeta(m);
      const name = g.name.trim();
      if (!name) { val.textContent = T('ts_need_name'); return; }
      if (g.mode === 'recipe') {
        const why = TPL_RECIPES[g.kind].validate(g.spec);
        if (why) { val.textContent = why; return; }
      }
      if (!g.template.trim()) { val.textContent = T('ts_need_tpl'); return; }
      btn.disabled = true;
      val.textContent = '';

      const pickFields = (schema, wanted) => {
        const allowed = new Set((Array.isArray(schema) ? schema : []).map((f) => f && f.name).filter(Boolean));
        if (!allowed.size) return wanted;
        const out = {};
        Object.entries(wanted).forEach(([k, v]) => { if (allowed.has(k) && v !== '' && v != null) out[k] = v; });
        return out;
      };

      const wanted = {
        name,
        state: g.template,
        ...(g.availability.trim() ? { availability: g.availability } : {}),
        ...(g.domain === 'sensor' && g.unit.trim() ? { unit_of_measurement: g.unit.trim() } : {}),
        ...(g.device_class ? { device_class: g.device_class } : {}),
        ...(g.domain === 'sensor' && g.state_class ? { state_class: g.state_class } : {}),
      };

      try {
        let entryId = g.entryId, entityId = g.entityId;
        if (entryId) {
          const f0 = await this._api('POST', 'config/config_entries/options/flow', { handler: entryId });
          if (!f0 || !f0.flow_id) throw new Error('options flow did not start');
          const body = pickFields(f0.data_schema, wanted);
          delete body.name;
          const f1 = await this._api('POST', `config/config_entries/options/flow/${encodeURIComponent(f0.flow_id)}`, body);
          if (f1 && f1.errors && Object.keys(f1.errors).length) throw new Error(Object.values(f1.errors).join(', '));
        } else {
          const f0 = await this._api('POST', 'config/config_entries/flow', { handler: 'template', show_advanced_options: true });
          if (!f0 || !f0.flow_id) throw new Error('template helper flow did not start');
          let step = f0;
          if (step.type === 'menu') {
            step = await this._api('POST', `config/config_entries/flow/${encodeURIComponent(step.flow_id)}`, { next_step_id: g.domain });
          }
          const body = pickFields(step && step.data_schema, wanted);
          const fin = await this._api('POST', `config/config_entries/flow/${encodeURIComponent(step.flow_id)}`, body);
          if (fin && fin.errors && Object.keys(fin.errors).length) throw new Error(Object.values(fin.errors).join(', '));
          entryId = (fin && fin.result && fin.result.entry_id) || (fin && fin.entry_id) || null;
          const label = g.label;
          for (let i = 0; i < 30 && !entityId; i++) {
            this._store.changed('reg');
            await this._regNow();
            const found = entryId && this._ents.find((e) => e.config_entry_id === entryId);
            if (found) entityId = found.entity_id;
            else {
              const guess = `${g.domain}.${slugify(name)}`;
              if (this._entMap.has(guess)) entityId = guess;
              else await this._clock.pause(200);
            }
          }
          if (entityId && label) await this._bldLabel(entityId, label);
        }
        const label = g.label;
        if (entityId && label && g.mode === 'recipe') {
          const LL = this._layout(label);
          LL.builders = Object.assign({}, LL.builders || {});
          LL.builders[entityId] = { kind: g.kind, spec: cleanTplRecipe(g.kind, g.spec) };
          this._save();
        }
        const madeEntryId = !g.entryId ? entryId : null;
        const madeEntityId = entityId;
        this._closeModal();
        this._stu = null;
        this._store.changed('reg');
        if (label) this._open(label, true);
        if (madeEntryId) {
          this._history({
            label,
            text: T('ts_step_new', { name }),
            undo: async () => {
              await this._api('DELETE', `config/config_entries/entry/${encodeURIComponent(madeEntryId)}`);
              const LL = this._layout(label);
              if (madeEntityId && LL.builders) { delete LL.builders[madeEntityId]; this._save(); }
              this._store.changed('reg');
            },
            redo: () => { this._toast(T('ts_redo_note')); },
          });
        }
        this._toast(g.entryId ? T('ts_updated', { name }) : T('ts_created', { name, fnName: this._fnName(label) }), madeEntryId ? [{ text: T('undo'), fn: () => this._undo() }] : []);
      } catch (e) {
        val.textContent = T('ts_not_saved', { e: (e && (e.message || e.code)) || e });
        btn.disabled = false;
      }
    },

    _tsHA() {
      const g = this._stu, n = g && g.entityId && this._model && this._model.nodes.get(g.entityId);
      this._closeModal();
      this._stu = null;
      if (n) this._moreInfo(n.key, 'settings');
    },
};
