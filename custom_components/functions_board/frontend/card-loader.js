// Lazy loader for the Functions Board dashboard card (CONF_CARD).
// Registered via frontend.add_extra_js_url() under /functions_board_static/<digest>/ so non-admin
// users and dashboards without the card never download or parse the full board modules.
const BOARD_URL = './functions-board.js';

let loading = null;
const waiters = new Set();

function mountReal(el) {
  if (el._inner || !customElements.get('functions-board-app')) return;
  const inner = document.createElement('functions-board-app');
  inner.style.cssText = 'display:block;width:100%;height:100%';
  el._inner = inner;
  el.shadowRoot.innerHTML = '';
  el.shadowRoot.appendChild(inner);
  if (el._cfg !== undefined && typeof inner.setConfig === 'function') inner.setConfig(el._cfg);
  if (el._panel !== undefined) inner.panel = el._panel;
  if (el._narrow !== undefined) inner.narrow = el._narrow;
  if (el._route !== undefined) inner.route = el._route;
  if (el._hass !== undefined) inner.hass = el._hass;
}

if (!customElements.get('functions-board')) {
  class FunctionsBoardLoader extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.style.display = 'block';
    }
    setConfig(cfg) {
      this._cfg = cfg;
      if (this._inner && typeof this._inner.setConfig === 'function') this._inner.setConfig(cfg);
    }
    getCardSize() { return this._inner && typeof this._inner.getCardSize === 'function' ? this._inner.getCardSize() : 6; }
    set panel(v) { this._panel = v; if (this._inner) this._inner.panel = v; }
    set narrow(v) { this._narrow = v; if (this._inner) this._inner.narrow = v; }
    set route(v) { this._route = v; if (this._inner) this._inner.route = v; }
    set hass(h) {
      this._hass = h;
      if (this._inner) { this._inner.hass = h; return; }
      if (!h || !h.user) return;
      if (!h.user.is_admin) {
        if (!this._denied) {
          this._denied = true;
          this.shadowRoot.innerHTML = '<div style="padding:16px;font:14px/1.4 system-ui,sans-serif;color:var(--secondary-text-color,#666)">Functions Board is for Home Assistant administrators only.</div>';
        }
        return;
      }
      if (customElements.get('functions-board-app')) { mountReal(this); return; }
      waiters.add(this);
      if (!loading) loading = import(BOARD_URL).catch(() => { loading = null; });
    }
    disconnectedCallback() { waiters.delete(this); }
  }
  FunctionsBoardLoader.__fbLoader = true;
  FunctionsBoardLoader.__fbReady = () => {
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
