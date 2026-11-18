// Shared helpers for the end-to-end tests. They drive Home Assistant's real frontend with Playwright.
// Setup and environment variables: see README.md in this folder.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FB_HA_URL || 'http://127.0.0.1:8123';
const STATE = process.env.FB_E2E_STATE || path.join(__dirname, '.state');
const SHOTS = path.join(STATE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Tokens are written by apitest.py. The access token lasts 30 minutes from when the file was written; after
// that the frontend gets a new one with the refresh token by itself, so the tests keep working.
function auth(who = 'owner') {
  const file = path.join(STATE, who + '_token.json'), t = JSON.parse(fs.readFileSync(file));
  const born = fs.statSync(file).mtimeMs;
  return { hassUrl: BASE, clientId: BASE + '/', expires: born + t.expires_in * 1000, refresh_token: t.refresh_token, access_token: t.access_token, expires_in: t.expires_in };
}

// Websocket errors that come from Home Assistant's own frontend, not the board.
const NOISE = /^(recorder\/info|lovelace\/config)$/;

// Set by fixtures.js when the suites run under Playwright Test: a check is also a soft expectation, and every
// context records a trace (kept by the fixture when the test fails).
const hooks = { soft: null, trace: false, open: [], traces: [], suite: null };
let traceN = 0;
async function stopTrace(ctx) {
  if (!ctx.__fbTrace) return;
  const file = ctx.__fbTrace; ctx.__fbTrace = null;
  await ctx.tracing.stop({ path: file });
  hooks.traces.push(file);
}

async function session(browser, who = 'owner', opts = {}) {
  const base = opts.mobile ? { ...devices['iPhone 13'] } : { viewport: opts.viewport || { width: 1400, height: 860 }, deviceScaleFactor: opts.scale || 1 };
  const ctx = await browser.newContext(Object.assign(base, { colorScheme: opts.light ? 'light' : 'dark' }));
  if (hooks.trace) {
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    ctx.__fbTrace = path.join(STATE, `trace-${process.pid}-${++traceN}.zip`);
    hooks.open.push(ctx);
    const close = ctx.close.bind(ctx);
    ctx.close = async (...a) => { hooks.open = hooks.open.filter((c) => c !== ctx); await stopTrace(ctx).catch(() => {}); return close(...a); };
  }
  await ctx.addInitScript((a) => { try { if (!localStorage.getItem('hassTokens')) localStorage.setItem('hassTokens', JSON.stringify(a)); } catch (e) {} }, auth(who));
  const page = await ctx.newPage();
  page.logs = [];
  page.sent = [];
  const ids = new Map();
  page.on('websocket', (w) => {
    w.on('framesent', (f) => {
      try { const m = JSON.parse(f.payload); (Array.isArray(m) ? m : [m]).forEach((x) => { if (x.id) ids.set(x.id, x.type); if (x.type) page.sent.push(x); }); } catch (e) {}
    });
    w.on('framereceived', (f) => {
      try {
        const m = JSON.parse(f.payload);
        (Array.isArray(m) ? m : [m]).forEach((x) => {
          if (x.type === 'result' && !x.success && !NOISE.test(ids.get(x.id) || '') && !(page.allowFail || []).some((re) => re.test(ids.get(x.id) || ''))) page.logs.push('WSFAIL ' + ids.get(x.id) + ' ' + JSON.stringify(x.error));
        });
      } catch (e) {}
    });
  });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.logs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => { if (!/^Object$/.test(e.message)) page.logs.push('pageerror: ' + e.message); });
  return { ctx, page };
}

// failures come back as plain objects; turn them into errors that say which call failed and why
const ws = (page, msg) => page.evaluate((m) => document.querySelector('home-assistant').hass.callWS(m).catch((e) => { throw new Error(m.type + ': ' + JSON.stringify(e)); }), msg);
const svc = (page, domain, service, data, target) => page.evaluate(([d, s, x, t]) => document.querySelector('home-assistant').hass.callService(d, s, x, t), [domain, service, data || {}, target || {}]);
const states = (page, ids) => page.evaluate((ids) => Object.fromEntries(ids.map((i) => [i, (document.querySelector('home-assistant').hass.states[i] || {}).state])), ids);
const ready = (page) => page.waitForFunction(() => { const h = document.querySelector('home-assistant'); return h && h.hass && h.hass.connected !== false && h.hass.panels; }, null, { timeout: 30000 });
const fbq = (page, sel) => page.locator('functions-board ' + sel);
const board = (page) => page.locator('functions-board').first();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until fn() is truthy, polling; returns the last value.
async function until(fn, ms = 5000, step = 100) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(step); }
  return v;
}

