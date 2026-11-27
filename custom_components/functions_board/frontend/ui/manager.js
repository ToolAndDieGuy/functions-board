import { P, T, TGT_RE, analyze, cssColor, esc } from '../lib/index.js';

export const managerPart = {
    /* ======================================================================================================
       part: manager: the import manager: detected functions, labels, picking items Owns _mgr, _pick (PARTS): only its
       own methods use them; the other parts ask its methods.
       ====================================================================================================== */

    /* ---------- import manager: detected functions, labels, pick items ---------- */
    // the import manager's fields: groups and members ticked, the picks, the options
    _mgrChange(t) {
      const g = this._mgr;
      if (!g || !t.dataset) return false;
      if (t.dataset.csel != null) { const i = +t.dataset.csel; if (t.checked) g.sel.add(i); else g.sel.delete(i); this._mgrFootRefresh(); return true; }
      if (t.dataset.cmem != null) {
        const c = g.cands && g.cands[+t.dataset.cmem];
        if (!c) return true;
        if (t.checked) { c.keep.add(t.dataset.id); g.drop.delete(t.dataset.id); } else { c.keep.delete(t.dataset.id); g.drop.add(t.dataset.id); }
        const card = t.closest('.cand'), cc = card && card.querySelector('.ccount');
        if (cc) cc.textContent = this._countText(c.members.filter((id) => c.keep.has(id)));
        return true;
      }
      if (t.dataset.lsel != null) { if (t.checked) g.lsel.add(t.dataset.lsel); else g.lsel.delete(t.dataset.lsel); this._mgrFootRefresh(); return true; }
      if (t.hasAttribute('data-mcats')) { g.cats = t.checked; return true; }
      if (t.hasAttribute('data-pdiag')) { g.pdiag = t.checked; g.pshow = 200; this._renderPicks(); return true; }
      if (t.hasAttribute('data-ptarget')) { g.target = t.value; this._renderManager(); return true; }
      if (t.dataset.pick) {
        if (t.checked) this._pick.add(t.dataset.pick); else this._pick.delete(t.dataset.pick);
        const c = this._$.modal.querySelector('.chip[data-ptype="selected"] span');
        if (c) c.textContent = this._pick.size;
        this._mgrFootRefresh();
        return true;
      }
      return false;
    },
    _mgrInput(t) {
      const g = this._mgr;
      if (t.classList.contains('search')) { if (g) g.pshow = 200; this._renderPicks(t.value); return true; }
      if (g && t.dataset.cname != null) { const c = g.cands && g.cands[+t.dataset.cname]; if (c) { c.name = t.value; g.names.set(c.key, t.value); } return true; }
      if (g && t.hasAttribute('data-pnew')) { g.newName = t.value; this._mgrFootRefresh(); return true; }
      return false;
    },
    _openManager(tab, target) {
      if (!this._mgr) {
        // parts, offers: the import's grouping (_cluster); joins: the parts merged, as keys "i,j" (fixed: ones made because
        // the parts are one function already); names: rows renamed, by key; drop: pieces unticked
        this._mgr = { tab: 'detect', cands: null, parts: null, offers: [], joins: new Set(), fixed: new Set(), names: new Map(), drop: new Set(),
          scanning: false, expanded: new Set(), sel: new Set(), lsel: new Set(), cats: true, busy: false, target: null, newName: '', q: '', ptype: 'all', pshow: 200, pdiag: false };
      }
      const g = this._mgr;
      g.tab = tab || g.tab;
      // Pick items adds to the function on screen: every opening starts from it, never from an earlier visit
      g.target = target || this._data.ui.current || '__new';
      if (g.target !== '__new' && !this._data.functions.includes(g.target)) g.target = '__new';
      this._pick = new Set();
      this._renderManager();
      if (g.tab === 'detect' && !g.cands && !g.scanning) this._scanFunctions();
    },
    _renderManager() {
      const g = this._mgr, m = this._$.modal;
      if (!g) return;
      const old = m.querySelector('.mbody'), top = old ? old.scrollTop : 0;
      m.hidden = false;
      const tabs = [['detect', T('detected_functions')], ['labels', T('labels')], ['pick', T('pick_items')]];
      const body = g.tab === 'detect' ? this._mgrDetect() : g.tab === 'labels' ? this._mgrLabels() : this._mgrPick();
      m.innerHTML = `<div class="dlg mgr"><div class="mhead"><h3>${T('import_2')}</h3><div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${g.tab === k ? 'on' : ''}" data-act="mgr-tab" data-tab="${k}">${t}</button>`).join('')}</div><button class="ib" data-act="modal-cancel" title="${T('close')}"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="mbody">${body}</div><div class="mfoot">${this._mgrFoot()}</div></div>`;
      const nb = m.querySelector('.mbody');
      if (nb && g.tab === g.lastTab) nb.scrollTop = top;
      g.lastTab = g.tab;
      if (g.tab === 'pick') {
        const s = m.querySelector('.search');
        if (s) { s.value = g.q || ''; this._clock.after('focus', 30, () => s.focus()); }
        this._renderPicks(g.q || '');
      }
    },
    _mgrFoot() {
      const g = this._mgr;
      if (g.tab === 'detect') {
        const avail = (g.cands || []).filter((c) => !(c.fn && !c.missing.length)).length, n = g.sel.size;
        return `<label class="chk mcats"><input type="checkbox" data-mcats ${g.cats ? 'checked' : ''}>${T('file_imported_pieces_under_a')}</label><span class="cnt">${g.cands ? T('of_selected', { n, avail }) : ''}</span><button data-act="mgr-rescan" ${g.scanning || g.busy ? 'disabled' : ''}>${T('rescan')}</button><button data-act="mgr-selall" ${avail && !g.busy ? '' : 'disabled'}>${n && n === avail ? T('select_none') : T('select_all')}</button><button class="primary" data-act="mgr-import-sel" ${n && !g.busy ? '' : 'disabled'}>${g.busy ? T('importing_2') : T('import_selected')}</button>`;
      }
      if (g.tab === 'labels') {
        const n = g.lsel.size;
        return `<span class="cnt">${n ? n + ' selected' : T('none_selected')}</span><button class="primary" data-act="mgr-labels-add" ${n ? '' : 'disabled'}>${T('add_as_functions_2')}</button>`;
      }
      const n = this._pick.size, to = g.target === '__new' ? (String(g.newName || '').trim() || T('a_new_function')) : this._fnName(g.target);
      return `<span class="cnt">${n ? n + ' selected' : T('none_selected')}</span><button class="primary" data-act="mgr-pick-add" ${n ? '' : 'disabled'}>${n ? T('add_to_4', { n: esc(P('n_items', n)), to: esc(to) }) : T('add')}</button>`;
    },
    _mgrFootRefresh() { const f = this._$.modal.querySelector('.mfoot'); if (f && this._mgr) f.innerHTML = this._mgrFoot(); },

    _mgrDetect() {
      const g = this._mgr;
      if (g.scanning) return `<div class="muted pad">${T('tracing_every_automation_and_script')}</div>`;
      if (g.error) return `<div class="muted pad">${T('the_scan_failed', { error: esc(g.error) })}</div>`;
      if (!g.cands) return '';
      if (!g.cands.length) return `<div class="muted pad">${T('no_groups_found_groups_show')}</div>`;
      const s = g.stats, cv = s.cover;
      return `<div class="hint mintro"><b>${T('of_and_of_are_in', { a: cv.a[0], a2: P('n_automations', cv.a[1]), s: cv.s[0], s2: P('n_scripts', cv.s[1]) })}</b> ${T('traced_and_each_group_below', { automations: P('n_automations', s.automations), scripts: P('n_scripts', s.scripts) })}</div>${g.cands.map((c, i) => this._candHTML(c, i)).join('')}${this._leftHTML()}`;
    },
    // automations and scripts in no group and no function, each two clicks from a function (3.2)
    _leftHTML() {
      const g = this._mgr, left = g.left || [];
      if (!left.length) return '';
      const open = !!g.leftOpen;
      return `<div class="cand left"><div class="crow"><ha-icon icon="mdi:help-circle-outline"></ha-icon><span class="cname static">${T('not_in_any_function')}</span><span class="ccount">${esc(this._countText(left))}</span><span class="csrc">${T('no_wiring_or_category_ties')}</span><button class="ib" data-act="mgr-left" title="${open ? T('hide') : T('show')} them"><ha-icon icon="${open ? 'mdi:chevron-up' : 'mdi:chevron-down'}"></ha-icon></button></div>${open ? `<div class="cmem">${left.map((id) => `<div class="lrow2"><span class="tag">${esc(this._tagOf(id))}</span><span class="mn"><b>${esc(this._nameOf(id))}</b><small>${esc(id)}</small></span><button class="chip" data-act="left-add" data-id="${esc(id)}" ${this._canLabel(id) ? '' : `disabled title="${T('no_unique_id_add_id_2')}"`}>${T('add_to_3')}</button><button class="chip" data-act="left-new" data-id="${esc(id)}" ${this._canLabel(id) ? '' : 'disabled'}>${T('new_function_from_this')}</button></div>`).join('')}</div>` : ''}</div>`;
    },
    _leftAddMenu(btn, id) {
      if (!this._data.functions.length) { this._leftNew(id); return; }
      this._menu(btn, this._data.functions.map((l) => ({ act: 'left-to', data: { id, label: l }, icon: (this._labelMap.get(l) || {}).icon || 'mdi:puzzle-outline', text: this._fnName(l) })), T('add_to_2'));
      // the manager is a modal: show the menu above it
      if (this._menuEl) this._menuEl.style.zIndex = 40;
    },
    async _leftTo(id, label) {
      this._closeMenu();
      const r = await this._labelMany([id], label, this._mgr ? this._mgr.cats : true);
      if (!r.done.length) { this._toast(T('could_not_add_2', { why: (r.skipped[0] || {}).why })); return; }
      this._mgr.left = this._mgr.left.filter((x) => x !== id);
      this._renderManager();
      this._toast(T('added_to_2', { nameOf: this._nameOf(id), fnName: this._fnName(label) }), [{ text: T('undo'), fn: () => this._undo() }, { text: T('go_there'), fn: () => { this._closeModal(); this._open(label); } }]);
    },
    async _leftNew(id) {
      const g = this._mgr, base = this._suggestName([id]);
      let name = base;
      for (let k = 2; this._labels.some((l) => String(l.name).toLowerCase() === name.toLowerCase()); k++) name = base + ' ' + k;
      try {
        const r = await this._importGroup(name, this._pickIcon([id]), 'indigo', [id], g ? g.cats : true);
        if (g) g.left = g.left.filter((x) => x !== id);
        await this._loadRegistries();
        this._renderList();
        this._renderManager();
        this._toast(T('created', { name }), [{ text: T('undo'), fn: () => this._undo() }, { text: T('go_there'), fn: () => { this._closeModal(); this._open(r.label); } }]);
      } catch (e) { this._toast(T('could_not_create', { message: e.message || e.code })); }
    },
    _candHTML(c, i) {
      const g = this._mgr, open = g.expanded.has(i), done = c.fn && !c.missing.length, lock = !!c.fn || g.busy;
      const src = { category: T('from_a_category'), wiring: T('from_the_wiring'), both: T('category_wiring'), function: T('on_the_board_2'), nodered: T('wiring_node_red'), merged: T('merged') }[c.source] || '';
      const over = c.overlap && c.overlap.length ? c.overlap.slice(0, 2).map((o) => T('already_in_2', { n: o.n, fnName: esc(this._fnName(o.l)) })).join(' · ') : '';
      let act;
      if (done) act = `<span class="onb">${T('on_the_board')}</span>`;
      else if (c.fn) act = `<button class="go" data-act="mgr-import-one" data-ci="${i}" ${g.busy ? 'disabled' : ''} title="${T('label_the_pieces_that_aren', { name: esc(c.name) })}">${T('add_missing', { count: c.missing.length })}</button>`;
      else act = `<button class="go" data-act="mgr-import-one" data-ci="${i}" ${g.busy ? 'disabled' : ''}>${T('import_2')}</button>`;
      // merged rows say what they're made from and can be separated; offers say why two rows may be one (0.11.0)
      const made = c.parts.length > 1 ? `<div class="cmade"><span>${T('made_from')}</span>${c.parts.map((p) => `<span class="ptag">${esc(g.parts[p].label)}</span>`).join('')}${c.split ? `<button class="chip" data-act="mgr-split" data-ci="${i}" ${g.busy ? 'disabled' : ''} title="${T('separate_title')}"><ha-icon icon="mdi:call-split"></ha-icon>${T('separate')}</button>` : ''}</div>` : '';
      const offers = (c.offers || []).map((x) => `<div class="coffer"><button class="chip" data-act="mgr-merge" data-o="${x.k}" ${g.busy ? 'disabled' : ''}><ha-icon icon="mdi:call-merge"></ha-icon>${esc(T('merge_with', { name: x.rows.map((r) => g.cands[r].name).join(', ') }))}</button><span>${esc(this._mgrWhy(g.offers[x.k]))}</span></div>`).join('');
      const into = g.cands.some((x, j) => j !== i && !(x.fn && c.fn));
      const nr = open ? c.nr.map((f) => `<div class="mrow2"><span class="tag">${T('node_red')}</span><span class="mn"><b>${esc(f.name)}</b><small>${esc(f.off ? T('node_red_flow_off', { tab: f.tabLabel }) : T('node_red_flow_in', { tab: f.tabLabel }))}</small></span></div>`).join('') : '';
      return `<div class="cand ${done ? 'done' : ''}" data-key="${esc(c.key)}"><div class="crow"><input type="checkbox" data-csel="${i}" ${g.sel.has(i) ? 'checked' : ''} ${done || g.busy ? 'disabled' : ''} title="${T('select_for_import_selected')}"><ha-icon icon="${esc(c.icon)}"></ha-icon><input class="cname" data-cname="${i}" value="${esc(c.name)}" ${lock ? 'disabled' : ''} title="${c.fn ? T('already_a_function') : T('function_name_click_to_rename')}"><span class="ccount">${esc(this._countText(c.members.filter((id) => c.keep.has(id))))}${c.fn && c.missing.length ? T('not_in_it_yet', { count: c.missing.length }) : ''}</span>${over ? `<span class="csrc">${over}</span>` : ''}<span class="csrc">${src}</span><button class="ib" data-act="mgr-merge-menu" data-ci="${i}" ${into && !g.busy ? '' : 'disabled'} title="${T('merge_into')}"><ha-icon icon="mdi:call-merge"></ha-icon></button><button class="ib" data-act="mgr-expand" data-ci="${i}" title="${T('the_pieces', { extra: open ? T('hide') : T('show') })}"><ha-icon icon="${open ? 'mdi:chevron-up' : 'mdi:chevron-down'}"></ha-icon></button>${act}</div>${made || offers ? `<div class="cmerge">${made}${offers}</div>` : ''}${open ? `<div class="cmem">${c.members.map((id) => this._memRow(i, c, id)).join('')}${nr}</div>` : ''}</div>`;
    },

    async _scanFunctions() {
      const g = this._mgr;
      g.scanning = true; g.error = null; g.sel = new Set(); g.expanded = new Set();
      this._renderManager();
      try {
        await this._loadRegistries();
        const ids = this._logicIds();
        const cfgs = await Promise.all(ids.map((e) => this._fetchConfig(e)));
        const an = ids.map((id, i) => (cfgs[i] ? analyze(cfgs[i], id.startsWith('script.'), (x) => this._known(x)) : null));
        await this._resolveTargets(an.flatMap((a) => (a ? a.refs.map((r) => r.ref).filter((r) => TGT_RE.test(r)) : [])));
        const roles = new Map();
        ids.forEach((id, i) => {
          if (!an[i]) return;
          const m = new Map(), put = (ref, role) => { if (ref === id) return; if (!m.has(ref)) m.set(ref, new Set()); m.get(ref).add(role); };
          // an area, floor or label target groups by the entities it covers, not the target itself (2.2)
          an[i].refs.forEach((r) => { if (TGT_RE.test(r.ref)) this._targetEntities(r.ref, r).forEach((e) => put(e, r.role)); else put(r.ref, r.role); });
          roles.set(id, m);
        });
        const cats = await this._catGroups();
        // the Node-RED flows (only while the board reads Node-RED): what they trigger on, check, change and run
        const nr = await this._nodered();
        g.roles = roles; g.catList = cats; g.ids = ids; g.nr = (nr && nr.groups) || [];
        this._mgrRecluster();
      } catch (e) { g.error = (e && (e.message || e.code)) || String(e); g.cands = null; }
      g.scanning = false;
      if (this._mgr === g && !this._$.modal.hidden && this._$.modal.querySelector('.mgr')) this._renderManager();
    },
    _mgrRecluster() {
      const g = this._mgr, ids = g.ids;
      const r = this._cluster(g.roles, g.catList, { nodered: g.nr });
      Object.assign(g, { parts: r.parts, offers: r.offers, joins: new Set(), fixed: new Set(), names: new Map(), drop: new Set(), cands: null, sel: new Set(), expanded: new Set() });
      g.parts.forEach((p) => { p.label = p.fn ? this._fnName(p.fn) : p.name || this._suggestName([...p.ids].filter((id) => this._hass.states[id] || this._entMap.has(id))); });
      this._mgrCands();
      // what ended up in no group and no function (3.2)
      const fset = new Set(this._data.functions), grouped = new Set(g.cands.flatMap((c) => c.members));
      const inFn = (id) => ((this._entMap.get(id) || {}).labels || []).some((l) => fset.has(l));
      g.left = ids.filter((id) => !grouped.has(id) && !inFn(id)).sort((x, y) => this._nameOf(x).localeCompare(this._nameOf(y)));
      const count = (pre) => { const all = ids.filter((x) => x.startsWith(pre)); return [all.length - all.filter((x) => g.left.includes(x)).length, all.length]; };
      g.stats = { automations: ids.filter((x) => x.startsWith('automation.')).length, scripts: ids.filter((x) => x.startsWith('script.')).length, cover: { a: count('automation.'), s: count('script.') } };
    },
    // The import's rows (0.11.0): its parts, merged as the person chose (an offer taken, or Merge into…). Parts that
    // turn out to be one function already are one row. What was ticked, opened or renamed stays with its row.
    _mgrCands() {
      const g = this._mgr, n = g.parts.length, up = [...Array(n).keys()];
      const find = (x) => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
      g.joins.forEach((k) => { const ps = k.split(',').map(Number).filter((p) => p >= 0 && p < n); ps.forEach((p) => { up[find(p)] = find(ps[0]); }); });
      const groups = new Map();
      for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
      const names = new Set(this._data.functions.map((l) => this._fnName(l).toLowerCase()));
      const rows = [...groups.values()].map((ps) => {
        const P = ps.map((i) => g.parts[i]), key = ps.join(','), big = P.slice().sort((x, y) => y.ids.size - x.ids.size);
        let name = g.names.has(key) ? g.names.get(key) : P.length === 1 ? P[0].name || null : null;
        if (name == null && P.length > 1) {
          if (P.every((p) => p.cat && p.cat === P[0].cat)) name = P[0].cat;
          else if (P.length <= 3) name = T('names_and', { list: P.slice(0, -1).map((p) => p.label).join(', '), last: P[P.length - 1].label });
        }
        const c = this._candOf(new Set(P.flatMap((p) => [...p.ids])), { fn: (P.find((p) => p.fn) || {}).fn, name, cat: (big.find((p) => p.cat) || {}).cat, icon: (P.find((p) => p.icon) || {}).icon, source: P.length > 1 ? 'merged' : P[0].source }, names);
        c.keep = new Set([...c.keep].filter((id) => !g.drop.has(id)));
        c.missing = c.missing.filter((id) => !g.drop.has(id));
        const mine = (k) => k.split(',').some((p) => ps.includes(+p));
        return Object.assign(c, { key, parts: ps, nr: P.flatMap((p) => p.nr || []), split: P.some((p) => !p.fn) && [...g.joins].some((k) => !g.fixed.has(k) && mine(k)) });
      });
      // rows that are the same function already made become one
      const seen = new Map();
      let again = false;
      rows.forEach((c) => {
        if (!c.fn) return;
        if (!seen.has(c.fn)) { seen.set(c.fn, c.parts[0]); return; }
        const k = seen.get(c.fn) + ',' + c.parts[0];
        g.joins.add(k); g.fixed.add(k); again = true;
      });
      if (again) return this._mgrCands();
      const list = rows.filter((c) => c.members.length >= 2);
      const order = (c) => (!c.fn ? 0 : c.missing.length ? 1 : 2);
      list.sort((x, y) => order(x) - order(y) || x.parts[0] - y.parts[0]);
      // identity colours only: red, orange, amber and yellow are kept for alarm and warning states
      const SAFE = ['indigo', 'teal', 'purple', 'blue', 'green', 'cyan', 'deep-purple', 'light-blue', 'light-green', 'pink', 'brown', 'blue-grey', 'lime'];
      list.forEach((c) => { c.color = SAFE[c.parts[0] % SAFE.length]; });
      // the offers each row can take: to merge it with the rows of the offer's other parts (never two functions made)
      const rowOf = new Map();
      list.forEach((c, i) => c.parts.forEach((p) => rowOf.set(p, i)));
      list.forEach((c, i) => {
        const sigs = new Set();
        c.offers = [];
        g.offers.forEach((o, k) => {
          if (!o.parts.some((p) => c.parts.includes(p))) return;
          const others = [...new Set(o.parts.map((p) => rowOf.get(p)).filter((r) => r != null && r !== i))].sort((x, y) => x - y);
          if (!others.length || [c].concat(others.map((r) => list[r])).filter((x) => x.fn).length > 1) return;
          const sig = others.join(',');
          if (sigs.has(sig)) return;
          sigs.add(sig);
          c.offers.push({ k, rows: others });
        });
      });
      // what was ticked or opened before: a row with one of those parts
      const had = (set) => { const ps = new Set(); set.forEach((i) => (((g.cands || [])[i] || {}).parts || []).forEach((p) => ps.add(p))); return ps; };
      const sp = had(g.sel), ep = had(g.expanded);
      g.sel = new Set(); g.expanded = new Set();
      list.forEach((c, i) => {
        if (c.parts.some((p) => sp.has(p)) && !(c.fn && !c.missing.length)) g.sel.add(i);
        if (c.parts.some((p) => ep.has(p))) g.expanded.add(i);
      });
      g.cands = list;
      return list;
    },
    // why an offer is made, in words: on the row it's shown on
    _mgrWhy(o) {
      const g = this._mgr, other = o.byPart == null ? '' : ((g.cands || []).find((c) => c.parts.includes(o.parts.find((p) => p !== o.byPart))) || {}).name || '';
      const by = o.byName, via = o.viaName;
      if (o.why === 'switches') return T('tie_switches', { by, via });
      if (o.why === 'uses') return T('tie_uses', { by, via });
      if (o.why === 'reads') return T('tie_reads', { by, via });
      if (o.why === 'starts') return T('tie_starts', { by, via, other });
      if (o.why === 'device') return T('tie_device', { via });
      return T('tie_category', { via });
    },
    // merge rows, or take a row back to its parts; then the row is where focus goes
    _mgrJoin(key, split) {
      const g = this._mgr;
      if (!g || g.busy) return;
      const first = +String(key).split(',')[0];
      if (split) [...g.joins].forEach((k) => { if (!g.fixed.has(k) && k.split(',').some((p) => String(key).split(',').includes(p))) g.joins.delete(k); });
      else g.joins.add(String(key));
      this._mgrCands();
      this._renderManager();
      const i = g.cands.findIndex((c) => c.parts.includes(first));
      const el = i >= 0 && this._$.modal.querySelector(`.cand[data-key="${g.cands[i].key}"] .crow`);
      const to = el && (el.querySelector('input.cname:not([disabled])') || el.querySelector('button'));
      if (to) to.focus();
    },
    _mgrMergeMenu(btn, i) {
      const g = this._mgr, c = g.cands[i];
      if (!c) return;
      const items = g.cands.map((x, j) => ({ x, j })).filter(({ x, j }) => j !== i && !(x.fn && c.fn))
        .map(({ x }) => ({ act: 'mgr-merge-to', data: { a: c.parts[0], b: x.parts[0] }, icon: x.icon, text: x.name }));
      this._menu(btn, items, T('merge_into_2'));
      // the manager is a modal: show the menu above it
      if (this._menuEl) this._menuEl.style.zIndex = 40;
    },
    _pickIcon(members) {
      for (const id of members) {
        if (this._scopeOf(id) !== 'helpers') continue;
        const e = this._entMap.get(id), st = this._hass.states[id], ic = (e && e.icon) || (st && st.attributes.icon);
        if (ic) return ic;
      }
      return 'mdi:puzzle-outline';
    },
    async _mgrImport(list) {
      const g = this._mgr;
      if (!g || g.busy) return;
      g.busy = true;
      this._renderManager();
      const done = [], skipped = [], failed = [];
      for (const i of list) {
        const c = g.cands && g.cands[i];
        if (!c || (c.fn && !c.missing.length)) continue;
        try {
          if (c.fn) {
            const ids = c.missing.filter((id) => c.keep.has(id));
            this._toast(T('adding_to', { count: P('n_pieces', ids.length), name: c.name }));
            const r = await this._labelMany(ids, c.fn, g.cats);
            c.missing = c.missing.filter((id) => !r.done.includes(id));
            skipped.push(...r.skipped);
            done.push(c.fn);
            c.parts.forEach((p) => { g.parts[p].fn = c.fn; }); c.split = false;
          } else {
            const ids = c.members.filter((id) => c.keep.has(id)), name = String(c.name || '').trim();
            if (!ids.length || !name) continue;
            this._toast(T('importing', { name }));
            const r = await this._importGroup(name, c.icon, c.color, ids, g.cats, c.cat);
            c.fn = r.label; c.members = ids; c.keep = new Set(ids); c.missing = r.skipped.map((x) => x.id);
            c.source = 'function';
            c.parts.forEach((p) => { g.parts[p].fn = c.fn; }); c.split = false;
            skipped.push(...r.skipped);
            done.push(c.fn);
          }
        } catch (e) { failed.push(c.name); this._toast(T('could_not_import', { name: c.name, message: e.message || e.code })); }
      }
      g.busy = false; g.sel = new Set();
      // an import lays each function out again (Auto-arrange), leaving only boxes kept in place where they are
      if (done.length) { done.forEach((l) => this._arrangeData(l)); this._save(); }
      await this._loadRegistries();
      this._renderList();
      if (this._$.modal.querySelector('.mgr')) this._renderManager();
      if (done.length) {
        const names = done.map((l) => this._fnName(l));
        const msg = (done.length === 1 ? T('imported_2', { names: names[0] }) : T('imported', { count: P('n_functions', done.length) }))
          + (skipped.length ? T('skipped', { count: P('n_pieces', skipped.length), why: skipped[0].why }) : '')
          + (failed.length ? T('failed', { failed: failed.join(', ') }) : '');
        this._toast(msg, [{ text: T('undo'), fn: () => this._undo() }]);
        if (!this._model) this._open(done[0]);
        else if (done.includes(this._data.ui.current)) this._open(this._data.ui.current, true);
      }
    },

    _mgrLabels() {
      const avail = this._labels.filter((l) => !this._data.functions.includes(l.label_id)).sort((a, b) => a.name.localeCompare(b.name));
      if (!avail.length) return `<div class="muted pad">${T('every_label_is_already_on')}</div>`;
      const count = (lid) => this._ents.filter((e) => (e.labels || []).includes(lid)).length + this._devs.filter((d) => (d.labels || []).includes(lid)).length;
      return `<div class="hint mintro">${T('labels_you_already_use_adding')}</div>${avail.map((l) => `<label class="lrow"><input type="checkbox" data-lsel="${esc(l.label_id)}" ${this._mgr.lsel.has(l.label_id) ? 'checked' : ''}>`
          + `<ha-icon icon="${esc(l.icon || 'mdi:label-outline')}" style="color:${cssColor(l.color)}"></ha-icon><span class="mn"><b>${esc(l.name)}</b>`
          + `<small>${P('n_items', count(l.label_id))}${l.description ? ' · ' + esc(l.description) : ''}</small></span></label>`).join('')}`;
    },
    _mgrLabelsAdd() {
      const g = this._mgr, ids = [...g.lsel].filter((l) => !this._data.functions.includes(l));
      ids.forEach((l) => this._data.functions.push(l));
      g.lsel = new Set();
      this._save(); this._renderList(); this._renderManager();
      if (!ids.length) return;
      this._history({ label: null, text: T('add_as_functions', { count: P('n_labels', ids.length) }), undo: async () => ids.forEach((l) => this._takeOff(l)), redo: async () => { ids.forEach((l) => { if (!this._data.functions.includes(l)) this._data.functions.push(l); }); this._save(); } });
      this._toast(T('added', { count: P('n_functions', ids.length) }), [{ text: T('undo'), fn: () => this._undo() }]);
      if (!this._model) this._open(ids[0]);
    },

    _mgrPick() {
      const g = this._mgr;
      const opts = `${this._data.functions.map((f) => `<option value="${esc(f)}" ${g.target === f ? 'selected' : ''}>${esc(this._fnName(f))}</option>`).join('')}<option value="__new" ${g.target === '__new' ? 'selected' : ''}>${T('new_function')}</option>`;
      return `<div class="ptop"><label>${T('add_to_2')}<select data-ptarget>${opts}</select></label>${g.target === '__new' ? `<label>${T('new_function_name')}<input data-pnew value="${esc(g.newName || '')}" placeholder="${T('e_g_garage_door')}"></label>` : ''}</div><input class="search" placeholder="${T('search_by_name_entity_id')}"><div class="pchips"></div><div class="picks"></div><div class="hint">${T('adding_gives_each_item_the')}</div>`;
    },
    _pickIndex() {
      if (this._pidx && this._pidxAt === this._regAt) return this._pidx;
      const area = (id) => (id && this._areaMap && this._areaMap.get(id) ? this._areaMap.get(id).name : '');
      const devCount = new Map();
      this._ents.forEach((e) => { if (e.device_id && !e.disabled_by) devCount.set(e.device_id, (devCount.get(e.device_id) || 0) + 1); });
      const rows = [];
      for (const e of this._ents) {
        if (e.disabled_by) continue;
        const st = this._hass.states[e.entity_id], dev = e.device_id ? this._devMap.get(e.device_id) : null;
        const devName = dev ? String(dev.name_by_user || dev.name || '') : '';
        const name = String((st && st.attributes.friendly_name) || e.name || e.original_name || e.entity_id);
        const ar = area(e.area_id || (dev && dev.area_id));
        const sc = this._scopeOf(e.entity_id);
        const type = sc === 'automation' ? 'automation' : sc === 'script' ? 'script' : sc === 'helpers' ? 'helpers' : 'entities';
        const lbl = (e.labels || []).map((l) => (this._labelMap.get(l) || {}).name || l);
        rows.push({
          key: e.entity_id, type, tag: this._tagOf(e.entity_id), name, labels: e.labels || [], diag: !!e.entity_category,
          sub: [e.entity_id, ar, devName && devName !== name ? devName : ''].filter(Boolean).join(' · '),
          hay: [name, e.entity_id, ar, devName, e.platform, e.original_name || '', ...lbl].join(' ').toLowerCase(),
        });
      }
      for (const d of this._devs) {
        if (d.disabled_by) continue;
        const name = String(d.name_by_user || d.name || T('device')), ar = area(d.area_id), n = devCount.get(d.id) || 0;
        const model = [d.manufacturer, d.model].filter(Boolean).join(' ');
        const lbl = (d.labels || []).map((l) => (this._labelMap.get(l) || {}).name || l);
        rows.push({
          key: 'device:' + d.id, type: 'devices', tag: T('device'), name, labels: d.labels || [], diag: false,
          sub: [ar, model, P('n_entities', n)].filter(Boolean).join(' · '),
          hay: [name, d.name || '', ar, model, ...lbl].join(' ').toLowerCase(),
        });
      }
      this._pidx = rows; this._pidxAt = this._regAt;
      return rows;
    },
    _renderPicks(q) {
      const g = this._mgr, m = this._$.modal, box = m.querySelector('.picks'), chips = m.querySelector('.pchips');
      if (!box || !g) return;
      if (q != null) g.q = q;
      const target = g.target !== '__new' ? g.target : null;
      const terms = String(g.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      const all = this._pickIndex();
      const match = terms.length ? all.filter((r) => terms.every((t) => r.hay.includes(t))) : all;
      const diagHidden = g.pdiag ? 0 : match.filter((r) => r.diag).length;
      const base = g.pdiag ? match : match.filter((r) => !r.diag);
      const counts = { all: base.length, automation: 0, script: 0, helpers: 0, devices: 0, entities: 0 };
      base.forEach((r) => { counts[r.type]++; });
      const types = [['all', T('all')], ['automation', T('automations')], ['script', T('scripts')], ['helpers', T('helpers')], ['devices', T('devices')], ['entities', T('entities')]];
      if (chips) {
        chips.innerHTML = `${types.map(([k, t]) => `<button class="chip ${g.ptype === k ? 'on' : ''}" data-act="mgr-ptype" data-ptype="${k}">${t}<span>${counts[k].toLocaleString()}</span></button>`).join('')}<button class="chip ${g.ptype === 'selected' ? 'on' : ''}" data-act="mgr-ptype" data-ptype="selected">${T('selected')}<span>${this._pick.size}</span></button><button class="chip" data-act="mgr-pickall" title="${T('tick_everything_currently_listed')}">${T('select_all_shown')}</button><label class="tg2"><input type="checkbox" data-pdiag ${g.pdiag ? 'checked' : ''}>${T('device_settings_and_diagnostics', { extra: diagHidden ? T('hidden', { diagHidden: diagHidden.toLocaleString() }) : '' })}</label>`;
      }
      const RANK = { automation: 0, script: 1, helpers: 2, devices: 3, entities: 4 };
      let rows = g.ptype === 'selected' ? all.filter((r) => this._pick.has(r.key)) : g.ptype === 'all' ? base : base.filter((r) => r.type === g.ptype);
      const score = (r) => {
        if (!terms.length) return 0;
        const n = r.name.toLowerCase();
        return terms.every((t) => n.includes(t)) ? (n.startsWith(terms[0]) ? 0 : 1) : 2;
      };
      rows = rows.map((r) => ({ r, s: score(r) })).sort((x, y) => x.s - y.s || RANK[x.r.type] - RANK[y.r.type] || x.r.name.localeCompare(y.r.name)).map((x) => x.r);
      const shown = rows.slice(0, g.pshow || 200);
      g.pshownKeys = shown.filter((r) => !(target && r.labels.includes(target))).map((r) => r.key);
      const html = shown.map((r) => {
        const inFn = !!target && r.labels.includes(target);
        return `<label class="pick ${inFn ? 'infn' : ''}"><input type="checkbox" data-pick="${esc(r.key)}" ${inFn || this._pick.has(r.key) ? 'checked' : ''} ${inFn ? 'disabled' : ''}>`
          + `<span class="tag">${esc(r.tag)}</span><span class="mn"><b>${esc(r.name)}</b><small>${esc(r.sub)}${inFn ? T('already_in_this_function') : ''}</small></span></label>`;
      }).join('');
      const more = rows.length - shown.length;
      box.innerHTML = (html || `<div class="muted pad">${T('nothing_matches')}</div>`)
        + (more > 0 ? `<button class="more" data-act="mgr-more">${T('show_more_not_shown', { min: Math.min(200, more).toLocaleString(), more: more.toLocaleString() })}</button>` : '');
    },
    async _mgrPickAdd() {
      const g = this._mgr, ids = [...this._pick];
      if (!ids.length || g.busy) return;
      let label = g.target, res;
      g.busy = true;
      try {
        if (label === '__new') {
          const name = String(g.newName || '').trim();
          if (!name) { this._toast(T('give_the_new_function_a')); g.busy = false; return; }
          res = await this._importGroup(name, 'mdi:puzzle-outline', 'indigo', ids, g.cats);
          label = res.label;
        } else {
          res = await this._labelMany(ids, label, true);
        }
      } catch (e) { g.busy = false; this._toast(T('could_not_add', { message: e.message || e.code })); return; }
      g.busy = false;
      this._pick = new Set();
      this._closeModal();
      await this._loadRegistries();
      this._renderList();
      const here = label === this._data.ui.current;
      const msg = T('added_to', { count: P('n_items', res.done.length), fnName: this._fnName(label), extra: res.skipped.length ? T('skipped', { count: P('n_items', res.skipped.length), why: res.skipped[0].why }) : '' });
      const acts = [];
      if (res.done.length) acts.push({ text: T('undo'), fn: () => this._undo() });
      if (!here || !this._model) acts.push({ text: T('go_there'), fn: () => this._open(label) });
      if (!this._model) this._open(label);
      else if (here) this._open(label, true);
      this._toast(msg, acts);
    },

};
