import { NH, NW, ROLE_RANK, SAME_ORIGIN, T, nrGroups, toList } from '../lib/index.js';

export const noderedPart = {
    /* ======================================================================================================
       part: nodered: Node-RED flows: read through its page here, kept for every board Owns _nrCache, _nrWait (PARTS):
       only its own methods use them; the other parts ask its methods.
       ====================================================================================================== */

    /* ---------- Node-RED flows (2.7, decision D1): read in the browser through the Node-RED app's own page, only
       while the switch in the Key is on. That page answers only once Home Assistant has let this browser in, which
       it does when Node-RED is opened from its sidebar (the board never asks for that itself). Until then, the
       flows last read by any board, kept by the integration (functions_board/nodered), stand in, marked with when
       they were read. What's kept is the summary nrGroups makes: names and entity ids, no flow code. ---------- */
    // forget the flows read (switched off or on: read again when asked)
    // the Node-RED switch is yours, for every function: off means no request to Node-RED at all
    _nrChange(t) {
      if (!t.hasAttribute || !t.hasAttribute('data-nr')) return false;
      this._data.ui.nodered = t.checked; this._save(); this._nrForget();
      if (this._model) this._open(this._model.label, true).then(() => this._renderLegend()); else this._renderLegend();
      return true;
    },
    _nrForget() { this._nrCache = null; },
    // another board read Node-RED: one showing older flows takes the new ones (only with Node-RED switched on)
    _nrTheirs() { if (this._data.ui.nodered === true && this._nrCache && this._nrCache.need && this._model) { this._nrCache = null; this._open(this._model.label, true).then(() => this._renderLegend()); } },
    // back from Node-RED's page (opened to let it in): read the flows again
    _nrBack() { if (this._nrWait) { this._nrWait = false; this._nrCache = null; if (this._model) this._open(this._model.label, true).then(() => this._renderLegend()); } },
    // what the Key says of Node-RED: the last read's error, and whether it needs its page opened first
    _nrState() { return this._nrCache || null; },
    async _nodered() {
      if (this._data.ui.nodered !== true) return null;
      const c = this._nrCache;
      if (c && Date.now() - c.at < (c.need ? 5000 : 60000)) return c;
      if (this._nrLoading) return this._nrLoading;
      const done = (x) => { this._nrCache = Object.assign({ at: Date.now(), groups: [] }, x); return this._nrCache; };
      this._nrLoading = (async () => {
        try {
          const r = await this._ws({ type: 'supervisor/api', endpoint: '/addons', method: 'get' }, { optional: 'only a Home Assistant run by the Supervisor answers this', fallback: null });
          if (!r) return done({ err: T('this_home_assistant_has_no') });
          const app = toList(r.addons).find((a) => a && /nodered/i.test(String(a.slug)));
          if (!app) return done({ err: T('no_node_red_app_is') });
          if (app.state !== 'started') return done({ err: T('the_node_red_app_isn') });
          const info = await this._ws({ type: 'supervisor/api', endpoint: `/addons/${app.slug}/info`, method: 'get' });
          const base = info && info.ingress_url;
          // a path on this Home Assistant (/api/hassio_ingress/…/), never another address: the only fetch the board makes
          if (!base || !SAME_ORIGIN.test(base)) return done({ err: T('the_node_red_app_has') });
          // through the app's page in Home Assistant, as opening Node-RED from the sidebar does
          const res = await this._ha.call('Node-RED flows', () => fetch(base + 'flows', { credentials: 'same-origin', headers: { 'Node-RED-API-Version': 'v2' } }), { fallback: null });
          if (!res || res.status === 401 || res.status === 403) {
            // not let in (yet, or any more): the flows last read here, if any, until Node-RED is opened
            const kept = await this._ws({ type: 'functions_board/nodered' }, { fallback: null }).then((x) => x && x.kept);
            const ok = kept && kept.slug === app.slug && Array.isArray(kept.groups) ? kept : null;
            const when = ok ? new Date(ok.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
            return done({ base, slug: app.slug, need: true, groups: ok ? ok.groups : [], asOf: ok ? ok.at : null,
              err: ok ? T('node_red_flows_as_of', { when }) : T('open_node_red_once_so_the') });
          }
          if (!res.ok) return done({ slug: app.slug, err: T('node_red_answered', { status: res.status }) });
          const body = await res.json(), flows = Array.isArray(body) ? body : (body && body.flows) || [];
          const groups = nrGroups(flows, (x) => this._known(x));
          this._ws({ type: 'functions_board/nodered_keep', slug: app.slug, groups, client: this._client() }, { fallback: null });  // (shown here, just not kept)
          return done({ base, slug: app.slug, groups });
        } catch (e) { return done({ err: T('could_not_read_the_flows', { e: (e && (e.message || e.code)) || e }) }); }
        finally { this._nrLoading = null; }
      })();
      return this._nrLoading;
    },
    // Node-RED through Home Assistant's own page for it (which lets this browser in); on closing it, the flows
    // are read again
    _openNodeRed(sub, title) {
      const c = this._nrCache;
      if (!c || !c.slug) return;
      this._nrWait = true;
      this._openDrawer(c.need || !c.base ? `/hassio/ingress/${c.slug}` : c.base + (sub || ''), title || T('node_red'));
    },
    // the flows that trigger on, read, change or run a piece of the function: boxes wired to those pieces
    async _nrNodes(nodes, edges) {
      if (this._data.ui.nodered !== true) return;
      const nr = await this._nodered();
      if (!nr || !nr.groups.length) return;
      const member = (k) => { const n = nodes.get(k); return n && n.kind === 'member'; };
      const used = new Set();
      nr.groups.forEach((g) => {
        const links = [];
        g.trig.forEach((x) => { if (member(x)) links.push([x, 'trigger']); });
        g.read.forEach((x) => { if (member(x)) links.push([x, 'condition']); });
        g.change.forEach((x) => { if (member(x)) links.push([x, 'action']); });
        g.calls.forEach((x) => { if (member(x)) links.push([x, 'call']); });
        if (!links.length) return;
        const key = 'nr:' + g.id;
        g.events.forEach((t) => { if (nodes.has('event:' + t)) links.push(['event:' + t, 'trigger']); });
        nodes.set(key, { key, kind: 'nodered', domain: 'nodered', name: g.name, icon: 'mdi:sitemap', badges: new Set(), writers: 0, x: 0, y: 0, w: NW, h: NH,
          nr: { tabLabel: g.tabLabel, size: g.size, sub: '#flow/' + encodeURIComponent(g.tab), off: !!g.off } });
        links.forEach(([k, role]) => {
          used.add(k);
          const inbound = role === 'trigger' || role === 'condition', from = inbound ? k : key, to = inbound ? key : k, id = from + '>' + to;
          const e = edges.find((x) => x.id === id);
          if (e) { if (ROLE_RANK[role] > ROLE_RANK[e.role]) e.role = role; return; }
          edges.push({ id, from, to, role, svcs: new Set(), tfs: [], anyTrig: role === 'trigger', via: null, loop: false });
        });
      });
      // a piece a flow uses is no unused piece (4.6)
      used.forEach((k) => { const n = nodes.get(k); if (n) n.unref = false; });
    },

};
