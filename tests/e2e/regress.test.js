// One check per fixed bug and per new board behaviour, on the real test Home Assistant.
// Run apitest.py first (tokens). node regress.test.js [filter]   (filter: run only cases whose name matches)
const path = require('path');
const { chromium, BASE, SHOTS, session, ws, svc, states, ready, fbq, board, until, suite, reset, importAll, openFn, sleep } = require('./lib');
const { test: pwTest } = require('./fixtures');
const test = (name, fn) => (only && !only.test(name) ? pwTest.skip(name, () => {}) : pwTest(name, fn));
const { check, done } = suite('regress');
// FB_ONLY=<pattern> runs only the parts whose names match (Playwright's --grep picks whole tests)
const only = process.env.FB_ONLY ? new RegExp(process.env.FB_ONLY, 'i') : null;
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


test('1.2 leaving the page on a phone stops the board', async ({ browser }) => {
  // its own function to look at (it used to rely on the case before it leaving one open)
  const { ctx, page } = await imported(browser, { mobile: true });
  await openFn(page, /garage/i);
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

test('3.1 import skips a piece without a unique ID and still finishes', async ({ browser }) => {
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

test('1.7 a running script keeps its box layout', async ({ browser }) => {
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

test('1.8 Existing adds to the function on screen', async ({ browser }) => {
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

test('1.9 an item made in the drawer keeps its label after the editor saves', async ({ browser }) => {
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

test('1.10 saving an automation redraws its arrows', async ({ browser }) => {
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

test('1.11 hiding is not deleting, and the name check brings it back', async ({ browser }) => {
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


test('8.1 Helper offers the types and opens the create dialog directly', async ({ browser }) => {
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


// switch the integration between Organise only and Full manager through its options flow
async function setMode(page, mode) {
  const entries = await ws(page, { type: 'config_entries/get', domain: 'functions_board' });
  const flow = await api(page, 'POST', 'config/config_entries/options/flow', { handler: entries[0].entry_id });
  await api(page, 'POST', 'config/config_entries/options/flow/' + flow.flow_id, { mode, card: false });
  await until(() => el(page, (b, m) => b._fbMode === m, mode), 8000);
}

test('8.4 Organise only hides delete; Full manager shows it', async ({ browser }) => {
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

test('8.2 delete an item, a function, and a function with its items; undo each', async ({ browser }) => {
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

test('Phase 2: area targets, purpose-specific triggers, helper inputs, scenes', async ({ browser }) => {
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

test('3.2 leftovers and coverage; 3.3 device chains (off by default)', async ({ browser }) => {
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

test('4.2 each function has an address; Back and reload work', async ({ browser }) => {
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

test('4.9 the board follows the user\'s language, English where a text is missing', async ({ browser }) => {
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

test('Edit on a helper opens its settings; without an ID, it says why not', async ({ browser }) => {
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



test('9.5 a notification\'s buttons are wired to the automations that answer them', async ({ browser }) => {
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

test('0.5.4 phone app: editors open full screen, and what is created there joins the function', async ({ browser }) => {
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

test('0.5.4 back from an editor: the board draws from what it had, then catches up', async ({ browser }) => {
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




test('0.7.1 sandbox flow view: closing the sandbox mid-flow leaves nothing behind; a debugger run lights as before', async ({ browser }) => {
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





test('0.9.0 saved checks: a sandbox run kept with what should come of it, replayed after every change', async ({ browser }) => {
  const { page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  const DOOR = 'cover.garage_door', AUTO = 'input_boolean.garage_auto_close';
  const script0 = await api(page, 'GET', 'config/script/config/close_garage');
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  const idle = () => until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 20000);
  check('0.9.0 Save as a check waits until something\'s been done in the sandbox', await el(page, (b) => b._$.drawer.querySelector('[data-act="chk-save"]').disabled));
  for (const [ent, val] of [[AUTO, 'on'], [DOOR, 'open']]) {
    await fbq(page, '.drawer .sbent').selectOption(ent);
    await fbq(page, '.drawer .sbval-sel').selectOption(val);
    await fbq(page, '.drawer [data-act="sbx-set"]').click();
    await idle();
  }
  await fbq(page, '.drawer [data-act="sbx-next"]').click();
  await idle();
  check('0.9.0 the sandbox ran it: the door closed there', (await el(page, (b, k) => b._sbx.eng.get(k).state, DOOR)) === 'closed');
  await fbq(page, '.drawer [data-act="chk-save"]').click();
  await fbq(page, '.modal .ckdlg').waitFor({ timeout: 5000 });
  const dlg = await el(page, (b) => ({ steps: [...b._$.modal.querySelectorAll('.cksteps li')].map((l) => l.textContent), x: [...b._$.modal.querySelectorAll('input[name="ckx"]')].map((c) => [c.parentNode.textContent, c.checked]) }));
  check('0.9.0 the dialog lists the steps you took', dlg.steps.length === 3 && /Set .*Auto.*on/i.test(dlg.steps[0]) && /Set Garage Door to open/.test(dlg.steps[1]) && /Clock to what/.test(dlg.steps[2]), dlg.steps);
  check('0.9.0 ... and suggests what came of it, ticked: the door ends closed, what ran ran', dlg.x.some(([t, on]) => /Garage Door ends closed/.test(t) && on) && dlg.x.some(([t, on]) => /Garage: left open runs to the end/.test(t) && on) && dlg.x.some(([t, on]) => /Close garage runs to the end/.test(t) && on), dlg.x);
  await fbq(page, '.modal input[name="ckname"]').fill('Left open: closes itself');
  await fbq(page, '.modal [data-act="chk-save-go"]').click();
  const saved = await until(async () => { const L = (await store(page)).layouts[lid]; return L && (L.checks || []).length ? L.checks : null; }, 8000);
  check('0.9.0 it\'s kept in the function\'s layout (shared, synced)', !!saved && saved[0].name === 'Left open: closes itself' && saved[0].steps.length === 3 && saved[0].start[DOOR].state === 'closed', saved && saved[0]);
  const pass = await until(() => el(page, (b) => { const r = b.shadowRoot.querySelector('.sbchk .ckst'); return r && (r.classList.contains('ok') || r.classList.contains('bad')) ? r.className : null; }), 20000);
  check('0.9.0 it runs straight away and passes', /ok/.test(pass || ''), pass);
  // someone breaks the script: the check fails, and the function shows it as a problem
  await api(page, 'POST', 'config/script/config/close_garage', Object.assign({}, script0, { sequence: script0.sequence.filter((x) => x.action !== 'cover.close_cover') }));
  await el(page, (b) => b._configChanged());
  const fail = await until(() => el(page, (b) => (b._model && (b._model.problems || []).find((p) => p.kind === 'c_failed')) || null), 25000);
  check('0.9.0 after an edit that stops it working, the check fails as a problem, saying what it got', !!fail && /Left open: closes itself/.test(fail.name) && /Garage Door ends closed \(got open\)/.test(fail.detail), fail);
  check('0.9.0 ... counted in the header', /problem/.test(await el(page, (b) => (b.shadowRoot.querySelector('.pchip') || {}).textContent || '')));
  // fixed: it passes again
  await api(page, 'POST', 'config/script/config/close_garage', script0);
  await el(page, (b) => b._configChanged());
  const ok2 = await until(() => el(page, (b) => (b._model && !(b._model.problems || []).some((p) => /^c_/.test(p.kind)) && b._checkRes.get(b._data.ui.current) && [...b._checkRes.get(b._data.ui.current).res.values()].every((r) => r.ok)) || null), 25000);
  check('0.9.0 put right, it passes again and the problem goes', !!ok2);
  // replay: its own states and steps, played in the sandbox
  await el(page, (b) => b._closeDrawer());
  await el(page, (b, id) => b._checkReplay(id), saved[0].id);
  const rep = await until(() => el(page, (b, k) => (b._sbx && !b._sbx.busy && b._sbx.rec.steps.length === 3 ? b._sbx.eng.get(k).state : null), DOOR), 30000);
  check('0.9.0 Replay plays it in the sandbox from its own states: the door ends closed again', rep === 'closed', rep);
  await el(page, (b) => b._closeDrawer());
  page.allowFail = [/^automation\/config$/, /^script\/config$/];
  check('0.9.0 saved checks: no errors', page.logs.length === 0, page.logs);
});



pwTest.afterAll(() => done());
