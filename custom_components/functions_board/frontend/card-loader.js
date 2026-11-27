// Lazy loader for the Functions Board dashboard card (CONF_CARD).
// Registered via frontend.add_extra_js_url() under /functions_board_static/<digest>/ so non-admin
// users and dashboards without the card never download or parse the full board modules.
const BOARD_URL = './functions-board.js';
const HOST_STYLE = '<style>:host{display:block}</style>';
const PROPS = ['panel', 'narrow', 'route', 'isPanel', 'layout'];

let loading = null;
const waiters = new Set();

function mountReal(el) {
  if (el._inner || !customElements.get('functions-board-app')) return;
  const inner = document.createElement('functions-board-app');
  inner.style.cssText = 'display:block;width:100%;height:100%';
  el._inner = inner;
  el.shadowRoot.innerHTML = HOST_STYLE;
  el.shadowRoot.appendChild(inner);
  if (el._cfg !== undefined && typeof inner.setConfig === 'function') inner.setConfig(el._cfg);
  for (const k of PROPS) if (el._p[k] !== undefined) inner[k] = el._p[k];
  if (el._hass !== undefined) inner.hass = el._hass;
}

function ensureBoard(el) {
  if (customElements.get('functions-board-app')) { mountReal(el); return; }
  waiters.add(el);
  if (!loading) {
    loading = import(BOARD_URL).catch((err) => {
      loading = null;
      console.error('Functions Board: failed to load board modules', err);
    });
  }
}

if (!customElements.get('functions-board')) {
  class FunctionsBoardLoader extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._p = {};
    }
    static getStubConfig() { return {}; }
    setConfig(cfg) {
      this._cfg = cfg;
      if (this._inner && typeof this._inner.setConfig === 'function') this._inner.setConfig(cfg);
    }
    getCardSize() { return this._inner && typeof this._inner.getCardSize === 'function' ? this._inner.getCardSize() : 12; }
    getGridOptions() { return this._inner && typeof this._inner.getGridOptions === 'function' ? this._inner.getGridOptions() : { columns: 'full' }; }
    get hass() { return this._inner ? this._inner.hass : this._hass; }
    set hass(h) {
      this._hass = h;
      if (this._inner) { this._inner.hass = h; return; }
      if (!h || !h.user) return;
      if (!h.user.is_admin) {
        if (!this._denied) {
          this._denied = true;
          this.shadowRoot.innerHTML = HOST_STYLE + '<div style="padding:16px;font:14px/1.4 system-ui,sans-serif;color:var(--secondary-text-color,#666)">Functions Board is for Home Assistant administrators only.</div>';
        }
        return;
      }
      ensureBoard(this);
    }
    connectedCallback() {
      if (!this._inner && this._hass && this._hass.user && this._hass.user.is_admin) ensureBoard(this);
    }
    disconnectedCallback() { waiters.delete(this); }
  }
  for (const k of PROPS) {
    Object.defineProperty(FunctionsBoardLoader.prototype, k, {
      get() { return this._inner ? this._inner[k] : this._p[k]; },
      set(v) { this._p[k] = v; if (this._inner) this._inner[k] = v; },
    });
  }
  FunctionsBoardLoader.__fbLoader = true;
  FunctionsBoardLoader.__fbReady = (App) => {
    if (App) {
      FunctionsBoardLoader.VERSION = App.VERSION;
      FunctionsBoardLoader.STR = App.STR;
      FunctionsBoardLoader.morph = App.morph;
    }
    for (const el of waiters) mountReal(el);
    waiters.clear();
  };
  customElements.define('functions-board', FunctionsBoardLoader);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c && c.type === 'functions-board')) {
    window.customCards.push({
      type: 'functions-board',
      name: 'Functions Board',
      description: 'Whiteboard of the automations, scripts, helpers and devices that make a function work.',
    });
  }
}
