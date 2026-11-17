// One check per fixed bug and per new board behaviour, on the real test Home Assistant.
// Run apitest.py first (tokens). node regress.test.js [filter]   (filter: run only cases whose name matches)
const path = require('path');
const { chromium, BASE, SHOTS, session, ws, svc, states, ready, fbq, board, until, suite, reset, importAll, openFn, sleep } = require('./lib');
const { check, done } = suite('regress');
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const { routeCheck } = require('./routecheck');
const { hopCheck } = require('./hopcheck');
const GARAGE = ['automation.garage_start_open_timer', 'automation.garage_left_open', 'automation.garage_closed_stop_timer'];

// a fresh owner board with every detected group imported; returns { ctx, page }
async function imported(browser, opts) {
  const s = await session(browser, 'owner', opts);
  await s.page.goto(BASE + '/');
  await ready(s.page);
  await reset(s.page);
  await importAll(s.page);
  return s;
}
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const store = async (page) => (await ws(page, { type: 'functions_board/get' })).data;
const regEntry = (page, id) => ws(page, { type: 'config/entity_registry/get', entity_id: id });
// the registry entry once the entity exists (asking for a missing one would count as a websocket error)
const regWhenThere = async (page, id) => ((await page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], id)) ? regEntry(page, id).catch(() => null) : null);
const hasLabel = async (page, id, label) => { const r = await regWhenThere(page, id); return !!r && (r.labels || []).includes(label); };
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b).catch((e) => { throw new Error(m + ' ' + p + ': ' + JSON.stringify(e)); }), [method, p, body]);
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('1.1 Resume leaves off what was off before Pause', async (browser) => {
  const { ctx, page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  await svc(page, 'automation', 'turn_on', {}, { entity_id: GARAGE });
  await svc(page, 'automation', 'turn_off', {}, { entity_id: GARAGE[2] });
  await page.waitForTimeout(1500);
  const pause = fbq(page, '[data-act="pause"]');
  await pause.click(); await page.waitForTimeout(250); await pause.click();
  await until(async () => Object.values(await states(page, GARAGE)).every((x) => x === 'off'), 5000);
  await until(async () => ((await store(page)).layouts[lid] || {}).paused, 4000);
  const L = (await store(page)).layouts[lid];
  check('1.1 Pause saves the list of what was on', L && JSON.stringify((L.paused || []).sort()) === JSON.stringify(GARAGE.slice(0, 2).sort()), L && L.paused);
  check('1.1 button says Resume while paused', /Resume/.test(await pause.textContent()));
  await svc(page, 'automation', 'turn_on', {}, { entity_id: GARAGE[0] });  // someone turns one back on by hand
  await page.waitForTimeout(1500);
  check('1.1 still Resume after one is switched on by hand', /Resume/.test(await pause.textContent()));
  await pause.click(); await page.waitForTimeout(250); await pause.click();
  await page.waitForTimeout(2500);
  const st = await states(page, GARAGE);
  check('1.1 Resume turns on only those it turned off', st[GARAGE[0]] === 'on' && st[GARAGE[1]] === 'on' && st[GARAGE[2]] === 'off', st);
  check('1.1 paused list cleared after Resume', !((await store(page)).layouts[lid] || {}).paused);
  await fbq(page, '[data-act="undo"]').click();
  await until(async () => (await states(page, GARAGE))[GARAGE[1]] === 'off', 5000);
  await until(async () => ((await store(page)).layouts[lid] || {}).paused, 4000);
  check('1.1 Undo of Resume pauses again', (await states(page, GARAGE))[GARAGE[1]] === 'off' && !!((await store(page)).layouts[lid] || {}).paused);
  await svc(page, 'automation', 'turn_on', {}, { entity_id: GARAGE });
  check('1.1 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('1.2 leaving the page on a phone stops the board', async (browser) => {
  const { ctx, page } = await session(browser, 'owner', { mobile: true });
  await page.goto(BASE + '/functions');
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const before = await el(page, (b) => {
    window.__fb = b; window.__fitsDetached = 0;
    const P = Object.getPrototypeOf(b), orig = P._fit;
    P._fit = function () { if (!this.isConnected) window.__fitsDetached++; return orig.apply(this, arguments); };
    return b._compact;
  });
  await page.evaluate(() => { history.pushState(null, '', '/config/info'); window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } })); });
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => ({ connected: window.__fb.isConnected, compact: window.__fb._compact, detached: window.__fitsDetached }));
  check('1.2 no fit() calls on the detached board', !r.connected && r.detached === 0, r);
  check('1.2 compact mode unchanged after leaving', r.compact === before, r);
  await ctx.close();
});

test('3.1 import skips a piece without a unique ID and still finishes', async (browser) => {
  const { ctx, page } = await session(browser, 'owner');
  await page.goto(BASE + '/');
  await ready(page);
  await reset(page);
  await svc(page, 'automation', 'reload');
  await page.goto(BASE + '/functions');
  await fbq(page, '.empty.wel [data-act="import"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  const g = await el(page, (b) => { const c = b._mgr.cands.find((x) => x.members.includes('automation.garage_restart_timer_when_reopened')); return c && { name: c.name, i: b._mgr.cands.indexOf(c), kept: c.keep.has('automation.garage_restart_timer_when_reopened'), n: c.members.length }; });
  check('3.1 the id-less automation is in the Garage group but not ticked', g && !g.kept, g);
  if (g) {
    await fbq(page, `.modal [data-act="mgr-expand"][data-ci="${g.i}"]`).click();
    const row = await fbq(page, '.modal .mrow.nolab').first().innerText().catch(() => '');
    check('3.1 the row says why it cannot be added', /no unique ID/.test(row), row);
  }
  await fbq(page, '.modal [data-act="mgr-selall"]').click();
  await fbq(page, '.modal [data-act="mgr-import-sel"]').click();
  await until(() => el(page, (b) => !b._mgr.busy && b._data.functions.length >= 3), 15000);
  await page.waitForTimeout(500);
  const toast = await fbq(page, '.toast').innerText().catch(() => '');
  const fns = await el(page, (b) => b._data.functions.map((l) => b._fnName(l)));
  check('3.1 every group is on the board', fns.some((n) => /garage/i.test(n)) && fns.length >= 3, fns);
  check('3.1 one toast, no failure', /Imported/.test(toast) && !/Could not|failed/.test(toast), toast);
  const lab = (await ws(page, { type: 'config/label_registry/list' })).find((l) => /garage/i.test(l.name));
  const ents = await ws(page, { type: 'config/entity_registry/list' });
  check('3.1 the labellable garage pieces carry the label', ents.filter((e) => (e.labels || []).includes(lab.label_id)).length === g.n - 1, ents.filter((e) => (e.labels || []).includes(lab.label_id)).map((e) => e.entity_id));
  check('3.1 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('1.7 a running script keeps its box layout', async (browser) => {
  const { ctx, page } = await imported(browser);
  await svc(page, 'script', 'reload');
  await until(async () => (await ws(page, { type: 'config/entity_registry/get', entity_id: 'script.slow_demo' }).catch(() => null)), 8000);
  const lid = await openFn(page, /garage/i);
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'script.slow_demo', labels: [lid] });
  await until(() => el(page, (b) => b._model && b._model.nodes.has('script.slow_demo')), 8000);
  await page.waitForTimeout(500);
  await svc(page, 'script', 'turn_on', {}, { entity_id: 'script.slow_demo' });
  await until(() => el(page, (b) => { const n = b.shadowRoot.querySelector('.node[data-key="script.slow_demo"]'); return n && n.classList.contains('running'); }), 6000);
  const r = await el(page, (b) => { const n = b.shadowRoot.querySelector('.node[data-key="script.slow_demo"]'); const cs = getComputedStyle(n); return { cls: n.className, display: cs.display, w: n.getBoundingClientRect().width / b._view.k, bg: cs.backgroundColor }; });
  check('1.7 box marked running', /\brunning\b/.test(r.cls) && !/\brun\b/.test(r.cls), r.cls);
  check('1.7 box stays a flex box of its own width with a background', r.display === 'flex' && Math.abs(r.w - 240) < 2 && r.bg !== 'rgba(0, 0, 0, 0)', r);
  await page.screenshot({ path: path.join(SHOTS, 'r-running.png') });
  await svc(page, 'script', 'turn_off', {}, { entity_id: 'script.slow_demo' });
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'script.slow_demo', labels: [] });
  await ctx.close();
});