// A suite's checks, counted and written as JUnit (tests/.results/e2e-<name>.xml, or $FB_RESULTS) for run.sh.
// A suite that crashes before done() leaves no report, and run.sh counts that as a failure.
const RESULTS = process.env.FB_RESULTS || path.join(__dirname, '..', '.results');
function suite(name) {
  const results = [];
  let last = Date.now();
  const check = (n, ok, detail) => {
    const d = !ok && detail !== undefined ? (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '';
    const r = { name: n, ok: !!ok, detail: d, ms: Date.now() - last };
    results.push(r);
    // kept as it happens: Playwright starts a new worker after a failed test, and that worker's done() must still
    // report the checks made before it
    try { fs.mkdirSync(RESULTS, { recursive: true }); fs.appendFileSync(path.join(RESULTS, 'e2e-' + name + '.jsonl'), JSON.stringify(r) + '\n'); } catch (e) { /* the report is best effort here */ }
    last = Date.now();
    console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  -- ' + d : ''));
    if (hooks.soft) { try { hooks.soft(!!ok, n + (d ? '  -- ' + d : '')); } catch (e) { /* outside a test */ } }
    return !!ok;
  };
  const done = () => {
    let all = results;
    try { all = fs.readFileSync(path.join(RESULTS, 'e2e-' + name + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { /* only this process's */ }
    const bad = all.filter((r) => !r.ok).map((r) => r.name);
    console.log(`\n${name}: ${all.length - bad.length}/${all.length} passed` + (bad.length ? ': failed ' + bad.join(', ') : ''));
    require('../lib/junit').write(path.join(RESULTS, 'e2e-' + name + '.xml'), name, all);
    process.exitCode = bad.length ? 1 : 0;
  };
  const me = { check, done, results };
  hooks.suite = me;
  return me;
}

// Remove everything the board and earlier runs created: labels, categories, board data, test dashboards.
async function reset(page) {
  for (const l of await ws(page, { type: 'config/label_registry/list' })) await ws(page, { type: 'config/label_registry/delete', label_id: l.label_id });
  for (const scope of ['automation', 'script', 'helpers']) {
    for (const c of await ws(page, { type: 'config/category_registry/list', scope })) await ws(page, { type: 'config/category_registry/delete', scope, category_id: c.category_id });
  }
  await ws(page, { type: 'functions_board/set', data: {} });
  await ws(page, { type: 'frontend/set_user_data', key: 'functions_board', value: null });
  await ws(page, { type: 'frontend/set_user_data', key: 'functions_board_ui', value: null });
  for (const d of (await ws(page, { type: 'lovelace/dashboards/list' })).filter((x) => /^fb-/.test(x.url_path))) await ws(page, { type: 'lovelace/dashboards/delete', dashboard_id: d.id });
  for (const r of await ws(page, { type: 'lovelace/resources' })) if (/functions/.test(r.url)) await ws(page, { type: 'lovelace/resources/delete', resource_id: r.id });
}

// Open a fresh owner page on the Home Assistant root, reset, then go to the board.
async function freshBoard(browser, opts = {}) {
  const s = await session(browser, 'owner', opts);
  await s.page.goto(BASE + '/');
  await ready(s.page);
  if (opts.reset !== false) await reset(s.page);
  return s;
}

// Import every group the manager detects (as a first-time user would), then close the manager.
async function importAll(page) {
  await page.goto(BASE + '/functions');
  await fbq(page, '.empty.wel [data-act="import"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  await fbq(page, '.modal [data-act="mgr-selall"]').click();
  await fbq(page, '.modal [data-act="mgr-import-sel"]').click();
  await until(async () => (await board(page).evaluate((el) => !(el._mgr && el._mgr.busy) && (el._data.functions || []).length)), 15000);
  await page.waitForTimeout(800);
  await fbq(page, '.modal [data-act="modal-cancel"]').first().click().catch(() => {});
  await page.waitForTimeout(500);
}

// Open a function by its label's name (regex) and wait for its boxes.
async function openFn(page, re) {
  const labels = await ws(page, { type: 'config/label_registry/list' });
  const l = labels.find((x) => re.test(x.name));
  if (!l) throw new Error('no label matching ' + re);
  await board(page).evaluate((el, id) => el._open(id), l.label_id);
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  return l.label_id;
}

module.exports = { hooks, stopTrace, chromium, BASE, STATE, SHOTS, auth, session, ws, svc, states, ready, fbq, board, sleep, until, suite, reset, freshBoard, importAll, openFn };
