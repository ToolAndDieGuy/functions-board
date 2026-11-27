import { BADGES, CAPTURE_KEY, Clock, DEFS, EXACT_RE, FULL_ONLY_TEST, HELPER_DOMAINS, HELPER_PLATFORMS, HOLD_MS, HOP, ICONS, LANG, Link, NH, NOTIFY_EVENTS, NW, P, PROTO, ROLE_RANK, SAME_ORIGIN, SBX_PRESS, STORE, STYLE, Store, T, TARGET_KEYS, TGT_RE, TPL_RE, TYPE, VER_HELPERS, VER_OK_ACTS, WARM_MS, XH, XW, actionMap, ago, analyze, anchor, arrowGeo, bothWays, clash, cleanCheck, cleanLayout, clock, cssColor, edgeGeom, esc, fill, findFunctions, findProblems, focusSet, inside, layered, lessMotion, loopEdges, markProblems, morph, orthoAll, orthoSides, portYs, regSig, roundPath, setCurved, setDomains, setLang, shorten, sides, toList, toLoose, uid } from './lib/index.js';

let REG = null, DESC = null;

export class FunctionsBoard extends HTMLElement {
    /* ======================================================================================================
       part: core: what every part shares: start and stop, data and sync, the store's maps, the open function and its
       model, drawing the board (boxes, arrows, view, pointer, keyboard, the Key, the bars), the board's modes (a
       version tab, the sandbox, a run lit on the board, an arrow being drawn), the drawer, the actions
       (_actionTables), undo
       ====================================================================================================== */
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._init();
      this._flushNow = () => { if (document.visibilityState !== 'visible') this._flushSave(); };
      this._winKeyFn = (e) => this._winKey(e);
    }
    // the state of a fresh page; _relang starts from it again
    _init() {
      this._data = null; this._model = null;
      this._labels = []; this._ents = []; this._devs = [];
      this._probs = new Map(); this._checkRes = new Map();
      this._entMap = new Map(); this._devMap = new Map(); this._labelMap = new Map(); this._regIdMap = new Map();
      this._view = { x: 40, y: 40, k: 1 };
      this._sel = null; this._focus = null; this._focusEdges = new Set(); this._els = new Map();
      this._drag = null; this._pointers = new Map(); this._live = new Map(); this._prev = new Map();
      this._drawer = null; this._capture = null; this._runs = []; this._errKeys = new Set(); this._pick = new Set();
      this._unsubs = []; this._clock = new Clock(); this._token = 0;
      // every call to Home Assistant (0.10.0): through the link, which orders, times and reports them (the only
      // place the board reaches this._hass's own calls)
      this._ha = new Link({
        ws: (m) => this._hass.callWS(m),
        api: (method, path, body) => this._hass.callApi(method, path, body),
        service: (domain, service, data, target) => this._hass.callService(domain, service, data, target),
        sub: (m, cb) => this._hass.connection.subscribeMessage(cb, m),
        ready: (cb) => { const c = this._hass.connection, f = () => cb(); c.addEventListener('ready', f); return () => c.removeEventListener('ready', f); },
      }, { clock: this._clock, report: (e) => console.warn(`Functions Board: ${e.kind} ${e.what} failed (${e.code}): ${e.message}`) });
      this._haConn = {
        subscribeMessage: (cb, m, o) => this._ha.sub(m, cb, o),
        subscribeEvents: (cb, type, o) => this._ha.sub({ type: 'subscribe_events', event_type: type }, cb, o),
        onReady: (cb) => this._ha.ready(cb),
      }; this._booting = false;
      this._watch = new Map(); this._toastActs = [];
      // what the board knows of Home Assistant, each fact with the time it was asked (0.10.0): the registries ('reg'),
      // configs ('cfg:<entity id>'), and the time of the shared board data ('data')
      this._store = new Store((key) => (key === 'reg' ? this._fetchRegistries() : key.startsWith('cfg:') ? this._readConfig(key.slice(4)) : key.startsWith('dtrig:') ? this._readDevTrig(key.slice(6)) : key.startsWith('zw:') ? this._readZw(key.slice(3)) : Promise.reject(new Error('the store has no way to read ' + key))));
      this._undoStack = []; this._redoStack = [];
      this._tgt = new Map(); this._src = new Map();
      // developer tools (Phase 9): simulated states, trigger watches, check results, monitors, the debugger
      this._sim = new Map(); this._simAt = new Map(); this._tw = new Map(); this._cond = new Map(); this._liveE = new Map();
      this._monSubs = new Map(); this._monData = new Map(); this._monCount = new Map();
      this._testLog = []; this._testOk = false; this._bld = null; this._dbg = null; this._dbgSeq = 0; this._lit = null;
    }
    // the user picked another language (4.9): stop what runs, save what is pending, and build the page again
    // as on a fresh visit. What Home Assistant set and Undo's steps stay; everything else starts over.
    _relang() {
      this._flushSave(); this._unsubscribe(); this._listen(false);
      if (this._ro) this._ro.disconnect();
      this._clock.stop();
      const keep = new Set(['_hass', '_config', '_panelObj', '_route', '_narrow', '_isPanel', '_layoutMode',
        '_flushNow', '_winKeyFn', '_rootOn']);
      const undo = this._undoStack, redo = this._redoStack;
      Object.keys(this).forEach((k) => { if (k.startsWith('_') && !keep.has(k)) delete this[k]; });
      this._init();
      this._undoStack = undo; this._redoStack = redo;
    }

    setConfig(config) { this._config = config || {}; }
    getCardSize() { return 12; }
    static getStubConfig() { return {}; }

    set hass(hass) {
      this._hass = hass;
      setLang(hass.language);
      // the user picked another language in their profile: start the page again in it (4.9)
      if (this._$ && this._lang !== LANG && !this._booting) this._relang();
      if (!this._$) this._build();
      if (hass.user && !hass.user.is_admin) { this._renderNoAdmin(); return; }
      if (!this._data) { if (!this._booting) this._boot(); return; }
      this._clock.once('states', 1000, () => this._refreshStates());
      this._clock.once('probscan', 60000, () => this._scanProblems());
    }
    get hass() { return this._hass; }
    // set by Home Assistant when this runs as the integration's sidebar page
    set panel(p) { this._panelObj = p; this._applyMode(); }
    get panel() { return this._panelObj; }
    set narrow(v) { this._narrow = !!v; this._applyMode(); }
    get narrow() { return this._narrow; }
    // in the sidebar page each function has its own address, /functions/<label id>, so Back and links work (4.2)
    set route(r) { this._route = r; if (this._data && !this._booting && this._mode() === 'panel') this._followRoute(); }
    get route() { return this._route; }
    // set by Home Assistant when this runs as a dashboard card
    set isPanel(v) { this._isPanel = !!v; this._applyMode(); }
    get isPanel() { return this._isPanel; }
    set layout(v) { this._layoutMode = v; this._applyMode(); }
    get layout() { return this._layoutMode; }
    getGridOptions() { return { columns: 'full' }; }
    _mode() { return this._panelObj ? 'panel' : (this._isPanel || this._layoutMode === 'panel') ? 'view' : 'card'; }
    _applyMode() {
      if (!this._$) return;
      const b = this._$.board, mode = this._mode();
      ['m-panel', 'm-view', 'm-card'].forEach((c) => b.classList.toggle(c, c === 'm-' + mode));
      b.classList.toggle('narrow', !!this._narrow);
      const hint = this._$.cardhint;
      if (hint) hint.hidden = mode !== 'card' || !!(this._data && this._data.ui.hintOff);
    }
    _renderNoAdmin() {
      if (this._noAdmin) return;
      this._noAdmin = true;
      this._$.board.innerHTML = `<div class="noadmin"><ha-icon icon="mdi:shield-account-outline"></ha-icon><b>${T('the_functions_board_needs_an')}</b><span>${T('it_reads_automation_and_script')}</span></div>`;
    }

    connectedCallback() {
      this._clock.start();
      if (this._data) {
        this._subscribe();
        // back on the page: the open function's monitors listen again, and an open debugger records again
        if (this._model) { this._startMonitors(); this._afterOpen(this._model.label); }
        this._dbgResume();
        this._resumeCapture();
        // and what changed while it was away
        this._catchUp();
      }
      if (this._ro && this._$) this._ro.observe(this._$.board);
      window.addEventListener('pagehide', this._flushNow);
      document.addEventListener('visibilitychange', this._flushNow);
      window.addEventListener('keydown', this._winKeyFn);
    }
    disconnectedCallback() {
      window.removeEventListener('keydown', this._winKeyFn);
      // Home Assistant removes the page when another sidebar entry opens: stop everything that keeps running
      this._unsubscribe(); this._listen(false);
      if (this._ro) this._ro.disconnect();
      window.removeEventListener('pagehide', this._flushNow);
      document.removeEventListener('visibilitychange', this._flushNow);
      this._flushSave();
      // and nothing it set runs while it's away (0.10.0): the clock starts again when it's back
      this._clock.stop();
    }

    /* ---------- small utilities ---------- */
    // to Home Assistant, through the link: a websocket message, a REST call, a service (o: { optional: '<why its
    // failure is expected>', fallback, timeout })
    _ws(msg, o) { return this._ha.ask(msg, o); }
    // a view's HTML put on the page by updating what's there (0.10.0, morph() in the library section): what has
    // focus, a scrolled place and the elements still there stay
    _put(el, html) { morph(el, html); }
    _api(method, path, body, o) { return this._ha.api(method, path, body, o); }
    _svc(domain, service, data, target, o) { return this._ha.service(domain, service, data, target, o); }
    async _loadData() {
      // The integration stores functions and layouts for everyone; without it they live in this user's data.
      let r = null;
      const asked = this._store.stamp();
      this._store.put('data', true, asked);
      try { r = await this._ws({ type: 'functions_board/get' }, { optional: 'without the integration, the board keeps its data in this user\u2019s own data' }); } catch (e) { r = null; }
      const ud = await this._ws({ type: 'frontend/get_user_data', key: STORE }, { fallback: null });
      const legacy = (ud && ud.value) || {};
      if (!r) { this._storeMode = 'user'; this._fbMode = 'organise'; return legacy; }
      this._storeMode = 'shared';
      // v0.4 integrations keep a revision per layout and take one layout per write; older ones take the whole store
      this._perLayout = !!r.revs;
      this._revs = Object.assign({}, r.revs || {});
      this._fbMode = r.mode === 'full' ? 'full' : 'organise';
      let shared = (r && r.data) || {};
      const chRes = await this._ws({ type: 'functions_board/checks' }, { optional: 'older integrations keep saved checks inside each layout', fallback: null });
      this._sepChecks = !!(chRes && chRes.checks && typeof chRes.checks === 'object');
      const checks = {};
      if (this._sepChecks) {
        Object.entries(chRes.checks).forEach(([k, v]) => {
          const list = (Array.isArray(v) ? v : []).slice(0, 50).map(cleanCheck).filter(Boolean);
          if (list.length) checks[k] = list;
        });
      }
      const uiData = await this._ws({ type: 'frontend/get_user_data', key: STORE + '_ui' }, { fallback: null });
      if (!Array.isArray(shared.functions) && (Array.isArray(legacy.functions) || legacy.layouts)) {
        shared = { v: 1, functions: legacy.functions || [], layouts: legacy.layouts || {} };
        await this._ws({ type: 'functions_board/set', data: shared, client: this._client() }, { fallback: null });
        this._revs = {};
        Object.keys(shared.layouts || {}).forEach((k) => { this._revs[k] = 1; });
        this._migrated = true;
      }
      if (this._sepChecks && shared.layouts && typeof shared.layouts === 'object') {
        Object.entries(shared.layouts).forEach(([k, L]) => {
          if (L && Array.isArray(L.checks)) {
            if (!checks[k] && L.checks.length) {
              const list = L.checks.slice(0, 50).map(cleanCheck).filter(Boolean);
              if (list.length) checks[k] = list;
            }
            delete L.checks;
          }
        });
      }
      return { functions: shared.functions || [], layouts: shared.layouts || {}, checks, ui: (uiData && uiData.value && uiData.value.ui) || legacy.ui || {} };
    }
    _client() { if (!this._cid) this._cid = uid() + uid(); return this._cid; }
    _full() { return this._fbMode === 'full'; }
    _sharedJson() { return JSON.stringify({ v: 1, functions: this._data.functions, layouts: this._data.layouts }); }
    _uiJson() { return JSON.stringify({ ui: this._data.ui }); }
    _markSaved(part) {
      // remember what is already stored, so opening a board or applying another board's change writes nothing
      if (!part || part === 'shared') {
        this._lastShared = this._sharedJson();
        this._lastFns = JSON.stringify(this._data.functions);
        this._lastLayouts = new Map(Object.entries(this._data.layouts).map(([k, L]) => [k, JSON.stringify(L)]));
        this._lastChecks = new Map(Object.entries(this._data.checks || {}).map(([k, list]) => [k, JSON.stringify(list)]));
      }
      if (!part || part === 'ui') this._lastUi = this._uiJson();
      if (!part) this._lastUser = JSON.stringify(this._data);
    }
    _save() {
      if (!this._data) return;
      this._savePending = true;
      // off the page, with its clock stopped, it's written at once: a write finishes wherever the board is
      if (!this._clock.running) { this._flushSave(); return; }
      this._clock.after('save', 700, () => this._doSave());
    }
    // a change made just before the tab closes or the page is left still gets written
    _flushSave() {
      if (!this._savePending || !this._data) return;
      this._clock.cancel('save');
      this._doSave();
    }
    _doSave() {
      this._savePending = false;
      // one write at a time, each looking at the data as it is when its turn comes
      this._saveChain = (this._saveChain || Promise.resolve()).then(() => this._writeNow()).catch((e) => {
        this._lastShared = this._lastUi = this._lastUser = this._lastFns = null;
        this._lastLayouts = new Map();  // retry everything on the next save
        this._lastChecks = new Map();
        this._toast(T('could_not_save_the_layout', { message: e.message || e.code }));
      });
      return this._saveChain;
    }
    async _writeNow() {
      const d = this._data, jobs = [];
      if (this._storeMode === 'shared') {
        const uj = this._uiJson();
        if (uj !== this._lastUi) { this._lastUi = uj; jobs.push(this._ws({ type: 'frontend/set_user_data', key: STORE + '_ui', value: JSON.parse(uj) })); }
        if (this._perLayout) {
          // only what changed: the functions list, and each layout on its own with its revision
          const fj = JSON.stringify(d.functions);
          if (fj !== this._lastFns) { this._lastFns = fj; jobs.push(this._ws({ type: 'functions_board/set_functions', functions: d.functions, client: this._client() })); }
          const labels = new Set([...Object.keys(d.layouts), ...this._lastLayouts.keys()]);
          labels.forEach((label) => {
            const L = d.layouts[label];
            let j = null;
            if (L) {
              if (this._sepChecks && 'checks' in L) {
                const copy = Object.assign({}, L);
                delete copy.checks;
                j = JSON.stringify(copy);
              } else j = JSON.stringify(L);
            }
            const was = this._lastLayouts.has(label) ? this._lastLayouts.get(label) : null;
            if (j !== was) jobs.push(this._writeLayout(label, j, was));
          });
        } else {
          const sj = this._sharedJson();
          if (sj !== this._lastShared) { this._lastShared = sj; jobs.push(this._ws({ type: 'functions_board/set', data: JSON.parse(sj), client: this._client() })); }
        }
        if (this._sepChecks) {
          const curChecks = d.checks || {};
          const chLabels = new Set([...Object.keys(curChecks), ...(this._lastChecks ? this._lastChecks.keys() : [])]);
          chLabels.forEach((label) => {
            const list = curChecks[label], j = list && list.length ? JSON.stringify(list) : null;
            const was = this._lastChecks && this._lastChecks.has(label) ? this._lastChecks.get(label) : null;
            if (j !== was) jobs.push(this._writeChecks(label, j, was));
          });
        }
      } else {
        const all = JSON.stringify(d);
        if (all !== this._lastUser) { this._lastUser = all; jobs.push(this._ws({ type: 'frontend/set_user_data', key: STORE, value: d })); }
      }
      await Promise.all(jobs);
    }
    async _writeChecks(label, j, was) {
      this._lastChecks = this._lastChecks || new Map();
      if (j == null) this._lastChecks.delete(label); else this._lastChecks.set(label, j);
      try {
        await this._ws({ type: 'functions_board/set_checks', label, checks: j == null ? [] : JSON.parse(j), client: this._client() });
      } catch (e) {
        if (was == null) this._lastChecks.delete(label); else this._lastChecks.set(label, was);
        throw e;
      }
    }
    async _writeLayout(label, j, was) {
      if (j == null) this._lastLayouts.delete(label); else this._lastLayouts.set(label, j);
      let r;
      try {
        r = await this._ws({ type: 'functions_board/set_layout', label, layout: j == null ? null : JSON.parse(j), rev: this._revs[label] || 0, client: this._client() });
      } catch (e) {
        if (was == null) this._lastLayouts.delete(label); else this._lastLayouts.set(label, was);
        throw e;
      }
      if (r && r.conflict) {
        // another board saved this function's layout since this one loaded it: its version wins
        this._revs[label] = r.rev;
        this._takeRemoteLayout(label, r.layout);
        this._toast(T('was_rearranged_on_another_board', { fnName: this._fnName(label) }));
        if (this._model && this._model.label === label) { this._place(); this._render(); }
      } else if (r && r.rev != null) this._revs[label] = r.rev;
    }
    _takeRemoteLayout(label, layout) {
      if (layout) { this._data.layouts[label] = cleanLayout(layout); this._lastLayouts.set(label, JSON.stringify(this._data.layouts[label])); }
      else { delete this._data.layouts[label]; this._lastLayouts.delete(label); }
    }
    async _onShared(msg) {
      // another open board (another admin, or this admin on another device) saved: take its changes
      const d = msg || {};
      if (this._storeMode !== 'shared' || !this._data) return;
      if (d.what === 'mode') { this._fbMode = d.mode === 'full' ? 'full' : 'organise'; this._$.board.classList.toggle('full', this._fbMode === 'full'); this._renderHeader(); this._renderNodebar(); return; }
      if (d.client && d.client === this._client()) return;
      // another board read Node-RED: one showing older flows takes the new ones (only with Node-RED switched on)
      if (d.what === 'versions') { if (this._drawer && this._drawer.mode === 'versions' && d.label === this._data.ui.current) this._renderVersions(); return; }
      if (d.what === 'nodered') {
        this._nrTheirs();
        return;
      }
      if (d.what === 'checks' && this._sepChecks && d.label) {
        try {
          const cur = (this._data.checks || {})[d.label];
          const mine = cur && cur.length ? JSON.stringify(cur) : null;
          const synced = this._lastChecks && this._lastChecks.has(d.label) ? this._lastChecks.get(d.label) : null;
          if (mine !== synced) return;
          const chRes = await this._ws({ type: 'functions_board/checks', label: d.label }, { optional: 'older integrations keep saved checks inside each layout', fallback: null });
          if (!chRes || !Array.isArray(chRes.checks)) return;
          const list = chRes.checks.slice(0, 50).map(cleanCheck).filter(Boolean);
          this._data.checks = this._data.checks || {};
          this._lastChecks = this._lastChecks || new Map();
          if (list.length) { this._data.checks[d.label] = list; this._lastChecks.set(d.label, JSON.stringify(list)); }
          else { delete this._data.checks[d.label]; this._lastChecks.delete(d.label); }
          if (d.label === this._data.ui.current) { this._renderChecks(); this._checksSoon(d.label); }
        } catch (e) { /* keep current checks */ }
        return;
      }
      const act = this.shadowRoot.activeElement;
      if (this._drag || (act && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName))) {
        // finish what's in hand first; pick the change up shortly after
        this._clock.after('remote', 1500, () => this._onShared({ what: 'all' }));
        return;
      }
      try {
        const asked = this._store.stamp();
        const r = await this._ws({ type: 'functions_board/get' });
        // the board data is as new as this question: registries asked before it delete nothing it names
        this._store.put('data', true, asked);
        const s2 = (r && r.data) || {}, revs = (r && r.revs) || {};
        if (r && r.mode) this._fbMode = r.mode === 'full' ? 'full' : 'organise';
        const fns = Array.isArray(s2.functions) ? s2.functions.filter((f) => typeof f === 'string') : [];
        if (JSON.stringify(this._data.functions) === this._lastFns || !this._perLayout) { this._data.functions = fns; this._lastFns = JSON.stringify(fns); }
        const remote = s2.layouts && typeof s2.layouts === 'object' ? s2.layouts : {};
        const labels = new Set([...Object.keys(remote), ...Object.keys(this._data.layouts)]);
        labels.forEach((label) => {
          // a layout with a change of this board's own still waiting to be saved keeps it
          const mine = this._data.layouts[label] ? JSON.stringify(this._data.layouts[label]) : null;
          const synced = this._lastLayouts.has(label) ? this._lastLayouts.get(label) : null;
          if (mine !== synced && this._perLayout) return;
          this._takeRemoteLayout(label, remote[label]);
          this._revs[label] = revs[label] || 0;
        });
        this._lastShared = this._sharedJson();
        this._renderList();
        if (this._data.ui.current && this._data.functions.includes(this._data.ui.current)) this._open(this._data.ui.current, true);
      } catch (e) { /* keep what we have */ }
    }
    _viewKey(label) { return label + '|' + this._mode() + (this._compact ? '|narrow' : ''); }
    _viewFor(label) {
      // pan and zoom are per person and per board size (sidebar page, dashboard card, phone);
      // layouts from v0.2 kept one wide-screen view in the shared layout
      const u = this._data.ui, old = this._data.layouts[label] && this._data.layouts[label].view;
      return (u.views && u.views[this._viewKey(label)]) || (!this._compact && this._mode() !== 'card' && old) || null;
    }
    _layout(label) {
      if (this._ver && this._ver.label === label) return this._ver.layout;
      const all = this._data.layouts;
      if (!all[label]) all[label] = { nodes: {}, frames: [], notes: [], view: null, categories: null };
      const L = all[label];
      L.nodes = L.nodes || {}; L.frames = L.frames || []; L.notes = L.notes || [];
      return L;
    }
    _checksOf(label) {
      if (!label || (this._ver && this._ver.label === label)) return [];
      if (this._sepChecks) {
        this._data.checks = this._data.checks || {};
        const L = this._data.layouts && this._data.layouts[label];
        if (L && Array.isArray(L.checks)) {
          if (!(this._data.checks[label] && this._data.checks[label].length) && L.checks.length) this._data.checks[label] = L.checks;
          delete L.checks;
        }
        return this._data.checks[label] || [];
      }
      return this._layout(label).checks || [];
    }
    _setChecks(label, list) {
      if (!label) return;
      if (this._sepChecks) {
        this._data.checks = this._data.checks || {};
        if (list && list.length) this._data.checks[label] = list;
        else delete this._data.checks[label];
        if (this._data.layouts && this._data.layouts[label] && 'checks' in this._data.layouts[label]) delete this._data.layouts[label].checks;
      } else {
        this._layout(label).checks = list;
      }
    }
    _known(x) {
      if (this._hass.states[x] || this._entMap.has(x)) return x;
      return this._regIdMap.get(x) || null;
    }
    // acts: [{ text, fn }] buttons such as Undo or Go there; a toast with buttons stays up longer
    _toast(msg, acts) {
      const t = this._$.toast;
      this._toastActs = acts || [];
      t.innerHTML = `<span>${esc(msg)}</span>` + this._toastActs.map((a, i) => `<button data-act="toast-act" data-i="${i}">${esc(a.text)}</button>`).join('');
      t.hidden = false;
      this._clock.after('toast', this._toastActs.length ? 9000 : 4500, () => { t.hidden = true; this._toastActs = []; });
    }
    _fatal(e) {
      console.error('functions-board', e);
      this._$.empty.hidden = false;
      this._$.empty.innerHTML = `<div><b>${T('the_functions_board_couldn_t')}</b><br>${esc((e && (e.message || e.code)) || e)}</div>`;
    }
    _twoStep(el, text, fn) {
      if (el.dataset.confirm) { delete el.dataset.confirm; el.innerHTML = el._orig; fn(); return; }
      el.dataset.confirm = '1'; el._orig = el.innerHTML; el.innerHTML = `<span>${esc(text)}</span>`;
      this._clock.after(null, 4000, () => { if (el.dataset.confirm) { delete el.dataset.confirm; el.innerHTML = el._orig; } });
    }

    /* ---------- skeleton ---------- */
    _build() {
      const r = this.shadowRoot;
      this._lang = LANG;
      r.innerHTML = `<style>${STYLE}</style>
<div class="board">
  <aside class="list"></aside>
  <div class="scrim" data-act="togglelist"></div>
  <section class="main">
    <header class="bar">
      <button class="ib hamenu" data-act="hamenu" title="${T('home_assistant_menu')}"><ha-icon icon="mdi:menu"></ha-icon></button>
      <button class="ib" data-act="togglelist" title="${T('show_or_hide_the_list')}"><ha-icon icon="mdi:format-list-bulleted"></ha-icon></button>
      <div class="title"></div>
      <div class="tools" role="toolbar" aria-label="${T('function_tools')}">
        <button data-act="new-automation" title="${T('new_automation_in_this_function')}"><ha-icon icon="mdi:robot-outline"></ha-icon><span>${T('automation')}</span></button>
        <button data-act="new-script" title="${T('new_script_in_this_function')}"><ha-icon icon="mdi:script-text-outline"></ha-icon><span>${T('script')}</span></button>
        <button data-act="recipes" title="${T('rcp_t')}" aria-haspopup="menu"><ha-icon icon="mdi:chef-hat"></ha-icon><span>${T('rcp_button')}</span></button>
        <button data-act="new-helper" title="${T('new_helper_in_this_function')}"><ha-icon icon="mdi:tune-variant"></ha-icon><span>${T('helper')}</span></button>
        <button data-act="add-existing" title="${T('bring_automations_scripts_helpers_or')}"><ha-icon icon="mdi:link-variant-plus"></ha-icon><span>${T('existing')}</span></button>
        <span class="sep"></span>
        <button class="ib" data-act="undo" title="${T('undo')}" disabled><ha-icon icon="mdi:undo"></ha-icon></button>
        <button class="ib" data-act="redo" title="${T('redo')}" disabled><ha-icon icon="mdi:redo"></ha-icon></button>
        <button class="sec" data-act="frame" title="${T('draw_a_frame_to_group')}"><ha-icon icon="mdi:selection"></ha-icon><span>${T('frame')}</span></button>
        <button class="sec" data-act="note" title="${T('add_a_note')}"><ha-icon icon="mdi:note-plus-outline"></ha-icon><span>${T('note')}</span></button>
        <button class="sec" data-act="arrange" title="${T('auto_arrange_resets_positions_you')}"><ha-icon icon="mdi:auto-fix"></ha-icon><span>${T('arrange')}</span></button>
        <button class="sec" data-act="hl" title="${T('arrows_what_lights_up_around')}"><ha-icon icon="mdi:vector-polyline"></ha-icon><span>${T('arrows')}</span></button>
        <span class="sep"></span>
        <button class="sec" data-act="runs" title="${T('every_run_of_every_automation')}"><ha-icon icon="mdi:timeline-clock-outline"></ha-icon><span>${T('runs')}</span></button>
        <button class="sec" data-act="debug" title="${T('debugger_what_happens_in_this')}"><ha-icon icon="mdi:bug-outline"></ha-icon><span>${T('debug_2')}</span></button>
        <button class="sec" data-act="sandbox" title="${T('sbx_button_t')}"><ha-icon icon="mdi:flask-outline"></ha-icon><span>${T('sbx_button')}</span></button>
        <button class="sec vonly" data-act="versions" title="${T('ver_button_t')}"><ha-icon icon="mdi:history"></ha-icon><span>${T('ver_button')}</span></button>
        <button data-act="pause" class="pause sec" hidden></button>
      </div>
    </header>
    <div class="stage">
    <div class="vp">
      <div class="world"><div class="frames"></div><svg class="edges" aria-hidden="true"></svg><svg class="flowx" aria-hidden="true"></svg><div class="nodes" role="group" aria-label="${T('boxes_arrow_keys_follow_the')}"></div><div class="flow"></div><div class="notes"></div><svg class="links" aria-hidden="true"></svg></div>
      <div class="empty" hidden></div>
      <div class="cardhint" hidden><ha-icon icon="mdi:information-outline"></ha-icon><span>${T('this_card_works_best_in')}</span><button data-act="hint-x" title="${T('dismiss')}">&times;</button></div>
      <div class="nodebar" role="toolbar" hidden></div>
      <div class="lh" hidden title="${T('drag_onto_another_box_to')}"></div>
      <div class="edgebar" hidden></div>
      <div class="zoom"><button data-act="zoomout" title="${T('zoom_out')}">&minus;</button><button data-act="fit" title="${T('fit_everything')}"><ha-icon icon="mdi:fit-to-screen-outline"></ha-icon></button><button data-act="zoomin" title="${T('zoom_in')}">+</button></div>
      <div class="legend"></div>
      <div class="loading" hidden>${T('reading_configs')}</div>
      <div class="vtabs" hidden></div>
      <div class="sbxpill" hidden><ha-icon icon="mdi:flask-outline"></ha-icon>${T('sbx_pill')}</div>
      <div class="litbar" hidden></div>
      <div class="ttip" hidden></div>
      <div class="toast" role="status" aria-live="polite" hidden></div>
    </div>
    <div class="drawer" hidden></div>
    </div>
  </section>
  <div class="modal" hidden></div>
</div>`;
      const q = (s) => r.querySelector(s);
      this._$ = {
        board: q('.board'), list: q('.list'), title: q('.title'), tools: q('.tools'), pause: q('.pause'), vp: q('.vp'),
        world: q('.world'), frames: q('.frames'), edges: q('.edges'), nodes: q('.nodes'), notes: q('.notes'),
        empty: q('.empty'), nodebar: q('.nodebar'), legend: q('.legend'), loading: q('.loading'), toast: q('.toast'),
        drawer: q('.drawer'), modal: q('.modal'), cardhint: q('.cardhint'), litbar: q('.litbar'), ttip: q('.ttip'),
        edgebar: q('.edgebar'), links: q('.links'), lh: q('.lh'), sbxpill: q('.sbxpill'), flow: q('.flow'), flowx: q('.flowx'), vtabs: q('.vtabs'),
      };
      // the shadow root outlives a rebuild in another language (_relang): it keeps its listeners
      if (!this._rootOn) {
        this._rootOn = true;
        r.addEventListener('click', (e) => this._onClick(e));
        r.addEventListener('change', (e) => this._onChange(e));
        r.addEventListener('input', (e) => this._onInput(e));
        r.addEventListener('dblclick', (e) => this._onDbl(e));
        r.addEventListener('focusout', (e) => this._onBlur(e));
        r.addEventListener('focusin', (e) => this._onFocus(e));
        r.addEventListener('keydown', (e) => this._onKey(e));
      }
      const vp = this._$.vp;
      vp.addEventListener('pointerdown', (e) => this._onDown(e));
      vp.addEventListener('pointermove', (e) => { if (this._linking && !this._linking.drag) this._linkMove(e); });
      vp.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
      // holding a finger on a box to move it must not open the phone's own menu; and when the phone says it's a long
      // press (it buzzes then), the box is picked up at that moment, whatever HOLD_MS says (0.13.0)
      vp.addEventListener('contextmenu', (e) => { if (this._drag && this._drag.touch) { e.preventDefault(); this._lift(this._drag); } });
      this._$.drawer.addEventListener('mouseover', (e) => { const x = e.target.closest('.run, .dbrow, .wrow'); this._hover(x ? x.dataset.key || null : null); });
      // hovering an arrow that comes from a template shows the template's value right now (9.3)
      const ed = this._$.edges;
      ed.addEventListener('pointerover', (e) => { const p = e.target.closest('path.hit'); if (p) this._edgeHover(p.dataset.e, e); });
      // pointing at a box traces its arrows through the shared lines it's on
      const ns = this._$.nodes;
      ns.addEventListener('pointerover', (e) => { if (e.pointerType === 'touch' || this._drag) return; const n = e.target.closest('.node'); this._setTrace(n ? this._busEdgesOf(n.dataset.key) : null); });
      ns.addEventListener('pointerleave', () => this._setTrace(null));
      ed.addEventListener('pointermove', (e) => this._ttPointerMove(e));
      ed.addEventListener('pointerout', (e) => this._ttPointerOut(e));
      this._$.drawer.addEventListener('mouseleave', () => this._hover(null));
      this._renderLegend();
      this._applyMode();
      this._watchModal();
      this._watchDrawer();
      if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this._checkCompact()); this._ro.observe(this._$.board); }
    }

    /* ---------- data loading ---------- */
    async _boot() {
      this._booting = true;
      try {
        const d = await this._loadData();
        this._data = {
          v: 1,
          functions: Array.isArray(d.functions) ? d.functions.filter((f) => typeof f === 'string') : [],
          layouts: this._cleanLayouts(d.layouts),
          checks: d.checks && typeof d.checks === 'object' ? d.checks : {},
          ui: Object.assign({ current: null, list: true, outside: true, suggest: true, legend: true }, d.ui || {}),
        };
        this._markSaved();
        await Promise.all([this._loadRegistries('warm'), this._loadDescriptions()]);
        // the problem counts on the list, soon after the page is up (then as states and configs change)
        this._clock.once('probscan0', 2000, () => this._scanProblems());
        this._subscribe();
        this._renderLegend();
        this._applyMode();
        this._renderList();
        if (this._migrated) this._toast(T('moved_your_functions_and_layouts'));
        const want = this._mode() === 'panel' ? this._routeLabel() : null;
        if (want && !this._data.functions.includes(want)) this._toast(T('there_s_no_function_on_2', { want }));
        const cur = want && this._data.functions.includes(want) ? want : this._data.functions.includes(this._data.ui.current) ? this._data.ui.current : this._data.functions[0];
        if (cur) await this._open(cur, false, { replace: true });
        else { this._renderHeader(); this._setEmpty(); }
        this._resumeCapture();
        if (this._regWarm) this._clock.after('warm', 600, () => this._refreshWarm());
      } catch (e) { this._fatal(e); }
      this._booting = false;
    }

    async _fetchRegistries() {
      const d = await Promise.all([
        this._ws({ type: 'config/label_registry/list' }),
        this._ws({ type: 'config/entity_registry/list' }),
        this._ws({ type: 'config/device_registry/list' }),
        this._ws({ type: 'config/area_registry/list' }, { fallback: [] }),
        this._ws({ type: 'config/floor_registry/list' }, { fallback: [] }),
      ]);
      return d;
    }
    // the registries, through the store: asked now (how: undefined), as held ('held': just loaded), or, at start-up,
    // the last board's if they're recent ('warm', see WARM_MS: then asked again in the background)
    async _loadRegistries(how) {
      const user = this._hass.user && this._hass.user.id;
      this._regWarm = false;
      if (how === 'warm' && !this._store.has('reg') && REG && REG.user === user && Date.now() - REG.at < WARM_MS) { this._store.put('reg', REG.data, REG.asked); this._regWarm = true; }
      else if (how !== 'held') await this._store.load('reg');
      if (!this._regWarm) REG = { data: this._store.get('reg'), asked: this._store.at('reg'), at: Date.now(), user };
      this._index();
    }
    // registries asked now, for a plan the person is about to carry out (a change Home Assistant hasn't told of yet,
    // as an automation just deleted, is in them); a reload in flight asked after the click is shared
    async _regNow() { await this._store.load('reg'); this._index(); }
    // the maps the board reads, made from the registries in one place; and what the registries say is gone
    _index() {
      const [labels, ents, devs, areas, floors] = this._store.get('reg');
      this._areaMap = new Map((areas || []).map((a) => [a.area_id, a]));
      this._floorMap = new Map((floors || []).map((f) => [f.floor_id, f]));
      this._tgt = new Map(); this._src = new Map();  // what areas and helpers contain changes with the registries
      setDomains(new Set(Object.keys(this._hass.states).map((id) => id.split('.')[0]).concat((ents || []).map((e) => e.entity_id.split('.')[0]))));
      this._regAt = this._store.at('reg');
      this._labels = labels || []; this._ents = ents || []; this._devs = devs || [];
      this._labelMap = new Map(this._labels.map((l) => [l.label_id, l]));
      this._entMap = new Map(this._ents.map((e) => [e.entity_id, e]));
      this._regIdMap = new Map(this._ents.map((e) => [e.id, e.entity_id]));
      this._devMap = new Map(this._devs.map((d) => [d.id, d]));
      // nothing is deleted on the strength of registries older than the board data: a label missing from them may
      // be one made since (0.9.2: the last board's registries, reused, deleted a function another board had made)
      if (this._data && this._store.newer('reg', 'data')) {
        this._data.functions = this._data.functions.filter((l) => this._labelMap.has(l));
        // a label deleted in Home Assistant takes its layout with it; hidden functions keep theirs
        const gone = Object.keys(this._data.layouts).filter((k) => !this._labelMap.has(k));
        if (gone.length) { gone.forEach((k) => delete this._data.layouts[k]); this._save(); }
      }
    }
    _cleanLayouts(all) {
      const out = {};
      if (all && typeof all === 'object' && !Array.isArray(all)) Object.entries(all).forEach(([k, L]) => { out[k] = cleanLayout(L); });
      return out;
    }

    _subscribe() {
      if (this._unsubs.length || !this._hass) return;
      const c = this._haConn;
      const reload = () => { this._store.changed('reg'); this._store.changed('dtrig:'); this._store.changed('zw:'); this._clock.after('reg', 1200, () => this._reload()); };
      this._unsubs = [
        c.subscribeEvents((ev) => this._onRegistry(ev), 'entity_registry_updated'),
        // devices: only creation, removal, and labels, names or areas changing matter to the board (5.5)
        c.subscribeEvents((ev) => { const d = (ev && ev.data) || {}, ch = d.changes || {}; if (d.action !== 'update' || 'labels' in ch || 'name_by_user' in ch || 'area_id' in ch) reload(); }, 'device_registry_updated'),
        c.subscribeEvents(reload, 'label_registry_updated'),
        c.subscribeEvents((ev) => this._onRun(ev), 'automation_triggered'),
        c.subscribeEvents((ev) => this._onRun(ev), 'script_started'),
        this._storeMode === 'shared' ? this._subscribeShared(c) : null,
        // saving an automation reloads it; saving a script calls script.reload (filtered by Home Assistant)
        c.subscribeEvents(() => this._configChanged(), 'automation_reloaded'),
        c.subscribeMessage(() => this._configChanged(), { type: 'subscribe_trigger', trigger: { trigger: 'event', event_type: 'call_service', event_data: { domain: 'script', service: 'reload' } } }, { fallback: null }),
        // the connection lost and back (Home Assistant restarted, the network dropped): what was said meanwhile is gone
        c.onReady(() => this._catchUp()),
      ];
    }
    // what Home Assistant said while the board wasn't listening (it was off the page, or the connection was lost and
    // came back) never reached it: nothing it holds is taken as current; it reads the shared board data again, then
    // the registries, and opens the function again (a load is shared with one in flight asked late enough)
    _catchUp() {
      if (!this._data || this._booting) return;
      this._store.changed('cfg:'); this._store.changed('reg');
      this._src = new Map(); this._grefs = null; this._cfgGen = (this._cfgGen || 0) + 1;
      this._regWarm = false;
      this._clock.once('probscan2', 3000, () => this._scanProblems());
      this._clock.after('reg', 300, async () => {
        if (this._storeMode === 'shared') await this._onShared({ what: 'all' });
        await this._reload();
      });
    }
    // changes saved by other boards: v0.4 integrations send them to subscribers; older ones fire a bus event
    async _subscribeShared(c) {
      try { return await c.subscribeMessage((m) => this._onShared(m), { type: 'functions_board/subscribe' }, { optional: 'an integration before 0.4 tells boards of changes with an event instead' }); }
      catch (e) { return c.subscribeEvents((ev) => this._onShared(Object.assign({ what: 'all' }, (ev && ev.data) || {})), 'functions_board_updated'); }
    }
    // configs changed: forget the cached ones and redraw the open function, at most once a second
    _configChanged() {
      this._store.changed('cfg:'); this._src = new Map(); this._grefs = null; this._cfgGen = (this._cfgGen || 0) + 1;
      this._clock.once('probscan2', 3000, () => this._scanProblems());
      this._clock.once('cfg', 1000, () => {
        if (this._drag) { this._configChanged(); return; }
        const cur = this._data && this._data.ui.current;
        if (cur && this._data.functions.includes(cur)) this._open(cur, true).then(() => this._verRefresh());
      });
    }
    _unsubscribe() {
      const u = this._unsubs; this._unsubs = [];
      u.forEach((p) => this._ha.drop(p));
      // and the developer tools' own subscriptions (Phase 9)
      this._stopWatches(); this._stopMonitors(); this._edgeHoverEnd(); this._dbgStop(true);
      this._clock.cancel('conds-tick');
    }

    // held: the store has just loaded them
    async _reload(held) {
      try { await this._loadRegistries(held ? 'held' : undefined); } catch (e) { return; }
      this._renderList();
      const cur = this._data.ui.current;
      if (cur && this._data.functions.includes(cur)) await this._open(cur, true);
      else if (this._data.functions.length) await this._open(this._data.functions[0]);
      else { this._model = null; this._clearWorld(); this._renderHeader(); this._setEmpty(); }
    }

    async _onRegistry(ev) {
      const d = (ev && ev.data) || {}, id = d.entity_id;
      if (d.action === 'create' && this._capture && id) {
        const c = this._capture;
        if (await this._captureMatch(id, c)) await this._captured(id, c);
      } else if (d.action === 'update' && id && this._isWatched(id)) await this._rewatch(id);
      if (id && /^(automation|script)\./.test(id)) this._store.changed('cfg:' + id);
      // every change to the registry makes what's held older than it (as of now waits for the reload)
      this._store.changed('reg');
      const relevant = d.action !== 'update' || (this._model && this._model.nodes.has(id)) || (d.changes && 'labels' in d.changes);
      if (relevant) this._clock.after('reg', 1200, () => this._reload().then(() => this._verRefresh()));
    }

    async _open(label, keep, opt = {}) {
      if (!label) return;
      if (this._ver && this._ver.label !== label) { this._ver = null; this._$.board.classList.remove('vview'); }
      if (this._sbx && this._sbx.label !== label) this._closeDrawer();
      if (this._capture && this._capture.label !== label) this._capture = null;
      this._data.ui.current = label;
      if (!keep && !opt.fromRoute) this._pushRoute(label, !!opt.replace);
      this._save();
      // (a function with no layout yet gets one)
      this._layout(label);
      if (!keep) {
        this._sel = null;
        this._view = Object.assign({ x: 40, y: 40, k: 1 }, this._viewFor(label) || {});
        this._model = null;
        this._clearWorld();
        // what was watched, listened to or lit belongs to the function that was open (Phase 9)
        this._stopWatches(label); this._stopMonitors(); this._clearLit(true); this._edgeHoverEnd();
        this._cond = new Map(); this._condKeys = null;
      }
      this._renderList();
      this._renderHeader();
      this._$.loading.hidden = false;
      let model = null;
      const st0 = this._hass.states;
      try { model = await this._buildModel(label); } catch (e) { this._toast(T('could_not_read_this_function', { message: e.message || e })); }
      this._$.loading.hidden = true;
      if (!model || this._data.ui.current !== label) return;
      model.probSig = this._probSig(model, st0);
      this._model = model;
      this._applyCheckProblems(label);
      this._renderHeader();
      this._checksSoon(label);
      if (this._drawer && this._drawer.mode === 'problems') this._openProblems();
      this._place();
      this._render();
      if (!keep && !this._viewFor(label)) this._fit();
      if (this._pendingSelect && model.nodes.has(this._pendingSelect)) { this._select(this._pendingSelect); this._centerOn(this._pendingSelect); }
      this._pendingSelect = null;
      this._loadRuns();
      this._afterOpen(label);
      this._renderVtabs();
      this._verFromUrl();
    }
    // the developer tools follow the open function (Phase 9)
    _afterOpen(label) {
      this._startMonitors();
      this._testCondsSoon(150);
      // time and sun conditions change without any state changing
      this._clock.every('conds-tick', 30000, () => { if (document.visibilityState === 'visible' && this.isConnected) this._testConds(); });
      this._dbgFollow(label);
    }
    _routeLabel() {
      const m = String((this._route && this._route.path) || '').match(/^\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
    _followRoute() {
      const want = this._routeLabel();
      if (!want) { if (this._data.ui.current) this._pushRoute(this._data.ui.current, true); return; }
      if (want === this._data.ui.current) return;
      if (this._data.functions.includes(want)) { this._closeDrawer(); this._open(want, false, { fromRoute: true }); }
      else { this._toast(T('there_s_no_function_on', { want })); this._pushRoute(this._data.ui.current, true); }
    }
    _pushRoute(label, replace) {
      if (this._mode() !== 'panel' || !label || !this.isConnected) return;
      const path = ((this._route && this._route.prefix) || '/functions') + '/' + encodeURIComponent(label);
      if (location.pathname === path) return;
      history[replace ? 'replaceState' : 'pushState'](null, '', path);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: !!replace } }));
    }
    _centerOn(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      // the middle of the part of the board the drawer leaves visible
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      v.x = this._openWidth() / 2 - (n.x + n.w / 2) * v.k; v.y = r.height / 2 - (n.y + n.h / 2) * v.k;
      this._applyView();
    }

    _clearWorld() {
      ['nodes', 'frames', 'notes'].forEach((k) => { this._$[k].innerHTML = ''; });
      this._$.edges.innerHTML = '';
      this._$.nodebar.hidden = true;
      this._els = new Map();
    }

    async _fetchConfig(entityId) {
      // a saved version's own configs, while its tab is open
      const V = this._ver, it = V && V.snap.items[entityId];
      if (it && it.cfg && /^(automation|script)\./.test(entityId)) return this._verCfg(entityId, it);
      // configs are kept for a minute; saving, reloading or closing the editor drawer makes them stale, and one read
      // before that is never taken as current (the store)
      return this._store.asOfNow('cfg:' + entityId, 60000);
    }
    async _readConfig(entityId) {
      // one in the registry that isn't loaded (left over, disabled, its YAML gone) has no config to read: Home
      // Assistant answers not_found, which would be reported as a failure every time (the problems list shows it)
      if (!this._hass.states[entityId]) return null;
      const d = entityId.split('.')[0];
      let cfg = null;
      try { const r = await this._ws({ type: d + '/config', entity_id: entityId }); cfg = r && r.config ? r.config : null; }
      catch (e) { return null; }
      const bp = cfg && cfg.use_blueprint;
      if (bp && bp.path) {
        // a blueprint automation/script stores only its inputs: ask Home Assistant for the filled-in config to read the wiring
        try {
          const r = await this._ws({ type: 'blueprint/substitute', domain: d, path: bp.path, input: bp.input || {} });
          if (r && r.substituted_config) cfg = Object.assign({}, r.substituted_config, { alias: cfg.alias, id: cfg.id, use_blueprint: bp });
        } catch (e) { /* keep the inputs-only config: the box shows, without arrows */ }
      }
      return cfg;
    }

    async _buildModel(label) {
      const token = ++this._token;
      const nodes = new Map(), edges = new Map(), tgts = [];
      const V = this._ver && this._ver.label === label ? this._ver : null;
      const members = V ? V.snap.members.filter((k) => !k.startsWith('device:')) : this._ents.filter((e) => (e.labels || []).includes(label)).map((e) => e.entity_id);
      const devs = V ? V.snap.members.filter((k) => k.startsWith('device:')) : this._devs.filter((d) => (d.labels || []).includes(label)).map((d) => 'device:' + d.id);
      members.concat(devs).forEach((k) => {
        const n = this._mkNode(k, 'member');
        // its name as it was when the version was saved (renamed or deleted since)
        const it = V && V.snap.items[k];
        if (it && (it.cfg && it.cfg.alias || it.name)) n.name = (it.cfg && it.cfg.alias) || it.name;
        nodes.set(k, n);
      });
      const known = (x) => this._known(x);
      const logic = members.filter((e) => e.startsWith('automation.') || e.startsWith('script.'));
      const cfgs = await Promise.all(logic.map((e) => this._fetchConfig(e)));
      const an = logic.map((e, i) => (cfgs[i] ? analyze(cfgs[i], e.startsWith('script.'), known) : null));
      let sug = [];
      if (this._flt(label).suggest) {
        // Related = any automation or script outside the function whose config references a member
        // (triggers on it, checks it, changes it, or calls it). Reads every config: ~30 ms for 120 items.
        const memberSet = new Set(members.concat(devs));
        // on a saved version's board, what's in the function now isn't "related" (it was added since)
        const now = V ? new Set(this._verMembers(label)) : null;
        const all = this._logicIds().filter((e) => !memberSet.has(e) && !(now && now.has(e)));
        const cf = await Promise.all(all.map((e) => this._fetchConfig(e)));
        all.forEach((e, i) => {
          if (!cf[i]) return;
          const a = analyze(cf[i], e.startsWith('script.'), known);
          const hits = new Set(a.refs.map((r) => r.ref).filter((r) => memberSet.has(r)));
          if (hits.size) sug.push({ e, a, n: hits.size });
        });
        sug.sort((x, y) => y.n - x.n);
        sug = sug.slice(0, 20);
      }
      // area, floor and label targets (including any target.exclude refs), resolved by Home Assistant itself (2.2)
      const exKeys = (r) => (r.ex && typeof r.ex === 'object' ? Object.entries(TARGET_KEYS).flatMap(([k, pre]) => toList(r.ex[k]).filter((x) => typeof x === 'string' && x && !TPL_RE.test(x)).map((x) => pre + ':' + x)) : []);
      await this._resolveTargets(an.concat(sug.map((x) => x.a)).flatMap((a) => (a ? a.refs.flatMap((r) => (TGT_RE.test(r.ref) ? [r.ref] : []).concat(exKeys(r))) : [])));
      logic.forEach((e, i) => { if (an[i]) this._wire(e, an[i], nodes, edges, false, tgts); });
      sug.forEach(({ e, a }) => {
        const existing = nodes.get(e);
        if (existing && existing.kind === 'member') return;
        nodes.set(e, this._mkNode(e, 'suggest'));
        this._wire(e, a, nodes, edges, true, tgts);
      });
      // scenes and groups change their members (2.4), unseen; derived helpers read their inputs (2.3)
      const held = this._wireGroups(nodes);
      await this._wireSources(nodes, edges);
      // members no automation or script anywhere refers to (4.6)
      const refs = await this._globalRefs();
      nodes.forEach((n, k) => {
        if (n.kind !== 'member' || k.startsWith('automation.')) return;
        n.unref = refs ? !refs.has(k) : false;
      });
      // a target's entities that are on the board get their own arrow too
      tgts.forEach(({ src, r, ref, suggest }) => this._targetEntities(ref, r).forEach((id) => {
        const t = nodes.get(id);
        if (id !== src && t && (!suggest || t.kind === 'member')) this._link(edges, src, id, r, ref);
      }));
      if (token !== this._token) return null;
      const list = [...edges.values()];
      const writers = new Map();
      list.forEach((e) => {
        if (e.role === 'action' || e.role === 'call') {
          const w = writers.get(e.to) || new Set(); w.add(e.from); writers.set(e.to, w);
        }
      });
      nodes.forEach((n, k) => { n.writers = writers.has(k) ? [...writers.get(k)].filter((x) => /^(automation|script)\./.test(x)).length : 0; });
      // loops are found on the entities behind area, floor and label targets, not on the target boxes:
      // motion in the nursery turning on the nursery's lights is no loop (2.2)
      const plain = list.filter((e) => !TGT_RE.test(e.from) && !TGT_RE.test(e.to)), extra = held.slice();
      tgts.forEach(({ src, r, ref, suggest }) => {
        if (suggest) return;
        const inbound = r.role === 'trigger' || r.role === 'condition';
        this._targetEntities(ref, r).forEach((id) => {
          if (id === src) return;
          const from = inbound ? id : src, to = inbound ? src : id;
          if (edges.has(from + '>' + to)) return;
          extra.push({ id: from + '>' + to + '|' + ref, from, to, role: r.role, svcs: new Set(r.svc ? [r.svc] : []), tfs: r.role === 'trigger' && r.tf ? [r.tf] : [], anyTrig: r.role === 'trigger' && !r.tf, box: inbound ? ref + '>' + src : src + '>' + ref });
        });
      });
      const keys = new Set([...nodes.keys()].filter((k) => !TGT_RE.test(k)));
      extra.forEach((e) => { keys.add(e.from); keys.add(e.to); });
      const loops = loopEdges([...keys], plain.concat(extra));
      list.forEach((e) => { e.loop = loops.has(e.id); });
      extra.forEach((e) => { if (loops.has(e.id) && edges.has(e.box)) edges.get(e.box).loop = true; });
      // Node-RED flows that use the function's pieces (2.7), only while that switch is on
      await this._nrNodes(nodes, list);
      // test buttons and monitor boxes kept in the layout (Phase 9), after the loop check: they are no part of it
      this._toolNodes(label, nodes, list);
      // what its automations and scripts point at that isn't there or can't work (0.9.0); a saved version is
      // judged against today's home too, since that's where it would be restored
      const found = findProblems(logic.map((e, i) => ({ key: e, refs: an[i] ? an[i].refs : [], both: bothWays(cfgs[i]) })), members.concat(devs), this._probCtx(label));
      // what was dismissed counts nowhere: not on the board, not in the list (a version shows everything)
      const sp = V ? { shown: found, hidden: [] } : this._splitProbs(label, found, (k) => !k.startsWith('c_'));
      markProblems(nodes, list, sp.shown);
      if (!V) this._noteProblems(label, sp.shown);
      return { label, nodes, edges: list, problems: sp.shown, dismissed: sp.hidden, ignored: sp.ignored || [] };
    }

    // every entity, device and script that any automation or script refers to (cached with the configs)
    async _globalRefs() {
      if (this._grefs && Date.now() - this._grefsAt < 60000) return this._grefs;
      const all = this._logicIds();
      const cfgs = await Promise.all(all.map((e) => this._fetchConfig(e)));
      const set = new Set(), known = (x) => this._known(x), tg = [];
      all.forEach((e, i) => {
        if (!cfgs[i]) return;
        analyze(cfgs[i], e.startsWith('script.'), known).refs.forEach((r) => { if (r.ref !== e) { set.add(r.ref); if (TGT_RE.test(r.ref)) tg.push(r); } });
      });
      await this._resolveTargets(tg.flatMap((r) => [r.ref].concat(r.ex && typeof r.ex === 'object' ? Object.entries(TARGET_KEYS).flatMap(([k, pre]) => toList(r.ex[k]).filter((x) => typeof x === 'string' && x && !TPL_RE.test(x)).map((x) => pre + ':' + x)) : [])));
      tg.forEach((r) => this._targetEntities(r.ref, r).forEach((id) => set.add(id)));
      // a device counts as used when an automation names it or one of its entities
      this._ents.forEach((e) => { if (e.device_id && set.has(e.entity_id)) set.add('device:' + e.device_id); });
      this._grefs = set; this._grefsAt = Date.now();
      return set;
    }
    // every automation and script that exists; a registry entry left over from a deleted one shows as a
    // restored, unavailable state and has no config to read
    _logicIds() {
      return Object.entries(this._hass.states).filter(([k, st]) => /^(automation|script)\./.test(k) && !(st.attributes && st.attributes.restored)).map(([k]) => k);
    }
    // one merged edge per pair: the strongest role wins, services and trigger filters accumulate
    _link(edges, a, b, r, via) {
      const inbound = r.role === 'trigger' || r.role === 'condition' || r.role === 'source';
      const from = inbound ? b : a, to = inbound ? a : b, id = from + '>' + to;
      let e = edges.get(id);
      if (!e) { e = { id, from, to, role: r.role, svcs: new Set(r.svc ? [r.svc] : []), tfs: [], anyTrig: false, via: via || null }; edges.set(id, e); }
      else { if (ROLE_RANK[r.role] > ROLE_RANK[e.role]) e.role = r.role; if (r.svc) e.svcs.add(r.svc); }
      if (r.role === 'trigger') { if (r.tf) e.tfs.push(r.tf); else e.anyTrig = true; }
      // for the developer tools: the conditions to test, templates to show live, triggers and actions to replay
      if (r.cond != null && !(e.conds || []).some((x) => x.c === r.cond)) (e.conds || (e.conds = [])).push({ c: r.cond, i: r.cidx });
      if (r.tpl) (e.tpls || (e.tpls = new Set())).add(r.tpl);
      if (r.trig && !(e.trigs || []).some((x) => x.t === r.trig)) (e.trigs || (e.trigs = [])).push({ t: r.trig, i: r.tidx });
      if (r.act && !(e.acts || []).includes(r.act)) (e.acts || (e.acts = [])).push(r.act);
      return e;
    }
    _wire(src, a, nodes, edges, suggest, tgts) {
      const { refs, badges } = a;
      const n = nodes.get(src);
      if (n) n.badges = badges;
      for (const r of refs) {
        const ref = r.ref;
        if (ref === src) continue;
        if (TGT_RE.test(ref)) {
          if (!suggest && !nodes.has(ref)) nodes.set(ref, this._mkNode(ref, 'outside'));
          if (!suggest) this._link(edges, src, ref, r);
          tgts.push({ src, r, ref, suggest });
          continue;
        }
        if (suggest) { const t = nodes.get(ref); if (!t || t.kind !== 'member') continue; }
        if (!nodes.has(ref)) nodes.set(ref, this._mkNode(ref, 'outside'));
        if (ref.startsWith('nact:') && r.title) { const bn = nodes.get(ref); bn.title = r.title; bn.name = T('button_3', { title: r.title }); }
        if (r.from && nodes.has(r.from)) this._link(edges, r.from, ref, r);  // a button hangs off its notification
        else this._link(edges, src, ref, r);  // _link points triggers and checks into src
      }
    }
    // what each purpose-specific trigger and condition can target (Home Assistant's triggers.yaml), read once
    async _loadDescriptions() {
      if (this._trigDesc) return;
      if (DESC) { [this._trigDesc, this._condDesc] = DESC; return; }
      const get = (type) => new Promise((resolve) => {
        let done = false, unsub = null;
        const fin = (v) => { if (done) return; done = true; this._clock.cancel(to); resolve(v || {}); this._ha.drop(unsub); };
        unsub = this._haConn.subscribeMessage((m) => fin(m), { type }, { fallback: null }).then((u) => { if (!u) fin({}); return u; });
        const to = this._clock.deadline(4000, () => fin({}));
      });
      [this._trigDesc, this._condDesc] = await Promise.all([get('trigger_platforms/subscribe'), get('condition_platforms/subscribe')]);
      if (Object.keys(this._trigDesc).length && Object.keys(this._condDesc).length) DESC = [this._trigDesc, this._condDesc];
    }
    // after a warm start: fetch the registries again, and redraw only if something changed while the board was away
    async _refreshWarm() {
      if (!this._regWarm || !this.isConnected) return;
      const old = this._store.get('reg');
      const d = await this._ha.quiet(this._store.load('reg'), 'its calls to Home Assistant report their own failures', null);
      this._regWarm = false;
      if (!d || !this.isConnected) return;
      REG = { data: d, asked: this._store.at('reg'), at: Date.now(), user: this._hass.user && this._hass.user.id };
      // the same as the warm ones: only what deletion waited for (they're newer than the board data now)
      if (old && regSig(d) === regSig(old)) { this._index(); return; }
      await this._reload(true);
    }
    async _resolveTargets(keys) {
      const todo = [...new Set(keys)].filter((k) => !this._tgt.has(k));
      await Promise.all(todo.map(async (k) => {
        const i = k.indexOf(':'), kind = k.slice(0, i), id = k.slice(i + 1);
        const field = { area: 'area_id', floor: 'floor_id', label: 'label_id' }[kind];
        try {
          const r = await this._ws({ type: 'extract_from_target', target: { [field]: [id] } });
          this._tgt.set(k, { entities: (r && r.referenced_entities) || [] });
        } catch (e) { this._tgt.set(k, { entities: [] }); }
      }));
    }
    // a target's entities, narrowed to what the action or trigger can touch: light.turn_on on an area means
    // its lights; door.opened on an area means its door sensors (Home Assistant's own trigger description)
    _targetEntities(ref, r) {
      const t = this._tgt.get(ref);
      if (!t) return [];
      let ids = t.entities;
      if (r.sdom && r.sdom !== 'homeassistant') ids = ids.filter((id) => id.startsWith(r.sdom + '.'));
      else if (r.kind && r.kind.includes('.')) {
        const desc = (r.role === 'trigger' ? this._trigDesc : this._condDesc) || {};
        const d = desc[r.kind], filt = d && d.target && d.target.entity ? toList(d.target.entity) : null;
        if (filt) {
          ids = ids.filter((id) => filt.some((f) => {
            if (f.domain && !toList(f.domain).includes(id.split('.')[0])) return false;
            if (f.device_class) {
              const st = this._hass.states[id], reg = this._entMap.get(id);
              const dc = (st && st.attributes.device_class) || (reg && (reg.device_class || reg.original_device_class));
              if (!toList(f.device_class).includes(dc)) return false;
            }
            return true;
          }));
        } else {
          const dom = r.kind.split('.')[0];
          if (ids.some((id) => id.startsWith(dom + '.'))) ids = ids.filter((id) => id.startsWith(dom + '.'));
        }
      }
      if (r.ex && typeof r.ex === 'object') {
        const drop = new Set();
        toList(r.ex.entity_id).forEach((x) => { if (typeof x === 'string') x.split(',').map((s) => s.trim()).filter((s) => EXACT_RE.test(s)).forEach((s) => drop.add(s)); });
        toList(r.ex.device_id).forEach((d) => { if (typeof d === 'string') this._ents.forEach((e) => { if (e.device_id === d) drop.add(e.entity_id); }); });
        Object.entries(TARGET_KEYS).forEach(([k, pre]) => toList(r.ex[k]).forEach((x) => {
          const et = typeof x === 'string' && this._tgt.get(pre + ':' + x);
          if (et) et.entities.forEach((id) => drop.add(id));
        }));
        if (drop.size) ids = ids.filter((id) => !drop.has(id));
      }
      return ids;
    }
    // scenes and groups (2.4) draw no arrows to what they set or hold (0.11.1): arrows to only the ones on the board
    // for other reasons read as if that were all they do. Their box says how many; their arrows are the ones into what
    // triggers on them or reads them, and clicking one shows the rest. What they change still counts for loops: the
    // unseen links to their members on the board are returned for the loop check (a sensor group is read from its
    // members; the rest change theirs)
    _wireGroups(nodes) {
      const READ_ONLY = new Set(['binary_sensor', 'sensor', 'event']), held = [];
      [...nodes.keys()].forEach((k) => {
        const st = this._hass.states[k];
        if (!st || k.includes(':')) return;
        const dom = k.split('.')[0], reg = this._entMap.get(k);
        if (dom !== 'scene' && dom !== 'group' && !(reg && reg.platform === 'group')) return;
        const list = [...new Set(toList(st.attributes.entity_id).filter((x) => typeof x === 'string' && x !== k))];
        if (dom === 'scene') nodes.get(k).setN = list.length; else nodes.get(k).memN = list.length;
        list.forEach((m) => {
          if (!nodes.has(m)) return;
          const [from, to, role] = READ_ONLY.has(dom) ? [m, k, 'source'] : [k, m, 'action'];
          held.push({ id: from + '>' + to + '|held', from, to, role, svcs: new Set(), tfs: [], anyTrig: false });
        });
      });
      return held;
    }
    // what the boxes that may be derived helpers read (functions_board/sources), asked for those not known yet;
    // nodes: the model's, or [entity id, { kind: 'member' }] pairs
    async _askSources(nodes) {
      if (this._storeMode !== 'shared') return;
      // members, helpers, template entities, and MQTT entities (what topics they follow, 0.11.3), wherever they are
      const ask = [...nodes].filter(([k, n]) => !k.includes(':') && !/^(automation|script|scene|group)\./.test(k) && (n.kind === 'member' || this._scopeOf(k) === 'helpers' || ['template', 'mqtt'].includes((this._entMap.get(k) || {}).platform)))
        .map(([k]) => k).filter((k) => !this._src.has(k)).slice(0, 500);
      if (!ask.length) return;
      try {
        const r = await this._ws({ type: 'functions_board/sources', entity_ids: ask });
        ask.forEach((k) => this._src.set(k, (r && r.sources && r.sources[k]) || null));
      } catch (e) { ask.forEach((k) => this._src.set(k, null)); }
    }
    // the helpers among these that follow what they read, with their rules, for a sandbox (asked first if the board let
    // go of them: a config changed): id → { rule, reads }
    async _followRules(nodes, states) {
      await this._askSources(nodes);
      return Object.fromEntries([...this._src].filter(([k, x]) => x && x.rule && states[k]).map(([k, x]) => [k, { rule: x.rule, reads: x.entities }]));
    }
    async _wireSources(nodes, edges) {
      if (this._storeMode !== 'shared') return;
      await this._askSources(nodes);
      [...nodes.entries()].forEach(([k, n]) => {
        const s = this._src.get(k);
        if (!s) return;
        n.reads = s;
        s.entities.forEach((src) => {
          if (!nodes.has(src)) {
            if (n.kind !== 'member' || !(this._hass.states[src] || this._entMap.has(src))) return;
            nodes.set(src, this._mkNode(src, 'outside'));
          }
          this._link(edges, k, src, { role: 'source', svc: '' });
        });
        // an MQTT entity follows its topics: an arrow from each topic's box on the board (one a message is published
        // to, or a trigger listens on: the same topic, not a wildcard that also matches it)
        toList(s.topics).forEach((tp) => { if (nodes.has('mqtt:' + tp)) this._link(edges, k, 'mqtt:' + tp, { role: 'source', svc: '' }); });
      });
    }

    _mkNode(key, kind) {
      const n = { key, kind, badges: new Set(), writers: 0, x: 0, y: 0 };
      if (key.startsWith('device:')) {
        const d = this._devMap.get(key.slice(7));
        n.domain = 'device'; n.name = d ? d.name_by_user || d.name || T('device') : T('unknown_device'); n.icon = 'mdi:devices';
      } else if (key.startsWith('svc:')) {
        n.domain = 'service'; n.name = key.slice(4);
        n.icon = key.startsWith('svc:notify.') ? 'mdi:message-arrow-right-outline' : 'mdi:cog-play-outline';
      } else if (key.startsWith('event:')) {
        n.domain = 'event'; n.name = key.slice(6); n.icon = 'mdi:broadcast';
      } else if (key.startsWith('mqtt:')) {
        n.domain = 'mqtt'; n.name = key.slice(5); n.icon = 'mdi:access-point-network';
      } else if (key.startsWith('nact:')) {
        n.domain = 'button_press'; n.name = T('button_2', { key: key.slice(5) }); n.icon = 'mdi:gesture-tap-button';
      } else if (TGT_RE.test(key)) {
        const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
        const reg = kind === 'area' ? this._areaMap && this._areaMap.get(id) : kind === 'floor' ? this._floorMap && this._floorMap.get(id) : this._labelMap.get(id);
        const t = this._tgt.get(key), cnt = t ? t.entities.length : 0;
        n.domain = kind; n.name = ((reg && reg.name) || id) + ` (${cnt})`;
        n.icon = (reg && reg.icon) || { area: 'mdi:texture-box', floor: 'mdi:home-floor-1', label: 'mdi:label-outline' }[kind];
        n.targets = t ? t.entities : [];
      } else {
        n.domain = key.split('.')[0];
        const st = this._hass.states[key], reg = this._entMap.get(key);
        n.name = (st && st.attributes.friendly_name) || (reg && (reg.name || reg.original_name)) || key;
        n.icon = (reg && reg.icon) || (st && st.attributes.icon) || ICONS[n.domain] || 'mdi:shape-outline';
      }
      const small = kind === 'outside';
      n.w = small ? XW : NW; n.h = small ? XH : NH;
      return n;
    }

    // which arrow types and kinds of box show, per function (7.2); outside and related default to the global choice
    _flt(label) {
      const u = this._data.ui, f = (u.filters && u.filters[label]) || {};
      const on = (k) => f[k] !== false;
      return { trigger: on('trigger'), condition: on('condition'), source: on('source'), action: on('action'), call: on('call'),
        outside: f.outside != null ? !!f.outside : u.outside !== false, suggest: f.suggest != null ? !!f.suggest : u.suggest !== false };
    }
    _setFlt(label, key, val) {
      const u = this._data.ui;
      u.filters = Object.assign({}, u.filters || {}, { [label]: Object.assign({}, (u.filters || {})[label] || {}, { [key]: val }) });
      this._save();
    }
    _visibleKeys() {
      const m = this._model, s = new Set();
      if (!m) return s;
      const f = this._flt(m.label);
      // an outside or related box is only there for its arrows: it goes when all of them are filtered out
      const shown = new Set();
      m.edges.forEach((e) => { if (f[e.role] !== false) { shown.add(e.from); shown.add(e.to); } });
      m.nodes.forEach((n, k) => {
        if (n.kind === 'outside' && (!f.outside || !shown.has(k))) return;
        if (n.kind === 'suggest' && (!f.suggest || !shown.has(k))) return;
        s.add(k);
      });
      return s;
    }
    _visEdges() {
      const m = this._model;
      if (!m) return [];
      const vis = this._visibleKeys(), f = this._flt(m.label);
      return m.edges.filter((e) => vis.has(e.from) && vis.has(e.to) && f[e.role] !== false);
    }
    _kindHead(k) {
      const n = this._model.nodes.get(k);
      const kind = n.kind === 'tool' ? T('tests_and_monitors') : n.kind === 'nodered' ? T('node_red_flows') : n.kind === 'suggest' ? T('related_2') : n.kind === 'outside' ? T('outside_items') : n.domain === 'automation' ? T('automations') : n.domain === 'script' ? T('scripts')
        : this._scopeOf(k) === 'helpers' ? T('helpers') : n.domain === 'device' ? T('devices') : T('other');
      return T('with_no_arrows', { kind });
    }
    _sortKey(k) {
      const n = this._model.nodes.get(k);
      const r = n.kind === 'member' ? (n.domain === 'automation' ? 0 : n.domain === 'script' ? 1 : HELPER_DOMAINS.has(n.domain) ? 2 : 3)
        : n.kind === 'suggest' || n.kind === 'nodered' ? 4 : n.kind === 'tool' ? 6 : 5;
      return r + ':' + String(n.name).toLowerCase();
    }

    _place() {
      setCurved(this._data.ui.curved === true);
      const m = this._model, L = this._layout(m.label), vis = this._visibleKeys();
      // test buttons and monitor boxes (Phase 9) take no part in the layout: adding one moves nothing else
      const tools = [...vis].filter((k) => k.startsWith('tool:')), E = this._visEdges().filter((e) => e.role !== 'tool');
      const keys = [...vis].filter((k) => !k.startsWith('tool:')).sort((a, b) => this._sortKey(a).localeCompare(this._sortKey(b)));
      const saved = keys.filter((k) => L.nodes[k]), fresh = keys.filter((k) => !L.nodes[k]), keep = new Set(L.keep || []);
      // after Auto-arrange with boxes kept in place, everything else is laid out together, clear of the kept boxes
      const around = saved.length && fresh.length && saved.every((k) => keep.has(k));
      const V = L.dir === 'down';
      const lay = around ? fresh : keys, auto = layered(lay, E.filter((e) => !around || (fresh.includes(e.from) && fresh.includes(e.to))), (k) => m.nodes.get(k), (k) => this._kindHead(k), V);
      let dx = 0, dy = 0;
      if (around) {
        const sz = (k) => m.nodes.get(k), kb = saved.map((k) => [L.nodes[k].x, L.nodes[k].y, L.nodes[k].x + sz(k).w, L.nodes[k].y + sz(k).h]);
        const ab = fresh.map((k) => { const a = auto.get(k); return [a.x, a.y, a.x + sz(k).w, a.y + sz(k).h]; });
        const ext = (bs) => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
        const K = ext(kb), A = ext(ab), clear = (ox, oy) => !ab.some((a) => kb.some((b) => a[0] + ox < b[2] + 40 && a[2] + ox + 40 > b[0] && a[1] + oy < b[3] + 40 && a[3] + oy + 40 > b[1]));
        const shape = (ox, oy) => { const w = Math.max(K[2], A[2] + ox) - Math.min(K[0], A[0] + ox), h = Math.max(K[3], A[3] + oy) - Math.min(K[1], A[1] + oy); return Math.abs(Math.log(w / h / 1.7)); };
        const tries = [[K[0] - A[0], K[1] - A[1]], [K[2] + 120 - A[0], K[1] - A[1]], [K[0] - A[0], K[3] + 120 - A[1]]];
        const ok = tries.filter(([ox, oy]) => clear(ox, oy));
        [dx, dy] = clear(...tries[0]) ? tries[0] : (ok.length ? ok : tries.slice(1)).sort((p, q) => shape(...p) - shape(...q))[0];
      } else if (saved.length && fresh.length) {
        dy = Math.max(...saved.map((k) => L.nodes[k].y + m.nodes.get(k).h)) + 100 - Math.min(...fresh.map((k) => auto.get(k).y));
        dx = Math.min(...saved.map((k) => L.nodes[k].x)) - Math.min(...fresh.map((k) => auto.get(k).x));
      }
      this._autoPos = new Map();
      keys.forEach((k) => {
        const n = m.nodes.get(k), p = L.nodes[k];
        if (p) { n.x = p.x; n.y = p.y; return; }
        const a = auto.get(k);
        n.x = Math.round(a.x + dx); n.y = Math.round(a.y + dy);
        this._autoPos.set(k, [n.x, n.y]);
      });
      // a box new to an arranged function goes next to its most connected neighbour (7.4)
      if (!around && saved.length && fresh.length) {
        const placed = saved.map((k) => m.nodes.get(k));
        const overlaps = (n) => placed.some((o) => o !== n && n.x < o.x + o.w + 20 && n.x + n.w + 20 > o.x && n.y < o.y + o.h + 14 && n.y + n.h + 14 > o.y);
        fresh.forEach((k) => {
          const n = m.nodes.get(k), score = new Map();
          E.forEach((e) => {
            const other = e.from === k ? e.to : e.to === k ? e.from : null;
            // what it sets off counts double: an input reads best just left of what it triggers
            if (other && placed.includes(m.nodes.get(other))) score.set(other, (score.get(other) || 0) + (e.from === k && e.role === 'trigger' ? 2 : 1));
          });
          const best = [...score.entries()].sort((x, y) => y[1] - x[1])[0];
          if (best) {
            const b = m.nodes.get(best[0]), after = E.some((e) => e.from === best[0] && e.to === k);
            if (V) {
              // top to bottom: under what sets it off, over what it sets off
              n.y = Math.round(after ? b.y + b.h + 70 : b.y - n.h - 70); n.x = b.x;
              for (let i = 0; i < 40 && overlaps(n); i++) n.x += n.w + 20;
            } else {
              n.x = Math.round(after ? b.x + b.w + 80 : b.x - n.w - 80); n.y = b.y;
              for (let i = 0; i < 40 && overlaps(n); i++) n.y += n.h + 14;
            }
            this._autoPos.delete(k);
          }
          placed.push(n);
        });
      }
      // a tool box sits where it was put; one without a place (from another board, say) goes next to what it is for
      const all = keys.map((k) => m.nodes.get(k));
      tools.forEach((k) => {
        const n = m.nodes.get(k), p = L.nodes[k];
        if (p) { n.x = p.x; n.y = p.y; all.push(n); return; }
        const t = n.tool, tgt = m.nodes.get(t.type === 'inject' ? t.test && t.test.target : t.target);
        const hit = () => all.some((o) => n.x < o.x + o.w + 16 && n.x + n.w + 16 > o.x && n.y < o.y + o.h + 12 && n.y + n.h + 12 > o.y);
        if (tgt) { n.x = t.type === 'inject' ? tgt.x - n.w - 70 : tgt.x; n.y = t.type === 'inject' ? tgt.y : tgt.y + tgt.h + 30; }
        else { n.x = Math.min(0, ...all.map((o) => o.x)) - n.w - 80; n.y = Math.min(0, ...all.map((o) => o.y)); }
        for (let i = 0; i < 40 && hit(); i++) n.y += n.h + 12;
        all.push(n);
      });
      // the automatic layout's waypoints for arrows that skip columns, where both ends are still where it put them
      // (in the turned frame for top to bottom, where a real shift right is a shift down)
      this._routes = new Map([...(auto.routes || new Map())].map(([id, pts]) => [id, pts.map((p) => (V ? [p[0] + dy, p[1] + dx, p[2]] : [p[0] + dx, p[1] + dy, p[2]]))]));
      // a heading over unwired boxes stays only while none of them has been moved by hand
      this._heads = (auto.heads || []).filter((h) => h.keys.every((k) => !L.nodes[k])).map((h) => ({ x: Math.round(h.x + dx), y: Math.round(h.y + dy), text: h.text }));
    }
    _routeFor(e, sd) {
      const r = this._routes && this._routes.get(e.id);
      if (!r || sd[0] !== 'r' || sd[1] !== 'l') return null;
      const at = (k) => { const p = this._autoPos && this._autoPos.get(k), n = this._model.nodes.get(k); return p && n && p[0] === n.x && p[1] === n.y; };
      return at(e.from) && at(e.to) ? r : null;
    }

    /* ---------- rendering ---------- */
    _render() {
      if (!this._model) return;
      const m = this._model, vis = this._visibleKeys(), shown = this._visEdges(), f = this._flt(m.label);
      // a box with arrows, all of them filtered out, says so (7.2)
      const cnt = new Map(), vis2 = new Set();
      m.edges.forEach((e) => { if (vis.has(e.from) && vis.has(e.to) && f[e.role] === false) { cnt.set(e.from, (cnt.get(e.from) || 0) + 1); cnt.set(e.to, (cnt.get(e.to) || 0) + 1); } });
      shown.forEach((e) => { vis2.add(e.from); vis2.add(e.to); });
      m.nodes.forEach((n, k) => { n.hidden = cnt.has(k) && !vis2.has(k) ? cnt.get(k) : 0; });
      this._renderFrames();
      // drawn in place (0.10.0): a box still there is the same element, so the one with focus keeps it
      this._put(this._$.nodes, [...vis].map((k) => this._nodeHTML(m.nodes.get(k))).join(''));
      this._els = new Map();
      this._$.nodes.querySelectorAll('.node').forEach((el) => this._els.set(el.dataset.key, el));
      this._renderNotes();
      this._renderMons();
      this._conn = this._connText();
      this._rove(this._sel || (this._roveKey && vis.has(this._roveKey) ? this._roveKey : [...vis][0]));
      this._applyView();
      this._refreshStates();
      this._applyFocus();
      this._setEmpty();
    }

    _nodeHTML(n) {
      if (n.kind === 'tool') return this._toolHTML(n);
      const b = [...n.badges].filter((x) => BADGES[x]).map((x) => `<ha-icon icon="${BADGES[x][0]}" title="${BADGES[x][1]}"></ha-icon>`).join('')
        + (n.writers > 1 ? `<span class="wr" title="${T('changed_by_automations_or_scripts', { writers: n.writers })}">&#9998;${n.writers}</span>` : '')
        + (n.prob ? `<ha-icon class="prob p-${n.prob}" icon="${n.prob === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}" title="${esc(this._probTitle(n.key))}"></ha-icon>` : '')
        + (n.unref ? `<ha-icon class="unref" icon="mdi:link-variant-off" title="${T('it_may_be_used_by', { extra: n.domain === 'script' ? T('no_automation_or_script_runs') : T('no_automation_or_script_refers') })}"></ha-icon>` : '')
        + (n.hidden ? `<span class="wr hid" title="${T('its_arrows_are_hidden_by')}">${P('n_hidden', n.hidden)}</span>` : '')
        + ((this._layout(this._model.label).keep || []).includes(n.key) ? `<ha-icon class="kept" icon="mdi:pin" title="${T('kept_in_place_auto_arrange')}"></ha-icon>` : '');
      const vd = this._ver && this._ver.diff ? (this._ver.diff.changed.has(n.key) ? 'chg' : this._ver.diff.only.has(n.key) ? 'only' : '') : '';
      return `<div class="node ${n.kind} d-${esc(n.domain)}${vd ? ' vd-' + vd : ''}" data-key="${esc(n.key)}" role="button" tabindex="-1" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px">`
        + (vd ? `<span class="vdtag" title="${vd === 'chg' ? T('ver_changed_t') : T('ver_only_t')}">${vd === 'chg' ? T('ver_changed_tag') : T('ver_only_tag')}</span>` : '')
        + `<span class="tag">${esc(this._tagOf(n.key))}</span> <ha-icon class="ic" icon="${esc(n.icon)}"></ha-icon> <div class="txt"><div class="name">${esc(n.name)}</div> `
        + (n.kind === 'outside' ? '' : '<div class="sub"></div>') + '</div> '
        + (b ? `<div class="badges">${b}</div>` : '')
        // the points arrows leave from (right) and enter by (left); in Full manager, drag from one to draw an arrow
        // (top to bottom: in by the top edge, out by the bottom one)
        + (PROTO().ortho ? (() => { const V = this._vert(), at = V ? 'left' : 'top'; return portYs(V ? n.w : n.h).map((y) => `<span class="port pl" data-y="${y - 4}" style="${at}:${y - 4}px"></span><span class="port pr" data-y="${y - 4}" style="${at}:${y - 4}px"></span>`).join(''); })() : '') + '</div>';
    }

    _renderFrames() {
      if (!this._model) return;
      const L = this._layout(this._model.label);
      const heads = (this._heads || []).map((h) => `<div class="khead" style="left:${+h.x}px;top:${+h.y}px">${esc(h.text)}</div>`).join('');
      this._$.frames.innerHTML = L.frames.map((f) => { const id = esc(f.id); return `<div class="frame" data-fid="${id}" style="left:${+f.x}px;top:${+f.y}px;width:${+f.w}px;height:${+f.h}px"><div class="fhead" data-fid="${id}"><span class="ftitle" data-fid="${id}" title="${T('double_click_to_rename')}">${esc(f.title)}</span><button class="fdel" data-act="fdel" data-fid="${id}" title="${T('delete_frame_keeps_what_is')}">&times;</button></div><div class="fresize" data-fid="${id}"></div></div>`; }).join('') + heads;
    }

    _renderNotes() {
      if (!this._model) return;
      const L = this._layout(this._model.label);
      this._$.notes.innerHTML = L.notes.map((n) => { const id = esc(n.id); return `<div class="note" data-nid="${id}" style="left:${+n.x}px;top:${+n.y}px;width:${+n.w || 240}px"><div class="nhead" data-nid="${id}"><ha-icon icon="mdi:note-text-outline"></ha-icon><button class="ndel" data-act="ndel" data-nid="${id}" title="${T('delete_note')}">&times;</button></div><textarea class="nbody" data-nid="${id}" rows="2" placeholder="${T('write_a_note')}">${esc(n.text)}</textarea></div>`; }).join('');
      this._$.notes.querySelectorAll('textarea').forEach((t) => this._autosize(t));
    }
    _autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

    _status(n) {
      if (n.kind === 'tool') return { text: n.tool.type === 'inject' ? (this._full() ? T('test_button') : T('test_button_full_manager_only')) : T('monitor') };
      if (n.kind === 'nodered') {
        const tabLabel = n.nr.tabLabel, count = P('n_nodes', n.nr.size);
        return n.nr.off ? { text: T('node_red_off', { tabLabel, count }), off: true } : { text: T('node_red_3', { tabLabel, count }) };
      }
      const tn = TYPE[n.domain] || n.domain.replace(/_/g, ' ');
      let r;
      if (n.domain === 'device') {
        const d = this._devMap.get(n.key.slice(7));
        r = { text: T('device_2', { extra: d && d.model ? ' · ' + d.model : '' }) };
      } else if (n.domain === 'service') r = { text: T('action_2', { split: n.name.split('.')[0] }) };
      else if (n.domain === 'event') r = { text: T('event') };
      else if (n.domain === 'button_press') r = { text: T('notification_button_action', { extra: n.title ? ' "' + n.title + '"' : '', key: n.key.slice(5) }) };
      else if (TGT_RE.test(n.key)) {
        const names = (n.targets || []).map((id) => { const st = this._hass.states[id]; return (st && st.attributes.friendly_name) || id; });
        r = { text: T('target', { type: TYPE[n.domain], count: P('n_entities', names.length), n: names.length ? ': ' + names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : '') : '' }) };
      }
      else if (n.domain === 'mqtt') r = { text: T('mqtt_topic') };
      else {
        const st = this._stOf(n.key);
        if (!st) r = { text: T('not_found', { tn }), warn: true };
        else if (st.state === 'unavailable') r = { text: T('unavailable_2', { tn }), warn: true };
        else if (n.domain === 'automation') {
          const run = (st.attributes.current || 0) > 0;
          r = { text: T('ran_3', { n: (st.state === 'on' ? T('on') : T('off')) + (run ? T('running_3') : ''), last_triggered: ago(st.attributes.last_triggered) }), off: st.state !== 'on', run };
        } else if (n.domain === 'script') {
          const run = st.state === 'on';
          r = { text: T('ran_2', { extra: run ? T('running_2') : T('idle'), last_triggered: ago(st.attributes.last_triggered) }), run };
        } else {
          let v;
          try { v = this._hass.formatEntityState ? this._hass.formatEntityState(st) : st.state; } catch (e) { v = st.state; }
          r = { text: tn + ' · ' + v };
        }
      }
      if (n.setN) r.text += ' · ' + P('sets_n', n.setN);
      if (n.memN) r.text += ' · ' + P('members_n', n.memN);
      if (n.kind === 'suggest') r.text = T('related', { text: r.text });
      if (this._sbxOn()) {
        // the sandbox: what runs there, and what it changed from the real state
        const eng = this._sbx.eng;
        if (/^(automation|script)\./.test(n.key)) {
          // its runs in the sandbox, not its last real run
          r.run = eng.running(n.key);
          const runs = eng.log.filter((e) => e.kind === 'run' && e.key === n.key).length, st = this._stOf(n.key);
          const on = n.domain === 'automation' ? (st && st.state === 'off' ? T('off') : T('on')) + ' · ' : '';
          r.text = on + (r.run ? T('sbx_running') : runs ? P('sbx_ran_n', runs) : T('sbx_not_run'));
          r.off = n.domain === 'automation' && !!st && st.state === 'off';
        }
        const was = this._hass.states[n.key], now = eng.changed.get(n.key);
        r.sbch = !!(now && (!was || String(was.state) !== String(now.state)));
        return r;
      }
      // a simulated state stays marked until the device or its integration reports again (9.2)
      if (this._sim.has(n.key)) {
        const st = this._hass.states[n.key];
        const at = this._simAt.get(n.key);
        if (st && st.context && st.context.id === this._sim.get(n.key)) { r.text += T('simulated_2'); r.sim = true; }
        // Home Assistant's word of the simulated state may come after its answer to setting it: until then the
        // state here is the one from before, which is no report from the device (0.9.1: this cleared the mark)
        else if (st && at && Date.parse(st.last_updated) < at) { /* not yet */ }
        else { this._sim.delete(n.key); this._simAt.delete(n.key); }
      }
      return r;
    }

    _refreshStates() {
      if (!this._model || !this._els) return;
      const m = this._model;
      // a box turned off, gone or unavailable since the board was built changes its problems: build it again
      if (m.probSig != null && !this._ver && this._probSig(m, this._hass.states) !== m.probSig) { m.probSig = null; this._clock.after('reprob', 300, () => this._open(m.label, true)); }
      this._els.forEach((el, k) => {
        const n = m.nodes.get(k);
        if (!n) return;
        const s = this._status(n);
        const sub = el.querySelector('.sub');
        if (sub && sub.textContent !== s.text) sub.textContent = s.text;
        const tip = n.name + (s.text ? ' — ' + s.text : '') + (n.kind === 'suggest' ? T('related_not_in_this_function_3') : n.kind === 'outside' ? T('outside_this_function_2') : '');
        if (el.title !== tip) el.title = tip;
        // what a screen reader says: first exactly what the box shows (so a voice command naming it finds it), then
        // what kind of box it is and what it's wired to (4.8)
        const shown = [...el.querySelectorAll('.vdtag,.tag,.name,.sub,.badges .wr')].map((x) => x.textContent.trim()).filter(Boolean).join(' ');
        const al = `${shown}${n.kind === 'suggest' ? T('related_not_in_this_function_2') : n.kind === 'outside' ? T('outside_this_function') : ''}${this._conn && this._conn.get(k) ? '. ' + this._conn.get(k) : ''}${n.prob ? '. ' + this._probTitle(k).replace(/\n/g, '. ') : ''}`;
        if (el.getAttribute('aria-label') !== al) el.setAttribute('aria-label', al);
        const pressed = String(k === this._sel);
        if (el.getAttribute('aria-pressed') !== pressed) el.setAttribute('aria-pressed', pressed);
        el.classList.toggle('off', !!s.off);
        el.classList.toggle('warn', !!s.warn);
        el.classList.toggle('running', !!s.run);
        el.classList.toggle('err', this._errKeys.has(k));
        el.classList.toggle('sim', !!s.sim);
        el.classList.toggle('sbch', !!s.sbch);
        // outside boxes have no state line: in the sandbox, a tag with the state
        if (this._sbxOn() && n.kind === 'outside') { const so = this._stOf(k), v = so ? this._fmtState(k, so.state) : ''; if (el.dataset.sbx !== v) el.dataset.sbx = v; }
        else if (el.dataset.sbx) delete el.dataset.sbx;
        const w = this._watching(k);
        el.classList.toggle('watching', !!w);
        if (w) { const t = 'watching' + (w.hits ? ' · ' + w.hits : ''); if (el.dataset.watch !== t) el.dataset.watch = t; } else if (el.dataset.watch) delete el.dataset.watch;
        const st = this._stOf(k);
        if (st && n.domain !== 'automation' && n.domain !== 'script' && n.kind !== 'outside') {
          const prev = this._prev.get(k);
          if (prev && prev !== st.last_changed) this._pulse(k);
          this._prev.set(k, st.last_changed);
        }
      });
      if (this._sel) {
        const t = this._$.nodebar.querySelector('button[data-act="toggle"]'), st = this._hass.states[this._sel];
        if (t && st && t.dataset.state !== st.state) this._renderNodebar();
      }
      this._renderPause();
      // the checks' results follow the states they read (9.3); the debugger lists what the logbook leaves out (9.4)
      if (this._condKeys && this._condKeys.size) {
        const sig = [...this._condKeys].map((k) => { const s = this._hass.states[k]; return s ? s.state + s.last_changed : ''; }).join('|');
        if (sig !== this._condSig) { this._condSig = sig; this._testCondsSoon(); }
      }
      this._dbgStates();
    }

    _drawEdges() {
      const m = this._model;
      if (!m) { this._$.edges.innerHTML = ''; return; }
      setCurved(this._data.ui.curved === true);
      const E = this._visEdges(), F = this._focus, out = [DEFS], labels = [], hits = [], now = Date.now(), PR = PROTO();
      this._$.board.classList.toggle('pc', !!PR.color);
      this._$.board.classList.toggle('full', !!this._full());
      const light = !(this._hass && this._hass.themes && this._hass.themes.darkMode);
      this._$.board.classList.toggle('light', light);
      this._$.modal.classList.toggle('light', light);
      // top to bottom: the arrows are routed left to right between the boxes turned a quarter turn (proxies with x and
      // y, width and height swapped), then drawn in a group reflected across the diagonal, which turns them back.
      // Text and check marks are put outside it, at the turned-back point, so they aren't mirrored
      const V = this._vert();
      this._$.board.classList.toggle('vert', V);
      const prox = new Map(), boxOf = (k) => {
        const n = m.nodes.get(k);
        if (!V || !n) return n;
        if (!prox.has(k)) prox.set(k, { key: n.key, kind: n.kind, x: n.y, y: n.x, w: n.h, h: n.w });
        return prox.get(k);
      };
      const tp = (x, y) => (V ? [y, x] : [x, y]);
      const boxes = [...this._visibleKeys()].map(boxOf);
      const marks = [], condOn = this._data.ui.condres !== false, mids = new Map(), fl = this._flow && this._sbxOn() ? this._flow : null;
      const dot = fl && fl.anim && fl.steps[fl.at] ? fl.steps[fl.at].links.find((l) => l.edge) : null;
      const geo = arrowGeo(E, boxOf, PR.ortho ? orthoSides : sides);
      let dots = [];
      const chev = [];
      if (PR.ortho) {
        const r = orthoAll(geo, (e, sd) => this._routeFor(e, sd), boxes);
        this._ortho = { ids: geo.map((g) => g.e.id), routes: r.routes, owners: r.owners, hops: r.hops.map((m) => [...m]), boxes: geo.map((g) => [g.e.from, g.e.to]), vert: V };
        geo.forEach((g, i) => { const rp = roundPath(r.routes[i], r.hops[i]); g.gm = { d: rp.d, mx: rp.mid[0], my: rp.mid[1] }; });
        // a bus's dots light with it
        // a branch lights with its arrow
        dots = r.dots.map((dt) => Object.assign({ lit: !F || (dt.tag == null ? geo.some((g, i) => (r.owners[i] || []).includes(dt.own) && this._focusEdges.has(g.e.id)) : this._focusEdges.has(geo[dt.ri].e.id)) }, dt));
        // each arrow's direction, on runs that go back (right to left)
        geo.forEach((g, i) => {
          const pts = r.routes[i], hi = !!F && this._focusEdges.has(g.e.id), hp = r.hops[i] || new Map();
          for (let j = 1; j < pts.length; j++) {
            const u = pts[j - 1], v = pts[j], len = u[0] - v[0];
            if (Math.abs(u[1] - v[1]) > 0.5 || len < 70) continue;
            const n = Math.max(1, Math.floor(len / 320));
            for (let q = 1; q <= n; q++) {
              let x = u[0] - (len * q) / (n + 1);
              // (not on a hop)
              (hp.get(j) || []).forEach(([h0, h1]) => { if (x > Math.min(h0, h1) - HOP - 6 && x < Math.max(h0, h1) + HOP + 6) x = Math.min(h0, h1) - HOP - 8; });
              chev.push(`<path class="chev role-${esc(g.e.role)}${F && !hi ? ' dim' : ''}" d="M${x - 4},${u[1]} L${x + 4},${u[1] - 4.5} L${x + 4},${u[1] + 4.5} z"></path>`);
            }
          }
        });
      }
      for (const g of geo) {
        const e = g.e, way = g.gm ? null : this._routeFor(e, g.s);
        const gm = g.gm || edgeGeom(g.a, g.b, { sides: g.s, fa: g.fa, fb: g.fb, way, boxes: way ? null : boxes });
        const hi = !!F && this._focusEdges.has(e.id), live = (this._live.get(e.from) || 0) > now || (this._liveE.get(e.id) || 0) > now;
        const cls = ['e', 'role-' + e.role];
        if (e.loop) cls.push('loop');
        if (e.prob) cls.push('prob');
        if (F) cls.push(hi ? 'hi' : 'dim');
        if (live) cls.push('live');
        if (this._selEdge === e.id) cls.push('esel');
        const RC = { trigger: 'trig', action: 'act', call: 'call' };
        const mk = PR.color ? (live ? 'hi' : RC[e.role] || (hi ? 'hi' : 'n')) : live ? 'blue' : e.loop ? 'amber' : hi ? 'hi' : 'n';
        const ms = e.role === 'trigger' ? ` marker-start="url(#fb-${PR.color && !live ? 'dottrig' : hi ? 'dothi' : 'dot'})"` : '';
        const title = e.tpls && e.tpls.size ? '' : `<title>${esc(this._edgeTitle(e))}</title>`;
        out.push(`<path class="${cls.join(' ')}" data-edge="${esc(e.id)}" d="${gm.d}" marker-end="url(#fb-${mk})"${ms}></path>`);
        // a wider, invisible copy that is easier to hover; arrows from templates show their live value instead of a title
        hits.push(`<path class="hit${e.tpls && e.tpls.size ? ' tpl' : ''}" data-act="edge" data-e="${esc(e.id)}" d="${gm.d}">${title}</path>`);
        const [lx, ly] = tp(gm.mx, gm.my);
        mids.set(e.id, [lx, ly]);
        // the sandbox's flow: a dot runs along the step's arrow (in the same frame as the arrow)
        if (dot && dot.edge === e.id) out.push(`<circle class="fdot" r="5.5"><animateMotion begin="indefinite" dur="0.65s" fill="freeze" path="${gm.d}"${dot.rev ? ' keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : ''}></animateMotion></circle>`);
        if (hi && e.svcs.size) labels.push(`<text x="${lx}" y="${ly - 6}" text-anchor="middle">${esc([...e.svcs].join(', '))}</text>`);
        // whether its check passes right now (9.3), or, in the sandbox's flow, whether it passed there
        const fc = fl && fl.cond.get(e.id), c = !fc && condOn && this._cond.get(e.id);
        if (fc || c) {
          const ok = fc ? fc.ok : c.ok, kind = ok === true ? 'ok' : ok === false ? 'bad' : 'unk';
          const glyph = kind === 'ok' ? '<path d="M-3.6,0.2 L-1.1,2.8 L3.8,-2.6"></path>' : kind === 'bad' ? '<path d="M-3,-3 L3,3 M3,-3 L-3,3"></path>' : '<text y="3.6" text-anchor="middle">?</text>';
          marks.push(`<g class="cres ${kind}${fc ? ' sbxc' : ''}${F && !hi ? ' dim' : ''}" data-edge="${esc(e.id)}" transform="translate(${lx},${ly})"><circle r="8"></circle>${glyph}<title>${esc(fc ? fc.title : this._condTitle(e, c))}</title></g>`);
        }
      }
      // where a shared line splits, and where an arrow leaves it: a plain dot (joined here, not crossing)
      const jd = dots.map((dt) => `<circle class="jd split role-${esc(dt.role)}${dt.lit ? '' : ' dim'}" cx="${dt.x}" cy="${dt.y}" r="${dt.tag == null ? 3.6 : 3.2}"></circle>`);
      const drawn = out.slice(1).join('') + chev.join('') + jd.join('') + hits.join('');
      this._$.edges.innerHTML = DEFS + (V ? `<g transform="matrix(0 1 1 0 0 0)">${drawn}</g>` : drawn) + labels.join('') + marks.join('');
      this._applyTrace();
      this._edgeMid = mids;
      if (dot && !lessMotion()) this._$.edges.querySelectorAll('animateMotion').forEach((x) => { try { x.beginElement(); } catch (er) { /* no SMIL */ } });
      this._paintFlow();
      if (fl) fl.anim = false;
    }

    // tracing arrows through a shared line: pointing at a box, or selecting it, draws that box's arrows on shared
    // lines end to end on top, and fades the others on the same lines
    _busEdgesOf(key) {
      const o = this._ortho;
      if (!o || !key) return null;
      const ids = o.ids.filter((id, i) => (o.owners[i] || []).some(Boolean) && (o.boxes[i][0] === key || o.boxes[i][1] === key));
      return ids.length ? new Set(ids) : null;
    }
    _setTrace(ids, sticky) {
      if (sticky !== undefined) this._traceKeep = sticky ? ids : null;
      const next = ids || this._traceKeep || null;
      const same = (a, b) => (!a && !b) || (a && b && a.size === b.size && [...a].every((x) => b.has(x)));
      if (same(next, this._trace)) return;
      this._trace = next;
      this._applyTrace();
    }
    _applyTrace() {
      const svg = this._$.edges, o = this._ortho, tr = this._trace;
      if (!svg) return;
      svg.querySelectorAll('.trc').forEach((x) => x.remove());
      svg.querySelectorAll('.trdim, .trhi').forEach((x) => x.classList.remove('trdim', 'trhi'));
      const on = !!(tr && tr.size && o);
      this._$.board.classList.toggle('tracing', on);
      if (!on) return;
      const owns = new Set();
      o.ids.forEach((id, i) => { if (tr.has(id)) (o.owners[i] || []).forEach((w) => { if (w) owns.add(w); }); });
      const mates = new Set(o.ids.filter((id, i) => (o.owners[i] || []).some((w) => w && owns.has(w))));
      svg.querySelectorAll('path.e').forEach((p) => { if (mates.has(p.dataset.edge) && !tr.has(p.dataset.edge)) p.classList.add('trdim'); });
      tr.forEach((id) => {
        const p = svg.querySelector(`path.e[data-edge="${CSS.escape(id)}"]`);
        if (!p) return;
        const c = p.cloneNode(false);
        c.removeAttribute('data-edge');
        c.setAttribute('class', 'trc ' + [...p.classList].filter((x) => x.startsWith('role-')).join(' '));
        // on top of everything in its frame, letters included
        p.parentNode.appendChild(c);
      });
    }

    /* ---------- the Arrows menu: highlight modes (7.1) and filters (7.2) ---------- */
    _setHl(change) {
      const u = this._data.ui;
      u.hl = Object.assign({ mode: 'chain', depth: 0 }, u.hl || {}, change);
      this._save();
      this._applyFocus();
      this._refreshHl();
    }
    _refreshHl() { if (this._menuEl && this._menuEl.classList.contains('hlm') && this._menuAnchor) this._hlMenu(this._menuAnchor, true); }
    _hlMenu(btn, again) {
      const hl = Object.assign({ mode: 'chain', depth: 0 }, this._data.ui.hl || {}), f = this._model ? this._flt(this._model.label) : null;
      const modes = [['chain', T('chain'), T('what_sets_it_off_and')], ['up', T('upstream'), T('only_what_leads_to_it')],
        ['down', T('downstream'), T('only_what_it_leads_to')], ['both', T('both_ways'), T('upstream_and_downstream')], ['off', T('off'), T('only_the_selected_box')]];
      const tick = (on) => `<ha-icon icon="mdi:check"${on ? '' : ' style="visibility:hidden"'}></ha-icon>`;
      const html = `<div class="mtitle">${T('highlight_around_a_selected_box')}</div>${modes.map(([k, t, d]) => `<button class="mi" data-act="hl-mode" data-mode="${k}" title="${esc(d)}">${tick(hl.mode === k)}<span>${t}</span></button>`).join('')}<div class="mdepth ${['up', 'down', 'both'].includes(hl.mode) ? '' : 'off'}"><span>${T('reach')}</span>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="chip ${hl.depth === d ? 'on' : ''}" data-act="hl-depth" data-depth="${d}" title="${d ? T('key_2', { d: P('n_arrows_away', d), d2: d }) : T('all_the_way_key_0')}">${d || T('all')}</button>`).join('')}</div>${f ? `<div class="msep"></div><div class="mtitle">${T('show_in_this_function')}</div>${[['trigger', T('triggers_2')], ['condition', T('checked_by')], ['source', T('read_by_helper_inputs')], ['action', T('changes')], ['call', T('runs_script_calls')], ['outside', T('outside_items')], ['suggest', T('related_suggestions')]]
            .map(([k, t]) => `<button class="mi" data-act="hl-flt" data-key="${k}">${tick(f[k])}<span>${t}</span></button>`).join('')}` : ''}<div class="msep"></div><div class="mtitle">${T('arrow_style')}</div><button class="mi" data-act="hl-curved" title="${T('curved_arrows_take_the_shortest')}">${tick(this._data.ui.curved === true)}<span>${T('curved_arrows')}</span></button><div class="msep"></div><div class="mtitle">${T('live')}</div><button class="mi" data-act="hl-cond" title="${T('a_tick_or_a_cross')}">${tick(this._data.ui.condres !== false)}<span>${T('whether_each_check_passes_now')}</span></button>`;
      if (again && this._menuEl) { this._menuEl.innerHTML = html; return; }
      this._menu(btn, [], null);
      this._menuEl.classList.add('hlm');
      this._menuEl.innerHTML = html;
      const br = this._$.board.getBoundingClientRect(), ar = btn.getBoundingClientRect();
      this._menuEl.style.left = Math.round(Math.max(6, Math.min(ar.left - br.left, br.width - this._menuEl.offsetWidth - 6))) + 'px';
    }

    /* ---------- focus: causal chain through the selected item ---------- */
    _computeFocus() {
      const m = this._model, k = this._sel;
      this._focus = null; this._focusEdges = new Set(); this._focusDist = null;
      // a run or a chain from the debugger, lit step by step (9.4)
      if (m && this._lit && !k) { this._focus = new Set(this._lit.keys); this._focusEdges = new Set(this._lit.edges); return; }
      if (!m || !k || !m.nodes.has(k)) return;
      const hl = this._data.ui.hl || {};
      const r = focusSet(this._visEdges(), k, hl.mode || 'chain', hl.depth || 0);
      this._focus = new Set(r.dist.keys()); this._focusEdges = r.edges; this._focusDist = r.dist;
    }
    _select(key) {
      this._sel = key && this._model && this._model.nodes.has(key) ? key : null;
      // a selected box's arrows stay traced through the shared lines they're on (how a touch screen traces them)
      this._setTrace(this._sel ? this._busEdgesOf(this._sel) : null, !!this._sel);
      if (this._lit) this._clearLit(true);
      if (this._selEdge || !this._$.edgebar.hidden) { this._selEdge = null; this._$.edgebar.hidden = true; }
      this._applyFocus();
      if (this._drawer && this._drawer.mode === 'debug') this._renderWhy();
      if (this._sbxOn() && this._sel && !this._sel.includes(':') && this._sbx.eng.get(this._sel)) this._sbxPick(this._sel);
    }
    _applyFocus() {
      this._computeFocus();
      const F = this._focus;
      this._els.forEach((el, k) => {
        el.classList.toggle('sel', k === this._sel);
        el.classList.toggle('now', !!this._lit && this._lit.now === k);
        el.classList.toggle('dim', !!F && !F.has(k));
        // lit boxes fade a little with distance, so the layers read at a glance
        const d = F && F.has(k) && this._focusDist ? this._focusDist.get(k) : 0;
        el.style.opacity = d > 1 ? String(Math.max(0.55, 1 - (d - 1) * 0.12)) : '';
      });
      this._drawEdges();
      this._renderNodebar();
    }
    _hover(key) {
      if (this._hov === key) return;
      const old = this._hov && this._els.get(this._hov);
      if (old) old.classList.remove('hov');
      this._hov = key;
      const el = key && this._els.get(key);
      if (el) el.classList.add('hov');
    }
    _pulse(k) {
      const el = this._els.get(k);
      if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
      this._live.set(k, Date.now() + 2500);
      this._drawEdges();
      this._clock.after('live', 2600, () => this._drawEdges());
    }

    _renderNodebar() {
      const bar = this._$.nodebar, m = this._model, n = m && this._sel ? m.nodes.get(this._sel) : null;
      this._$.lh.hidden = true;
      if (!n) { bar.hidden = true; return; }
      const mk = (list) => list.map(([a, i, t, off, data]) => `<button data-act="${a}" ${data || ''} ${off ? `disabled title="${esc(off)}"` : `title="${esc(t)}"`}><ha-icon icon="${i}"></ha-icon><span>${esc(t)}</span></button>`).join('');
      if (n.kind === 'tool') {
        const tid = `data-tid="${esc(n.tool.id)}"`, inj = n.tool.type === 'inject', full = this._full() ? null : FULL_ONLY_TEST;
        this._put(bar, `<span class="nbname">${esc(n.name)}</span>` + mk(inj
          ? [['tool-run', 'mdi:play', T('run_2'), full, tid], ['tool-edit', 'mdi:pencil-outline', T('edit_2'), full, tid], ['tool-del', 'mdi:delete-outline', T('remove'), null, tid]]
          : [['mon-clear', 'mdi:broom', T('clear'), null, tid], ['tool-del', 'mdi:delete-outline', T('remove'), null, tid]]));
        bar.hidden = false;
        this._positionNodebar();
        return;
      }
      if (this._sbxOn()) {
        const b = [], eng = this._sbx.eng;
        if (!n.key.includes(':') && eng.get(n.key)) {
          b.push(['sbx-setbox', 'mdi:pencil-box-outline', T('sbx_set_here')]);
          // its first suggested values (0.11.2), one click each
          if (this._sbx.ins) this._sbxValOpts(n.key, '').opts.filter((o) => o.v !== (eng.get(n.key) || {}).state && !['unavailable', 'unknown'].includes(o.v)).slice(0, 3).forEach((o) => b.push(['sbx-setv', 'mdi:arrow-right-bold-circle-outline', o.v.startsWith(SBX_PRESS) ? o.l : T('sbx_set_v', { v: shorten(o.v, 16) }), null, `data-v="${esc(o.v)}" data-k="${esc(n.key)}"`]));
        }
        if (eng.items.has(n.key)) {
          b.push(['sbx-runbox', 'mdi:play', T('sbx_run_here')]);
          b.push(eng.breaks.has(n.key) ? ['sbx-break', 'mdi:pause-octagon', T('sbx_break_off')] : ['sbx-break', 'mdi:pause-octagon-outline', T('sbx_break_on')]);
        }
        if (n.key.startsWith('event:')) b.push(['sbx-firebox', 'mdi:lightning-bolt-outline', T('sbx_fire_here')]);
        if (this._canTest(n)) b.push(['test', 'mdi:flask-outline', T('sbx_test_here')]);
        this._put(bar, `<span class="nbname">${esc(n.name)}</span>` + mk(b) + `<span class="nbsbx">${T('sbx_bar_note')}</span>`);
        bar.hidden = false;
        this._positionNodebar();
        return;
      }
      const st = this._hass.states[n.key];
      const logic = n.domain === 'automation' || n.domain === 'script';
      const ent = !n.key.includes(':') || n.domain === 'device';
      const btn = [];
      if (n.kind === 'nodered') btn.push(['open', 'mdi:sitemap', T('open_in_node_red')]);
      else if (logic) btn.push(['open', 'mdi:pencil-outline', T('edit_2')]);
      else if (n.domain === 'device') btn.push(['open', 'mdi:devices', T('device')]);
      else {
        const ed = this._editOf(n);
        if (ed) btn.push(['edit', 'mdi:pencil-outline', T('edit_2'), ed.off || null]);
        if (ent) btn.push(['open', 'mdi:information-outline', T('details')]);
      }
      if (logic && this._itemId(n)) btn.push(['trace', 'mdi:timeline-clock-outline', T('traces_2')]);
      if (n.domain === 'automation' && st) btn.push(['toggle', st.state === 'on' ? 'mdi:pause-circle-outline' : 'mdi:play-circle-outline', st.state === 'on' ? T('turn_off') : T('turn_on')]);
      if (n.kind === 'member') btn.push(['remove', 'mdi:link-variant-off', T('remove')]);
      else if (ent) btn.push(['add', 'mdi:link-variant-plus', T('add_to_function')]);
      if (this._full() && !n.key.includes(':') && (logic || n.domain === 'scene' || this._scopeOf(n.key) === 'helpers')) btn.push(['delete', 'mdi:delete-outline', T('delete_3')]);
      const kept = (this._layout(m.label).keep || []).includes(n.key);
      btn.push(['keep', kept ? 'mdi:pin-off-outline' : 'mdi:pin-outline', kept ? T('unpin') : T('keep_in_place')]);
      // developer tools (Phase 9)
      const tools = [];
      if (this._canTest(n)) tools.push(['test', 'mdi:flask-outline', T('test_2'), this._full() ? null : FULL_ONLY_TEST]);
      if (n.domain === 'automation' && st) tools.push(this._watching(n.key) ? ['watch', 'mdi:eye-off-outline', T('stop_watching')] : ['watch', 'mdi:eye-outline', T('watch_triggers')]);
      if (/^(event|nact):/.test(n.key) || (n.key.startsWith('mqtt:') && (this._hass.config.components || []).includes('mqtt'))) tools.push(['monitor', 'mdi:monitor-eye', T('monitor')]);
      if (n.key.startsWith('svc:notify.') || (n.domain === 'notify' && st)) tools.push(['messages', 'mdi:message-text-clock-outline', T('messages')]);
      if (this._canLink(n)) tools.push(['connect', 'mdi:vector-polyline-plus', T('connect'), this._full() ? null : T('drawing_arrows_needs_full_manager')]);
      this._put(bar, `<span class="nbname">${esc(n.name)}</span>` + mk(btn.map(([a, i, t, off]) => [a, i, t, off || null, a === 'toggle' && st ? `data-state="${esc(st.state)}"` : '']))
        + (tools.length ? '<span class="nbsep"></span>' + mk(tools) : ''));
      bar.hidden = false;
      this._positionNodebar();
    }
    _positionNodebar() {
      const bar = this._$.nodebar;
      if (bar.hidden || !this._model) return;
      const n = this._model.nodes.get(this._sel);
      if (!n) return;
      // the bar sits above the box (translateY(-100%)); keep all of it inside the board, beside an open drawer:
      // it wraps onto a second line when it doesn't fit. Measure it at the left edge: placed near the right edge,
      // it would shrink to the room left there and be measured too narrow.
      const W = this._openWidth();
      bar.style.maxWidth = Math.max(160, W - 12) + 'px';
      bar.style.left = '0px';
      const v = this._view, H = this._$.vp.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight;
      bar.style.left = Math.max(6, Math.min(n.x * v.k + v.x, W - bw - 6)) + 'px';
      bar.style.top = Math.max(bh + 6, Math.min(n.y * v.k + v.y - 8, H - 6)) + 'px';
      // the handle to draw an arrow from (7.5), on the box's right edge
      const lh = this._$.lh, show = this._full() && this._canLink(n);
      lh.hidden = !show;
      // out by the right edge, or the bottom one top to bottom
      if (show) { const V = this._vert(); lh.style.left = ((V ? n.x + n.w / 2 : n.x + n.w) * v.k + v.x) + 'px'; lh.style.top = ((V ? n.y + n.h : n.y + n.h / 2) * v.k + v.y) + 'px'; }
    }

    _setEmpty() {
      const e = this._$.empty;
      e.classList.remove('wel');
      this._$.board.classList.toggle('firstrun', !this._data.functions.length);
      if (!this._data.functions.length) {
        e.hidden = false;
        e.classList.add('wel');
        e.innerHTML = `<div class="welcome"><ha-icon icon="mdi:sitemap-outline"></ha-icon><h2>${T('welcome_to_functions')}</h2><p>${T('a_function_is_everything_that')}</p><ol><li><b>${T('import_2')}</b> ${T('finds_the_functions_already_in')}</li><li>${T('or_start_a')} <b>${T('new_function_3')}</b> ${T('and_build_it_with_home')}</li><li>${T('open_a_function_to_see')}</li></ol><div class="wbtns"><button class="primary" data-act="import">${T('import_from_my_setup')}</button><button data-act="newfn">${T('new_function_2')}</button></div><p class="safe"><ha-icon icon="mdi:shield-check-outline"></ha-icon><span>${this._full()
            ? T('a_function_is_a_home_2')
            : T('a_function_is_a_home')}</span></p></div>`;
        return;
      }
      if (this._model && !this._visibleKeys().size) {
        e.hidden = false;
        e.innerHTML = `<div><b>${T('nothing_in_this_function_yet')}</b><br>${T('add_pieces_with_automation_script')}</div>`;
        return;
      }
      e.hidden = true;
    }

    _renderHeader() {
      const vb = this._$.tools && this._$.tools.querySelector('[data-act="versions"]');
      if (vb) vb.hidden = !this._verOK();
      const l = this._labelMap.get(this._data && this._data.ui.current);
      const t = this._$.title;
      if (!l) { this._put(t, `<span class="muted">${T('functions')}</span>`); this._$.tools.hidden = true; return; }
      this._$.tools.hidden = false;
      this._put(t, `<ha-icon icon="${esc(l.icon || 'mdi:puzzle-outline')}" style="color:${cssColor(l.color)}"></ha-icon><div class="tt"><div class="ttl">${esc(l.name)}</div>${l.description ? `<div class="desc">${esc(l.description)}</div>` : ''}</div><button class="ib" data-act="fn-edit" title="${T('edit_name_icon_colour_and')}"><ha-icon icon="mdi:pencil-outline"></ha-icon></button><button class="ib" data-act="fn-menu" data-label="${esc(l.label_id)}" title="${T('hide_or_delete_this_function')}"><ha-icon icon="mdi:dots-vertical"></ha-icon></button>${this._probChip()}`);
      this._renderPause();
    }

    _isOn(id) { const st = this._hass.states[id]; return !!st && st.state === 'on'; }
    _pauseState() {
      const m = this._model;
      if (!m) return null;
      const ids = [...m.nodes.values()].filter((n) => n.kind === 'member' && n.domain === 'automation').map((n) => n.key);
      const L = this._layout(m.label), paused = Array.isArray(L.paused) ? L.paused : null;
      if (!ids.length && !paused) return null;
      return { ids, total: ids.length, on: ids.filter((id) => this._isOn(id)).length, paused };
    }
    _renderPause() {
      const b = this._$.pause, p = this._pauseState();
      if (!p) { b.hidden = true; return; }
      b.hidden = false;
      if (b.dataset.confirm) return;
      // Resume shows while the function is paused, even if someone switched one back on by hand
      const resume = p.paused ? true : p.on === 0, sig = p.on + '/' + p.total + '/' + (p.paused ? p.paused.length : '-');
      if (b.dataset.sig === sig) return;
      b.dataset.sig = sig;
      b.innerHTML = `<ha-icon icon="${resume ? 'mdi:play-circle-outline' : 'mdi:pause-circle-outline'}"></ha-icon><span>${resume ? T('resume_2') : T('pause')}</span>`;
      b.title = p.paused ? T('turn_back_on_the_that', { count: P('n_automations', p.paused.length) })
        : resume ? T('turn_the_in_this_function', { total: P('n_automations', p.total) })
          : T('turn_off_the_that_are', { on: P('n_automations', p.on) });
    }
    _pause(b) {
      const p = this._pauseState(), label = this._data.ui.current;
      if (!p) return;
      if (this._sbxOn()) { this._toast(T('sbx_no_pause')); return; }
      const L = this._layout(label), name = this._fnName(label);
      const call = (service, ids) => this._svc('automation', service, {}, { entity_id: ids });
      const done = () => { delete b.dataset.sig; this._renderPause(); };
      if (p.paused) {
        const ids = p.paused.filter((id) => this._hass.states[id]);
        this._twoStep(b, T('turn_on_2', { count: P('n_automations', ids.length) }), async () => {
          try {
            if (ids.length) await call('turn_on', ids);
            delete L.paused; this._save();
            this._history({ label, text: T('resume', { name }), undo: async () => { L.paused = ids; this._save(); if (ids.length) await call('turn_off', ids); }, redo: async () => { delete L.paused; this._save(); if (ids.length) await call('turn_on', ids); } });
            this._toast(T('resumed_back_on', { count: P('n_automations', ids.length) }));
          } catch (e) { this._toast(T('failed_3', { message: e.message || e.code })); }
          done();
        });
      } else if (p.on > 0) {
        const ids = p.ids.filter((id) => this._isOn(id));
        this._twoStep(b, T('turn_off_and_stop_runs', { count: P('n_automations', ids.length) }), async () => {
          L.paused = ids; this._save();
          try {
            await call('turn_off', ids);
            this._history({ label, text: T('pause_2', { name }), undo: async () => { delete L.paused; this._save(); await call('turn_on', ids); }, redo: async () => { L.paused = ids; this._save(); await call('turn_off', ids); } });
            this._toast(T('paused_off_until_you_resume', { count: P('n_automations', ids.length) }));
          } catch (e) { delete L.paused; this._save(); this._toast(T('failed_3', { message: e.message || e.code })); }
          done();
        });
      } else {
        // paused before v0.3.1 (no saved list) or switched off by hand: the only choice is all of them
        this._twoStep(b, T('turn_on_all', { total: P('n_automations', p.total) }), async () => {
          try { await call('turn_on', p.ids); this._toast(T('turned_on', { total: P('n_automations', p.total) })); } catch (e) { this._toast(T('failed_3', { message: e.message || e.code })); }
          done();
        });
      }
    }

    _renderLegend() {
      const u0 = (this._data && this._data.ui) || { legend: true, outside: true, suggest: true };
      const u = this._model ? Object.assign({}, u0, this._flt(this._model.label)) : u0;
      const open = this._compact ? !!this._legendOpen : u.legend;
      const line = (cls) => `<svg width="38" height="10"><path class="${cls}" d="M4,5 L30,5"></path><path class="ah ${cls}" d="M30,1 L37,5 L30,9 z"></path>${cls === 'role-trigger' ? '<circle class="ah trig" cx="4" cy="5" r="3.5"></circle>' : ''}</svg>`;
      this._put(this._$.legend, `<button class="lgt" data-act="legend"><ha-icon icon="mdi:map-legend"></ha-icon>${open ? T('hide_key') : T('key')}</button>`
        + (open ? `<div class="lg">${line('role-trigger')}<span>${T('triggers')}</span>${line('role-condition')}<span>${T('is_checked_or_read_by')}</span>${line('role-action')}<span>${T('changes_2')}</span>${line('role-call')}<span>${T('runs_script_call')}</span>${line('role-source')}<span>${T('is_read_by_a_helper')}</span>${line('loop')}<span>${T('loop_can_retrigger_itself')}</span>${line('role-tool')}<span>${T('a_test_button_or_a')}</span>`
          + `<svg width="38" height="14"><path d="M4,3 L16,3 L16,11 L30,11"></path><path d="M16,3 L30,3"></path><circle cx="16" cy="3" r="2.6" style="fill:var(--fb-edge)"></circle></svg><span>${T('one_line_that_branches_dot')}</span>`
          + `<svg width="38" height="14"><path d="M19,1 L19,13"></path><path d="M4,8 L15,8 A4,4 0 0 1 23,8 L34,8"></path></svg><span>${T('crosses_without_meeting')}</span>`
          + `<svg width="38" height="14"><path d="M4,7 L34,7"></path><path class="ah" d="M15,7 L23,2.5 L23,11.5 z"></path></svg><span>${T('runs_back')}</span></div><div class="lgn"><span class="sw dashed"></span>${T('related_not_in_this_function')}<br><span class="sw pill"></span>${T('outside_item_it_touches')}<br><span class="sw st amber"></span>${T('unavailable')}<span class="sw st red"></span>${T('last_run_failed')}<span class="sw st blue"></span>${T('running')}<br><span class="cres-k ok">✓</span><span class="cres-k bad">✕</span> ${T('a_check_passes_or_fails')}<br><span class="sw dashed2"></span>${T('simulated_state')}${this._sbxOn() ? `<br><span class="sw sbk"></span>${T('sbx_changed_key')}<br><span class="sw sbg"></span>${T('sbx_ghost_key')}` : ''}</div><label class="tg"><input type="checkbox" data-tog="outside" ${u.outside ? 'checked' : ''}>${T('show_outside_items')}</label><label class="tg"><input type="checkbox" data-tog="suggest" ${u.suggest ? 'checked' : ''}>${T('show_related_suggestions')}</label><label class="tg" title="${T('reads_your_node_red_app')}"><input type="checkbox" data-nr ${u0.nodered === true ? 'checked' : ''}>${T('show_node_red_flows')}</label>${u0.nodered === true && this._nrState() && this._nrState().err ? `<div class="lgerr">${esc(this._nrState().err)}${this._nrState().need ? ` <button class="lgbtn" data-act="nr-open">${T('open_node_red')}</button>` : ''}</div>` : ''}` : ''));
    }

    /* ---------- view ---------- */
    _applyView() {
      const v = this._view;
      this._$.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
      this._$.vp.style.backgroundSize = `${22 * v.k}px ${22 * v.k}px`;
      this._$.vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
      this._positionNodebar();
    }
    _saveView() {
      this._clock.after('view', 800, () => {
        if (!this._model) return;
        const u = this._data.ui;
        (u.views = u.views || {})[this._viewKey(this._model.label)] = { x: Math.round(this._view.x), y: Math.round(this._view.y), k: +this._view.k.toFixed(3) };
        this._save();
      });
    }
    _zoomAt(cx, cy, f) {
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      const k = Math.min(2.5, Math.max(0.15, v.k * f)), px = cx - r.left, py = cy - r.top, s = k / v.k;
      v.x = px - (px - v.x) * s; v.y = py - (py - v.y) * s; v.k = k;
      this._fitNext = null;
      this._applyView();
      this._saveView();
    }
    _zoomCenter(f) { const r = this._$.vp.getBoundingClientRect(); this._zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }
    _center() {
      const r = this._$.vp.getBoundingClientRect(), v = this._view;
      return { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k };
    }
    // Fit cycles when a system is too wide to read whole: the readable fit (60% or more), then everything (down to 25%)
    _fitPress() { this._fit({ all: this._fitNext === 'all' }); }
    _fit(opt = {}, tries = 0) {
      const m = this._model;
      if (!m || !this.isConnected) return;
      const r = this._$.vp.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) { if (tries < 20) this._clock.after('fit', 250, () => this._fit(opt, tries + 1)); return; }
      const L = this._layout(m.label), vis = this._visibleKeys();
      const boxes = [...vis].map((k) => m.nodes.get(k)).map((n) => [n.x, n.y, n.x + n.w, n.y + n.h])
        .concat(L.frames.map((f) => [f.x, f.y, f.x + f.w, f.y + f.h]))
        .concat(L.notes.map((n) => [n.x, n.y, n.x + (n.w || 240), n.y + 120]));
      if (!boxes.length) { this._view = { x: 40, y: 40, k: 1 }; this._applyView(); return; }
      const pad = 60, MIN = opt.all ? 0.25 : 0.6;
      const bbox = (bs) => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
      let [x0, y0, x1, y1] = bbox(boxes);
      const tooBig = (b) => (b[2] - b[0]) * 0.6 > r.width - pad * 2 || (b[3] - b[1]) * 0.6 > r.height - pad * 2;
      const whole = [x0, y0, x1, y1];
      if (!opt.all && vis.size && tooBig(whole)) {
        // too big to show whole at a readable zoom: frame the boxes themselves rather than far-off frames and notes
        [x0, y0, x1, y1] = bbox(boxes.slice(0, vis.size));
      }
      const kf = Math.min((r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0));
      const k = Math.min(1.2, Math.max(MIN, kf));
      // what the next press does: show everything when this fit cut something off, else the readable fit again
      this._fitNext = !opt.all && tooBig(whole) ? 'all' : null;
      const fb = this._$.vp.querySelector('[data-act="fit"]');
      if (fb) fb.title = this._fitNext === 'all' ? T('zoom_out_to_show_everything') : opt.all ? T('back_to_a_readable_size') : T('fit_everything');
      if (opt.all) this._fitNext = 'readable';
      const x = (x1 - x0) * k <= r.width - pad * 2 ? (r.width - (x1 - x0) * k) / 2 - x0 * k : pad - x0 * k;
      const y = (y1 - y0) * k <= r.height - pad * 2 ? (r.height - (y1 - y0) * k) / 2 - y0 * k : pad - y0 * k;
      this._view = { k, x, y };
      this._applyView();
      this._saveView();
    }
    // Auto-arrange: every box goes where the automatic layout puts it, boxes you moved by hand included, except
    // those you chose to keep in place
    _arrangeData(label) {
      const L = this._layout(label), keep = new Set(L.keep || []), nodes = {};
      Object.entries(L.nodes || {}).forEach(([k, p]) => { if (keep.has(k)) nodes[k] = p; });
      L.nodes = nodes;
    }
    _arrange() {
      const label = this._model.label, before = this._snap(label);
      this._arrangeData(label);
      this._place(); this._render(); this._fit(); this._save();
      this._layoutStep(label, before, T('arrange'));
    }
    // Auto-arrange, and which way the function flows
    _arrangeMenu(btn) {
      const V = this._vert(), chk = (on) => (on ? 'mdi:check' : 'mdi:blank');
      this._menu(btn, [
        { act: 'arr-go', icon: 'mdi:auto-fix', text: T('auto_arrange_now') },
        { sep: true },
        { act: 'arr-dir', data: { dir: 'right' }, icon: chk(!V), text: T('flow_left_to_right'), title: T('flow_switch_t') },
        { act: 'arr-dir', data: { dir: 'down' }, icon: chk(V), text: T('flow_top_to_bottom'), title: T('flow_switch_t') },
      ], T('arrange'));
    }
    // a new direction lays the whole function out again: boxes kept in place are let go too, since where they were
    // kept makes no sense turned a quarter turn. Undo puts the direction, the places and what was kept back
    _setDir(dir) {
      const label = this._model.label, L = this._layout(label), want = dir === 'down' ? 'down' : 'right';
      if ((L.dir || 'right') === want) return;
      const before = this._snap(label), kept = (L.keep || []).length;
      L.dir = want;
      L.keep = [];
      L.nodes = {};
      this._place(); this._render(); this._fit(); this._save();
      this._layoutStep(label, before, want === 'down' ? T('flow_top_to_bottom') : T('flow_left_to_right'));
      this._toast(kept ? P('flow_switched_kept', kept) : T('flow_switched'), [{ text: T('undo'), fn: () => this._undo() }]);
    }

    // moving a box by hand keeps every other box where it is now too: the function is arranged by hand from then
    // on, until Auto-arrange
    _freeze(L) {
      const m = this._model;
      this._visibleKeys().forEach((k) => { const n = m.nodes.get(k); if (n && !L.nodes[k] && !k.startsWith('tool:')) L.nodes[k] = { x: n.x, y: n.y }; });
    }

    /* ---------- pointer: pan, zoom, drag nodes / frames / notes ---------- */
    _listen(on) {
      if (!this._mv) { this._mv = (e) => this._onMove(e); this._up = (e) => this._onUp(e); }
      if (on && !this._listening) {
        window.addEventListener('pointermove', this._mv); window.addEventListener('pointerup', this._up); window.addEventListener('pointercancel', this._up);
        this._listening = true;
      } else if (!on && this._listening) {
        window.removeEventListener('pointermove', this._mv); window.removeEventListener('pointerup', this._up); window.removeEventListener('pointercancel', this._up);
        this._listening = false;
      }
    }
    _onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // drawing an arrow (7.5): from the handle by dragging, or by clicking the other box
      if (e.target.closest('.lh') && this._sel) {
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this._listen(true);
        this._startLink(this._sel, true);
        if (this._linking) { this._linking.sx = e.clientX; this._linking.sy = e.clientY; }
        return;
      }
      // or from one of a box's points: from a right-hand one out of the box, from a left-hand one into it
      const port = this._full() && e.target.closest('.port');
      if (port) {
        const key = port.closest('.node').dataset.key;
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this._listen(true);
        this._startLink(key, true, port.classList.contains('pl'));
        if (this._linking) { this._linking.sx = e.clientX; this._linking.sy = e.clientY; }
        return;
      }
      if (this._linking) {
        const node = e.target.closest('.node'), L = this._linking;
        this._endLink();
        if (node && node.dataset.key !== L.from) this._linkDialog(L.rev ? node.dataset.key : L.from, L.rev ? L.from : node.dataset.key);
        return;
      }
      if (e.target.closest('button, select, input, textarea, .nodebar, .edgebar, .zoom, .legend, .toast, .litbar, .flow .ghost, .flow .fnum')) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._listen(true);
      if (this._pointers.size === 2) {
        this._dropHold(this._drag);
        const [p, q] = [...this._pointers.values()];
        this._drag = { type: 'pinch', d0: Math.hypot(p.x - q.x, p.y - q.y) || 1, v0: Object.assign({}, this._view), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
        return;
      }
      if (this._pointers.size > 2) return;
      const base = { sx: e.clientX, sy: e.clientY, moved: false }, m = this._model, L = m && this._layout(m.label);
      const nodeEl = e.target.closest('.node'), fres = e.target.closest('.fresize'), fhead = e.target.closest('.fhead'), nhead = e.target.closest('.nhead');
      if (nodeEl && m) {
        const n = m.nodes.get(nodeEl.dataset.key);
        if (n) { this._grab(e, Object.assign(base, { type: 'node', n, el: nodeEl, ox: n.x, oy: n.y, before: this._snap(m.label) })); return; }
      }
      if (fres && L) {
        const f = L.frames.find((x) => x.id === fres.dataset.fid);
        if (f) { this._drag = Object.assign(base, { type: 'resize', f, el: fres.parentElement, ow: f.w, oh: f.h, before: this._snap(m.label) }); return; }
      }
      if (fhead && L) {
        const f = L.frames.find((x) => x.id === fhead.dataset.fid);
        if (f) { this._grab(e, Object.assign(base, { type: 'frame', f, el: fhead.parentElement, ox: f.x, oy: f.y, items: this._inFrame(f), before: this._snap(m.label) })); return; }
      }
      if (nhead && L) {
        const nt = L.notes.find((x) => x.id === nhead.dataset.nid);
        if (nt) { this._grab(e, Object.assign(base, { type: 'note', nt, el: nhead.parentElement, ox: nt.x, oy: nt.y, before: this._snap(m.label) })); return; }
      }
      this._drag = Object.assign(base, { type: 'pan', ox: this._view.x, oy: this._view.y });
    }
    // On a touch screen a box, frame or note moves only after it has been held still for half a second (a phone's
    // long-press). A finger that moves sooner pans the board, so swiping across boxes to look around doesn't drag them.
    _grab(e, d) {
      this._drag = d;
      if (e.pointerType !== 'touch') return;
      d.touch = true; d.wait = true;
      this._clock.after('hold', HOLD_MS, () => this._lift(d));
    }
    // picked up: it shows, and the phone buzzes the way Home Assistant's own buttons make it (0.13.0): its 'haptic'
    // event, which the companion app turns into the phone's buzz, and a browser into a vibration if the person's
    // profile allows it (navigator.vibrate alone does nothing in the app)
    _lift(d) {
      if (!d || this._drag !== d || !d.wait) return;
      this._clock.cancel('hold');
      d.wait = false;
      if (d.el) d.el.classList.add('lifted');
      window.dispatchEvent(new CustomEvent('haptic', { detail: 'medium', bubbles: true, composed: true }));
    }
    _dropHold(d) {
      if (!d) return;
      this._clock.cancel('hold'); d.wait = false;
      if (d.el) d.el.classList.remove('lifted');
    }
    _inFrame(f) {
      const items = [], inside = (x, y) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h;
      this._els.forEach((el, k) => {
        const n = this._model.nodes.get(k);
        if (n && inside(n.x + n.w / 2, n.y + n.h / 2)) items.push({ n, el, ox: n.x, oy: n.y });
      });
      this._layout(this._model.label).notes.forEach((nt) => {
        if (inside(nt.x + 20, nt.y + 10)) items.push({ nt, el: this._$.notes.querySelector(`.note[data-nid="${nt.id}"]`), ox: nt.x, oy: nt.y });
      });
      return items;
    }
    _onMove(e) {
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._linking && this._linking.drag) { this._linkMove(e); return; }
      let d = this._drag;
      if (!d) return;
      if (d.type === 'pinch') {
        if (this._pointers.size < 2) return;
        const [p, q] = [...this._pointers.values()];
        this._view = Object.assign({}, d.v0);
        this._zoomAt(d.mx, d.my, Math.hypot(p.x - q.x, p.y - q.y) / d.d0);
        return;
      }
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.wait) {
        // a finger can wobble a little while it holds; past that, before the second is up, it's a pan
        if (Math.hypot(dx, dy) < 10) return;
        this._dropHold(d);
        d = this._drag = { type: 'pan', touch: true, sx: d.sx, sy: d.sy, moved: false, ox: this._view.x, oy: this._view.y };
      }
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      const k = this._view.k, mv = (o, x, y) => { o.x = Math.round(x); o.y = Math.round(y); };
      if (d.type === 'pan') { this._view.x = d.ox + dx; this._view.y = d.oy + dy; this._applyView(); return; }
      if (d.type === 'resize') {
        d.f.w = Math.max(200, Math.round(d.ow + dx / k)); d.f.h = Math.max(120, Math.round(d.oh + dy / k));
        d.el.style.width = d.f.w + 'px'; d.el.style.height = d.f.h + 'px';
        return;
      }
      if (d.type === 'note') { mv(d.nt, d.ox + dx / k, d.oy + dy / k); d.el.style.left = d.nt.x + 'px'; d.el.style.top = d.nt.y + 'px'; return; }
      if (d.type === 'node') { mv(d.n, d.ox + dx / k, d.oy + dy / k); d.el.style.left = d.n.x + 'px'; d.el.style.top = d.n.y + 'px'; }
      if (d.type === 'frame') {
        mv(d.f, d.ox + dx / k, d.oy + dy / k);
        d.el.style.left = d.f.x + 'px'; d.el.style.top = d.f.y + 'px';
        d.items.forEach((it) => {
          const o = it.n || it.nt;
          mv(o, it.ox + dx / k, it.oy + dy / k);
          if (it.el) { it.el.style.left = o.x + 'px'; it.el.style.top = o.y + 'px'; }
        });
      }
      this._clock.frame('edges', () => { this._drawEdges(); this._positionNodebar(); });
    }
    _onUp(e) {
      this._pointers.delete(e.pointerId);
      if (!this._pointers.size) this._listen(false);
      if (this._linking && this._linking.drag) {
        const L = this._linking, hit = this.shadowRoot.elementFromPoint(e.clientX, e.clientY), node = hit && hit.closest && hit.closest('.node');
        const moved = Math.hypot(e.clientX - (L.sx || e.clientX), e.clientY - (L.sy || e.clientY)) > 6;
        if (node && node.dataset.key !== L.from) { this._endLink(); this._linkDialog(L.rev ? node.dataset.key : L.from, L.rev ? L.from : node.dataset.key); }
        else if (moved) this._endLink();
        else L.drag = false;  // a click on the handle: now click the other box
        return;
      }
      const d = this._drag;
      if (!d) return;
      if (d.type === 'pinch') { if (this._pointers.size < 2) { this._drag = null; this._saveView(); } return; }
      this._drag = null;
      this._dropHold(d);
      const label = this._model && this._model.label, L = label && this._layout(label);
      if (d.type === 'node') {
        if (!d.moved) this._select(d.n.key);
        else { this._freeze(L); L.nodes[d.n.key] = { x: d.n.x, y: d.n.y }; this._save(); this._drawEdges(); this._layoutStep(label, d.before, T('move', { name: d.n.name })); }
      } else if (d.type === 'pan') {
        if (!d.moved) this._select(null); else { this._fitNext = null; this._saveView(); }
      } else if (d.type === 'frame' && d.moved) {
        this._freeze(L);
        d.items.forEach((it) => { if (it.n) L.nodes[it.n.key] = { x: it.n.x, y: it.n.y }; });
        this._save(); this._drawEdges(); this._layoutStep(label, d.before, T('move_frame'));
      } else if ((d.type === 'resize' || d.type === 'note') && d.moved) { this._save(); this._layoutStep(label, d.before, d.type === 'resize' ? T('resize_frame') : T('move_note')); }
    }
    _onWheel(e) {
      e.preventDefault();
      this._zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }

    /* ---------- clicks, inputs, keys ---------- */
    _onClick(ev) {
      const el = ev.target.closest('[data-act],[data-fn],[data-run]');
      if (this._menuEl && !(el && this._menuEl.contains(el)) && !(this._menuAnchor && this._menuAnchor.contains(ev.target))) this._closeMenu();
      if (!el || el.tagName === 'SELECT') return;
      if (el.dataset.fn) {
        this._closeDrawer();
        if (this._compact) this._listOpen = false;
        this._open(el.dataset.fn);
        return;
      }
      if (el.dataset.run != null) { this._openRun(+el.dataset.run); return; }
      const a = el.dataset.act, label = this._data && this._data.ui.current;
      const need = () => { if (!label) { this._toast(T('create_or_pick_a_function')); return false; } return true; };
      if (a && this._ver && !VER_OK_ACTS.test(a)) { this._toast(T('ver_readonly')); return; }
      const h = a && this._acts().get(a);
      if (h) h(el, { a, label, need, ev });
    }
    _acts() { return this._actMap || (this._actMap = actionMap(this._actionTables())); }
    /* ---------- actions (0.10.0): what every button does, one table per view ----------
       A button names its action with data-act; _onClick finds it here (actionMap() joins the tables, and refuses a
       name in two of them). A handler gets the button and { a, label, need, ev }: the action's name, the open
       function's label, need() (false, with a toast, when no function is open) and the click. Static rules: every
       data-act in the source has a handler here, and every handler here is used. */
    _actionTables() {
      return {
        // the list of functions and its menus
        list: {
          'togglelist': () => {
            if (this._compact) this._listOpen = !this._listOpen;
            else if (this._data) { this._data.ui.list = !this._data.ui.list; this._save(); }
            this._renderList();
          },
          'newfn': () => { this._fnModal(null); },
          'fn-edit': (el, { label, need }) => { if (need()) this._fnModal(label); },
          'fn-goto': (el) => { this._closeModal(); this._open(el.dataset.label); },
          'fn-restore': (el) => { this._restoreFn(el.dataset.label); },
          'hamenu': () => { this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true })); },
          'find-x': () => { this._findClear(); },
          'find-go': (el) => { if (!this._findGo(el.dataset.key)) this._findAdd(el, el.dataset.key); },
          'find-in': (el) => { this._findGo(el.dataset.key, el.dataset.label); },
          'find-add': (el) => { this._findAdd(el, el.dataset.key); },
          'find-to': (el) => { this._findTo(el.dataset.key, el.dataset.label); },
          'left-add': (el) => { this._leftAddMenu(el, el.dataset.id); },
          'left-to': (el) => { this._leftTo(el.dataset.id, el.dataset.label); },
          'left-new': (el) => { this._leftNew(el.dataset.id); },
          'fn-menu': (el) => { this._fnMenu(el, el.dataset.label); },
          'fnm-edit': (el) => { this._closeMenu(); this._fnModal(el.dataset.label); },
          'fnm-hide': (el) => { this._closeMenu(); this._hideFunction(el.dataset.label); },
          'fnm-del': (el) => { this._closeMenu(); this._deleteFnDialog(el.dataset.label, false); },
          'fnm-delall': (el) => { this._closeMenu(); this._deleteFnDialog(el.dataset.label, true); },
        },
        // making new things for the open function
        create: {
          'new-automation': (el, { need }) => { if (need()) this._create('automation'); },
          'new-script': (el, { need }) => { if (need()) this._create('script'); },
          'new-helper': (el, { need }) => { if (need()) { if (this._menuEl && this._menuAnchor === el) this._closeMenu(); else this._helperMenu(el); } },
          'mk-helper': (el, { need }) => { if (need()) this._create('helper', el.dataset.domain, el.dataset.name); },
          'mk-scene': (el, { need }) => { if (need()) this._create('scene'); },
          'mk-more': () => { this._helperMoreMenu(); },
          'mk-back': () => { this._helperMenu(this._menuAnchor); },
        },
        // the builders (0.11.3)
        builders: {
          'recipes': (el, { need }) => { if (need()) { if (this._menuEl && this._menuAnchor === el) this._closeMenu(); else this._bldMenu(el); } },
          'nb-new': (el, { need }) => { if (need() && !this._ver) this._bldNew(); },
          'nb-add-btn': () => { this._bldButton(true); },
          'nb-del-btn': (el) => { this._bldButton(false, +el.dataset.i); },
          'nb-save': () => { this._bldSave(); },
          'nb-try': () => { this._bldTry(); },
          'nb-ha': () => { this._bldHA(); },
        },
        // the import manager
        manager: {
          'add-existing': (el, { label }) => { this._openManager('pick', label || '__new'); },
          'import': () => { this._openManager('detect'); },
          'mgr-tab': (el) => {
            const g = this._mgr;
            g.tab = el.dataset.tab;
            if (g.tab === 'detect' && !g.cands && !g.scanning) this._scanFunctions(); else this._renderManager();
          },
          'mgr-left': () => { this._mgr.leftOpen = !this._mgr.leftOpen; this._renderManager(); },
          'mgr-merge': (el) => { const o = this._mgr.offers[+el.dataset.o]; if (o) this._mgrJoin(o.parts.join(',')); },
          'mgr-merge-menu': (el) => { this._mgrMergeMenu(el, +el.dataset.ci); },
          'mgr-merge-to': (el) => { this._closeMenu(); this._mgrJoin(el.dataset.a + ',' + el.dataset.b); },
          'mgr-split': (el) => { const c = this._mgr.cands[+el.dataset.ci]; if (c) this._mgrJoin(c.key, true); },
          'mgr-expand': (el) => { const x = this._mgr.expanded, i = +el.dataset.ci; if (x.has(i)) x.delete(i); else x.add(i); this._renderManager(); },
          'mgr-import-one': (el) => { this._mgrImport([+el.dataset.ci]); },
          'mgr-import-sel': () => { this._mgrImport([...this._mgr.sel]); },
          'mgr-selall': () => {
            const g = this._mgr, avail = (g.cands || []).map((c, i) => (c.fn && !c.missing.length ? -1 : i)).filter((i) => i >= 0);
            g.sel = g.sel.size === avail.length ? new Set() : new Set(avail);
            this._renderManager();
          },
          'mgr-rescan': () => { this._mgr.cands = null; this._scanFunctions(); },
          'mgr-labels-add': () => { this._mgrLabelsAdd(); },
          'mgr-pick-add': () => { this._mgrPickAdd(); },
          'mgr-ptype': (el) => { this._mgr.ptype = el.dataset.ptype; this._mgr.pshow = 200; this._renderPicks(); },
          'mgr-more': () => { this._mgr.pshow = (this._mgr.pshow || 200) + 200; this._renderPicks(); },
          'mgr-pickall': () => { (this._mgr.pshownKeys || []).forEach((k) => this._pick.add(k)); this._renderPicks(); this._mgrFootRefresh(); },
        },
        // the board: header tools, the boxes, the view
        canvas: {
          'hint-x': () => { this._data.ui.hintOff = true; this._save(); this._applyMode(); },
          'frame': (el, { need }) => { if (need() && this._model) this._addFrame(); },
          'note': (el, { need }) => { if (need() && this._model) this._addNote(); },
          // undoable, so no second click to confirm it
          'arrange': (el) => { if (this._model) this._arrangeMenu(el); },
          'arr-go': () => { this._closeMenu(); if (this._model) this._arrange(); },
          'arr-dir': (el) => { this._closeMenu(); if (this._model) this._setDir(el.dataset.dir); },
          'pause': (el) => { this._pause(el); },
          'zoomin': () => { this._zoomCenter(1.2); },
          'zoomout': () => { this._zoomCenter(1 / 1.2); },
          'fit': () => { this._fitPress(); },
          'legend': () => {
            if (this._compact) this._legendOpen = !this._legendOpen;
            else { this._data.ui.legend = !this._data.ui.legend; this._save(); }
            this._renderLegend();
          },
          'open': (el, { a }) => { this._nodeAction(a, el); },
          'edit': (el, { a }) => { this._nodeAction(a, el); },
          'trace': (el, { a }) => { this._nodeAction(a, el); },
          'toggle': (el, { a }) => { this._nodeAction(a, el); },
          'remove': (el, { a }) => { this._nodeAction(a, el); },
          'add': (el, { a }) => { this._nodeAction(a, el); },
          'delete': (el, { a }) => { this._nodeAction(a, el); },
          'hl': (el) => { if (this._menuEl && this._menuAnchor === el) this._closeMenu(); else this._hlMenu(el); },
          'hl-mode': (el) => { this._setHl({ mode: el.dataset.mode }); },
          'hl-depth': (el) => { this._setHl({ depth: +el.dataset.depth, mode: ['chain', 'off'].includes((this._data.ui.hl || {}).mode || 'chain') ? 'both' : this._data.ui.hl.mode }); },
          'hl-flt': (el) => { if (this._model) { const f = this._flt(this._model.label), k = el.dataset.key; this._setFlt(this._model.label, k, !f[k]); if (k === 'suggest') this._open(this._model.label, true); else { this._place(); this._render(); } this._renderLegend(); this._refreshHl(); } },
          'fdel': (el) => { this._delFrame(el.dataset.fid); },
          'ndel': (el) => { this._delNote(el.dataset.nid); },
          // the routes change with the style, and so does the automatic layout's spacing for them
          'hl-curved': () => { this._data.ui.curved = this._data.ui.curved !== true; this._save(); this._place(); this._render(); this._refreshHl(); },
          'hl-cond': () => { this._data.ui.condres = this._data.ui.condres === false; this._save(); this._testConds(); this._refreshHl(); },
        },
        // the arrow editor (7.5)
        arrows: {
          'edge': (el, { ev }) => { this._edgeClick(el.dataset.e, ev); },
          'connect': () => { if (this._sel) this._startLink(this._sel, false); },
          'arw-remove': () => { this._arrowRemoveDialog(this._selEdge); },
          'arw-open': () => {
            const e = this._model && this._model.edges.find((x) => x.id === this._selEdge), ends = e && this._arrowEnds(e), n = ends && this._model.nodes.get(ends.owner);
            this._clearEdgeSel();
            if (n) this._openItem(n);
          },
          'arw-edit': (el) => { const n = this._model && this._model.nodes.get(el.dataset.key); this._closeModal(); if (n) this._openItem(n); },
          'arw-save': () => { this._arwSave(); },
          'lnk-pick': (el) => { if (this._arw) { this._arw.pick = +el.dataset.i; this._renderLinkDlg(); } },
          'nr-open': () => { this._openNodeRed(); },
          'lnk-kind': (el) => { if (this._arw) { this._arw.pick = Math.max(0, this._arw.choices.findIndex((c) => c.kind === el.dataset.k)); this._renderLinkDlg(); } },
        },
        // the developer tools (Phase 9)
        tools: {
          'messages': () => { if (this._sel) this._openMessages(this._sel); },
          'msg-run': (el) => { const x = (this._msgs || [])[+el.dataset.i]; if (x) this._showRun({ kind: 'run', key: x.from, t: x.t, run: x.run }, null); },
          'test': () => { if (this._sel) this._testDialog(this._sel); },
          'test-pick': (el) => { if (this._tst) { this._tst.pick = el.dataset.id; this._tst.bad = null; this._renderTestDlg(); } },
          'test-run': () => { this._testRunDlg(false); },
          'test-save': () => { this._testRunDlg(true); },
          'test-confirm': () => { const t = this._pendingTest; this._pendingTest = null; this._closeModal(); if (t) this._doTest(t); },
          'tool-run': (el) => { this._toolRun(el.dataset.tid); },
          'tool-edit': (el) => { const t = this._toolById(el.dataset.tid); if (t && t.type === 'inject') this._testDialog(t.test.target, t.id); },
          'tool-del': (el) => { this._delTool(el.dataset.tid); },
          'mon-clear': (el) => { this._monData.delete(el.dataset.tid); this._monCount.delete(el.dataset.tid); this._renderMon(el.dataset.tid); },
          'watch': () => { if (this._sel) this._toggleWatch(this._sel); },
          'keep': () => { if (this._sel) this._toggleKeep(this._sel); },
          'monitor': () => { if (this._sel) this._monitorFor(this._sel); },
          'mon-kind': (el) => {
            this._monKind = el.dataset.k === 'mqtt' ? 'mqtt' : 'event';
            this._$.modal.querySelectorAll('[data-act="mon-kind"]').forEach((b) => b.classList.toggle('on', b === el));
            const l = this._$.modal.querySelector('.mlab'), i = this._$.modal.querySelector('input[name=topic]');
            if (l) l.textContent = this._monKind === 'mqtt' ? T('mqtt_topic_and_work') : T('event_type');
            if (i) { i.placeholder = this._monKind === 'mqtt' ? 'zigbee2mqtt/hall_button/action' : 'mobile_app_notification_action'; i.setAttribute('list', this._monKind === 'mqtt' ? '' : 'fbevtypes'); i.focus(); }
          },
          'mon-make': () => { this._monitorMake(); },
        },
        // the side drawer
        drawer: {
          'runs': (el, { need }) => { if (need()) this._openRuns(); },
          'close': () => { this._closeDrawer(); },
          'newtab': () => { if (this._drawer && this._drawer.url) window.open(this._drawer.url, '_blank'); },
          'refresh': () => { this._openRuns(); },
          'back': () => { if (this._drawerBack === 'debug') this._openDebug(); else this._openRuns(); },
        },
        // problems and saved checks
        problems: {
          'chk-save': () => { this._checkSaveDlg(); },
          'chk-save-go': () => { this._checkSaveGo(); },
          'chk-run': (el) => { this._runChecks(this._data.ui.current, el.dataset.id ? [el.dataset.id] : null, true); },
          'chk-replay': (el) => { this._checkReplay(el.dataset.id); },
          'chk-del': (el) => { this._checkDel(el.dataset.id); },
          'chk-edit': (el) => { this._checkEditDlg(el.dataset.id); },
          'chk-edit-go': () => { this._checkEditGo(); },
          'chk-st-up': (el) => { this._checkEditMove(+el.dataset.i, -1); },
          'chk-st-down': (el) => { this._checkEditMove(+el.dataset.i, 1); },
          'chk-st-del': (el) => { this._checkEditDrop('steps', +el.dataset.i); },
          'chk-x-del': (el) => { this._checkEditDrop('expect', +el.dataset.i); },
          'chk-x-add': () => { this._checkEditAdd(); },
          'chk-export': (el) => { this._checkExport(el.dataset.id); },
          'chk-copy': () => { this._checkCopy(); },
          'chk-import': () => { this._checkImportDlg(); },
          'chk-import-go': () => { this._checkImportGo(); },
          'problems': (el) => { if (this._drawer && this._drawer.mode === 'problems' && !this._drawer.dismissed && !el.closest('.drawer')) this._closeDrawer(); else this._openProblems(); },
          'pdis-list': (el) => { if (this._drawer && this._drawer.mode === 'problems' && this._drawer.dismissed && !el.closest('.drawer')) this._closeDrawer(); else this._openProblems(true); },
          'pdis': (el) => { this._probDismiss(el.dataset.k, 'off'); },
          'pdis-back': (el) => { this._probDismiss(el.dataset.k, 'back'); },
          'pdis-ever': (el) => { this._probDismiss(el.dataset.k, 'ever'); },
          'pdis-unever': () => { this._probDismiss(null, 'unever'); },
          'prob-go': (el) => { const k = el.dataset.key; if (this._model && this._model.nodes.has(k)) { this._select(k); this._centerOn(k); } },
          'prob-open': (el) => { const n = this._model && this._model.nodes.get(el.dataset.key); if (n) this._openItem(n); },
        },
        // the debugger and a run followed on the board
        debug: {
          'debug': (el, { need }) => { if (need()) { if (this._drawer && this._drawer.mode === 'debug') this._closeDrawer(); else this._openDebug(); } },
          'dbg-mon': () => { this._monitorDlg(); },
          'dbg-clear': () => { if (this._dbg) { this._dbg.entries = []; this._dbg.byId = new Map(); this._dbg.cleared = Date.now(); this._dbgSel = null; this._renderDbg(); } },
          'dbg-flt': (el) => { this._dbgFlt = el.dataset.f; this._dbgScrolled = false; this._renderDbg(); },
          'dbg-pick': (el) => { this._dbgPick(el.dataset.id); },
          'why-run': (el) => { this._showRun({ kind: 'run', key: el.dataset.key, t: Date.now(), run: { domain: 'automation', item_id: el.dataset.item, run_id: el.dataset.rid } }, null); },
          'lit-clear': () => { this._clearLit(); this._dbgSel = null; this._renderDbg(); },
          'lit-replay': () => { if (this._litSteps) this._lightSteps(this._litSteps, this._litRun); },
          'flow-go': (el) => { this._flowGo(+el.dataset.i, true); },
          'flow-prev': () => { if (this._flow) this._flowGo(this._flow.at - 1, true); },
          'flow-next': () => { if (this._flow) this._flowGo(this._flow.at + 1, true); },
          'flow-play': () => { this._flowPlay(); },
          'flow-undo': () => { if (this._flow && this._flow.act && this._sbx) this._sbxRewind(this._flow.act.step0); },
          'flow-ghost': (el) => { const f = this._flow, i = f ? f.steps.findIndex((x) => x.box === el.dataset.g || x.links.some((l) => l.a === el.dataset.g || l.b === el.dataset.g)) : -1; if (i >= 0) this._flowGo(i, true); },
          'lit-trace': () => { this._openLitTrace(); },
        },
        // versions
        versions: {
          'versions': (el, { need }) => { if (need()) { if (this._drawer && this._drawer.mode === 'versions') this._closeDrawer(); else this._openVersions(); } },
          'ver-new': () => { this._verNewDlg(); },
          'ver-save': () => { this._verSave(); },
          'ver-over': () => { this._verOverDlg(); },
          'ver-over-go': () => { this._verOver(); },
          'ver-open': (el) => { this._verOpenTab(el.dataset.id); },
          'ver-sbx': (el) => { this._verOpenTab(el.dataset.id, true); },
          'ver-sbx-cur': () => { this._verTrySandbox(); },
          'ver-restore': (el) => { this._verRestore(el.dataset.id); },
          'ver-restore-go': () => { this._verRestoreGo(); },
          'ver-edit': (el) => { this._verEditDlg(el.dataset.id); },
          'ver-edit-save': () => { this._verEditSave(); },
          'ver-del': (el) => { this._verDelDlg(el.dataset.id); },
          'ver-del-go': () => { this._verDel(); },
          'vtab': (el) => { this._verView(el.dataset.id || null); },
          'vtab-x': (el) => { this._verCloseTab(el.dataset.id); },
          'vtab-win': (el) => { window.open(location.pathname + '?version=' + encodeURIComponent(el.dataset.id), '_blank', 'noopener'); },
        },
        // the sandbox (Phase 10): the drawer's own buttons work only while it's open
        sandbox: {
          'sandbox': (el, { need }) => { if (need()) { if (this._sbxOn()) this._closeDrawer(); else if (this._data.ui.sbxIntro === false) this._openSandbox(); else this._sbxIntro(); } },
          'sbx-start': () => {
            // "don't show this again" is yours alone (saved with your display settings); the i in the drawer shows it again
            const skip = this._$.modal.querySelector('input[name="sbxskip"]'), whole = this._$.modal.querySelector('input[name="sbxwhole"]');
            if (skip) { if (skip.checked) this._data.ui.sbxIntro = false; else delete this._data.ui.sbxIntro; }
            // whole home changes what runs: an open sandbox starts again with it
            const was = !!this._data.ui.sbxWhole;
            if (whole) { if (whole.checked) this._data.ui.sbxWhole = true; else delete this._data.ui.sbxWhole; }
            if (skip || whole) this._save();
            if (this._sbxOn() && was !== !!this._data.ui.sbxWhole) this._ha.soft(this._sbxReset(), 'starting the sandbox again (whole home)', null);
            this._closeModal();
            if (!this._sbxOn()) this._openSandbox();
          },
          'sbx-about': () => { this._sbxIntro(); },
          // a section's header folds it away or opens it (0.13.1); what's picked in its fields stays as it was
          'sbx-sec': (el) => {
            const k = el.dataset.k, shut = new Set(this._data.ui.sbxShut || []), open = shut.has(k);
            if (open) shut.delete(k); else shut.add(k);
            if (shut.size) this._data.ui.sbxShut = [...shut]; else delete this._data.ui.sbxShut;
            this._save();
            el.setAttribute('aria-expanded', open ? 'true' : 'false');
            const b = this._$.drawer.querySelector('#sbsecb-' + k);
            if (b) b.hidden = !open;
          },
          'sbx-set': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-fire': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-run': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-mqtt': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-next': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-press': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-zw': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-ha': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-hook': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-tag': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-cal': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-say': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-advby': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-jump': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-to': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-pick': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-tab': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-stepone': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-continue': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-again': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-undo': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-whatif': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-behave': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-st-set': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-st-reset': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-nact': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-history': () => { if (!this._sbxOn()) return; const s = this._$.drawer.querySelector('.sbhist'); this._ha.soft(this._sbxHistory(s ? s.value : 'night'), 'replaying from history', null); },
          'sbx-explore': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-ex-stop': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-ex-show': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-cov-run': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-vars-close': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-break': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-setv': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-pdis': (el) => { this._probDismiss(el.dataset.k, 'off'); },
          'sbx-reset': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-ans': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-setbox': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-runbox': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
          'sbx-firebox': (el, { a }) => { if (this._sbxOn()) this._sbxBox(a, el); },
        },
        // dialogs, the toast, undo
        dialogs: {
          'fn-rename': () => { const i = this._$.modal.querySelector('input[name=name]'), c = this._$.modal.querySelector('.clash'); if (c) c.remove(); if (i) { i.focus(); i.select(); } },
          'modal-cancel': () => { this._closeModal(); },
          'modal-save': () => { this._saveFn(); },
          'about': () => { this._aboutModal(); },
          'diag': (el) => { this._diagModal(el.dataset.ver || null); },
          'diag-go': () => { this._diagGo(false); },
          'diag-copy': () => { this._diagGo(true); },
          'del-go': () => { this._deleteGo(); },
          'undo': () => { this._undo(); },
          'redo': () => { this._redo(); },
          'toast-act': (el) => {
            const t = this._toastActs[+el.dataset.i];
            this._$.toast.hidden = true; this._toastActs = [];
            if (t) t.fn();
          },
        },
      };
    }
    // a field changed: each part looks at it in turn, and the first that knows it handles it
    _onChange(e) {
      const t = e.target;
      if (this._diagChange(t) || this._bldChange(t) || this._sbxChange(t) || this._nrChange(t) || this._testChange(t) || this._arwChange(t) || this._togChange(t) || this._fnChange(t) || this._mgrChange(t)) return;
    }
    // typed into: the same, for what each part reads as it's typed
    _onInput(e) {
      const t = e.target;
      if (this._testChange(t) || this._arwInput(t) || this._mgrInput(t) || this._findInput(t) || this._fnInput(t) || this._noteInput(t)) return;
    }
    // the Arrows menu's and the Key's switches (core: what the board shows)
    _togChange(t) {
      if (!t.dataset || !t.dataset.tog) return false;
      if (this._model) this._setFlt(this._model.label, t.dataset.tog, t.checked);
      else { this._data.ui[t.dataset.tog] = t.checked; this._save(); }
      if (t.dataset.tog === 'suggest') this._open(this._data.ui.current, true);
      else if (this._model) { this._place(); this._render(); }
      this._refreshHl();
      return true;
    }
    // a note on the board, typed into
    _noteInput(t) {
      if (!t.classList.contains('nbody') || !this._model) return false;
      const nt = this._layout(this._model.label).notes.find((x) => x.id === t.dataset.nid);
      if (nt) { nt.text = t.value; this._autosize(t); this._save(); }
      return true;
    }
    _onDbl(e) {
      const nodeEl = e.target.closest('.node');
      if (nodeEl && this._model) {
        const n = this._model.nodes.get(nodeEl.dataset.key);
        if (n && n.kind === 'tool') { if (n.tool.type === 'inject') this._testDialog(n.tool.test.target, n.tool.id); return; }
        if (n) this._editOrOpen(n);
        return;
      }
      const ft = e.target.closest('.ftitle');
      if (ft && this._model) {
        const f = this._layout(this._model.label).frames.find((x) => x.id === ft.dataset.fid);
        if (!f) return;
        const inp = document.createElement('input');
        inp.className = 'ftin'; inp.value = f.title; inp.dataset.fid = f.id; inp._before = this._snap(this._model.label);
        ft.replaceWith(inp); inp.focus(); inp.select();
      }
    }
    _onBlur(e) {
      const t = e.target;
      if (t.classList && t.classList.contains('ftin') && this._model) {
        const f = this._layout(this._model.label).frames.find((x) => x.id === t.dataset.fid);
        if (f) { f.title = t.value.trim() || T('frame'); this._save(); if (t._before) this._layoutStep(this._model.label, t._before, T('rename_frame')); }
        this._clock.after('frames', 0, () => this._renderFrames());
      }
      if (t.classList && t.classList.contains('nbody') && this._model && t._before) {
        this._layoutStep(this._model.label, t._before, T('edit_note'));
        t._before = null;
      }
    }
    _onFocus(e) {
      const t = e.target;
      if (t.classList && t.classList.contains('node') && t.dataset.key) this._rove(t.dataset.key);
      if (t.classList && t.classList.contains('nbody') && this._model) t._before = this._snap(this._model.label);
    }
    _onKey(e) {
      const t = e.composedPath()[0];
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
      if (typing) {
        e.stopPropagation();  // keep Home Assistant's single-key shortcuts out of the board's own fields
        if ((e.key === 'Enter' || e.key === 'Escape') && t.classList && t.classList.contains('ftin')) t.blur();
        if (e.key === 'Enter' && t.classList && t.classList.contains('search')) e.preventDefault();
        if (e.key === 'Enter' && t.classList && t.classList.contains('sbval') && this._sbxOn()) { e.preventDefault(); this._sbxAction('sbx-set', t); }
        if (t.classList && t.classList.contains('find')) {
          if (e.key === 'Enter') { const b = this._$.list.querySelector('.fgo'); if (b) b.click(); }
          if (e.key === 'Escape') this._findClear();
        }
        return;
      }
      e._fbDone = true;
      if (this._model && this._boxKey(e, t)) return;
      this._hotkey(e);
    }
    // keys pressed while focus is outside the board (after a click on the canvas, focus is on the page)
    _winKey(e) {
      if (e._fbDone || e.defaultPrevented || !this.isConnected || !this._data || !this._$.board.clientWidth) return;
      const t = e.composedPath()[0];
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      if (e.composedPath().some((x) => x.tagName && /^(HA-DIALOG|HA-MORE-INFO-DIALOG|DIALOG)$/.test(x.tagName))) return;
      this._hotkey(e);
    }
    _hotkey(e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zZy]$/.test(e.key)) {
        if (!this._$.modal.hidden) return;
        e.preventDefault();
        if (e.key === 'y' || e.shiftKey) this._redo(); else this._undo();
        return;
      }
      if (/^[0-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && this._sel && this._$.modal.hidden) {
        // number keys set how many arrows away the highlight reaches; 0 is all (7.1)
        const hl = this._data.ui.hl || {};
        this._setHl({ depth: +e.key, mode: ['chain', 'off'].includes(hl.mode || 'chain') ? 'both' : hl.mode });
        return;
      }
      if (e.key === 'Escape') {
        if (this._menuEl) this._closeMenu();
        else if (!this._$.modal.hidden) this._closeModal();
        else if (this._linking) { this._endLink(); this._$.toast.hidden = true; }
        else if (this._selEdge) this._clearEdgeSel();
        else if (this._lit) this._clearLit();
        else if (this._drawer) this._closeDrawer();
        else this._select(null);
      }
    }

    /* ---------- node actions ---------- */
    _itemId(n) {
      const r = this._entMap.get(n.key);
      if (r && r.unique_id) return r.unique_id;
      return n.domain === 'script' ? n.key.slice(7) : null;
    }
    // ha: Home Assistant's own editor, also for a script a builder made (which otherwise opens in its builder)
    _openItem(n, ha) {
      if (n.kind === 'nodered') { this._openNodeRed(n.nr.sub, T('node_red_2', { tabLabel: n.nr.tabLabel })); return; }
      if (!ha && n.domain === 'script' && this._bldHas(n.key)) { this._bldEdit(n); return; }
      if (n.domain === 'automation' || n.domain === 'script') {
        const id = this._itemId(n);
        if (id) { this._openDrawer(`/config/${n.domain}/edit/${encodeURIComponent(id)}`, n.name); return; }
        this._moreInfo(n.key); return;
      }
      if (n.domain === 'device') { this._openDrawer(`/config/devices/device/${n.key.slice(7)}`, n.name); return; }
      if (!n.key.includes(':')) this._moreInfo(n.key);
    }
    _openTraces(n) {
      const id = this._itemId(n);
      if (id) this._openDrawer(`/config/${n.domain}/trace/${encodeURIComponent(id)}`, T('traces', { name: n.name }));
    }
    _moreInfo(entityId, view) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: view ? { entityId, view } : { entityId }, bubbles: true, composed: true }));
    }
    // what Edit opens on a box that isn't an automation or script: a helper's settings (where its options are,
    // also a template helper's template), a scene in Home Assistant's scene editor. Set up in YAML without an ID,
    // neither can be changed from the UI.
    _editOf(n) {
      if (n.key.includes(':')) return null;
      const st = this._hass.states[n.key];
      if (n.domain === 'scene') {
        const id = st && st.attributes.id;
        return id ? { url: `/config/scene/edit/${encodeURIComponent(id)}` } : { off: T('set_up_in_yaml_without_a') };
      }
      if (this._scopeOf(n.key) !== 'helpers') return null;
      return this._entMap.has(n.key) ? { view: 'settings' } : { off: T('set_up_in_yaml_without_a') };
    }
    _editItem(n) {
      const ed = this._editOf(n);
      if (!ed || ed.off) return;
      if (ed.url) this._openDrawer(ed.url, n.name);
      else this._moreInfo(n.key, ed.view);
    }
    // double-click and Enter: edit what can be edited, otherwise open it
    _editOrOpen(n) {
      const ed = n.domain === 'automation' || n.domain === 'script' ? null : this._editOf(n);
      if (ed && !ed.off) this._editItem(n); else this._openItem(n);
    }
    async _nodeAction(a, el) {
      const m = this._model, n = m && m.nodes.get(this._sel);
      if (!n) return;
      const label = this._data.ui.current;
      if (a === 'open') { this._openItem(n); return; }
      if (a === 'edit') { this._editItem(n); return; }
      if (a === 'trace') { this._openTraces(n); return; }
      if (a === 'delete') { this._deleteItemDialog(n.key); return; }
      if (a === 'toggle') {
        const st = this._hass.states[n.key];
        if (st) this._svc('automation', st.state === 'on' ? 'turn_off' : 'turn_on', {}, { entity_id: n.key });
        return;
      }
      if (a === 'remove') {
        this._twoStep(el, T('remove_from_function'), async () => {
          try {
            const u = await this._label(n.key, label, false);
            this._labelStep(T('remove_from_2', { name: n.name, fnName: this._fnName(label) }), label, [u]);
            this._toast(T('removed_from_it_still_exists', { name: n.name, fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
            this._select(null);
          } catch (e) { this._toast(T('could_not_remove', { message: e.message || e.code })); }
        });
        return;
      }
      if (a === 'add') {
        try {
          const u = await this._label(n.key, label, true, true);
          this._labelStep(T('add_to_5', { name: n.name, fnName: this._fnName(label) }), label, [u]);
          this._toast(T('added_to_3', { name: n.name, fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }]);
        } catch (e) { this._toast(T('could_not_add_3', { name: n.name, noLabelWhy: this._noLabelWhy(n.key, e) })); }
      }
    }
    // a small menu under a toolbar button
    _menu(anchor, items, title) {
      this._closeMenu(true);
      this._menuAnchor = anchor;
      const m = document.createElement('div');
      m.className = 'menu';
      m.innerHTML = (title ? `<div class="mtitle">${esc(title)}</div>` : '') + items.map((it) => it.sep ? '<div class="msep"></div>'
        : `<button class="mi" ${it.act ? `data-act="${it.act}"` : ''} ${Object.entries(it.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')} ${it.disabled ? 'disabled' : ''} ${it.title ? `title="${esc(it.title)}"` : ''}>`
          + (it.icon ? `<ha-icon icon="${esc(it.icon)}"></ha-icon>` : '') + `<span>${esc(it.text)}</span></button>`).join('');
      this._$.board.appendChild(m);
      const br = this._$.board.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      m.style.top = Math.round(ar.bottom - br.top + 4) + 'px';
      m.style.left = Math.round(Math.max(6, Math.min(ar.left - br.left, br.width - m.offsetWidth - 6))) + 'px';
      this._menuEl = m;
    }
    _closeMenu(keepAnchor) {
      if (this._menuEl) {
        // focus that was in the menu goes back to the button that opened it (4.8)
        const had = this._menuEl.contains(this.shadowRoot.activeElement);
        this._menuEl.remove(); this._menuEl = null;
        if (had && this._menuAnchor && this._menuAnchor.isConnected) this._menuAnchor.focus();
      }
      if (!keepAnchor) this._menuAnchor = null;
    }
    // The phone app signs its page in through the app itself, and Home Assistant inside the drawer's frame can't
    // reach that sign-in, so its editors never load there. In the app, Home Assistant's own pages open full
    // screen instead; the app's Back returns to the board.
    _inApp() { return !!(this._hass && this._hass.auth && this._hass.auth.external); }
    _openDrawer(url, title, opt = {}) {
      // only Home Assistant's own pages open in the drawer (or in a new tab from it), never another address
      if (!SAME_ORIGIN.test(String(url))) return;
      if (this._inApp() && /^\/config\//.test(url)) { this._goTo(url, opt.capture); return; }
      this._leaveDrawerMode();
      if (!opt.capture) this._capture = null;
      const was = this._drawer;
      if (was && was.mode === 'frame') this._configChanged();
      this._drawer = { mode: 'frame', url, title };
      const d = this._$.drawer;
      d.hidden = false;
      this._put(d, `<div class="dhead">${opt.back ? `<button data-act="back" title="${T('back_to_runs')}"><ha-icon icon="mdi:arrow-left"></ha-icon></button>` : ''}<span class="dtitle">${esc(title)}</span>${opt.capture && this._capture ? `<span class="dcap" title="${T('anything_you_create_here_gets', { fnName: esc(this._fnName(this._capture.label)) })}">${T('saves_into', { fnName: esc(this._fnName(this._capture.label)) })}</span>` : ''}<button data-act="newtab" title="${T('open_in_a_new_tab')}"><ha-icon icon="mdi:open-in-new"></ha-icon></button><button data-act="close" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><iframe title="${esc(title)}" src="${esc(url)}"></iframe>`);
      this._fitLitbar();
    }
    _closeDrawer() {
      this._leaveDrawerMode();
      const d = this._$.drawer, was = this._drawer;
      d.hidden = true; this._put(d, '');
      this._drawer = null;
      this._drawerBack = null;
      this._endCapture();
      this._hover(null);
      if (was && was.mode === 'frame') this._configChanged();  // whatever was saved in the editor shows at once
      this._nrBack();
      this._fitLitbar();
    }
    // Leaving the board for one of Home Assistant's pages (the phone app). The board stops while it's away, so
    // a create remembers what it's for, and when the board comes back, what was made meanwhile joins the
    // function. "Meanwhile" is measured by the registry's own clock, not the phone's.
    _goTo(url, capture) {
      const c = capture && this._capture;
      if (c) {
        const since = (this._ents || []).reduce((m, e) => Math.max(m, e.created_at || 0), 0);
        try { sessionStorage.setItem(CAPTURE_KEY, JSON.stringify({ label: c.label, kind: c.kind, domain: c.domain, since, at: Date.now() })); } catch (e) { /* the item just won't be labelled */ }
      }
      this._capture = null;
      if (this._drawer) this._closeDrawer();
      // "from" is how Home Assistant's own navigation marks a page that was opened from another one; with it, the
      // editor's back arrow goes back here instead of to its own list
      history.pushState({ from: location.pathname }, '', url);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    }
    _onRun(ev) {
      const k = ev && ev.data && ev.data.entity_id, m = this._model;
      if (!m || !k || !m.nodes.has(k)) return;
      this._pulse(k);
      this._clock.after('runs', 2500, async () => {
        await this._loadRuns();
        if (this._drawer && this._drawer.mode === 'runs') this._renderRuns();
      });
    }
    // states worth offering for a simulated change: what the function's triggers wait for first
    _stateHints(n) {
      const st = this._hass.states[n.key], A = (st && st.attributes) || {}, out = new Set();
      (this._model ? this._model.edges : []).forEach((e) => { if (e.from === n.key) e.tfs.forEach((f) => (f.to || []).forEach((s) => out.add(s))); });
      const by = { binary_sensor: ['on', 'off'], cover: ['open', 'closed', 'opening', 'closing'], lock: ['locked', 'unlocked', 'jammed'], valve: ['open', 'closed'],
        light: ['on', 'off'], switch: ['on', 'off'], fan: ['on', 'off'], siren: ['on', 'off'], schedule: ['on', 'off'], person: ['home', 'not_home'],
        device_tracker: ['home', 'not_home'], media_player: ['playing', 'paused', 'idle', 'off'], vacuum: ['cleaning', 'docked', 'returning', 'idle'],
        alarm_control_panel: ['disarmed', 'armed_home', 'armed_away', 'armed_night', 'triggered'] };
      (by[n.domain] || []).forEach((s) => out.add(s));
      if (n.domain === 'climate') toList(A.hvac_modes).forEach((s) => out.add(s));
      if (n.domain === 'select' || n.domain === 'input_select') toList(A.options).forEach((s) => out.add(s));
      if (n.domain === 'input_boolean') ['on', 'off'].forEach((s) => out.add(s));
      if (n.domain === 'timer') ['idle', 'active', 'paused'].forEach((s) => out.add(s));
      if (n.domain === 'sun') ['above_horizon', 'below_horizon'].forEach((s) => out.add(s));
      if (n.domain === 'input_number' || n.domain === 'number') [A.min, A.max].forEach((s) => { if (s != null) out.add(String(s)); });
      if (st) out.add(st.state);
      return [...out].filter((s) => s != null && s !== '').map(String).slice(0, 30);
    }
    // what a test starts from: the data the function's own triggers and actions use
    _prefill(n, what) {
      const m = this._model, k = n.key;
      if (what === 'event' || what === 'mqtt') {
        for (const e of (m ? m.edges : [])) {
          if (e.from !== k || !e.trigs) continue;
          for (const t of e.trigs) {
            const node = t.t || {};
            if (what === 'event' && node.event_data && typeof node.event_data === 'object') return JSON.parse(JSON.stringify(node.event_data));
            if (what === 'mqtt' && node.payload != null) return String(node.payload);
          }
        }
        return what === 'mqtt' ? '' : {};
      }
      for (const e of (m ? m.edges : [])) {
        if (e.to !== k || !e.acts) continue;
        const a = e.acts.find((x) => x && x.data && typeof x.data === 'object');
        if (a) { const d = JSON.parse(JSON.stringify(a.data)); delete d.entity_id; return d; }
      }
      return { message: T('test_from_the_functions_board') };
    }
    // a notification button: the event a phone fires when it is pressed, as the function's own trigger waits for it
    _buttonEvent(n) {
      const id = n.key.slice(5);
      for (const e of (this._model ? this._model.edges : [])) {
        if (e.from !== n.key || !e.trigs) continue;
        for (const t of e.trigs) { const et = t.t && t.t.event_type; if (typeof et === 'string' && NOTIFY_EVENTS[et]) return { event_type: et, event_data: { [NOTIFY_EVENTS[et]]: id } }; }
      }
      return { event_type: 'mobile_app_notification_action', event_data: { action: id } };
    }
    async _scriptFields(k) {
      const cfg = await this._fetchConfig(k);
      const f = cfg && cfg.fields && typeof cfg.fields === 'object' ? cfg.fields : {};
      return Object.entries(f).map(([name, x]) => ({ name, type: 'selector', label: (x && x.name) || name, selector: (x && x.selector) || { text: {} },
        value: x && x.default !== undefined ? x.default : undefined, required: !!(x && x.required),
        hint: (x && (x.description || (x.example != null ? T('for_example', { stringify: typeof x.example === 'object' ? JSON.stringify(x.example) : x.example }) : ''))) || '' }));
    }
    // a kept test back into the fields it was made with
    _valsOf(spec, t) {
      if (t.kind === 'action') return Object.assign({}, t.data || {});
      if (t.kind === 'state') return { state: t.state };
      if (t.kind === 'event') return { event_data: t.event_data || {} };
      if (t.kind === 'mqtt') return { payload: t.payload };
      if (t.kind === 'notify') return { data: t.data || {} };
      if (t.kind === 'run') return t.target.startsWith('automation.') ? { check: !t.skip_condition } : Object.assign({}, t.variables || {});
      return {};
    }
    _fieldHTML(f, i, vals) {
      const v = vals && f.name in vals ? vals[f.name] : f.value, id = 'tf' + i;
      const lab = (inner) => `<label>${esc(f.label)}${inner}${f.hint ? `<span class="fh">${esc(f.hint)}</span>` : ''}</label>`;
      if (f.type === 'bool') return `<label class="chk"><input type="checkbox" name="${id}" ${v ? 'checked' : ''}>${esc(f.label)}</label>`;
      if (f.type === 'select') return lab(`<select name="${id}">${toList(f.options).map((o) => `<option ${String(o) === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
      if (f.type === 'number') {
        const at = (k, x) => (x != null && x !== '' ? ` ${k}="${esc(x)}"` : '');
        return lab(`<input type="number" name="${id}" value="${esc(v == null ? '' : v)}"${at('min', f.min)}${at('max', f.max)}${f.step != null ? at('step', f.step) : ' step="any"'}>`);
      }
      if (f.type === 'date' || f.type === 'time') return lab(`<input type="${f.type}" name="${id}" value="${esc(v || '')}"${f.type === 'time' ? ' step="1"' : ''}>`);
      if (f.type === 'object') return `<div class="selbox" data-f="${i}">${lab(`<textarea name="${id}" rows="4" spellcheck="false">${esc(toLoose(v))}</textarea>`)}</div>`;
      if (f.type === 'selector') return `<div class="selbox" data-f="${i}">${lab(`<input name="${id}" value="${esc(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v)}">`)}</div>`;
      const opts = f.options && f.options.length ? `<datalist id="dl${i}">${f.options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
      return lab(`<input name="${id}" value="${esc(v == null ? '' : v)}"${opts ? ` list="dl${i}"` : ''}>${opts}`);
    }
    // a test in a few words, for its button, its toast and the logbook
    _describeTest(t) {
      const who = this._boxName(t.target);
      switch (t.kind) {
        case 'action': {
          const s = t.service.split('.')[1], v = t.data || {};
          const verb = { turn_on: T('turn_on'), turn_off: T('turn_off'), toggle: T('toggle'), press: T('press_2'), increment: T('increment'), decrement: T('decrement'), reset: T('reset'),
            set_value: T('set'), select_option: T('set'), set_datetime: T('set'), start: T('start'), finish: T('finish'), cancel: T('cancel'), pause: T('pause') }[s] || t.service;
          const val = v.value != null ? ' to ' + v.value : v.option != null ? ' to ' + v.option : v.duration ? ' for ' + v.duration : (v.date || v.time) ? ' to ' + [v.date, v.time].filter(Boolean).join(' ') : '';
          return verb + ' ' + who + val;
        }
        case 'state': return T('simulated', { who, state: t.state });
        case 'event': return t.target.startsWith('nact:') ? T('press', { who }) : T('fire', { event_type: t.event_type });
        case 'mqtt': return T('publish_to', { topic: t.topic });
        case 'notify': return T('send_a_test_notification_with', { who });
        case 'run': return T('run', { who, extra: t.skip_condition ? T('without_its_conditions') : '' });
        default: return T('test_2');
      }
    }
    _boxName(k) {
      const n = this._model && this._model.nodes.get(k);
      return n ? n.name : String(k).includes(':') ? String(k).slice(String(k).indexOf(':') + 1) : this._nameOf(k);
    }
    // a notification's templates, filled in by Home Assistant, as sending it from an automation would
    async _fillTemplates(v) {
      if (typeof v === 'string') { if (!TPL_RE.test(v)) return v; const r = await this._renderOnce(v); return r == null ? v : typeof r === 'string' ? r : JSON.stringify(r); }
      if (Array.isArray(v)) return Promise.all(v.map((x) => this._fillTemplates(x)));
      if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await this._fillTemplates(x); return out; }
      return v;
    }
    _renderOnce(template) {
      return new Promise((resolve) => {
        let done = false, unsub = null;
        const fin = (v) => { if (done) return; done = true; this._clock.cancel(to); resolve(v); this._ha.drop(unsub); };
        unsub = this._haConn.subscribeMessage((msg) => fin(msg && !msg.error ? msg.result : null), { type: 'render_template', template, strict: false, report_errors: true, timeout: 3 }, { fallback: null }).then((u) => { if (!u) fin(null); return u; });
        const to = this._clock.deadline(4000, () => fin(null));
      });
    }
    // the open function's tool boxes, again from its layout (after adding, removing or undoing one)
    _syncTools() {
      const m = this._model;
      if (!m) return;
      [...m.nodes.keys()].filter((k) => k.startsWith('tool:')).forEach((k) => m.nodes.delete(k));
      m.edges = m.edges.filter((e) => e.role !== 'tool');
      this._toolNodes(m.label, m.nodes, m.edges);
    }
    _freeSpot(x, y, w, h) {
      const boxes = this._model ? [...this._model.nodes.values()] : [];
      const hit = (px, py) => boxes.some((o) => px < o.x + o.w + 16 && px + w + 16 > o.x && py < o.y + o.h + 12 && py + h + 12 > o.y);
      let px = Math.round(x), py = Math.round(y);
      for (let i = 0; i < 40 && hit(px, py); i++) py += h + 12;
      return { x: px, y: py };
    }
    _addTool(tool, near, w, h, text) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label), c = this._center();
      L.tools = (L.tools || []).concat([tool]);
      const n = near && this._model.nodes.get(near);
      L.nodes['tool:' + tool.id] = tool.type === 'inject'
        ? this._freeSpot(n ? n.x - w - 70 : c.x - w / 2, n ? n.y : c.y, w, h)
        : this._freeSpot(n ? n.x : c.x - w / 2, n ? n.y + n.h + 30 : c.y - h / 2, w, h);
      this._save(); this._syncTools(); this._place(); this._render(); this._startMonitors();
      this._layoutStep(label, before, text);
      this._showBox('tool:' + tool.id);
    }
    // a box placed out of sight, or under the key, is brought into view
    _showBox(key) {
      const n = this._model && this._model.nodes.get(key);
      if (!n) return;
      const v = this._view, W = this._openWidth(), H = this._$.vp.clientHeight;
      const x = n.x * v.k + v.x, y = n.y * v.k + v.y, w = n.w * v.k, h = n.h * v.k;
      const vr = this._$.vp.getBoundingClientRect(), lr = this._$.legend.getBoundingClientRect();
      const lx = lr.left - vr.left, ly = lr.top - vr.top, under = lr.width && x < lx + lr.width && x + w > lx && y < ly + lr.height && y + h > ly;
      if (x < 8 || y < 8 || x + w > W - 8 || y + h > H - 8 || under) { this._centerOn(key); this._saveView(); }
    }
    _keepTest(test) { this._addTool({ id: uid(), type: 'inject', title: this._describeTest(test), test }, test.target, XW, 48, T('keep_a_test_on_the')); }
    _saveTool(id, test) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.tools = (L.tools || []).map((t) => (t.id === id ? Object.assign({}, t, { test, title: this._describeTest(test) }) : t));
      this._save(); this._syncTools(); this._place(); this._render();
      this._layoutStep(label, before, T('change_a_test_button'));
    }
    _addMonitor(spec) {
      this._addTool({ id: uid(), type: 'monitor', what: spec.what, topic: spec.topic, target: spec.target || null,
        title: spec.title || (spec.what === 'mqtt' ? T('mqtt_2') : T('events')) + spec.topic }, spec.target, 280, 176, T('add_a_monitor'));
    }
    // leaving the debug panel for another drawer stops recording
    _leaveDrawerMode() {
      if (this._drawer && this._drawer.mode === 'debug') this._dbgStop();
      if (this._drawer && this._drawer.mode === 'sandbox') { this._sbxEnd(); this._testCondsSoon(0); }
    }
    _fmtState(k, state) {
      const st = this._hass.states[k];
      try { return st && this._hass.formatEntityState ? this._hass.formatEntityState(Object.assign({}, st, { state: String(state) })) : String(state); } catch (e) { return String(state); }
    }
    // a box's state as the board shows it: the sandbox's while it's open, Home Assistant's otherwise
    _stOf(k) {
      if (!this._sbxOn()) return this._hass.states[k];
      const s = this._sbx.eng.get(k);
      return s ? { entity_id: k, state: String(s.state), attributes: s.attributes || {}, last_changed: s.last_changed, last_updated: s.last_updated, context: {} } : undefined;
    }
    _renderRaw(template, variables) {
      return new Promise((res, rej) => {
        let done = false, un = null;
        const fin = (f, v) => { if (done) return; done = true; this._clock.cancel(to); f(v); if (un) this._ha.drop(un); };
        const to = this._clock.deadline(8000, () => fin(rej, new Error('timeout')));
        un = this._haConn.subscribeMessage((m) => {
          if (m && m.error) { if (m.level !== 'WARNING') fin(rej, new Error(String(m.error))); return; }
          fin(res, m ? m.result : null);
        }, { type: 'render_template', template, variables, strict: false, report_errors: true }).catch((e) => { fin(rej, new Error((e && (e.message || e.code)) || 'error')); return null; });
      });
    }
    _fitK(R) { const a = this._flowArea(); return Math.min((a.W - 2 * a.pad) / Math.max(1, R.x1 - R.x0), (a.H - 2 * a.pad) / Math.max(1, R.y1 - R.y0)); }
    // the part of the board the drawer leaves visible
    _openWidth() {
      const W = this._$.vp.clientWidth, d = this._$.drawer;
      return d && !d.hidden && this._drawer ? Math.max(200, W - d.offsetWidth) : W;
    }
    _fitLitbar() {
      const r = (12 + this._$.vp.clientWidth - this._openWidth()) + 'px', b = this._$.litbar, vt = this._$.vtabs;
      if (b && !b.hidden) b.style.right = r;
      // the version tabs and their banner keep to the part of the board the drawer leaves free too
      if (vt) vt.style.right = r;
    }
    // bring boxes into the visible part of the board, zooming out only when they don't fit
    _frameKeys(keys, extra) {
      const m = this._model, ns = [...new Set(keys)].map((k) => m && m.nodes.get(k)).filter(Boolean).concat(extra || []);
      if (!ns.length) return;
      const W = this._openWidth(), H = this._$.vp.clientHeight, v = this._view, pad = 50;
      const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y)), x1 = Math.max(...ns.map((n) => n.x + n.w)), y1 = Math.max(...ns.map((n) => n.y + n.h));
      const inView = x0 * v.k + v.x >= 0 && y0 * v.k + v.y >= 0 && x1 * v.k + v.x <= W && y1 * v.k + v.y <= H - 60;
      if (inView) return;
      const k = Math.max(0.35, Math.min(v.k, (W - pad * 2) / Math.max(1, x1 - x0), (H - 60 - pad * 2) / Math.max(1, y1 - y0)));
      this._view = { k, x: (W - (x1 - x0) * k) / 2 - x0 * k, y: (H - 60 - (y1 - y0) * k) / 2 - y0 * k };
      this._applyView();
      this._saveView();
    }
    _stepText(s) {
      if (s.kind === 'state') return `${this._boxName(s.key)} → ${this._fmtState(s.key, s.state)}`;
      if (s.kind === 'run') return T('ran', { boxName: this._boxName(s.key) });
      if (s.kind === 'call') return s.svc;
      return s.text || '';
    }
    // the config of the automation or script that holds an arrow, or why it can't be changed from here
    async _ownerCfg(owner) {
      const n = this._model && this._model.nodes.get(owner), dom = owner.split('.')[0], id = n && this._itemId(n);
      if (!n) return { err: T('it_isn_t_on_the') };
      if (!id) return { err: T('has_no_id_so_it', { name: n.name }) };
      let cfg;
      try { cfg = await this._api('GET', `config/${dom}/config/${encodeURIComponent(id)}`); }
      catch (e) {
        const nf = e && (e.status_code === 404 || /404|not.found/i.test(String(e.message || e.body || e.error || '')));
        return { err: nf ? T('is_set_up_in_yaml', { name: n.name, dom }) : T('could_not_read_its_config', { e: (e && (e.message || e.body)) || e }), n };
      }
      if (cfg && cfg.use_blueprint) return { err: T('comes_from_a_blueprint_its', { name: n.name }), n };
      return { cfg, id, dom, n, isScript: dom === 'script' };
    }
    _yamlWarn(dom) {
      return this._data.ui.yamlOk ? '' : `<div class="warnbox"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${T('saving_writes_s_yaml_the', { dom })}</span></div>`;
    }
    // drawing an arrow: pick the box to connect to
    _canLink(n) {
      if (!n || n.kind === 'tool') return false;
      const k = n.key;
      return /^(automation|script)\./.test(k) || /^(event|nact):/.test(k) || TGT_RE.test(k) || (!k.includes(':') && !!this._hass.states[k]);
    }
    // which way an arrow between two boxes can go, and what it can mean
    _linkKinds(from, to) {
      const logic = (k) => /^(automation|script)\./.test(k);
      const ent = (k) => !k.includes(':') && !!this._hass.states[k];
      if (to.startsWith('automation.') && (ent(from) || /^(event|nact):/.test(from)) && !logic(from)) return { owner: to, other: from, kinds: /^(event|nact):/.test(from) ? ['trigger'] : ['trigger', 'condition'] };
      if (logic(from) && to.startsWith('script.')) return { owner: from, other: to, kinds: ['call'] };
      if (logic(from) && (ent(to) || TGT_RE.test(to))) return { owner: from, other: to, kinds: ['action'] };
      return null;
    }
    _linkKey(kind, isScript, cfg) {
      if (isScript) return 'sequence';
      const plural = { trigger: 'triggers', condition: 'conditions', action: 'actions', call: 'actions' }[kind], single = plural.slice(0, -1);
      return cfg[plural] == null && cfg[single] != null ? single : plural;
    }
    _saveCfg(dom, id, cfg) {
      return this._api('POST', `config/${dom}/config/${encodeURIComponent(id)}`, cfg).then((r) => { this._store.changed('cfg:'); return r; });
    }

    /* ---------- keyboard and screen readers (4.8) ---------- */
    // what each box is wired to, in words, for its accessible description
    _connText() {
      const m = this._model, out = new Map();
      if (!m) return out;
      const IN = { trigger: T('set_off_by'), condition: T('checks'), source: T('reads'), action: T('changed_by'), call: T('run_by'), tool: T('tested_or_listened_to_by') };
      const OUT = { trigger: T('sets_off'), condition: T('is_checked_by'), source: T('is_read_by'), action: T('changes'), call: T('runs'), tool: T('tests') };
      const list = (names) => (names.length > 4 ? T('and_more_2', { names: names.slice(0, 4).join(', '), n: names.length - 4 }) : names.join(', '));
      const vis = this._visibleKeys(), E = this._visEdges();
      vis.forEach((k) => {
        const parts = [];
        const group = (edges, other, words) => {
          const by = new Map();
          edges.forEach((e) => { const n = m.nodes.get(other(e)); if (n) (by.get(e.role) || by.set(e.role, []).get(e.role)).push(n.name); });
          by.forEach((names, role) => parts.push(`${words[role] || role} ${list([...new Set(names)])}`));
        };
        // a check points into the automation: from the automation's side it checks the box
        group(E.filter((e) => e.to === k), (e) => e.from, Object.assign({}, IN, { condition: T('checks') }));
        group(E.filter((e) => e.from === k), (e) => e.to, OUT);
        if (parts.length) out.set(k, parts.join('. '));
      });
      return out;
    }
    // one box is in the tab order at a time; the arrow keys move between them
    _rove(key) {
      const el = key && this._els.get(key);
      if (!el) return;
      if (this._roveKey && this._roveKey !== key) { const o = this._els.get(this._roveKey); if (o) o.tabIndex = -1; }
      el.tabIndex = 0;
      this._roveKey = key;
    }
    // the box an arrow key leads to: along the arrows for left and right, else the nearest in that direction
    _navFrom(k, dir) {
      const m = this._model, n = m && m.nodes.get(k);
      if (!n) return null;
      const vis = this._visibleKeys(), E = this._visEdges(), cx = (o) => o.x + o.w / 2, cy = (o) => o.y + o.h / 2;
      let cand = dir === 'right' ? E.filter((e) => e.from === k).map((e) => e.to) : dir === 'left' ? E.filter((e) => e.to === k).map((e) => e.from) : [];
      cand = cand.filter((x) => x !== k && vis.has(x));
      if (!cand.length) {
        cand = [...vis].filter((x) => {
          const o = m.nodes.get(x);
          return x !== k && (dir === 'right' ? cx(o) > cx(n) + 10 : dir === 'left' ? cx(o) < cx(n) - 10 : dir === 'up' ? cy(o) < cy(n) - 10 : cy(o) > cy(n) + 10);
        });
      }
      const horiz = dir === 'left' || dir === 'right';
      const d = (x) => { const o = m.nodes.get(x), dx = Math.abs(cx(o) - cx(n)), dy = Math.abs(cy(o) - cy(n)); return horiz ? dx + dy * 2 : dy + dx * 2; };
      return cand.sort((a, b) => d(a) - d(b))[0] || null;
    }
    _boxKey(e, t) {
      const k = t && t.classList && t.classList.contains('node') ? t.dataset.key : null;
      if (!k) return false;
      const dirs = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };
      if (dirs[e.key]) {
        e.preventDefault();
        const to = this._navFrom(k, dirs[e.key]);
        if (to) { this._select(to); this._rove(to); this._showBox(to); const el = this._els.get(to); if (el) el.focus(); }
        return true;
      }
      if (e.key === 'Enter') { e.preventDefault(); const n = this._model.nodes.get(k); if (n) this._editOrOpen(n); return true; }
      if (e.key === ' ') {
        e.preventDefault();
        this._select(this._sel === k ? null : k);
        // then Tab reaches the box's actions
        return true;
      }
      return false;
    }

    /* ---------- undo and redo: one stack per board session ---------- */
    // step: { label, text, undo(), redo(), check?(dir) } - check returns false when the item has changed
    // since the step (someone edited it elsewhere); the board then asks before overwriting
    _history(step) {
      if (this._ver) return;
      this._undoStack.push(step);
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack = [];
      this._renderUndo();
    }
    _renderUndo() {
      if (!this._$) return;
      const u = this._undoStack[this._undoStack.length - 1], r = this._redoStack[this._redoStack.length - 1];
      const ub = this._$.tools.querySelector('[data-act="undo"]'), rb = this._$.tools.querySelector('[data-act="redo"]');
      const key = /Mac|iPhone|iPad/.test(navigator.platform || '') ? T('cmd') : T('ctrl');
      if (ub) { ub.disabled = !u || this._undoBusy; ub.title = u ? T('undo_z', { text: u.text, key }) : T('nothing_to_undo'); }
      if (rb) { rb.disabled = !r || this._undoBusy; rb.title = r ? T('redo_shift_z', { text: r.text, key }) : T('nothing_to_redo'); }
    }
    async _undo() { await this._step(this._undoStack, this._redoStack, 'undo'); }
    async _redo() { await this._step(this._redoStack, this._undoStack, 'redo'); }
    async _step(from, to, dir) {
      if (this._undoBusy) return;
      const st = from[from.length - 1];
      if (!st) return;
      if (st.check && !this._confirmStep) {
        let ok = true;
        try { ok = await st.check(dir); } catch (e) { ok = true; }
        if (!ok) {
          this._toast(T('changed_since_somewhere_else', { text: st.text }), [{ text: dir === 'undo' ? T('undo_anyway') : T('redo_anyway'), fn: () => { this._confirmStep = true; this._step(from, to, dir).finally(() => { this._confirmStep = false; }); } }]);
          return;
        }
      }
      from.pop();
      const startedOn = this._data.ui.current;
      this._undoBusy = true; this._renderUndo();
      try {
        await st[dir]();
        to.push(st);
        this._toast((dir === 'undo' ? T('undone') : T('redone')) + st.text);
      } catch (e) {
        this._toast(T('could_not', { dir, text: st.text, message: e.message || e.code || e }));
      }
      this._undoBusy = false; this._renderUndo();
      // show the function the step changed, unless the user has moved on to another one meanwhile
      const moved = this._data.ui.current !== startedOn;
      if (!moved && st.label && st.label !== this._data.ui.current && this._data.functions.includes(st.label)) this._open(st.label);
      else if (this._model) { this._place(); this._render(); }
    }
    // layout steps: moving boxes, Arrange, frames and notes restore the function's previous layout
    _snap(label) { const L = this._layout(label); return JSON.stringify({ nodes: L.nodes, frames: L.frames, notes: L.notes, tools: L.tools || [], keep: L.keep || [], dir: L.dir || 'right' }); }
    _layoutStep(label, before, text) {
      const after = this._snap(label);
      if (after === before) return;
      const apply = (j) => {
        const v = JSON.parse(j), L = this._layout(label), tools = JSON.stringify(L.tools || []) !== JSON.stringify(v.tools || []);
        L.nodes = v.nodes; L.frames = v.frames; L.notes = v.notes;
        if (v.tools && v.tools.length) L.tools = v.tools; else delete L.tools;
        if (v.keep && v.keep.length) L.keep = v.keep; else delete L.keep;
        if (v.dir === 'down') L.dir = 'down'; else delete L.dir;
        this._save();
        // test buttons and monitors are boxes on the board: put them back or take them away too
        if (tools && this._model && this._model.label === label) { this._syncTools(); this._startMonitors(); }
      };
      // another board may have changed this layout since: ask before overwriting that
      const check = async (dir) => this._snap(label) === (dir === 'undo' ? after : before);
      this._history({ label, text, check, undo: async () => apply(before), redo: async () => apply(after) });
    }

    /* ---------- frames and notes ---------- */
    _addFrame() {
      const label = this._model.label, L = this._layout(label), c = this._center(), before = this._snap(label);
      L.frames.push({ id: uid(), title: T('new_frame'), x: Math.round(c.x - 270), y: Math.round(c.y - 170), w: 540, h: 340 });
      this._save(); this._renderFrames();
      this._layoutStep(label, before, T('add_frame'));
    }
    _addNote() {
      const label = this._model.label, L = this._layout(label), c = this._center(), before = this._snap(label);
      const n = { id: uid(), text: '', x: Math.round(c.x - 120), y: Math.round(c.y - 50), w: 240 };
      L.notes.push(n);
      this._save(); this._renderNotes();
      this._layoutStep(label, before, T('add_note'));
      const ta = this._$.notes.querySelector(`textarea[data-nid="${n.id}"]`);
      if (ta) ta.focus();
    }
    _delFrame(id) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.frames = L.frames.filter((f) => f.id !== id);
      this._save(); this._renderFrames();
      this._layoutStep(label, before, T('delete_frame'));
    }
    _delNote(id) {
      const label = this._model.label, L = this._layout(label), before = this._snap(label);
      L.notes = L.notes.filter((n) => n.id !== id);
      this._save(); this._renderNotes();
      this._layoutStep(label, before, T('delete_note'));
    }
    async _ensureSelector() {
      if (customElements.get('ha-selector')) return true;
      try {
        // Home Assistant loads its form widgets lazily; opening a built-in card editor loads them.
        if (window.loadCardHelpers) {
          const helpers = await window.loadCardHelpers();
          const card = await helpers.createCardElement({ type: 'button', entity: 'sun.sun' });
          if (card && card.constructor && card.constructor.getConfigElement) await card.constructor.getConfigElement();
        }
      } catch (e) { /* fall back to the plain inputs */ }
      await Promise.race([customElements.whenDefined('ha-selector'), this._clock.sleep(4000)]);
      return !!customElements.get('ha-selector');
    }
    _nameClash(l) {
      const m = this._$.modal, box = m.querySelector('.clash') || document.createElement('div');
      box.className = 'clash';
      const onBoard = this._data.functions.includes(l.label_id);
      box.innerHTML = onBoard
        ? `<b>${esc(l.name)}</b> ${T('is_already_a_function_on')}<div class="cbtns"><button data-act="fn-goto" data-label="${esc(l.label_id)}">${T('open_it')}</button></div>`
        : `${T('a_home_assistant_label_called')} <b>${esc(l.name)}</b> ${T('already_exists_so_this_name')}<div class="cbtns"><button class="primary" data-act="fn-restore" data-label="${esc(l.label_id)}">${T('put_it_back_on_the')}</button><button data-act="fn-rename">${T('choose_another_name')}</button></div>`;
      const btns = m.querySelector('.btns');
      if (!box.isConnected && btns) btns.before(box);
    }
    // categories named after a function, one per scope; an existing one with the same name is reused.
    // Returns { ids: { scope: category_id }, made: [[scope, category_id]] } (made = created here, for undo)
    async _categories(name, icon, scopes) {
      const ids = {}, made = [];
      for (const scope of scopes || ['automation', 'script', 'helpers']) {
        try {
          const list = await this._ws({ type: 'config/category_registry/list', scope });
          const f = (list || []).find((c) => String(c.name).toLowerCase() === name.toLowerCase());
          if (f) ids[scope] = f.category_id;
          else { ids[scope] = (await this._ws({ type: 'config/category_registry/create', scope, name, icon })).category_id; made.push([scope, ids[scope]]); }
        } catch (e) { /* leave this scope without a category */ }
      }
      return { ids, made };
    }
    _closeModal() { this._$.modal.hidden = true; this._$.modal.innerHTML = ''; this._editing = null; this._arwDone(); this._tst = null; }
    // what the board changes in Home Assistant, in this install's mode (also in strings.json and the README)
    _promise() {
      const full = this._full();
      const li = [
        T('creating_a_function_creates_a'),
        T('adding_or_removing_a_piece'),
        T('pause_and_resume_turn_the'),
        T('new_automations_scripts_helpers_and'),
        T('hide_from_board_leaves_the'),
      ];
      if (full) {
        li.push(T('full_manager_is_on_the'));
        li.push(T('ver_promise_full'));
        li.push(T('tests_full_manager_a_helper'));
        li.push(T('nb_promise'));
        li.push(T('ver_del_promise'));
      } else {
        li.push(T('this_install_is_set_to'));
      }
      li.push(T('the_debugger_watch_triggers_monitor'));
      li.push(T('show_node_red_flows_in'));
      li.push(T('ver_promise'));
      li.push(T('every_change_is_shown_before'));
      li.push(T('privacy_promise'));
      return li;
    }
    _expText(x, got) {
      const nm = esc(this._checkName(x.id)), g = got == null ? '' : ' ' + T('chk_got', { got: esc(got) });
      if (x.k === 'state') return T('chk_x_state', { name: nm, state: esc(x.state) }) + g;
      if (x.k === 'ran') return T('chk_x_ran', { name: nm }) + g;
      if (x.k === 'stopped') return T('chk_x_stopped', { name: nm }) + g;
      return T('chk_x_notran', { name: nm }) + g;
    }
    // the function's own layout, not a version's open in a tab
    _liveLayout(label) { return this._data.layouts[label] || this._layout(label); }
    // how one item would be deleted, whether Undo can bring it back, and why not when it can't
    async _howDelete(id) {
      if (id.startsWith('device:')) return { id, name: this._mkNode(id, 'member').name, can: false, undo: false, why: T('devices_are_never_deleted_it') };
      const st = this._hass.states[id];
      const reg = this._entMap.has(id) ? await this._ws({ type: 'config/entity_registry/get', entity_id: id }, { optional: 'an entity set up in YAML has no registry entry', fallback: null }) : null;
      const name = (st && st.attributes.friendly_name) || (reg && (reg.name || reg.original_name)) || id;
      const base = { id, name, reg, can: false, undo: false };
      const dom = id.split('.')[0];
      if (['automation', 'script', 'scene'].includes(dom)) {
        const cid = reg && reg.unique_id;
        if (!cid) return Object.assign(base, { why: T('defined_in_yaml_without_an') });
        try {
          const cfg = await this._api('GET', `config/${dom}/config/${encodeURIComponent(cid)}`);
          return Object.assign(base, { can: true, undo: true, how: 'config', dom, cid, cfg, where: `${dom}s.yaml` });
        } catch (e) { return Object.assign(base, { why: T('defined_in_yaml_outside_s', { dom }) }); }
      }
      if (HELPER_DOMAINS.has(dom)) {
        const items = await this._ws({ type: dom + '/list' }, { optional: 'a helper domain not set up has no list of helpers', fallback: [] });
        const item = reg && (items || []).find((x) => x.id === reg.unique_id);
        if (item) return Object.assign(base, { can: true, undo: true, how: 'collection', dom, item, where: T('helpers_made_in_the_ui') });
        return Object.assign(base, { why: T('defined_in_yaml_configuration_yaml') });
      }
      if (reg && reg.config_entry_id && HELPER_PLATFORMS.has(reg.platform)) {
        const entries = await this._ws({ type: 'config_entries/get', domain: reg.platform }, { fallback: [] });
        const entry = (entries || []).find((x) => x.entry_id === reg.config_entry_id);
        const siblings = this._ents.filter((e) => e.config_entry_id === reg.config_entry_id).map((e) => e.entity_id);
        return Object.assign(base, { can: true, undo: false, how: 'entry', entryId: reg.config_entry_id, where: `${reg.platform} helper${entry ? ' "' + entry.title + '"' : ''}`, siblings, why: T('deleting_a_helper_set_up') });
      }
      return Object.assign(base, { why: T('not_an_automation_script_or') });
    }
    // automations and scripts (outside `skip`) whose configs refer to any of these items
    async _usedBy(ids, skip) {
      const want = new Set(ids), out = new Map();
      const all = this._logicIds().filter((e) => !skip.has(e));
      const cfgs = await Promise.all(all.map((e) => this._fetchConfig(e)));
      all.forEach((e, i) => {
        if (!cfgs[i]) return;
        analyze(cfgs[i], e.startsWith('script.'), (x) => this._known(x)).refs.forEach((r) => {
          if (!want.has(r.ref)) return;
          if (!out.has(r.ref)) out.set(r.ref, new Set());
          out.get(r.ref).add(e);
        });
      });
      return out;
    }
    _nameOf(id) { const st = this._hass.states[id], e = this._entMap.get(id); return (st && st.attributes.friendly_name) || (e && (e.name || e.original_name)) || id; }
    // what outside `mine` uses any of `ids` (0.11.0): automations and scripts, the groups and scenes that hold it,
    // the helpers that read it (template, statistics …) and the Node-RED flows last read; id → Set of who uses it
    async _outsideUses(ids, mine) {
      const want = new Set(ids), skip = new Set(mine);
      const out = await this._usedBy(ids, skip);
      const add = (id, who) => { if (!out.has(id)) out.set(id, new Set()); out.get(id).add(who); };
      Object.values(this._hass.states).forEach((st) => {
        if (skip.has(st.entity_id)) return;
        toList(st.attributes && st.attributes.entity_id).forEach((x) => { if (typeof x === 'string' && x !== st.entity_id && want.has(x)) add(x, st.entity_id); });
      });
      if (this._storeMode === 'shared') {
        const ask = this._ents.filter((e) => !skip.has(e.entity_id) && HELPER_PLATFORMS.has(e.platform)).map((e) => e.entity_id).slice(0, 500);
        const r = ask.length ? await this._ws({ type: 'functions_board/sources', entity_ids: ask }, { fallback: null }) : null;
        Object.entries((r && r.sources) || {}).forEach(([k, src]) => ((src && src.entities) || []).forEach((x) => { if (want.has(x)) add(x, k); }));
      }
      const nr = this._nrState();
      ((nr && nr.groups) || []).forEach((g) => [].concat(g.trig || [], g.read || [], g.change || [], g.calls || []).forEach((x) => { if (want.has(x)) add(x, 'nr:' + g.name); }));
      return out;
    }
    // why a piece of a function deleted with its items stays (0.11.0): it's also in another function, something
    // outside this one uses it, or deleting it would delete something that isn't in this function (a helper set up
    // with others). It stays, and only leaves this function; null when it may go
    // plain: the reason alone, for a piece that stays anyway (restore rewriting what's also elsewhere)
    _sharedWhy(p, label, mine, uses, plain) {
      const ids = [p.id].concat(p.siblings || []), fset = new Set(this._data.functions.filter((l) => l !== label)), other = new Set(), who = new Set();
      ids.forEach((id) => {
        const e = this._entMap.get(id);
        ((e && e.labels) || []).forEach((l) => { if (fset.has(l)) other.add(this._fnName(l)); });
        (uses.get(id) || new Set()).forEach((u) => who.add(u));
      });
      const fns = [...other].join(', '), names = (list) => list.slice(0, 3).join(', ') + (list.length > 3 ? T('and_more', { n: list.length - 3 }) : '');
      if (other.size) return plain ? T('shared_also_in', { fns }) : T('stays_also_in', { fns });
      const users = names([...who].map((u) => (u.startsWith('nr:') ? T('node_red_named', { name: u.slice(3) }) : this._nameOf(u))));
      if (who.size) return plain ? T('shared_used_by', { names: users }) : T('stays_used_by', { names: users });
      if (plain) return null;
      const with_ = (p.siblings || []).filter((x) => x !== p.id && !mine.includes(x));
      if (with_.length) return T('stays_set_up_with', { names: names(with_.map((x) => this._nameOf(x))) });
      return null;
    }
    _usedHtml(id, used) {
      const u = used.get(id);
      if (!u || !u.size) return '';
      const names = [...u].map((x) => this._nameOf(x));
      return `<div class="dwarn"><ha-icon icon="mdi:alert-outline"></ha-icon>${T('used_by', { count: esc(P('n_automations_and_scripts', u.size)), names: esc(names.slice(0, 4).join(', ')), extra: names.length > 4 ? T('and_more', { n: names.length - 4 }) : '' })}</div>`;
    }
    // the function's own categories, and whether anything outside `ids` is filed under them
    async _fnCategories(label, ids) {
      const L = this._data.layouts[label] || {}, cats = L.categories || {}, out = [];
      const name = this._fnName(label).toLowerCase();
      for (const scope of ['automation', 'script', 'helpers']) {
        let cid = cats[scope];
        const list = await this._ws({ type: 'config/category_registry/list', scope }, { fallback: [] });
        const c = (list || []).find((x) => x.category_id === cid) || (list || []).find((x) => String(x.name).toLowerCase() === name);
        if (!c) continue;
        cid = c.category_id;
        const inIt = this._ents.filter((e) => (e.categories || {})[scope] === cid);
        const mine = inIt.filter((e) => (e.labels || []).includes(label) || ids.includes(e.entity_id));
        out.push({ scope, id: cid, name: c.name, icon: c.icon || null, members: inIt.map((e) => e.entity_id), free: inIt.length === mine.length });
      }
      return out;
    }
    // wait until an entity's registry entry exists (Home Assistant creates it shortly after the config)
    async _waitEntity(test, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const ents = await this._ws({ type: 'config/entity_registry/list' }, { fallback: [] });
        const e = ents.find(test);
        if (e) return e;
        await this._clock.pause(300);
      }
      return null;
    }
    // put deleted items back, with their registry settings (name, icon, labels, area, categories, entity id)
    async _restoreItems(done) {
      const back = [];
      for (const p of done) {
        if (!p.undo) continue;
        let e = null;
        if (p.how === 'config') {
          await this._api('POST', `config/${p.dom}/config/${encodeURIComponent(p.cid)}`, p.cfg);
          e = await this._waitEntity((x) => x.platform === p.dom && x.unique_id === p.cid);
        } else if (p.how === 'collection' && VER_HELPERS.has(p.dom)) {
          const settings = Object.assign({}, p.item);
          delete settings.id;
          const made = await this._ws(Object.assign({ type: p.dom + '/create' }, settings));
          e = await this._waitEntity((x) => x.platform === p.dom && x.unique_id === made.id);
          p.item = made;
        }
        if (!e) continue;
        const r = p.reg || {}, msg = { type: 'config/entity_registry/update', entity_id: e.entity_id, name: r.name || null, icon: r.icon || null, area_id: r.area_id || null, labels: r.labels || [], categories: r.categories || {} };
        if (e.entity_id !== p.id) msg.new_entity_id = p.id;
        // (an entity whose id can't be changed back is put back under the id it has now)
        if (msg.new_entity_id) { if ((await this._ws(msg, { optional: 'Home Assistant refuses an entity id already taken', fallback: false })) === false) await this._ws(Object.assign(msg, { new_entity_id: undefined }), { fallback: null }); } else await this._ws(msg, { fallback: null });
        back.push(p);
      }
      return back;
    }
    async _runItemDelete(d) {
      const p = d.plan[0], label = d.label;
      const { done, failed } = await this._deleteItems(d.plan);
      if (!done.length) { this._toast(T('could_not_delete', { failed: failed.join('; ') })); return; }
      if (this._model && this._model.nodes.has(p.id)) this._select(null);
      this._history({
        label, text: T('delete', { name: p.name }),
        check: async (dir) => dir !== 'undo' || !this._hass.states[p.id],
        undo: async () => { await this._restoreItems(done); },
        redo: async () => {
          const again = await this._howDelete(p.id);
          if (again.can) { const r = await this._deleteItems([again]); done.splice(0, done.length, ...r.done); }
        },
      });
      this._store.changed('cfg:');
      this._toast(T('deleted_2', { name: p.name }), p.undo ? [{ text: T('undo'), fn: () => this._undo() }] : []);
    }
    async _runFnDelete(d) {
      const label = d.label, lab = this._labelMap.get(label), name = lab ? lab.name : label;
      const keep = { name, icon: lab && lab.icon, color: lab && lab.color, description: lab && lab.description };
      const layout = this._data.layouts[label] ? JSON.parse(JSON.stringify(this._data.layouts[label])) : null;
      const pos = this._data.functions.indexOf(label);
      const areas = (await this._ws({ type: 'config/area_registry/list' }, { fallback: [] })).filter((a) => (a.labels || []).includes(label)).map((a) => a.area_id);
      const st = { label, ents: d.ents, devs: d.devs, areas, cats: d.dropCats ? d.cats : [], items: [] };
      // 1. the items, when asked
      if (d.withItems && d.plan.length) {
        const r = await this._deleteItems(d.plan);
        st.items = r.done;
        if (r.failed.length) this._toast(T('some_items_could_not_be', { failed: r.failed.join('; ') }));
      }
      // 2. the categories (Home Assistant un-files whatever is still in them)
      for (const c of st.cats) await this._ws({ type: 'config/category_registry/delete', scope: c.scope, category_id: c.id }, { fallback: null });
      // 3. the label (Home Assistant takes it off every entity, device and area) and the layout
      await this._ws({ type: 'config/label_registry/delete', label_id: label });
      this._takeOff(label);
      delete this._data.layouts[label];
      this._save();
      this._history({
        label: null, text: T('delete', { name }),
        check: async (dir) => dir !== 'undo' || !(await this._ws({ type: 'config/label_registry/list' })).some((l) => String(l.name).toLowerCase() === name.toLowerCase()),
        undo: async () => {
          const msg = { type: 'config/label_registry/create', name: keep.name, icon: keep.icon || 'mdi:puzzle-outline' };
          if (keep.color) msg.color = keep.color;
          if (keep.description) msg.description = keep.description;
          const nl = await this._ws(msg);
          const newId = nl.label_id;
          const back = await this._restoreItems(st.items);
          // categories come back with the same names; whatever was filed there is filed again
          const catIds = {};
          for (const c of st.cats) {
            const made = await this._ws({ type: 'config/category_registry/create', scope: c.scope, name: c.name, icon: c.icon || undefined }, { fallback: null });
            if (!made) continue;
            catIds[c.scope] = made.category_id;
            for (const id of c.members) await this._ws({ type: 'config/entity_registry/update', entity_id: id, categories: { [c.scope]: made.category_id } }, { fallback: null });
          }
          const deleted = new Set(st.items.map((p) => p.id).filter((id) => !back.some((p) => p.id === id)));
          for (const id of st.ents) {
            if (deleted.has(id)) continue;
            const r = await this._ws({ type: 'config/entity_registry/get', entity_id: id }, { optional: 'an entity set up in YAML has no registry entry', fallback: null });
            if (r) await this._ws({ type: 'config/entity_registry/update', entity_id: id, labels: [...new Set((r.labels || []).concat([newId]))] }, { fallback: null });
          }
          await this._loadRegistries();
          for (const did of st.devs) {
            const dev = this._devMap.get(did.slice(7));
            if (dev) await this._ws({ type: 'config/device_registry/update', device_id: dev.id, labels: [...new Set((dev.labels || []).concat([newId]))] }, { fallback: null });
          }
          for (const aid of st.areas) {
            const a = (await this._ws({ type: 'config/area_registry/list' })).find((x) => x.area_id === aid);
            if (a) await this._ws({ type: 'config/area_registry/update', area_id: aid, labels: [...new Set((a.labels || []).concat([newId]))] }, { fallback: null });
          }
          if (layout) { const L = cleanLayout(layout); if (Object.keys(catIds).length) L.categories = Object.assign({}, L.categories || {}, catIds); this._data.layouts[newId] = L; }
          if (!this._data.functions.includes(newId)) this._data.functions.splice(Math.max(0, pos), 0, newId);
          this._data.ui.current = newId;
          st.label = newId;
          this._save();
        },
        redo: async () => {
          await this._loadRegistries();
          const items = st.items.length ? await Promise.all(st.items.map((p) => this._howDelete(p.id))) : [];
          const cats = st.cats.length ? await this._fnCategories(st.label, []) : [];
          await this._runFnDeleteQuiet(st.label, items.filter((p) => p.can), cats);
        },
      });
      await this._loadRegistries();
      this._renderList();
      if (this._data.ui.current) this._open(this._data.ui.current); else { this._model = null; this._clearWorld(); this._renderHeader(); this._setEmpty(); }
      this._toast(T('deleted', { name, extra: st.items.length ? T('and', { count: P('n_items', st.items.length) }) : '' }), [{ text: T('undo'), fn: () => this._undo() }]);
    }
    async _runFnDeleteQuiet(label, items, cats) {
      if (items.length) await this._deleteItems(items);
      for (const c of cats) await this._ws({ type: 'config/category_registry/delete', scope: c.scope, category_id: c.id }, { fallback: null });
      await this._ws({ type: 'config/label_registry/delete', label_id: label }, { fallback: null });
      this._takeOff(label);
      delete this._data.layouts[label];
      this._save();
    }

    /* ---------- types ---------- */
    _scopeOf(id) {
      const d = id.split('.')[0];
      if (d === 'automation') return 'automation';
      if (d === 'script') return 'script';
      const reg = this._entMap.get(id);
      if (HELPER_DOMAINS.has(d) || (reg && HELPER_PLATFORMS.has(reg.platform))) return 'helpers';
      return null;
    }
    _tagOf(key) {
      if (key.startsWith('device:')) return T('device');
      if (key.startsWith('svc:')) return T('action');
      if (key.startsWith('event:')) return T('event');
      if (key.startsWith('mqtt:')) return T('mqtt');
      if (key.startsWith('nact:')) return T('button');
      if (key.startsWith('nr:')) return T('node_red');
      if (TGT_RE.test(key)) return TYPE[key.slice(0, key.indexOf(':'))];
      const s = this._scopeOf(key);
      if (s === 'automation') return T('automation');
      if (s === 'script') return T('script');
      if (s === 'helpers') return T('helper');
      const d = key.split('.')[0];
      return TYPE[d] || d.replace(/_/g, ' ');
    }
    _countText(ids) {
      const c = { a: 0, s: 0, h: 0, o: 0 };
      ids.forEach((id) => { const t = this._scopeOf(id); if (t === 'automation') c.a++; else if (t === 'script') c.s++; else if (t === 'helpers') c.h++; else c.o++; });
      const p = [];
      if (c.a) p.push(P('n_automations', c.a));
      if (c.s) p.push(P('n_scripts', c.s));
      if (c.h) p.push(P('n_helpers', c.h));
      if (c.o) p.push(c.o + ' other');
      return p.join(' · ');
    }
    _memRow(i, c, id) {
      const st = this._hass.states[id], e = this._entMap.get(id), can = this._canLabel(id);
      const name = (st && st.attributes.friendly_name) || (e && (e.name || e.original_name)) || id;
      const other = ((e && e.labels) || []).filter((l) => this._data.functions.includes(l)).map((l) => this._fnName(l));
      const inFn = c.fn && can && !c.missing.includes(id);
      return `<label class="mrow ${can ? '' : 'nolab'}"><input type="checkbox" data-cmem="${i}" data-id="${esc(id)}" ${can && c.keep.has(id) ? 'checked' : ''} ${inFn || !can ? 'disabled' : ''}>`
        + `<span class="tag">${esc(this._tagOf(id))}</span><span class="mn"><b>${esc(name)}</b>`
        + `<small>${esc(id)}${can ? '' : T('can_t_be_added_no')}${other.length ? ` ${T('already_in', { other: esc(other.join(', ')) })}` : ''}</small></span></label>`;
    }
    // only items in the entity or device registry can carry a label (a YAML automation without id: can't)
    _canLabel(id) { return id.startsWith('device:') || this._entMap.has(id); }
    async _catGroups() {
      const scopes = ['automation', 'script', 'helpers'];
      const lists = await Promise.all(scopes.map((s) => this._ws({ type: 'config/category_registry/list', scope: s }, { fallback: [] })));
      const byId = new Map();
      scopes.forEach((s, i) => (lists[i] || []).forEach((c) => byId.set(s + ':' + c.category_id, c)));
      const byName = new Map();
      this._ents.forEach((e) => Object.entries(e.categories || {}).forEach(([scope, cid]) => {
        const c = byId.get(scope + ':' + cid);
        if (!c) return;
        const k = String(c.name).toLowerCase();
        if (!byName.has(k)) byName.set(k, { name: c.name, icon: c.icon || null, members: new Set() });
        byName.get(k).members.add(e.entity_id);
      }));
      return [...byName.values()];
    }
    // The import's grouping (0.11.0): the parts findFunctions makes of every automation, script and Node-RED flow,
    // with the functions already on the board and your categories, and the offers to merge parts into one function
    // (two parts tied, or a category several parts are filed under). Nothing is merged until the person says so.
    // opt.nodered: Node-RED groups (nrGroups), when the board reads Node-RED.
    _cluster(roles, cats, opt = {}) {
      const catOf = new Map();
      cats.forEach((c) => c.members.forEach((id) => catOf.set(id, String(c.name).toLowerCase())));
      const all = new Map(roles), nrOf = new Map();
      (opt.nodered || []).forEach((g) => {
        const id = 'nr:' + g.id, m = new Map(), put = (ref, role) => (m.get(ref) || m.set(ref, new Set()).get(ref)).add(role);
        g.trig.forEach((x) => put(x, 'trigger')); g.read.forEach((x) => put(x, 'condition')); g.change.forEach((x) => put(x, 'action')); g.calls.forEach((x) => put(x, 'call'));
        all.set(id, m); nrOf.set(id, g);
      });
      const kind = (id) => {
        if (nrOf.has(id)) return 'nodered';
        const sc = this._scopeOf(id);
        return sc === 'helpers' ? 'helper' : sc || (id.startsWith('scene.') ? 'scene' : null);
      };
      const { parts, ties } = findFunctions(all, {
        kind, name: (id) => (nrOf.has(id) ? nrOf.get(id).tabLabel : this._nameOf(id)), cat: (id) => catOf.get(id) || '',
        tab: (id) => (nrOf.get(id) || {}).tabLabel || '', source: (ref) => this._sourceOf(ref),
      });
      const fset = new Set(this._data.functions);
      const fnOf = (id) => { const e = this._entMap.get(id); return ((e && e.labels) || []).filter((l) => fset.has(l)); };
      // 1. a part that's mostly a function already is that function (with the rest of it); parts of one function are one
      const out = [], byFn = new Map(), at = new Map();
      parts.forEach((ids, pi) => {
        const own = ids.filter((id) => !nrOf.has(id)), nr = ids.filter((id) => nrOf.has(id)).map((id) => nrOf.get(id));
        const tally = new Map();
        own.forEach((id) => fnOf(id).forEach((l) => tally.set(l, (tally.get(l) || 0) + 1)));
        let best = null, bn = 0;
        tally.forEach((n, l) => { if (n > bn) { bn = n; best = l; } });
        if (best && bn >= own.length / 2) {
          if (!byFn.has(best)) { byFn.set(best, out.length); out.push({ ids: new Set(), fn: best, source: 'function', nr: [] }); }
          const o = out[byFn.get(best)];
          own.forEach((id) => o.ids.add(id)); o.nr.push(...nr); at.set(pi, byFn.get(best));
        } else { at.set(pi, out.length); out.push({ ids: new Set(own), source: nr.length ? 'nodered' : 'wiring', nr }); }
      });
      byFn.forEach((oi, l) => this._ents.forEach((e) => { if ((e.labels || []).includes(l)) out[oi].ids.add(e.entity_id); }));
      // 2. categories: a part filed under one keeps it; one category holding a single part brings the rest of what's
      //    filed there into it, as before; a category over several parts is an offer to merge them (what's filed
      //    there and in no part is a part of its own); a category over none is a part of its own
      const offers = [];
      const catC = cats.filter((c) => c.members.size >= 2 && [...c.members].some((id) => id.startsWith('automation.') || id.startsWith('script.')));
      const inC = new Map();
      out.forEach((o, oi) => {
        if (o.fn) return;
        let bi = -1, bo = 0;
        catC.forEach((c, ci) => { let ov = 0; o.ids.forEach((id) => { if (c.members.has(id)) ov++; }); if (ov > bo) { bo = ov; bi = ci; } });
        if (bi >= 0 && (bo >= o.ids.size / 2 || bo >= catC[bi].members.size / 2)) inC.set(oi, bi);
      });
      const used = new Set(out.flatMap((o) => [...o.ids]));
      catC.forEach((c, ci) => {
        const ps = [...inC.entries()].filter(([, x]) => x === ci).map(([oi]) => oi);
        const rest = [...c.members].filter((id) => !used.has(id) && !fnOf(id).length);
        if (ps.length === 1) {
          const o = out[ps[0]];
          rest.forEach((id) => o.ids.add(id));
          Object.assign(o, { name: c.name, cat: c.name, icon: c.icon, source: 'both' });
          return;
        }
        const mine = ps.slice();
        if (rest.length >= 2 && rest.some((id) => id.startsWith('automation.') || id.startsWith('script.'))) {
          mine.push(out.length);
          out.push({ ids: new Set(rest), source: 'category', name: c.name, cat: c.name, icon: c.icon, nr: [] });
        }
        mine.forEach((oi) => { out[oi].cat = out[oi].cat || c.name; });
        if (mine.length >= 2) offers.push({ parts: mine.sort((x, y) => x - y), why: 'category', byPart: null, byName: '', viaName: c.name });
      });
      // 3. the ties between parts, except between two functions already made
      const nm = (id) => (!id ? '' : nrOf.has(id) ? T('node_red_named', { name: nrOf.get(id).name }) : this._nameOf(id));
      const devName = (id) => { const e = this._entMap.get(id), d = e && this._devMap.get(e.device_id); return d ? d.name_by_user || d.name || nm(id) : nm(id); };
      ties.forEach((t) => {
        const a = at.get(t.a), b = at.get(t.b);
        if (a === b || (out[a].fn && out[b].fn)) return;
        const byPart = t.by == null ? null : parts[t.a].includes(t.by) ? a : b;
        offers.push({ parts: [a, b].sort((x, y) => x - y), why: t.why, byPart, byName: nm(t.by), viaName: t.why === 'device' ? devName(t.via) : nm(t.via) });
      });
      return { parts: out, offers };
    }
    // what a trigger on ref starts from, for the import (findFunctions): a device's buttons (its event entities, its
    // MQTT topic), an actuator's own state (a light, a switch), or the device; nothing for what everything listens to
    // (people, phones, zones, the sun, speakers) or for helpers (they link pieces their own way)
    _sourceOf(ref) {
      const mq = /^mqtt:([^/]+)\/([^/]+)/.exec(ref);
      if (mq) { const d = this._devs.find((x) => (x.name_by_user || x.name) === mq[2]); return 'buttons:' + (d ? d.id : mq[1] + '/' + mq[2]); }
      if (ref.includes(':') || !ref.includes('.')) return null;
      const dom = ref.split('.')[0], e = this._entMap.get(ref);
      if (/^(person|device_tracker|zone|sun|weather|media_player|tts|notify|calendar|scene|automation|script|conversation|stt|wake_word|assist_satellite)$/.test(dom)) return null;
      if (!e || !e.device_id || e.platform === 'mobile_app' || this._scopeOf(ref) === 'helpers') return null;
      if (dom === 'event') return 'buttons:' + e.device_id;
      return /^(light|switch|fan|siren|valve)$/.test(dom) ? ref : 'dev:' + e.device_id;
    }
    // one row of the import from its pieces: its name, the function it already is (if any), what's missing from that
    // function, what it overlaps; o: { fn, name, cat, icon, source }; names: the names taken so far (lower case)
    _candOf(ids, o, names) {
      const fset = new Set(this._data.functions);
      const fnOf = (id) => { const e = this._entMap.get(id); return ((e && e.labels) || []).filter((l) => fset.has(l)); };
      const rank = (id) => { const t = this._scopeOf(id); return t === 'automation' ? 0 : t === 'script' ? 1 : t === 'helpers' ? 2 : 3; };
      const can = (id) => this._canLabel(id);
      const members = [...ids].filter((id) => this._hass.states[id] || this._entMap.has(id)).sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
      const tally = new Map();
      members.forEach((id) => fnOf(id).forEach((l) => tally.set(l, (tally.get(l) || 0) + 1)));
      let fn = o.fn || null;
      if (!fn) tally.forEach((n, l) => { if (!fn && n >= members.length * 0.8) fn = l; });
      if (!fn && o.name) this._data.functions.forEach((l) => { if (!fn && this._fnName(l).toLowerCase() === o.name.toLowerCase()) fn = l; });
      const missing = fn ? members.filter((id) => can(id) && !fnOf(id).includes(fn)) : [];
      let name;
      if (fn) name = this._fnName(fn);
      else {
        name = o.name || this._suggestName(members);
        const base = name;
        for (let k = 2; names.has(name.toLowerCase()); k++) name = base + ' ' + k;
        names.add(name.toLowerCase());
      }
      const lab = fn ? this._labelMap.get(fn) : null;
      return {
        name, cat: o.cat || null, fn, missing, members, keep: new Set(members.filter(can)), source: fn && o.source === 'function' ? 'function' : o.source,
        icon: (lab && lab.icon) || o.icon || this._pickIcon(members),
        overlap: fn ? [] : [...tally.entries()].map(([l, n]) => ({ l, n })).sort((x, y) => y.n - x.n),
      };
    }
    _suggestName(members) {
      const STOP = new Set(['the', 'a', 'an', 'of', 'on', 'off', 'to', 'and', 'for', 'in', 'at', 'by', 'with', 'is', 'when', 'if', 'then',
        'set', 'turn', 'new', 'auto', 'automation', 'script', 'input', 'boolean', 'number', 'text', 'select', 'button', 'counter', 'timer',
        'sensor', 'binary', 'switch', 'notify', 'notification', 'run', 'do', 'my']);
      const ACR = new Set(['led', 'ups', 'hvac', 'tv', 'ac', 'pc', 'ha', 'mqtt', 'ir', 'rf', 'ev', 'pv', 'dns', 'vpn', 'wan', 'lan', 'usb', 'nas', 'erv', 'co2', 'voc', 'ai']);
      // 1. the user's own system name: "Garage: left open", "Garage - close", "[Garage] lights"
      const fname = (id) => { const e = this._entMap.get(id), st = this._hass.states[id]; return ((e && e.name) || (st && st.attributes.friendly_name) || '').trim(); };
      const logic = members.filter((id) => /^(automation|script)\./.test(id)).map(fname).filter(Boolean);
      const pre = new Map();
      logic.forEach((n) => {
        const m = n.match(/^\[([^\]]{2,40})\]/) || n.match(/^(.{2,40}?)\s*(?::|\s[-\u2013\u2014|]\s)/);
        if (!m || !/[a-z]{2}/i.test(m[1])) return;
        const k = m[1].trim().toLowerCase(), p = pre.get(k) || { name: m[1].trim(), n: 0 };
        p.n++; pre.set(k, p);
      });
      const best = [...pre.values()].sort((a, b) => b.n - a.n)[0];
      if (best && best.n >= 2 && best.n >= logic.length / 2) return best.name;
      // 2. leading words every automation and script name shares: "Morning lights...", "Morning briefing"
      if (logic.length >= 2) {
        const words = logic.map((n) => n.replace(/[:|\[\]\u2013\u2014]|\s-\s/g, ' ').split(/\s+/).filter(Boolean));
        let k = 0;
        while (k < 4 && words.every((w) => w[k] && w[k].toLowerCase() === words[0][k].toLowerCase())) k++;
        const lead = words[0].slice(0, k).join(' ').replace(/[,.;]+$/, '');
        if (k && /[a-z]{3}/i.test(lead) && !STOP.has(lead.toLowerCase())) return lead;
      }
      // 3. words the entity ids share
      const counts = new Map(), first = new Map();
      members.forEach((id, idx) => {
        const obj = id.split('.')[1] || id;
        new Set(obj.split('_').filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))).forEach((t) => {
          counts.set(t, (counts.get(t) || 0) + 1);
          if (!first.has(t)) first.set(t, idx * 1000 + obj.indexOf(t));
        });
      });
      const need = Math.max(2, Math.ceil(members.length * 0.34));
      const top = [...counts.entries()].filter(([, c]) => c >= need).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
      if (top.length) {
        const ref = members.find((id) => top.every((t) => id.includes(t)));
        top.sort((a, b) => (ref ? ref.indexOf(a) - ref.indexOf(b) : first.get(a) - first.get(b)));
        return top.map((t) => (ACR.has(t) ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1))).join(' ');
      }
      const lead = members.find((id) => this._scopeOf(id) === 'helpers') || members[0];
      const st = this._hass.states[lead];
      return (st && st.attributes.friendly_name) || lead;
    }
    // Create (or reuse) the label, file under categories, label every piece that can take a label, and put the
    // function on the board even when some pieces are skipped. Returns { label, done, skipped }.
    async _importGroup(name, icon, color, ids, withCats, catName, opt = {}) {
      let label = this._labels.find((l) => String(l.name).toLowerCase() === name.toLowerCase()), made = false;
      if (!label) {
        const msg = { type: 'config/label_registry/create', name, icon: icon || 'mdi:puzzle-outline' };
        if (color) msg.color = color;
        label = await this._ws(msg);
        this._labels.push(label); this._labelMap.set(label.label_id, label);
        made = true;
      }
      const lid = label.label_id;
      if (opt.layout && !this._data.layouts[lid]) this._data.layouts[lid] = opt.layout;
      const L = this._layout(lid);
      let madeCats = [];
      if (withCats && !L.categories) {
        const scopes = [...new Set(ids.map((id) => this._scopeOf(id)).filter(Boolean))];
        const r = await this._categories(catName || name, icon || 'mdi:puzzle-outline', scopes);
        L.categories = r.ids; madeCats = r.made;
      }
      const recs = [], skipped = [];
      for (const id of ids) {
        try { recs.push(await this._label(id, lid, true, withCats)); }
        catch (e) { skipped.push({ id, why: this._noLabelWhy(id, e) }); }
      }
      const wasOn = this._data.functions.includes(lid);
      if (!wasOn) this._data.functions.push(lid);
      this._save();
      const st = { lid, made, madeCats, recs, wasOn, layout: null };
      if (!opt.quiet) {
        this._history({
          label: lid, text: T('import', { name }),
          check: async (dir) => dir !== 'undo' || !st.made || (await this._labelCount(st.lid)) <= st.recs.filter((u) => !u.had).length,
          undo: async () => {
            for (const u of st.recs) await this._ha.quiet(this._unlabel(u), 'its calls to Home Assistant report their own failures');
            if (!st.wasOn) this._takeOff(st.lid);
            await this._dropCategories(st.madeCats);
            if (st.made) {
              st.layout = this._data.layouts[st.lid] || null;
              delete this._data.layouts[st.lid];
              await this._ws({ type: 'config/label_registry/delete', label_id: st.lid });
            }
            this._save();
          },
          redo: async () => {
            await this._loadRegistries();
            const r = await this._importGroup(name, icon, color, ids, withCats, catName, { quiet: true, layout: st.layout });
            Object.assign(st, r.state);
          },
        });
      }
      return { label: lid, done: recs.map((u) => u.id), skipped, state: st };
    }
    _noLabelWhy(id, e) {
      if (!this._canLabel(id)) return T('no_unique_id_add_id');
      return (e && (e.message || e.code)) || T('could_not_be_labelled');
    }

}