test('1.8 Existing adds to the function on screen', async (browser) => {
  const { ctx, page } = await imported(browser);
  const a = await openFn(page, /filter/i);
  await fbq(page, '.list [data-act="import"]').first().click();     // the manager opened on function A...
  await page.waitForTimeout(800);
  await fbq(page, '.modal [data-act="modal-cancel"]').first().click();
  const b = await openFn(page, /garage/i);                           // ...then the user moves to B
  await fbq(page, '[data-act="add-existing"]').click();
  await fbq(page, '.modal .search').fill('vacation');
  await page.waitForTimeout(400);
  await fbq(page, '.modal [data-pick="input_boolean.vacation_mode"]').check();
  const btn = await fbq(page, '.modal [data-act="mgr-pick-add"]').innerText();
  check('1.8 the Add button names the target function', /Add 1 item to Garage/i.test(btn), btn);
  await fbq(page, '.modal [data-act="mgr-pick-add"]').click();
  await page.waitForTimeout(1500);
  const e = await regEntry(page, 'input_boolean.vacation_mode');
  check('1.8 the item gets B\'s label, not A\'s', e.labels.includes(b) && !e.labels.includes(a), e.labels);
  check('1.8 B stays open', (await el(page, (x) => x._data.ui.current)) === b);
  await fbq(page, '[data-act="undo"]').click();
  await page.waitForTimeout(1200);
  check('1.8 Undo takes the label off again', !(await regEntry(page, 'input_boolean.vacation_mode')).labels.includes(b));
  check('1.8 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('1.9 an item made in the drawer keeps its label after the editor saves', async (browser) => {
  const { ctx, page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  await el(page, (b) => b._create('automation'));
  const id = 'fbtest' + Date.now();
  await api(page, 'POST', 'config/automation/config/' + id, { alias: 'Garage: test capture', triggers: [{ trigger: 'state', entity_id: 'input_boolean.garage_auto_close', to: 'on' }], actions: [{ action: 'persistent_notification.create', data: { message: 'x' } }] });
  const ent = 'automation.garage_test_capture';
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], ent), 8000);
  await until(async () => ((await regEntry(page, ent)).labels || []).includes(lid), 8000);
  // what Home Assistant's editor does right after saving a new automation: write the save dialog's fields
  await ws(page, { type: 'config/entity_registry/update', entity_id: ent, labels: [], categories: { automation: null }, area_id: null });
  await page.waitForTimeout(2500);
  const e = await regEntry(page, ent);
  check('1.9 label put back after the save dialog wiped it', (e.labels || []).includes(lid), e.labels);
  const L = (await store(page)).layouts[lid] || {};
  check('1.9 category put back when the dialog left it empty', !L.categories || !L.categories.automation || (e.categories || {}).automation === L.categories.automation, [e.categories, L.categories]);
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), ent), 6000);
  check('1.9 new box on the board', await el(page, (b, k) => b._model.nodes.has(k), ent));
  await fbq(page, '.drawer [data-act="close"]').click();
  await api(page, 'DELETE', 'config/automation/config/' + id);
  check('1.9 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('1.10 saving an automation redraws its arrows', async (browser) => {
  const { ctx, page } = await imported(browser);
  await openFn(page, /garage/i);
  const id = '2003', ent = 'automation.garage_closed_stop_timer';
  const orig = await api(page, 'GET', 'config/automation/config/' + id);
  const has = () => el(page, (b, k) => b._model.edges.some((e) => e.from === k && e.to === 'input_boolean.garage_auto_close'), ent);
  check('1.10 no arrow to start with', !(await has()));
  const cfg = JSON.parse(JSON.stringify(orig));
  cfg.actions = cfg.actions.concat([{ action: 'input_boolean.turn_off', target: { entity_id: 'input_boolean.garage_auto_close' } }]);
  const t0 = Date.now();
  await api(page, 'POST', 'config/automation/config/' + id, cfg);
  const ok = await until(has, 4000, 100);
  check('1.10 new arrow appears without reloading the page', ok, Date.now() - t0 + ' ms');
  check('1.10 within 2 seconds', ok && Date.now() - t0 < 2500, Date.now() - t0 + ' ms');
  await api(page, 'POST', 'config/automation/config/' + id, orig);
  check('1.10 arrow goes when the change is undone', await until(async () => !(await has()), 4000));
  check('1.10 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('1.11 hiding is not deleting, and the name check brings it back', async (browser) => {
  const { ctx, page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  const L0 = (await store(page)).layouts[lid];
  await ws(page, { type: 'functions_board/set', data: Object.assign(await store(page), { layouts: Object.assign((await store(page)).layouts, { [lid]: Object.assign(L0 || {}, { nodes: { 'automation.garage_left_open': { x: 777, y: 55 } } }) }) }) });
  await page.reload();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await openFn(page, /garage/i);
  await fbq(page, '.title [data-act="fn-menu"]').click();
  const hide = fbq(page, '.menu [data-act="fnm-hide"]');
  check('1.11 the menu says Hide from board, apart from Delete', /Hide from board/.test(await hide.innerText()) && (await fbq(page, '.menu [data-act="fnm-del"]').count()) === 1);
  await hide.click();
  await page.waitForTimeout(800);
  const fns = await el(page, (b) => b._data.functions);
  check('1.11 hidden from the list, label kept', !fns.includes(lid) && (await ws(page, { type: 'config/label_registry/list' })).some((l) => l.label_id === lid));
  await fbq(page, '.list [data-act="newfn"]').click();
  await fbq(page, '.modal input[name=name]').fill('garage');
  await fbq(page, '.modal [data-act="modal-save"]').click();
  await page.waitForTimeout(400);
  const clash = await fbq(page, '.modal .clash').innerText().catch(() => '');
  check('1.11 a taken name is explained', /already exists/.test(clash) && /Put it back/.test(clash), clash);
  await fbq(page, '.modal [data-act="fn-restore"]').click();
  await page.waitForTimeout(1500);
  const back = await el(page, (b) => ({ fns: b._data.functions, cur: b._data.ui.current, x: (b._model && b._model.nodes.get('automation.garage_left_open') || {}).x }));
  check('1.11 Put it back restores the function with its layout', back.fns.includes(lid) && back.cur === lid && back.x === 777, back);
  check('1.11 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('4.1 Fit shows everything on a second press; the action bar stays on screen', async (browser) => {
  const { ctx, page } = await imported(browser, { viewport: { width: 760, height: 560 } });
  await openFn(page, /morning/i);
  await el(page, (b) => { b._view.k = 1; b._fit(); });
  const k1 = await el(page, (b) => b._view.k);
  await fbq(page, '[data-act="fit"]').click();
  const k2 = await el(page, (b) => b._view.k);
  await fbq(page, '[data-act="fit"]').click();
  const k3 = await el(page, (b) => b._view.k);
  check('4.1 readable fit, then everything, then readable again', k1 >= 0.6 && k2 < k1 && k2 >= 0.25 && Math.abs(k3 - k1) < 0.01, [k1, k2, k3]);
  const r = await el(page, (b) => {
    const keys = [...b._els.keys()], vp = b._$.vp.getBoundingClientRect();
    const far = keys.map((k) => [k, b._els.get(k).getBoundingClientRect()]).sort((x, y) => y[1].right - x[1].right)[0][0];
    b._view.x += vp.width - (b._model.nodes.get(far).x * b._view.k + b._view.x) - 30; b._applyView();
    b._select(far);
    const bar = b._$.nodebar.getBoundingClientRect();
    return { barRight: bar.right, vpRight: vp.right, barTop: bar.top, vpTop: vp.top };
  });
  check('4.1 the action bar is clamped inside the board', r.barRight <= r.vpRight + 1 && r.barTop >= r.vpTop - 1, r);
  await ctx.close();
});

test('8.1 Helper offers the types and opens the create dialog directly', async (browser) => {
  const { ctx, page } = await imported(browser);
  await openFn(page, /garage/i);
  await fbq(page, '[data-act="new-helper"]').click();
  const items = await page.locator('functions-board .menu .mi').allInnerTexts();
  check('8.1 menu lists the helper types and Scene', ['Toggle', 'Number', 'Counter', 'Timer', 'Schedule', 'Scene'].every((t) => items.includes(t)), items);
  await fbq(page, '.menu [data-act="mk-more"]').click();
  await until(async () => (await page.locator('functions-board .menu .mi').count()) > 3, 6000);
  const more = await page.locator('functions-board .menu .mi').allInnerTexts();
  check('8.1 More lists helpers from integrations', more.some((t) => /Template/.test(t)) && more.some((t) => /Group/.test(t)), more.slice(0, 12));
  await fbq(page, '.menu [data-act="mk-back"]').click();
  await fbq(page, '.menu [data-domain="input_boolean"]').click();
  const src = await fbq(page, '.drawer iframe').getAttribute('src');
  check('8.1 Toggle opens /config/helpers/add?domain=input_boolean', /\/config\/helpers\/add\?domain=input_boolean$/.test(src), src);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(SHOTS, 'r-helper-toggle.png') });
  const dlg = await page.frameLocator('functions-board .drawer iframe').locator('dialog-helper-detail').count().catch(() => -1);
  check('8.1 the helper create dialog is open in the drawer', dlg > 0, dlg);
  await fbq(page, '.drawer [data-act="close"]').click();
  check('8.1 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('8.3 undo and redo for moves and frames', async (browser) => {
  const { ctx, page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  const key = 'automation.garage_left_open';
  const box = await fbq(page, `.node[data-key="${key}"]`).boundingBox();
  const x0 = await el(page, (b, k) => b._model.nodes.get(k).x, key);
  await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 80, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const x1 = await el(page, (b, k) => b._model.nodes.get(k).x, key);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const x2 = await el(page, (b, k) => b._model.nodes.get(k).x, key);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(500);
  const x3 = await el(page, (b, k) => b._model.nodes.get(k).x, key);
  check('8.3 move, undo, redo', x1 > x0 && x2 === x0 && x3 === x1, [x0, x1, x2, x3]);
  await fbq(page, '[data-act="frame"]').click();
  await page.waitForTimeout(200);
  await fbq(page, '[data-act="undo"]').click();
  await page.waitForTimeout(500);
  check('8.3 undo a new frame', (await fbq(page, '.frames .frame').count()) === 0);
  await page.waitForTimeout(1200);
  const L = (await store(page)).layouts[lid];
  check('8.3 undone state saved', L && L.frames.length === 0 && L.nodes[key] && L.nodes[key].x === x1, L);
  check('8.3 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

// switch the integration between Organise only and Full manager through its options flow
async function setMode(page, mode) {
  const entries = await ws(page, { type: 'config_entries/get', domain: 'functions_board' });
  const flow = await api(page, 'POST', 'config/config_entries/options/flow', { handler: entries[0].entry_id });
  await api(page, 'POST', 'config/config_entries/options/flow/' + flow.flow_id, { mode, card: false });
  await until(() => el(page, (b, m) => b._fbMode === m, mode), 8000);
}

test('8.4 Organise only hides delete; Full manager shows it', async (browser) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'organise');
  await openFn(page, /garage/i);
  await fbq(page, '.title [data-act="fn-menu"]').click();
  check('8.4 Organise only: delete entries shown but disabled', await fbq(page, '.menu [data-act="fnm-del"]').isDisabled() && await fbq(page, '.menu [data-act="fnm-delall"]').isDisabled());
  await page.keyboard.press('Escape');
  await el(page, (b) => b._select('automation.garage_left_open'));
  check('8.4 Organise only: no Delete on a box', (await fbq(page, '.nodebar [data-act="delete"]').count()) === 0);
  await setMode(page, 'full');
  await el(page, (b) => b._select('automation.garage_left_open'));
  check('8.4 Full manager reaches an open board without a reload', (await fbq(page, '.nodebar [data-act="delete"]').count()) === 1);
  await setMode(page, 'organise');
  check('8.4 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('8.2 delete an item, a function, and a function with its items; undo each', async (browser) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  const garage = await openFn(page, /garage/i);
  // a helper made in the UI, used by an automation outside the function
  const h = await ws(page, { type: 'input_boolean/create', name: 'FB test toggle', icon: 'mdi:flask' });
  const hid = 'input_boolean.fb_test_toggle';
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], hid), 6000);
  await ws(page, { type: 'config/entity_registry/update', entity_id: hid, labels: [garage], area_id: 'kitchen' }).catch(() => ws(page, { type: 'config/entity_registry/update', entity_id: hid, labels: [garage] }));
  const aid = 'fbdel' + Date.now();
  await api(page, 'POST', 'config/automation/config/' + aid, { alias: 'FB uses the toggle', triggers: [{ trigger: 'state', entity_id: hid, to: 'on' }], actions: [] });
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), hid), 8000);
  await el(page, (b, k) => b._select(k), hid);
  await fbq(page, '.nodebar [data-act="delete"]').click();
  await fbq(page, '.modal [data-act="del-go"]').waitFor({ timeout: 10000 });
  const txt = await fbq(page, '.modal').innerText();
  check('8.2 a helper that automations use names them first', /Used by 1 automation or script: FB uses the toggle/.test(txt), txt);
  check('8.2 says Undo brings it back', /Undo brings it back/.test(txt), txt);
  await fbq(page, '.modal [data-act="del-go"]').click();
  await until(() => page.evaluate((k) => !document.querySelector('home-assistant').hass.states[k], hid), 6000);
  check('8.2 the helper is gone', !(await page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], hid)));
  await fbq(page, '[data-act="undo"]').click();
  await until(() => hasLabel(page, hid, garage), 10000);
  const back = await regWhenThere(page, hid);
  check('8.2 Undo brings the helper back with its label and icon', back && back.labels.includes(garage) && (await ws(page, { type: 'input_boolean/list' })).some((x) => x.name === 'FB test toggle' && x.icon === 'mdi:flask'), back);

  // an automation in automations.yaml
  const aent = 'automation.fb_uses_the_toggle';
  await ws(page, { type: 'config/entity_registry/update', entity_id: aent, labels: [garage] });
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), aent), 8000);
  await el(page, (b, k) => b._select(k), aent);
  await fbq(page, '.nodebar [data-act="delete"]').click();
  await fbq(page, '.modal [data-act="del-go"]').click();
  await until(() => page.evaluate((k) => !document.querySelector('home-assistant').hass.states[k], aent), 6000);
  let gone = true; try { await api(page, 'GET', 'config/automation/config/' + aid); gone = false; } catch (e) { gone = true; }
  check('8.2 the automation is gone from automations.yaml', gone);
  await fbq(page, '[data-act="undo"]').click();
  await until(() => hasLabel(page, aent, garage), 10000);
  const cfg = await api(page, 'GET', 'config/automation/config/' + aid).catch(() => null);
  check('8.2 Undo writes the automation back, same id, same entity, labelled', cfg && cfg.alias === 'FB uses the toggle' && ((await regEntry(page, aent)).labels || []).includes(garage));

  // delete the Morning function, items stay; undo
  const morning = await openFn(page, /morning/i);
  const mItems = (await ws(page, { type: 'config/entity_registry/list' })).filter((e) => (e.labels || []).includes(morning)).map((e) => e.entity_id);
  await fbq(page, '.title [data-act="fn-menu"]').click();
  await fbq(page, '.menu [data-act="fnm-del"]').click();
  await fbq(page, '.modal [data-act="del-go"]').waitFor({ timeout: 10000 });
  const t2 = await fbq(page, '.modal').innerText();
  check('8.2 Delete function says the items stay', /items themselves stay/.test(t2), t2);
  await fbq(page, '.modal [data-act="del-go"]').click();
  await until(async () => !(await ws(page, { type: 'config/label_registry/list' })).some((l) => l.label_id === morning), 6000);
  await until(() => el(page, (b, l) => !b._data.functions.includes(l), morning), 4000);
  const fns = await el(page, (b) => b._data.functions);
  const stillThere = await page.evaluate((ids) => ids.filter((k) => !document.querySelector('home-assistant').hass.states[k]), mItems);
  check('8.2 the label and the function are gone; the items still exist', !fns.includes(morning) && stillThere.length === 0, { fns, morning, missing: stillThere });
  await fbq(page, '[data-act="undo"]').click();
  await until(async () => (await ws(page, { type: 'config/label_registry/list' })).some((l) => /morning/i.test(l.name)), 8000);
  await page.waitForTimeout(1500);
  const nl = (await ws(page, { type: 'config/label_registry/list' })).find((l) => /morning/i.test(l.name));
  const relabelled = (await ws(page, { type: 'config/entity_registry/list' })).filter((e) => (e.labels || []).includes(nl.label_id)).map((e) => e.entity_id).sort();
  check('8.2 Undo recreates the label, relabels the same items and puts it back on the board', JSON.stringify(relabelled) === JSON.stringify(mItems.sort()) && (await el(page, (b) => b._data.functions)).includes(nl.label_id), [mItems, relabelled]);

  // a temporary function with a UI helper and an automation: delete with its items; undo
  const tl = await ws(page, { type: 'config/label_registry/create', name: 'FB temp', icon: 'mdi:flask' });
  await ws(page, { type: 'input_number/create', name: 'FB temp level', min: 0, max: 10, step: 1, mode: 'slider' });
  await until(() => page.evaluate(() => !!document.querySelector('home-assistant').hass.states['input_number.fb_temp_level']), 6000);
  const tid = 'fbtemp' + Date.now();
  await api(page, 'POST', 'config/automation/config/' + tid, { alias: 'FB temp rule', triggers: [{ trigger: 'state', entity_id: 'input_number.fb_temp_level' }], actions: [] });
  await until(() => page.evaluate(() => !!document.querySelector('home-assistant').hass.states['automation.fb_temp_rule']), 6000);
  for (const id of ['input_number.fb_temp_level', 'automation.fb_temp_rule', 'input_boolean.garage_auto_close']) {
    const r = await regEntry(page, id); await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: (r.labels || []).concat([tl.label_id]) });
  }
  await el(page, (b, l) => { b._data.functions.push(l); b._save(); return b._open(l); }, tl.label_id);
  await page.waitForTimeout(1500);
  await fbq(page, '.title [data-act="fn-menu"]').click();
  await fbq(page, '.menu [data-act="fnm-delall"]').click();
  await fbq(page, '.modal [data-act="del-go"]').waitFor({ timeout: 10000 });
  const t3 = await fbq(page, '.modal').innerText();
  check("8.2 a YAML helper is listed but can't be deleted", /Garage auto-close[\s\S]*defined in YAML/.test(t3), t3);
  await fbq(page, '.modal [data-act="del-go"]').click();
  await until(() => page.evaluate(() => !document.querySelector('home-assistant').hass.states['automation.fb_temp_rule'] && !document.querySelector('home-assistant').hass.states['input_number.fb_temp_level']), 8000);
  const yamlLeft = await regEntry(page, 'input_boolean.garage_auto_close');
  check('8.2 function and its items deleted; the YAML helper stays, without the label', !(await page.evaluate(() => !!document.querySelector('home-assistant').hass.states['automation.fb_temp_rule'])) && !(yamlLeft.labels || []).includes(tl.label_id) && (yamlLeft.labels || []).includes(garage), yamlLeft.labels);
  await fbq(page, '[data-act="undo"]').click();
  await until(() => page.evaluate(() => !!document.querySelector('home-assistant').hass.states['automation.fb_temp_rule'] && !!document.querySelector('home-assistant').hass.states['input_number.fb_temp_level']), 12000);
  await page.waitForTimeout(1500);
  const tl2 = (await ws(page, { type: 'config/label_registry/list' })).find((l) => l.name === 'FB temp');
  const inTemp = tl2 ? (await ws(page, { type: 'config/entity_registry/list' })).filter((e) => (e.labels || []).includes(tl2.label_id)).map((e) => e.entity_id).sort() : [];
  check('8.2 Undo brings back the function, its items and their labels', JSON.stringify(inTemp) === JSON.stringify(['automation.fb_temp_rule', 'input_boolean.garage_auto_close', 'input_number.fb_temp_level']), inTemp);
  // clean up
  for (const [dom, id] of [['automation', tid], ['automation', aid]]) await api(page, 'DELETE', `config/${dom}/config/${id}`).catch(() => {});
  for (const dom of ['input_boolean', 'input_number']) for (const x of await ws(page, { type: dom + '/list' })) if (/^FB /.test(x.name)) await ws(page, { type: dom + '/delete', [dom + '_id']: x.id });
  await setMode(page, 'organise');
  check('8.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('Phase 2: area targets, purpose-specific triggers, helper inputs, scenes', async (browser) => {
  const { ctx, page } = await imported(browser);
  for (const a of await ws(page, { type: 'config/area_registry/list' })) if (a.name === 'FB nursery') await ws(page, { type: 'config/area_registry/delete', area_id: a.area_id });
  const area = await ws(page, { type: 'config/area_registry/create', name: 'FB nursery' });
  // Home Assistant puts entities that have no name of their own in an area through their device
  const devOf = async (id) => (await regEntry(page, id)).device_id;
  const devs = [];
  for (const id of ['light.bed_light', 'light.ceiling_lights', 'binary_sensor.movement_backyard']) { const d = await devOf(id); devs.push(d); await ws(page, { type: 'config/device_registry/update', device_id: d, area_id: area.area_id }); }
  const aid = 'fbarea' + Date.now();
  await api(page, 'POST', 'config/automation/config/' + aid, { alias: 'FB nursery: motion light', triggers: [{ trigger: 'motion.detected', target: { area_id: area.area_id } }], actions: [{ action: 'light.turn_on', target: { area_id: area.area_id } }] });
  const ent = 'automation.fb_nursery_motion_light';
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], ent), 8000);
  const sid = 'fbscene' + Date.now();
  await api(page, 'POST', 'config/scene/config/' + sid, { name: 'FB nursery night', entities: { 'light.bed_light': { state: 'on', brightness: 30 } } });
  const scene = 'scene.fb_nursery_night';
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], scene), 8000);
  const lab = await ws(page, { type: 'config/label_registry/create', name: 'FB nursery fn' });
  for (const id of [ent, 'light.bed_light', scene]) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [lab.label_id] });
  await el(page, (b, l) => { b._data.functions.push(l); b._save(); return b._open(l); }, lab.label_id);
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), 'area:' + area.area_id), 10000);
  const m = await el(page, (b) => ({ nodes: [...b._model.nodes.values()].map((n) => [n.key, n.kind, n.name]), edges: b._model.edges.map((e) => [e.from, e.role, e.to, e.loop, e.via]) }));
  const has = (f, r, t) => m.edges.some((e) => e[0] === f && e[1] === r && e[2] === t);
  const A = 'area:' + area.area_id;
  check('2.2 one box for the area target, with a count', m.nodes.some((n) => n[0] === A && /FB nursery \(3\)/.test(n[2])), m.nodes);
  check('2.2 the action goes to the area box', has(ent, 'action', A), m.edges);
  check('2.2 the trigger comes from the area box', has(A, 'trigger', ent), m.edges);
  check('2.2 and to the member light it covers', has(ent, 'action', 'light.bed_light') && m.edges.find((e) => e[2] === 'light.bed_light' && e[0] === ent)[4] === A, m.edges);
  check('2.2 no bare light.turn_on action box', !m.nodes.some((n) => n[0] === 'svc:light.turn_on'), m.nodes);
  check('2.1 motion.detected then turn on lights: no loop', !m.edges.some((e) => e[3]), m.edges.filter((e) => e[3]));
  check('2.4 the scene changes its member light', has(scene, 'action', 'light.bed_light'), m.edges);
  const filt = await el(page, (b, k) => b._targetEntities(k, { role: 'trigger', kind: 'motion.detected' }), A);
  check('2.2 a motion trigger on the area covers only its motion sensors', JSON.stringify(filt) === '["binary_sensor.movement_backyard"]', filt);
  // a template sensor's inputs
  const ff = await openFn(page, /filter/i);
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'sensor.furnace_filter_status', labels: [ff] });
  await until(() => el(page, (b) => b._model && b._model.edges.some((e) => e.role === 'source' && e.to === 'sensor.furnace_filter_status')), 10000);
  const src = await el(page, (b) => b._model.edges.filter((e) => e.role === 'source' && e.to === 'sensor.furnace_filter_status').map((e) => e.from).sort());
  check('2.3 the template sensor shows what it reads', JSON.stringify(src) === '["counter.filter_countdown","input_boolean.filter_due"]', src);
  await page.screenshot({ path: path.join(SHOTS, 'r-phase2-filter.png') });
  // clean up
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'sensor.furnace_filter_status', labels: [] });
  await api(page, 'DELETE', 'config/automation/config/' + aid).catch(() => {});
  await api(page, 'DELETE', 'config/scene/config/' + sid).catch(() => {});
  for (const id of ['light.bed_light', 'light.ceiling_lights', 'binary_sensor.movement_backyard']) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [] });
  for (const d of devs) await ws(page, { type: 'config/device_registry/update', device_id: d, area_id: null });
  await ws(page, { type: 'config/area_registry/delete', area_id: area.area_id });
  check('Phase 2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('3.2 leftovers and coverage; 3.3 device chains (off by default)', async (browser) => {
  const { ctx, page } = await session(browser, 'owner');
  await page.goto(BASE + '/'); await ready(page); await reset(page);
  await page.goto(BASE + '/functions');
  await fbq(page, '.empty.wel [data-act="import"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  const intro = await fbq(page, '.modal .mintro').innerText();
  check('3.2 coverage line', /\d+ of \d+ automations and \d+ of \d+ scripts are in a group or a function/.test(intro), intro);
  await fbq(page, '.modal [data-act="mgr-left"]').click();
  const left = await page.locator('functions-board .modal .lrow2').allInnerTexts();
  check('3.2 the lone automations are listed', left.some((t) => /Backyard motion light/.test(t)) && left.some((t) => /kitchen speaker/i.test(t)), left);
  const g0 = await el(page, (b) => b._mgr.cands.find((c) => c.members.includes('automation.morning_lights_and_blinds')).members);
  check('3.3 off by default: the speaker automation is not in the Morning group', !g0.includes('automation.morning_kitchen_speaker_on_with_the_lights'), g0);
  await fbq(page, '.modal [data-mdev]').check();
  await page.waitForTimeout(300);
  const g1 = await el(page, (b) => b._mgr.cands.find((c) => c.members.includes('automation.morning_lights_and_blinds')).members);
  check('3.3 on: the light joins both automations into one Morning group', g1.includes('automation.morning_kitchen_speaker_on_with_the_lights'), g1);
  await fbq(page, '.modal [data-mdev]').uncheck();
  await page.waitForTimeout(300);
  // import everything, then add the blueprint automation from the leftovers in two clicks
  await fbq(page, '.modal [data-act="mgr-selall"]').click();
  await fbq(page, '.modal [data-act="mgr-import-sel"]').click();
  await until(() => el(page, (b) => !b._mgr.busy && b._data.functions.length >= 3), 15000);
  await page.waitForTimeout(800);
  if (!(await fbq(page, '.modal .lrow2').count())) await fbq(page, '.modal [data-act="mgr-left"]').click();
  const row = page.locator('functions-board .modal .lrow2', { hasText: 'Backyard motion light' });
  await row.locator('[data-act="left-add"]').click();
  await fbq(page, '.menu [data-act="left-to"]').first().click();
  await page.waitForTimeout(1200);
  const e = await regEntry(page, 'automation.backyard_motion_light');
  check('3.2 Add to puts it in a function in two clicks', (e.labels || []).length === 1, e.labels);
  check('3.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('4.2 each function has an address; Back and reload work', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  await page.waitForTimeout(400);
  const m = (await ws(page, { type: 'config/label_registry/list' })).find((l) => /morning/i.test(l.name)).label_id;
  await fbq(page, `.list .fn[data-fn="${m}"]`).click();
  await until(() => page.evaluate(() => location.pathname), 3000);
  await page.waitForTimeout(800);
  check('4.2 the address names the open function', (await page.evaluate(() => location.pathname)) === '/functions/' + m, await page.evaluate(() => location.pathname));
  await page.goBack();
  await until(() => el(page, (b, x) => b._data.ui.current === x, g), 5000);
  check('4.2 Back opens the previous function', (await el(page, (b) => b._data.ui.current)) === g && (await page.evaluate(() => location.pathname)) === '/functions/' + g);
  await page.reload();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  check('4.2 reloading keeps the function', (await el(page, (b) => b._data.ui.current)) === g && (await page.evaluate(() => location.pathname)) === '/functions/' + g);
  await page.goto(BASE + '/functions/no_such_function');
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  check('4.2 an unknown address falls back, with a note', /no function/i.test(await fbq(page, '.toast').innerText().catch(() => '')) && (await page.evaluate(() => location.pathname)) !== '/functions/no_such_function');
  check('4.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('4.9 the board follows the user\'s language, English where a text is missing', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  const boxes = await fbq(page, '.node').count();
  const pick = (lang) => page.evaluate((l) => document.querySelector('home-assistant')
    .dispatchEvent(new CustomEvent('hass-language-select', { detail: l, bubbles: true, composed: true })), lang);
  const tool = (act) => fbq(page, `[data-act="${act}"] span`).first().textContent();
  // a partial Dutch table, added the way a translator tries one from the browser console
  await page.evaluate(() => {
    customElements.get('functions-board').STR.nl = {
      automation: 'Automatisering', undo: 'Ongedaan maken', n_automations: { one: '{n} automatisering', other: '{n} automatiseringen' },
    };
  });
  await pick('nl');
  await until(async () => (await tool('new-automation')) === 'Automatisering', 8000);
  check('4.9 the toolbar is in the new language', (await tool('new-automation')) === 'Automatisering', await tool('new-automation'));
  check('4.9 a text the language leaves out stays English', (await tool('new-script')) === 'Script', await tool('new-script'));
  check('4.9 tooltips too', (await fbq(page, '[data-act="undo"]').getAttribute('title')) === 'Ongedaan maken');
  const row = await fbq(page, `.fn[data-fn="${g}"]`).innerText();
  check('4.9 counts take the language\'s plural forms', /\d+ automatisering(en)?\b/.test(row), row);
  await until(async () => (await fbq(page, '.node').count()) === boxes, 8000);
  check('4.9 the same function opens again, with every box', (await el(page, (b) => b._data.ui.current)) === g && (await fbq(page, '.node').count()) === boxes,
    [await el(page, (b) => b._data.ui.current), boxes, await fbq(page, '.node').count()]);
  await pick('en');
  await until(async () => (await tool('new-automation')) === 'Automation', 8000);
  check('4.9 and back to English', (await tool('new-automation')) === 'Automation');
  check('4.9 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('Edit on a helper opens its settings; without an ID, it says why not', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  const mine = async () => (await ws(page, { type: 'input_boolean/list' })).filter((x) => x.name === 'FB edit toggle');
  for (const x of await mine()) await ws(page, { type: 'input_boolean/delete', input_boolean_id: x.id });
  const h = await ws(page, { type: 'input_boolean/create', name: 'FB edit toggle' });
  const hid = 'input_boolean.' + h.id;
  try {
    await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], hid), 6000);
    await ws(page, { type: 'config/entity_registry/update', entity_id: hid, labels: [g] });
    await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), hid), 8000);
    // Home Assistant's more-info dialog, and the view it shows
    const dialog = () => page.evaluate(() => {
      const q = [document];
      while (q.length) { const r = q.shift(); const d = r.querySelector && r.querySelector('ha-more-info-dialog'); if (d) return d._open ? { view: d._currView, entity: d._entityId } : null; (r.querySelectorAll ? [...r.querySelectorAll('*')] : []).forEach((x) => x.shadowRoot && q.push(x.shadowRoot)); }
      return null;
    });
    const closeDialog = async () => {
      await page.evaluate(() => {
        const q = [document];
        while (q.length) { const r = q.shift(); const d = r.querySelector && r.querySelector('ha-more-info-dialog'); if (d) { d.closeDialog(); return; } (r.querySelectorAll ? [...r.querySelectorAll('*')] : []).forEach((x) => x.shadowRoot && q.push(x.shadowRoot)); }
      });
      await until(async () => !(await dialog()), 4000);
    };
    await el(page, (b, k) => b._select(k), hid);
    const bar = await page.locator('functions-board .nodebar button').allInnerTexts();
    check('a helper\'s bar has Edit, then Details', bar.indexOf('Edit') >= 0 && bar.indexOf('Edit') < bar.indexOf('Details'), bar);
    await fbq(page, '.nodebar [data-act="edit"]').click();
    await until(async () => ((await dialog()) || {}).view === 'settings', 6000);
    check('Edit opens the helper\'s settings', JSON.stringify(await dialog()) === JSON.stringify({ view: 'settings', entity: hid }), await dialog());
    await closeDialog();
    await el(page, (b, k) => b._centerOn(k), hid);
    await page.waitForTimeout(300);
    await fbq(page, `.node[data-key="${hid}"]`).dblclick();
    await until(async () => ((await dialog()) || {}).view === 'settings', 6000);
    check('double-click edits it too', ((await dialog()) || {}).view === 'settings', await dialog());
    await closeDialog();
    // without a registry entry (set up in YAML without a unique ID) there are no settings to change
    await el(page, (b, k) => { b._entMap.delete(k); b._select(k); }, hid);
    const ed = fbq(page, '.nodebar [data-act="edit"]');
    check('without an ID, Edit is off and says why', (await ed.isDisabled()) && /YAML/.test(await ed.getAttribute('title')), await ed.getAttribute('title'));
    check('no errors', page.logs.length === 0, page.logs);
  } finally {
    for (const x of await mine()) await ws(page, { type: 'input_boolean/delete', input_boolean_id: x.id });
    await ctx.close();
  }
});

test('4.4 find anything; 4.6 unwired pieces explained', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  await fbq(page, '.lfind .find').fill('closed stop');
  await page.waitForTimeout(400);
  const res = await page.locator('functions-board .fres').allInnerTexts();
  check('4.4 results show where an item lives', res.length >= 1 && /Garage/.test(res[0]), res);
  await openFn(page, /morning/i);
  await fbq(page, '.lfind .find').fill('closed stop');
  await page.waitForTimeout(300);
  await fbq(page, '.fres .fgo').first().click();
  await until(() => el(page, (b) => b._sel === 'automation.garage_closed_stop_timer'), 6000);
  check('4.4 choosing a result opens its function and selects the box', (await el(page, (b) => [b._data.ui.current, b._sel])).join() === g + ',automation.garage_closed_stop_timer');
  await fbq(page, '[data-act="find-x"]').click();
  // a helper nothing uses
  await ws(page, { type: 'input_boolean/create', name: 'FB lonely toggle' });
  await until(() => page.evaluate(() => !!document.querySelector('home-assistant').hass.states['input_boolean.fb_lonely_toggle']), 6000);
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'input_boolean.fb_lonely_toggle', labels: [g] });
  await until(() => el(page, (b) => b._model && b._model.nodes.has('input_boolean.fb_lonely_toggle')), 8000);
  await page.waitForTimeout(500);
  const u = await el(page, (b) => ({ unref: b._model.nodes.get('input_boolean.fb_lonely_toggle').unref, badge: !!b.shadowRoot.querySelector('.node[data-key="input_boolean.fb_lonely_toggle"] .unref'), heads: (b._heads || []).map((h) => h.text), wired: b._model.nodes.get('input_boolean.garage_auto_close').unref }));
  check('4.6 an unused helper says nothing refers to it', u.unref === true && u.badge, u);
  check('4.6 a used helper does not', u.wired === false, u);
  check('4.6 unwired boxes sit under a heading per kind', u.heads.some((h) => /Helpers with no arrows/.test(h)), u.heads);
  await page.screenshot({ path: path.join(SHOTS, 'r-unwired.png') });
  for (const x of await ws(page, { type: 'input_boolean/list' })) if (/^FB /.test(x.name)) await ws(page, { type: 'input_boolean/delete', input_boolean_id: x.id });
  check('4.4/4.6 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('Phase 7: highlight modes, filters, nearest sides, new boxes by their neighbour', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  const lit = () => el(page, (b) => [...b._els.keys()].filter((k) => !b._els.get(k).classList.contains('dim')).sort());
  await el(page, (b) => b._select('automation.garage_left_open'));
  const chain = await lit();
  await fbq(page, '[data-act="hl"]').click();
  await fbq(page, '.menu [data-act="hl-mode"][data-mode="off"]').click();
  const off = await lit();
  check('7.1 Off lights only the selected box', off.length === 1 && off[0] === 'automation.garage_left_open', off);
  await fbq(page, '.menu [data-act="hl-mode"][data-mode="down"]').click();
  await fbq(page, '.menu [data-act="hl-depth"][data-depth="1"]').click();
  const down1 = await lit();
  check('7.1 Downstream, 1 arrow: the box and what it runs', down1.includes('script.close_garage') && !down1.includes('timer.garage_open') && down1.length < chain.length, down1);
  await page.keyboard.press('Escape');
  await el(page, (b) => b._select('automation.garage_left_open'));
  await page.keyboard.press('2');
  const hl = await el(page, (b) => b._data.ui.hl);
  check('7.1 number keys set the reach', hl.depth === 2 && hl.mode === 'down', hl);
  await el(page, (b) => b._setHl({ mode: 'chain', depth: 0 }));
  // 7.2 filters
  await fbq(page, '[data-act="hl"]').click();
  await fbq(page, '.menu [data-act="hl-flt"][data-key="trigger"]').click();
  await fbq(page, '.menu [data-act="hl-flt"][data-key="condition"]').click();
  const noTrig = await el(page, (b) => ({ drawn: [...b.shadowRoot.querySelectorAll('.edges path.e')].map((p) => p.getAttribute('class')), hid: [...b.shadowRoot.querySelectorAll('.node .hid')].map((x) => x.closest('.node').dataset.key) }));
  check('7.2 hidden arrow types are not drawn', noTrig.drawn.length > 0 && !noTrig.drawn.some((c) => /role-trigger/.test(c)), noTrig.drawn);
  check('7.2 a box whose arrows are all hidden says so', noTrig.hid.includes('input_boolean.garage_auto_close'), noTrig.hid);
  await page.waitForTimeout(1200);
  const saved = await ws(page, { type: 'frontend/get_user_data', key: 'functions_board_ui' });
  check('7.2 filters are kept per function in your view settings', saved.value.ui.filters && saved.value.ui.filters[g] && saved.value.ui.filters[g].trigger === false, saved.value.ui.filters);
  await fbq(page, '.menu [data-act="hl-flt"][data-key="trigger"]').click();
  await fbq(page, '.menu [data-act="hl-flt"][data-key="condition"]').click();
  await page.keyboard.press('Escape');
  // 7.3 drag the script to the left of the automation that runs it: the arrow flips to the facing sides
  const src = 'automation.garage_left_open', dst = 'script.close_garage';
  // (both on screen, with room on the left)
  await el(page, (b, k) => { const n = b._model.nodes.get(k); b._view = { k: 0.6, x: 650 - n.x * 0.6, y: 420 - n.y * 0.6 }; b._applyView(); }, src);
  await page.waitForTimeout(300);
  const sb = await fbq(page, `.node[data-key="${src}"]`).boundingBox(), db = await fbq(page, `.node[data-key="${dst}"]`).boundingBox();
  await page.mouse.move(db.x + 30, db.y + 20); await page.mouse.down();
  await page.mouse.move(sb.x - db.width - 120, sb.y + 20, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const arrow = (a) => el(page, (b, a) => {
    const n1 = b._model.nodes.get(a[0]), n2 = b._model.nodes.get(a[1]);
    const p = b.shadowRoot.querySelector(`.edges path[data-edge="${a[0]}>${a[1]}"]`);
    const L = p.getTotalLength(), pts = [];
    for (let i = 1; i < 40; i++) { const q = p.getPointAtLength((L * i) / 40); pts.push([q.x, q.y]); }
    const inBox = (q, n) => q[0] > n.x + 3 && q[0] < n.x + n.w - 3 && q[1] > n.y + 3 && q[1] < n.y + n.h - 3;
    const s0 = p.getPointAtLength(0), s1 = p.getPointAtLength(L);
    return { startX: s0.x, srcX: n1.x, srcR: n1.x + n1.w, endX: s1.x, dstX: n2.x, crosses: pts.filter((q) => inBox(q, n1) || inBox(q, n2)).length, left: n2.x + n2.w < n1.x };
  }, a);
  // square-cornered arrows always read left to right: out of the right side, round, into the left side
  let geo = await arrow([src, dst]);
  check('7.3 after the swap the arrow still leaves the right side and goes round', geo.left && Math.abs(geo.startX - geo.srcR) < 4 && geo.endX < geo.dstX + 2, geo);
  check('7.3 no part of it runs through either box', geo.crosses === 0, geo);
  // curved arrows (the Arrows menu's style) take the facing sides
  await fbq(page, '[data-act="hl"]').click();
  await fbq(page, '.menu [data-act="hl-curved"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  geo = await arrow([src, dst]);
  // (the boxes not moved by hand are laid out again for the other style, so which side faces the other may change)
  check('7.3 curved, the arrow leaves the side facing its target', Math.abs(geo.startX - (geo.left ? geo.srcX : geo.srcR)) < 4, geo);
  check('7.3 curved, no part of it runs through either box', geo.crosses === 0, geo);
  await fbq(page, '[data-act="hl"]').click();
  await fbq(page, '.menu [data-act="hl-curved"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+z');
  // 7.4 a box new to an arranged function goes next to its neighbour
  // Auto-arrange is one click (it can be undone)
  await fbq(page, '[data-act="arrange"]').click();
  await fbq(page, '.menu [data-act="arr-go"]').click();
  await page.waitForTimeout(500);
  await el(page, (b) => { const L = b._layout(b._model.label); b._model.nodes.forEach((n, k) => { if (n.kind === 'member') L.nodes[k] = { x: n.x, y: n.y }; }); b._save(); });
  await page.waitForTimeout(900);
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'cover.garage_door', labels: [g] }).catch(() => {});
  const r = await until(() => el(page, (b) => { const n = b._model && b._model.nodes.get('cover.garage_door'); return n && n.kind === 'member' ? n : null; }), 8000);
  const nb = await el(page, (b) => { const a = b._model.nodes.get('automation.garage_start_open_timer'); return { x: a.x, y: a.y }; });
  check('7.4 the new member sits next to what it triggers, not below everything', r && Math.abs(r.y - nb.y) < 250 && Math.abs(r.x - nb.x) < 500, { r, nb });
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'cover.garage_door', labels: [] }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, 'r-phase7.png') });
  check('Phase 7 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.5 a notification\'s buttons are wired to the automations that answer them', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  const s1 = 'fbnote' + Date.now(), s2 = s1 + 'b';
  await api(page, 'POST', 'config/automation/config/' + s1, { alias: 'FB garage: ask to close', triggers: [{ trigger: 'state', entity_id: 'timer.garage_open', to: 'idle' }],
    actions: [{ action: 'notify.mobile_app_test_phone', data: { message: 'The garage is open', data: { actions: [{ action: 'FB_CLOSE_GARAGE', title: 'Close it' }, { action: 'FB_IGNORE', title: 'Leave it' }] } } }] });
  await api(page, 'POST', 'config/automation/config/' + s2, { alias: 'FB garage: close from the phone', triggers: [{ trigger: 'event', event_type: 'mobile_app_notification_action', event_data: { action: 'FB_CLOSE_GARAGE' } }],
    actions: [{ action: 'script.close_garage' }] });
  const a1 = 'automation.fb_garage_ask_to_close', a2 = 'automation.fb_garage_close_from_the_phone';
  await until(() => page.evaluate(([x, y]) => !!document.querySelector('home-assistant').hass.states[x] && !!document.querySelector('home-assistant').hass.states[y], [a1, a2]), 8000);
  for (const id of [a1, a2]) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [g] });
  await until(() => el(page, (b) => b._model && b._model.nodes.has('nact:FB_CLOSE_GARAGE') && b._model.edges.some((e) => e.from === 'nact:FB_CLOSE_GARAGE')), 10000);
  const m = await el(page, (b) => ({ btn: (b._model.nodes.get('nact:FB_CLOSE_GARAGE') || {}).name, edges: b._model.edges.map((e) => [e.from, e.to, e.loop]) }));
  const has = (f, t) => m.edges.some((e) => e[0] === f && e[1] === t);
  check('9.5 the notification is a box with one output per button', has(a1, 'svc:notify.mobile_app_test_phone') && has('svc:notify.mobile_app_test_phone', 'nact:FB_CLOSE_GARAGE') && has('svc:notify.mobile_app_test_phone', 'nact:FB_IGNORE'), m.edges);
  check('9.5 the button is named by its title', m.btn === 'Button: Close it', m.btn);
  check('9.5 the button is wired to the automation that answers it', has('nact:FB_CLOSE_GARAGE', a2) && !m.edges.some((e) => e[0] === 'event:mobile_app_notification_action'), m.edges);
  await api(page, 'DELETE', 'config/automation/config/' + s1);
  await api(page, 'DELETE', 'config/automation/config/' + s2);
  check('9.5 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('0.5.4 phone app: editors open full screen, and what is created there joins the function', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  // the phone app is told apart by its own sign-in (hass.auth.external); that can't be faked here without
  // confusing Home Assistant's frontend, so the board is told it's in the app
  await el(page, (b) => { b._inApp = () => true; });
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), GARAGE[1]);
  await until(() => page.evaluate(() => location.pathname.startsWith('/config/automation/edit/')), 8000);
  const r1 = await page.evaluate(() => location.pathname);
  check('0.5.4 Edit leaves the board for the automation editor', r1.startsWith('/config/automation/edit/'), r1);
  // the editor's own back arrow (not only the phone's Back) returns to the board
  await page.locator('ha-automation-editor ha-icon-button-arrow-prev').first().click();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  check('0.5.4 the editor\'s back arrow returns to the function', await page.evaluate((p) => location.pathname === p, '/functions/' + g), await page.evaluate(() => location.pathname));
  await el(page, (b, k) => { b._inApp = () => true; b._openItem(b._model.nodes.get(k)); }, GARAGE[1]);
  await until(() => page.evaluate(() => location.pathname.startsWith('/config/automation/edit/')), 8000);
  await page.goBack();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  check('0.5.4 Back returns to the function', await page.evaluate((p) => location.pathname === p, '/functions/' + g), await page.evaluate(() => location.pathname));
  check('0.5.4 no drawer frame was opened', (await fbq(page, '.drawer iframe').count()) === 0);
  // create: the board goes, the automation is saved meanwhile, and on Back it gets the function's label
  await el(page, (b) => { b._inApp = () => true; b._create('automation'); });
  await until(() => page.evaluate(() => location.pathname === '/config/automation/edit/new'), 8000);
  const pend = await page.evaluate(() => JSON.parse(sessionStorage.getItem('functions_board_capture') || 'null'));
  check('0.5.4 Create remembers what it is for', pend && pend.label === g && pend.kind === 'automation' && pend.since > 0, pend);
  const sid = 'fbapp' + Date.now(), aid = 'automation.fb_made_in_the_app';
  await api(page, 'POST', 'config/automation/config/' + sid, { alias: 'FB made in the app', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open' }], actions: [] });
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], aid), 8000);
  await page.goBack();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  check('0.5.4 the automation made in the editor joins the function', await until(() => hasLabel(page, aid, g), 8000), await regWhenThere(page, aid));
  check('0.5.4 the pending create is used up', !(await page.evaluate(() => sessionStorage.getItem('functions_board_capture'))));
  // an old item is never picked up: a second Back-and-return with nothing new labels nothing else
  const before = (await ws(page, { type: 'config/entity_registry/list' })).filter((e) => (e.labels || []).includes(g)).length;
  await el(page, (b) => { b._inApp = () => true; b._create('script'); });
  await until(() => page.evaluate(() => location.pathname === '/config/script/edit/new'), 8000);
  await page.goBack();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000);
  const after = (await ws(page, { type: 'config/entity_registry/list' })).filter((e) => (e.labels || []).includes(g)).length;
  check('0.5.4 nothing is labelled when nothing was made', after === before, { before, after });
  await api(page, 'DELETE', 'config/automation/config/' + sid);
  check('0.5.4 phone app: no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('0.5.4 back from an editor: the board draws from what it had, then catches up', async (browser) => {
  const { ctx, page } = await imported(browser);
  const g = await openFn(page, /garage/i);
  await page.waitForTimeout(1000);
  await el(page, (b, k) => { b._inApp = () => true; b._openItem(b._model.nodes.get(k)); }, GARAGE[1]);
  await page.locator('ha-automation-editor ha-icon-button-arrow-prev').first().waitFor({ timeout: 15000 });
  // renamed while the board is away: the warm board can't know until it checks again
  await ws(page, { type: 'config/entity_registry/update', entity_id: GARAGE[2], name: 'FB renamed while away' });
  await page.waitForTimeout(500);
  const sent0 = page.sent.length;
  await page.locator('ha-automation-editor ha-icon-button-arrow-prev').first().click();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  const before = page.sent.slice(sent0).map((m) => m.type);
  check('0.5.4 the board draws without fetching the registries again', !before.includes('config/entity_registry/list'), before);
  const named = await until(() => el(page, (b, k) => { const n = b._model && b._model.nodes.get(k); return n && n.name === 'FB renamed while away'; }, GARAGE[2]), 6000);
  check('0.5.4 a change made while away shows up a moment later', named, await el(page, (b, k) => (b._model.nodes.get(k) || {}).name, GARAGE[2]));
  check('0.5.4 it is still the same function', await page.evaluate((p) => location.pathname === p, '/functions/' + g));
  await ws(page, { type: 'config/entity_registry/update', entity_id: GARAGE[2], name: null });
  check('0.5.4 warm return: no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('0.5.4 touch: a box moves only after a one-second hold; a quick swipe pans', async (browser) => {
  const { ctx, page } = await imported(browser, { mobile: true });
  await openFn(page, /garage/i);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (x, y, dx, hold) => {
    await touch('touchStart', x, y);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', x + dx * i / 6, y); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await page.waitForTimeout(400);
  };
  const key = GARAGE[1];
  const where = () => el(page, (b, k) => { const n = b._model.nodes.get(k), r = b._els.get(k).getBoundingClientRect(); return { x: n.x, y: n.y, cx: r.left + r.width / 2, cy: r.top + r.height / 2, vx: b._view.x, w: r.width }; }, key);
  await el(page, (b, k) => { b._listOpen = false; b._renderList(); b._centerOn(k); }, key);
  await page.waitForTimeout(500);
  let p = await where();
  await swipe(p.cx, p.cy, -60, 0);
  let q = await where();
  check('0.5.4 a quick swipe that starts on a box pans the board', q.x === p.x && q.y === p.y && Math.abs((q.vx - p.vx) + 60) < 6, { p, q });
  p = q;
  await touch('touchStart', p.cx, p.cy);
  await page.waitForTimeout(1200);
  check('0.5.4 a held box shows it is picked up', await el(page, (b, k) => b._els.get(k).classList.contains('lifted'), key));
  for (let i = 1; i <= 6; i++) { await touch('touchMove', p.cx + 10 * i, p.cy); await page.waitForTimeout(16); }
  await touch('touchEnd');
  await page.waitForTimeout(400);
  q = await where();
  const k = await el(page, (b) => b._view.k);
  check('0.5.4 after the hold the box moves with the finger', Math.abs(q.x - p.x - 60 / k) < 3 && q.vx === p.vx, { p, q, k });
  check('0.5.4 the lift ends with the drag', !(await el(page, (b, k) => b._els.get(k).classList.contains('lifted'), key)));
  const L = await el(page, (b, k) => (b._layout(b._model.label).nodes || {})[k], key);
  check('0.5.4 the move is saved', L && L.x === q.x, L);
  p = q;
  await touch('touchStart', p.cx + 60, p.cy);
  await touch('touchEnd');
  await page.waitForTimeout(400);
  check('0.5.4 a tap still selects the box', (await el(page, (b) => b._sel)) === key, await el(page, (b) => b._sel));
  check('0.5.4 touch: no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('0.6.0 square-cornered arrows: never alongside each other, colours by meaning, Auto-arrange, separate chains packed', async (browser) => {
  const { page } = await imported(browser);
  // every imported function, laid out automatically: no two arrows run closer than 16 px, and none crosses a box
  const fns = await el(page, (b) => (b._data.functions || []).slice());
  const bad = [];
  for (const id of fns) {
    await el(page, (b, id) => b._open(id), id);
    await page.waitForTimeout(700);
    const r = await el(page, (b) => { b._layout(b._model.label).nodes = {}; b._place(); b._render(); return null; }).then(() => board(page).evaluate(routeCheck, { min: 16 }));
    const h = await board(page).evaluate(hopCheck);
    if (r.error || r.close || r.through || h.error || h.missed) bad.push({ id, r, h });
  }
  check('0.6.0 in every function no two arrows run within 16 px of each other or through a box, and every crossing hops', fns.length > 0 && !bad.length, bad);
  await openFn(page, /garage/i);
  // colour by meaning: what sets things off, what they change
  const col = await el(page, (b) => {
    const get = (role) => { const p = b.shadowRoot.querySelector(`.edges path.e.role-${role}`); return p && getComputedStyle(p).stroke; };
    const root = getComputedStyle(b._$.board);
    return { trig: get('trigger'), act: get('action'), want: [root.getPropertyValue('--fb-trig').trim(), root.getPropertyValue('--fb-act').trim()] };
  });
  const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  check('0.6.0 trigger arrows are orange and action arrows blue', col.trig === rgb(col.want[0]) && col.act === rgb(col.want[1]), col);
  // Auto-arrange: one click lays out boxes you moved, and Undo puts them back
  const key = GARAGE[1];
  const box = await fbq(page, `.node[data-key="${key}"]`).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 260, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const moved = await el(page, (b, k) => ({ x: b._model.nodes.get(k).x, y: b._model.nodes.get(k).y }), key);
  await fbq(page, '[data-act="arrange"]').click();
  await fbq(page, '.menu [data-act="arr-go"]').click();
  await page.waitForTimeout(500);
  const after = await el(page, (b, k) => ({ x: b._model.nodes.get(k).x, y: b._model.nodes.get(k).y, saved: Object.keys(b._layout(b._model.label).nodes || {}).length }), key);
  check('0.6.0 Auto-arrange (from its menu) lays the moved box out again', (after.x !== moved.x || after.y !== moved.y) && after.saved === 0, { moved, after });
  check('0.6.0 Auto-arrange asks nothing', !(await fbq(page, '[data-act="arrange"][data-confirm]').count()));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const back = await el(page, (b, k) => ({ x: b._model.nodes.get(k).x, y: b._model.nodes.get(k).y }), key);
  check('0.6.0 Undo puts your arrangement back', back.x === moved.x && back.y === moved.y, { moved, back });
  check('0.6.0 moving one box by hand keeps the others where they were', await el(page, (b) => [...b._visibleKeys()].filter((k) => !k.startsWith('tool:')).every((k) => b._layout(b._model.label).nodes[k])));
  // Keep in place: a kept box stays where you put it through Auto-arrange; the rest is laid out clear of it
  const kk = GARAGE[0];
  await el(page, (b, k) => b._select(k), kk);
  await fbq(page, '.nodebar [data-act="keep"]').click();
  await page.waitForTimeout(300);
  check('0.6.0 a kept box shows a pin', await fbq(page, `.node[data-key="${kk}"] .kept`).count() === 1);
  const kb = await fbq(page, `.node[data-key="${kk}"]`).boundingBox();
  await page.mouse.move(kb.x + 30, kb.y + 20); await page.mouse.down();
  await page.mouse.move(kb.x + 30, kb.y - 220, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const kept = await el(page, (b, k) => ({ x: b._model.nodes.get(k).x, y: b._model.nodes.get(k).y }), kk);
  await fbq(page, '[data-act="arrange"]').click();
  await fbq(page, '.menu [data-act="arr-go"]').click();
  await page.waitForTimeout(600);
  const ka = await el(page, (b, k) => {
    const n = b._model.nodes.get(k), others = [...b._visibleKeys()].filter((o) => o !== k && !o.startsWith('tool:')).map((o) => b._model.nodes.get(o));
    return { x: n.x, y: n.y, overlap: others.filter((o) => o.x < n.x + n.w && o.x + o.w > n.x && o.y < n.y + n.h && o.y + o.h > n.y).map((o) => o.key), saved: Object.keys(b._layout(b._model.label).nodes) };
  }, kk);
  check('0.6.0 Auto-arrange leaves a kept box where it is and moves only the rest', ka.x === kept.x && ka.y === kept.y && ka.saved.length === 1 && ka.saved[0] === kk, { kept, ka });
  check('0.6.0 nothing is laid out on top of a kept box', !ka.overlap.length, ka.overlap);
  check('0.6.0 the rest still keeps its arrows 16 px apart', ((r) => !r.close && !r.through)(await board(page).evaluate(routeCheck, { min: 16 })));
  await el(page, (b, k) => b._select(k), kk);
  await fbq(page, '.nodebar [data-act="keep"]').click();
  await page.waitForTimeout(300);
  check('0.6.0 Let Auto-arrange move it takes the pin off', await fbq(page, `.node[data-key="${kk}"] .kept`).count() === 0 && !(await el(page, (b) => (b._layout(b._model.label).keep || []).length)));
  // each box has three points a side; arrows leave and enter at them
  const pts = await el(page, (b) => {
    const R = b._ortho, ys = (k) => { const n = b._model.nodes.get(k), st = Math.min(18, (n.h - 16) / 2); return [n.y + n.h / 2 - st, n.y + n.h / 2, n.y + n.h / 2 + st]; };
    const off = [];
    R.routes.forEach((p, i) => {
      const [f, t] = R.boxes[i], a = b._model.nodes.get(f), z = p[p.length - 1];
      if (Math.abs(p[0][0] - (a.x + a.w)) < 1 && !(R.owners[i] || [])[0] && !ys(f).some((y) => Math.abs(y - p[0][1]) < 0.6)) off.push(R.ids[i] + ' start');
      if (!(R.owners[i] || [])[1] && Math.abs(z[0] - b._model.nodes.get(t).x) < 3 && !ys(t).some((y) => Math.abs(y - z[1]) < 0.6)) off.push(R.ids[i] + ' end');
    });
    return { dots: b.shadowRoot.querySelectorAll('.node[data-key="automation.garage_left_open"] .port').length, off };
  });
  check('0.6.0 a box shows three points on each side', pts.dots === 6, pts.dots);
  check('0.6.0 arrows leave and enter boxes at those points', !pts.off.length, pts.off);
  // in Full manager, dragging from a right-hand point draws an arrow out of the box, from a left-hand one into it
  await setMode(page, 'full');
  await el(page, (b) => { b.__ld = []; b._linkDialog = (f, t) => { b.__ld.push([f, t]); }; b._select(null); b._fit(); });
  await page.waitForTimeout(500);
  const drag = async (fromSel, toKey) => {
    const p = await fbq(page, fromSel).boundingBox(), t = await fbq(page, `.node[data-key="${toKey}"]`).boundingBox();
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await drag('.node[data-key="input_boolean.garage_auto_close"] .port.pr >> nth=1', GARAGE[1]);
  await drag(`.node[data-key="${GARAGE[1]}"] .port.pl >> nth=0`, 'input_boolean.garage_auto_close');
  const ld = await el(page, (b) => b.__ld);
  check('0.6.0 drag from a box\'s right-hand point to another box: an arrow out of it', ld[0] && ld[0][0] === 'input_boolean.garage_auto_close' && ld[0][1] === GARAGE[1], ld);
  check('0.6.0 drag from a left-hand point: an arrow into it, from the box dropped on', ld[1] && ld[1][0] === 'input_boolean.garage_auto_close' && ld[1][1] === GARAGE[1], ld);
  await setMode(page, 'organise');
  // separate chains are each laid out on their own and packed together, not spread through one set of columns
  const pk = await el(page, (b) => {
    const mk = (key, kind) => ({ key, kind, domain: key.split('.')[0], name: key, icon: 'mdi:circle', badges: new Set(), w: kind === 'outside' ? 204 : 240, h: kind === 'outside' ? 40 : 62, x: 0, y: 0 });
    const keys = ['input_boolean.a1', 'automation.a2', 'light.a3', 'light.a4', 'input_boolean.b1', 'automation.b2', 'switch.b3', 'automation.c1'];
    const nodes = new Map(keys.map((k) => [k, mk(k, k.startsWith('light') || k.startsWith('switch') ? 'outside' : 'member')]));
    const E = [['input_boolean.a1', 'automation.a2', 'trigger'], ['automation.a2', 'light.a3', 'action'], ['automation.a2', 'light.a4', 'action'],
      ['input_boolean.b1', 'automation.b2', 'trigger'], ['automation.b2', 'switch.b3', 'action']].map(([from, to, role]) => ({ id: from + '>' + to, from, to, role, svcs: new Set(), tfs: [], anyTrig: true }));
    b._model = { label: 'fbx-pack', nodes, edges: E };
    b._layout('fbx-pack').nodes = {};
    b._place(); b._render();
    const ext = (ks) => { const ns = ks.map((k) => nodes.get(k)); return { x0: Math.min(...ns.map((n) => n.x)), y0: Math.min(...ns.map((n) => n.y)), x1: Math.max(...ns.map((n) => n.x + n.w)), y1: Math.max(...ns.map((n) => n.y + n.h)) }; };
    return { a: ext(keys.slice(0, 4)), b: ext(keys.slice(4, 7)), c: ext(['automation.c1']) };
  });
  // five arrows out of one box: they share its three points; each arrow has a letter where it branches off and
  // beside its own end (0.7.2: letters, not colours), and no two arrows of the function have the same one
  const tg = await el(page, (b) => {
    const mk = (key, kind) => ({ key, kind, domain: key.split('.')[0], name: key, icon: 'mdi:circle', badges: new Set(), w: kind === 'outside' ? 204 : 240, h: kind === 'outside' ? 40 : 62, x: 0, y: 0 });
    const ls = [1, 2, 3, 4, 5].map((i) => 'light.l' + i), keys = ['automation.all_off', ...ls];
    const nodes = new Map(keys.map((k) => [k, mk(k, k.startsWith('light') ? 'outside' : 'member')]));
    b._model = { label: 'fbx-tags', nodes, edges: ls.map((t) => ({ id: 'automation.all_off>' + t, from: 'automation.all_off', to: t, role: 'action', svcs: new Set(), tfs: [], anyTrig: true })) };
    b._layout('fbx-tags').nodes = {};
    b._place(); b._render();
    const chips = [...b.shadowRoot.querySelectorAll('.edges g.bch')].map((c) => ({ l: c.querySelector('text').textContent, e: c.dataset.e, end: c.classList.contains('end') }));
    return { ends: chips.filter((c) => c.end), branches: chips.filter((c) => !c.end), colours: b.shadowRoot.querySelectorAll('.edges circle.jd:not(.split), .node .port.tagd').length };
  });
  check('0.7.2 the arrows on a shared line each have a letter beside their own end, all different', tg.ends.length >= 4 && new Set(tg.ends.map((c) => c.l)).size === tg.ends.length && tg.ends.every((c) => /^[A-Z]+$/.test(c.l)), tg);
  check('0.7.2 each letter where an arrow branches off is the letter at that arrow\'s end; no colour dots', tg.branches.length >= 2 && tg.branches.every((c) => tg.ends.some((x) => x.e === c.e && x.l === c.l)) && tg.colours === 0, tg);
  const apart = (p, q) => p.x1 + 40 <= q.x0 || q.x1 + 40 <= p.x0 || p.y1 + 40 <= q.y0 || q.y1 + 40 <= p.y0;
  check('0.6.0 two separate chains sit apart as blocks', apart(pk.a, pk.b), pk);
  check('0.6.0 a chain packs beside or under the bigger one, without a column gap between its boxes', pk.b.x1 - pk.b.x0 < 900, pk);
  check('0.6.0 a box with no arrows goes under the chains', pk.c.y0 >= Math.max(pk.a.y1, pk.b.y1), pk);
  check('0.6.0 no errors', page.logs.length === 0, page.logs);
});

test('0.7.0 top to bottom: every function laid out turned, arrows still apart and hopping, ports on top and bottom, Undo', async (browser) => {
  const { page } = await imported(browser);
  const fns = await el(page, (b) => (b._data.functions || []).slice());
  const bad = [];
  for (const id of fns) {
    await el(page, (b, id) => b._open(id), id);
    await page.waitForTimeout(700);
    await el(page, (b) => { const L = b._layout(b._model.label); L.dir = 'down'; L.nodes = {}; b._place(); b._render(); });
    const r = await board(page).evaluate(routeCheck, { min: 16 }), h = await board(page).evaluate(hopCheck);
    // the flow runs down: an arrow's start is above its end, more often than not (back runs go up)
    const down = await el(page, (b) => { const ps = [...b.shadowRoot.querySelectorAll('.edges g > path.e')]; return { n: ps.length, flipped: !!b.shadowRoot.querySelector('.edges g[transform="matrix(0 1 1 0 0 0)"]') }; });
    if (r.error || r.close || r.through || h.error || h.missed || !down.flipped || !down.n) bad.push({ id, r, h, down });
    await el(page, (b) => { const L = b._layout(b._model.label); delete L.dir; L.nodes = {}; b._place(); b._render(); });
  }
  check('0.7.0 top to bottom, in every function no two arrows run within 16 px or through a box, and every crossing hops', fns.length > 0 && !bad.length, bad);

  await openFn(page, /garage/i);
  const G = 'automation.garage_start_open_timer';
  // keep one box in place, then switch from the Auto-arrange menu
  await el(page, (b, k) => { b._select(k); }, G);
  await fbq(page, '.nodebar [data-act="keep"]').click();
  await page.waitForTimeout(200);
  const keptBefore = await el(page, (b) => (b._layout(b._model.label).keep || []).length);
  await fbq(page, '[data-act="arrange"]').click();
  const items = await fbq(page, '.menu .mi').allTextContents();
  check('0.7.0 the Auto-arrange button offers Auto-arrange and the two directions', items.join('|').includes('Auto-arrange') && items.some((t) => /top to bottom/.test(t)) && items.some((t) => /left to right/.test(t)), items);
  await fbq(page, '.menu [data-act="arr-dir"][data-dir="down"]').click();
  await page.waitForTimeout(600);
  const v = await el(page, (b) => {
    const L = b._layout(b._model.label), m = b._model;
    const ord = (a, c) => { const x = m.nodes.get(a), y = m.nodes.get(c); return x && y ? { dy: y.y - x.y, dx: Math.abs(y.x - x.x) } : null; };
    const p = b._els.get('automation.garage_start_open_timer').querySelector('.port.pr');
    const pr = p && getComputedStyle(p), nb = b._els.get('automation.garage_start_open_timer').getBoundingClientRect(), pb = p && p.getBoundingClientRect();
    return { dir: L.dir, keep: (L.keep || []).length, vert: b._$.board.classList.contains('vert'), chain: ord('cover.garage_door', 'automation.garage_start_open_timer'),
      outPort: pb ? { atBottom: Math.abs(pb.top + pb.height / 2 - nb.bottom) < 3, inside: pb.left > nb.left && pb.right < nb.right } : null };
  });
  check('0.7.0 switching to top to bottom is saved, and lets go of the boxes kept in place', keptBefore === 1 && v.dir === 'down' && v.keep === 0 && v.vert, { keptBefore, v });
  check('0.7.0 what sets something off sits above it', v.chain && v.chain.dy > 0, v.chain);
  check('0.7.0 arrows leave a box by its bottom edge', v.outPort && v.outPort.atBottom && v.outPort.inside, v.outPort);
  check('0.7.0 it says the kept box was let go, with Undo', /let go/.test(await fbq(page, '.toast').textContent()));
  const rc = await board(page).evaluate(routeCheck, { min: 16 });
  check('0.7.0 the garage, top to bottom: arrows apart, none through a box', !rc.close && !rc.through, rc);
  // a box dragged and Auto-arrange again keep the direction
  await fbq(page, '[data-act="arrange"]').click();
  await fbq(page, '.menu [data-act="arr-go"]').click();
  await page.waitForTimeout(400);
  check('0.7.0 Auto-arrange keeps the direction', await el(page, (b) => b._vert()));
  // Undo (Auto-arrange straight after the switch changed nothing, so it left no step): back to left to right,
  // with the box kept in place again
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  const u = await el(page, (b) => { const L = b._layout(b._model.label); return { dir: L.dir || 'right', keep: (L.keep || []).length, vert: b._$.board.classList.contains('vert'), ports: !!b.shadowRoot.querySelector('.node .port.pl[style*="top"]') }; });
  check('0.7.0 Undo puts the direction back, and the kept box', u.dir === 'right' && u.keep === 1 && !u.vert && u.ports, u);
  check('0.7.0 no errors', page.logs.length === 0, page.logs);
});

test('0.7.1 sandbox flow view: closing the sandbox mid-flow leaves nothing behind; a debugger run lights as before', async (browser) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  await el(page, (b) => { b._data.ui.sbxIntro = false; });
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  await el(page, (b) => b._sbxDo((e) => e.userSet('cover.garage_door', 'open')));
  const mid = await until(() => el(page, (b) => (b._flow && b._$.litbar.classList.contains('flowbar') && b._$.flow.querySelector('.fnum') ? true : null)), 6000);
  check('0.7.1 a change in the sandbox starts its flow on the board', !!mid);
  await fbq(page, '.drawer [data-act="close"]').click();
  await page.waitForTimeout(1200);
  const after = await el(page, (b) => ({ flow: !!b._flow, lit: !!b._lit, layer: b._$.flow.children.length + b._$.flowx.children.length, bar: b._$.litbar.hidden, cls: b._$.litbar.classList.contains('flowbar'), dots: b._$.edges.querySelectorAll('circle.fdot, g.cres.sbxc').length }));
  check('0.7.1 closing the sandbox mid-flow: no flow, no temporary boxes, numbers or dots left, the bar gone', !after.flow && !after.lit && after.layer === 0 && after.bar && !after.cls && after.dots === 0, after);
  // the debugger's own chain still uses the plain bar
  await el(page, (b) => b._lightSteps([{ kind: 'state', key: 'cover.garage_door', state: 'open' }, { kind: 'run', key: 'automation.garage_start_open_timer' }], null));
  const plain = await el(page, (b) => ({ shown: !b._$.litbar.hidden, cls: b._$.litbar.classList.contains('flowbar'), steps: b._$.litbar.querySelectorAll('.lstep').length, replay: !!b._$.litbar.querySelector('[data-act="lit-replay"]') }));
  check('0.7.1 ... and a debugger chain afterwards lights with its own bar (Replay, no step controls)', plain.shown && !plain.cls && plain.steps === 2 && plain.replay, plain);
});

test('0.7.2 shared lines: point at a box to trace its arrow, tap a letter to keep it traced, upright top to bottom', async (browser) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const ls = [1, 2, 3, 4, 5].map((i) => 'light.l' + i);
  const build = (dir) => el(page, (b, [ls, dir]) => {
    const mk = (key, kind) => ({ key, kind, domain: key.split('.')[0], name: key, icon: 'mdi:circle', badges: new Set(), w: kind === 'outside' ? 204 : 240, h: kind === 'outside' ? 40 : 62, x: 0, y: 0 });
    const keys = ['automation.all_off', ...ls], nodes = new Map(keys.map((k) => [k, mk(k, k.startsWith('light') ? 'outside' : 'member')]));
    b._model = { label: 'fbx-trace', nodes, edges: ls.map((t) => ({ id: 'automation.all_off>' + t, from: 'automation.all_off', to: t, role: 'action', svcs: new Set(), tfs: [], anyTrig: true })) };
    const L = b._layout('fbx-trace'); L.nodes = {}; if (dir) L.dir = dir; else delete L.dir;
    b._data.ui.legend = false; b._renderLegend && b._renderLegend();
    b._place(); b._render(); b._fit();
  }, [ls, dir]);
  const state = () => el(page, (b) => ({ trc: b._$.edges.querySelectorAll('path.trc').length, dim: b._$.edges.querySelectorAll('path.e.trdim').length,
    hi: [...b._$.edges.querySelectorAll('g.bch.trhi')].map((c) => c.dataset.e), keep: !!b._traceKeep, tracing: b._$.board.classList.contains('tracing') }));
  const centre = (k) => el(page, (b, k) => { const r = b._els.get(k).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, k);
  await build(null);
  await page.waitForTimeout(400);
  // the lights whose arrows are on the shared line (one may have a point of its own)
  const onBus = () => el(page, (b) => b._ortho.ids.filter((id, i) => (b._ortho.owners[i] || []).some(Boolean)).map((id) => id.split('>')[1]));
  const bus = await onBus(), L1 = bus[1], L2 = bus[2], L3 = bus[0];
  check('0.7.2 (the five arrows share a line)', bus.length >= 4, bus);
  const [x, y] = await centre(L1);
  await page.mouse.move(x, y);
  await page.waitForTimeout(150);
  const hov = await state();
  check('0.7.2 pointing at a box draws its arrow through the shared line on top, and fades the others on it', hov.trc === 1 && hov.dim >= 1 && hov.tracing && hov.hi.length >= 1 && hov.hi.every((e) => e === 'automation.all_off>' + L1), hov);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  const off = await state();
  check('0.7.2 ... and moving off it puts the line back', off.trc === 0 && off.dim === 0 && !off.tracing, off);
  const src = await el(page, (b) => b._busEdgesOf('automation.all_off').size);
  check('0.7.2 pointing at the box the line starts from traces all of its arrows on it', src === bus.length, [src, bus]);
  await fbq(page, `.edges g.bch[data-e="automation.all_off>${L2}"]`).first().dispatchEvent('click');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  const kept = await state();
  check('0.7.2 tapping a letter keeps its arrow traced (for touch screens)', kept.trc === 1 && kept.keep && kept.hi.every((e) => e === 'automation.all_off>' + L2), kept);
  await fbq(page, `.edges g.bch[data-e="automation.all_off>${L2}"]`).first().dispatchEvent('click');
  const again = await state();
  check('0.7.2 ... tapping it again lets go', again.trc === 0 && !again.keep, again);
  await fbq(page, `.edges g.bch[data-e="automation.all_off>${L3}"]`).first().dispatchEvent('click');
  await el(page, (b) => b._select(null));
  const cleared = await state();
  check('0.7.2 ... and so does clicking elsewhere', cleared.trc === 0 && !cleared.keep, cleared);
  // top to bottom: the letters stay outside the turned group (upright), the traced copy inside it (on its arrow)
  await build('down');
  await page.waitForTimeout(400);
  const V3 = (await onBus())[0];
  await el(page, (b, k) => b._setTrace(b._busEdgesOf(k)), V3);
  const v = await el(page, (b) => {
    const chips = [...b._$.edges.querySelectorAll('g.bch')], trc = b._$.edges.querySelector('path.trc');
    return { chips: chips.length, upright: chips.every((c) => c.parentNode === b._$.edges), turned: !!trc && trc.parentNode.getAttribute('transform') === 'matrix(0 1 1 0 0 0)' };
  });
  check('0.7.2 top to bottom: the letters read upright and the trace follows the turned arrows', v.chips >= 6 && v.upright && v.turned, v);
  await el(page, (b) => b._setTrace(null));
  check('0.7.2 no errors', page.logs.length === 0, page.logs);
});

(async () => {
  const browser = await chromium.launch();
  for (const [name, fn] of cases) {
    if (only && !only.test(name)) continue;
    console.log('-- ' + name);
    try { await fn(browser); } catch (e) { check(name + ' (ran to the end)', false, e.message.split('\n')[0]); }
  }
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
