// Regress cases on the fake Home Assistant (layer 3): one per fixed bug or new behaviour, named by the version it
// shipped in, for what needs no real Home Assistant (moved here from tests/e2e/regress.test.js in 0.9.1; the ones that
// do need it stay there). FB_ONLY=<pattern> runs only the cases whose names match.
const path = require('path');
const { chromium, BASE, SHOTS, session, ws, svc, states, ready, fbq, board, until, suite, reset, importAll, openFn, sleep } = require('./helpers');
const { test: pwTest } = require('./fixtures');
const only = process.env.FB_ONLY ? new RegExp(process.env.FB_ONLY, 'i') : null;
const test = (name, fn) => (only && !only.test(name) ? pwTest.skip(name, () => {}) : pwTest(name, fn));
const { check, done } = suite('board-regress');
const { routeCheck } = require('../e2e/routecheck');
const { hopCheck } = require('../e2e/hopcheck');
const GARAGE = ['automation.garage_start_open_timer', 'automation.garage_left_open', 'automation.garage_closed_stop_timer'];

async function imported(browser, opts) {
  const s = await session(browser, 'owner', opts);
  await importAll(s.page);
  return s;
}
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const store = async (page) => (await ws(page, { type: 'functions_board/get' })).data;
const regEntry = (page, id) => ws(page, { type: 'config/entity_registry/get', entity_id: id });
const regWhenThere = async (page, id) => ((await page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], id)) ? regEntry(page, id).catch(() => null) : null);
const hasLabel = async (page, id, label) => { const r = await regWhenThere(page, id); return !!r && (r.labels || []).includes(label); };
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b).catch((e) => { throw new Error(m + ' ' + p + ': ' + JSON.stringify(e)); }), [method, p, body]);

test('1.1 Resume leaves off what was off before Pause', async ({ browser }) => {
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

test('4.1 Fit shows everything on a second press; the action bar stays on screen', async ({ browser }) => {
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

test('8.3 undo and redo for moves and frames', async ({ browser }) => {
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

test('4.4 find anything; 4.6 unwired pieces explained', async ({ browser }) => {
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

test('Phase 7: highlight modes, filters, nearest sides, new boxes by their neighbour', async ({ browser }) => {
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

test('0.5.4 touch: a box moves only after a hold; a quick swipe pans', async ({ browser }) => {
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

test('0.6.0 square-cornered arrows: never alongside each other, colours by meaning, Auto-arrange, separate chains packed', async ({ browser }) => {
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
  // five arrows out of one box: they share its three points (0.7.2: no letters or colours, a plain dot at branches)
  const tg = await el(page, (b) => {
    const mk = (key, kind) => ({ key, kind, domain: key.split('.')[0], name: key, icon: 'mdi:circle', badges: new Set(), w: kind === 'outside' ? 204 : 240, h: kind === 'outside' ? 40 : 62, x: 0, y: 0 });
    const ls = [1, 2, 3, 4, 5].map((i) => 'light.l' + i), keys = ['automation.all_off', ...ls];
    const nodes = new Map(keys.map((k) => [k, mk(k, k.startsWith('light') ? 'outside' : 'member')]));
    b._model = { label: 'fbx-tags', nodes, edges: ls.map((t) => ({ id: 'automation.all_off>' + t, from: 'automation.all_off', to: t, role: 'action', svcs: new Set(), tfs: [], anyTrig: true })) };
    b._layout('fbx-tags').nodes = {};
    b._place(); b._render();
    return { letters: b.shadowRoot.querySelectorAll('.edges g.bch, .edges text.bl').length, colours: b.shadowRoot.querySelectorAll('.node .port.tagd, .edges circle.jd[style*="fill"]').length,
      joins: b.shadowRoot.querySelectorAll('.edges circle.jd').length, bus: b._ortho.owners.filter((o) => (o || []).some(Boolean)).length };
  });
  check('0.7.2 shared lines carry no letters or colours: a plain dot where an arrow branches off', tg.bus >= 4 && tg.letters === 0 && tg.colours === 0 && tg.joins >= 2, tg);
  const apart = (p, q) => p.x1 + 40 <= q.x0 || q.x1 + 40 <= p.x0 || p.y1 + 40 <= q.y0 || q.y1 + 40 <= p.y0;
  check('0.6.0 two separate chains sit apart as blocks', apart(pk.a, pk.b), pk);
  check('0.6.0 a chain packs beside or under the bigger one, without a column gap between its boxes', pk.b.x1 - pk.b.x0 < 900, pk);
  check('0.6.0 a box with no arrows goes under the chains', pk.c.y0 >= Math.max(pk.a.y1, pk.b.y1), pk);
  check('0.6.0 no errors', page.logs.length === 0, page.logs);
});

test('0.7.0 top to bottom: every function laid out turned, arrows still apart and hopping, ports on top and bottom, Undo', async ({ browser }) => {
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

test('0.7.2 shared lines: point at a box to trace its arrow, select it to keep it traced, top to bottom', async ({ browser }) => {
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
    hi: [...b._$.edges.querySelectorAll('path.trc')].length, keep: !!b._traceKeep, tracing: b._$.board.classList.contains('tracing') }));
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
  check('0.7.2 pointing at a box draws its arrow through the shared line on top, and fades the others on it', hov.trc === 1 && hov.dim >= 1 && hov.tracing, hov);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  const off = await state();
  check('0.7.2 ... and moving off it puts the line back', off.trc === 0 && off.dim === 0 && !off.tracing, off);
  const src = await el(page, (b) => b._busEdgesOf('automation.all_off').size);
  check('0.7.2 pointing at the box the line starts from traces all of its arrows on it', src === bus.length, [src, bus]);
  await el(page, (b, k) => b._select(k), L2);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  const kept = await state();
  check('0.7.2 selecting a box keeps its arrow traced (how a touch screen traces it)', kept.trc === 1 && kept.keep && kept.dim >= 1, kept);
  await el(page, (b) => b._select(null));
  const cleared = await state();
  check('0.7.2 ... and selecting nothing lets go', cleared.trc === 0 && !cleared.keep, cleared);
  // top to bottom: the traced copy is drawn inside the turned group, on its arrow
  await build('down');
  await page.waitForTimeout(400);
  const V3 = (await onBus())[0];
  await el(page, (b, k) => b._setTrace(b._busEdgesOf(k)), V3);
  const v = await el(page, (b) => {
    const trc = b._$.edges.querySelector('path.trc');
    return { turned: !!trc && trc.parentNode.getAttribute('transform') === 'matrix(0 1 1 0 0 0)' };
  });
  check('0.7.2 top to bottom: the trace follows the turned arrows', v.turned, v);
  await el(page, (b) => b._setTrace(null));
  check('0.7.2 no errors', page.logs.length === 0, page.logs);
});

test('0.8.1 the Key: "simulated state" is on the same line as its mark', async ({ browser }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  await el(page, (b) => { b._data.ui.legend = true; b._renderLegend(); });
  await page.waitForTimeout(300);
  const k = await el(page, (b) => {
    const mark = b.shadowRoot.querySelector('.legend .sw.dashed2'), text = mark && mark.nextSibling;
    if (!mark || !text) return null;
    const r = document.createRange(); r.selectNodeContents(text);
    const m = mark.getBoundingClientRect(), t = r.getBoundingClientRect();
    return { mark: [m.left, m.top, m.bottom], text: [t.left, t.top, t.bottom], words: text.textContent };
  });
  check('0.8.1 the simulated-state mark sits just before its words, on their line', !!k && k.text[0] - k.mark[0] < 60 && k.text[0] > k.mark[0] && Math.abs((k.mark[1] + k.mark[2]) / 2 - (k.text[1] + k.text[2]) / 2) < 10, k);
  check('0.8.1 no errors', page.logs.length === 0, page.logs);
});

test('0.9.0 problems: what an automation points at that isn\'t there, on the list, the header, the boxes, the arrows and the drawer', async ({ browser }) => {
  const { page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  const ID = 'fbprob1', KEY = 'automation.garage_points_at_gone_things';
  await api(page, 'POST', `config/automation/config/${ID}`, { alias: 'Garage: points at gone things', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door_old', to: 'open' }], actions: [{ action: 'notify.mobile_app_gone_phone', data: { message: 'x' } }, { action: 'cover.close_cover', target: { entity_id: 'cover.garage_door' } }] });
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], KEY), 10000);
  // on (Home Assistant restores the last state of an automation with this ID, from an earlier run)
  await svc(page, 'automation', 'turn_on', {}, { entity_id: KEY });
  await ws(page, { type: 'config/entity_registry/update', entity_id: KEY, labels: [lid] });
  const probs = () => el(page, (b) => ((b._model && b._model.problems) || []).map((p) => `${p.sev} ${p.kind} ${p.ref}`).sort());
  const got = await until(async () => { const p = await probs(); return p.length >= 2 ? p : null; }, 15000);
  check('0.9.0 a renamed or removed entity it triggers on, and an action that doesn\'t exist, are found', JSON.stringify(got) === JSON.stringify(['error e_missing cover.garage_door_old', 'error s_missing notify.mobile_app_gone_phone']), got);
  const ui = await until(() => el(page, (b, [k, l]) => {
    const r = b.shadowRoot, chip = r.querySelector('.pchip'), badge = r.querySelector(`.fn[data-fn="${l}"] .pbadge`);
    const box = r.querySelector(`.node[data-key="cover.garage_door_old"] ha-icon.prob`), auto = r.querySelector(`.node[data-key="${k}"] ha-icon.prob`);
    const arrow = [...r.querySelectorAll('path.e.prob')].map((p) => p.dataset.edge);
    return chip && badge ? { chip: chip.textContent.trim(), chipErr: chip.classList.contains('p-error'), badge: badge.querySelector('[aria-hidden="true"]').textContent, badgeErr: badge.classList.contains('p-error'), box: box && box.classList.contains('p-error') ? box.title : null, auto: !!auto, arrow } : null;
  }, [KEY, lid]), 10000);
  check('0.9.0 the header says how many, in red', !!ui && ui.chip === '2 problems' && ui.chipErr, ui);
  check('0.9.0 ... and so does the function in the list', !!ui && ui.badge === '2' && ui.badgeErr, ui);
  check('0.9.0 the missing thing\'s box is marked, saying what\'s wrong', !!ui && /doesn.t exist: renamed or removed\?/.test(ui.box || ''), ui && ui.box);
  check('0.9.0 ... the automation pointing at it too, and the arrow between them is marked', !!ui && ui.auto && ui.arrow.some((e) => e === `cover.garage_door_old>${KEY}`), ui);
  await fbq(page, '.pchip').click();
  await fbq(page, '.drawer .probs .prow').first().waitFor({ timeout: 5000 });
  const dr = await el(page, (b) => [...b._$.drawer.querySelectorAll('.prow')].map((r) => ({ cls: r.className, text: r.querySelector('.ptxt').textContent, by: (r.querySelector('.pby') || {}).textContent || '', edit: !!r.querySelector('[data-act="prob-open"]') })));
  check('0.9.0 the Problems drawer lists each, what it\'s in, with a way to edit it', dr.length === 2 && dr.every((r) => /p-error/.test(r.cls) && /Garage: points at gone things/.test(r.by) && r.edit) && /notify\.mobile_app_gone_phone doesn.t exist/.test(dr.map((r) => r.text).join(' ')), dr);
  await fbq(page, '.drawer .prow [data-act="prob-go"][data-key="cover.garage_door_old"]').click();
  check('0.9.0 Show selects the thing on the board', (await el(page, (b) => b._sel)) === 'cover.garage_door_old');
  // turned off: a warning too (amber, may be on purpose)
  await svc(page, 'automation', 'turn_off', {}, { entity_id: KEY });
  await el(page, (b) => b._open(b._data.ui.current, true));
  const w = await until(async () => { const p = await probs(); return p.includes(`warn m_off ${KEY}`) ? p : null; }, 10000);
  check('0.9.0 an automation that\'s off is a warning', !!w && w.length === 3, w);
  // fixed: gone again (the board may still ask once for the deleted automation's config)
  page.allowFail = [/^automation\/config$/];
  await api(page, 'DELETE', `config/automation/config/${ID}`);
  await until(() => page.evaluate((k) => !document.querySelector('home-assistant').hass.states[k], KEY), 10000);
  await el(page, (b) => { b._configChanged(); return b._open(b._data.ui.current, true); });
  const clean = await until(() => el(page, (b, l) => (!(b._model.problems || []).length && !b.shadowRoot.querySelector('.pchip') && !b.shadowRoot.querySelector(`.fn[data-fn="${l}"] .pbadge`)) || null, lid), 10000);
  check('0.9.0 once it\'s fixed, the marks, the count and the badge go', !!clean);
  check('0.9.0 problems: no errors', page.logs.length === 0, page.logs);
});

test('0.9.0 dismissing problems: out of the count, the list and the board, under Dismissed, back on request, forgotten a day after it\'s fixed', async ({ browser }) => {
  const { page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  const ID = 'fbdis1', KEY = 'automation.garage_dismiss_these';
  const MISS = 'e_missing|cover.garage_door_old', SVC = 's_missing|notify.mobile_app_gone_phone';
  await api(page, 'POST', `config/automation/config/${ID}`, { alias: 'Garage: dismiss these', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door_old', to: 'open' }], actions: [{ action: 'notify.mobile_app_gone_phone', data: { message: 'x' } }, { action: 'cover.close_cover', target: { entity_id: 'cover.garage_door' } }] });
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], KEY), 10000);
  await svc(page, 'automation', 'turn_on', {}, { entity_id: KEY });
  await ws(page, { type: 'config/entity_registry/update', entity_id: KEY, labels: [lid] });
  // what the person sees: the header's chip and Dismissed button, the list's badge, the marks on the board
  const seen = () => el(page, (b, [l, k]) => {
    const r = b.shadowRoot, chip = r.querySelector('.pchip'), dis = r.querySelector('.pdchip'), badge = r.querySelector(`.fn[data-fn="${l}"] .pbadge`);
    return {
      n: ((b._model && b._model.problems) || []).length, chip: chip ? chip.textContent.trim() : null, dis: dis ? dis.textContent.trim() : null,
      badge: badge ? badge.querySelector('[aria-hidden="true"]').textContent : null,
      box: !!r.querySelector('.node[data-key="cover.garage_door_old"] ha-icon.prob'), arrow: [...r.querySelectorAll('path.e.prob')].some((p) => p.dataset.edge === `cover.garage_door_old>${k}`),
      rows: [...b._$.drawer.querySelectorAll('.prow')].length,
    };
  }, [lid, KEY]);
  const stored = async () => ((await store(page)).layouts[lid] || {}).dismissed || [];
  const two = await until(async () => { const v = await seen(); return v.n === 2 && v.badge === '2' ? v : null; }, 15000);
  check('0.9.0 two problems to start with: "2 problems", badge 2, nothing dismissed', !!two && two.chip === '2 problems' && !two.dis, two);
  await fbq(page, '.pchip').click();
  await fbq(page, '.drawer .probs .prow').first().waitFor({ timeout: 5000 });
  const btn = await el(page, (b, k) => { const x = b._$.drawer.querySelector(`[data-act="pdis"][data-k="${k}"]`); return x && x.getAttribute('aria-label'); }, SVC);
  check('0.9.0 each problem has a Dismiss button that says which one', /^Dismiss: The action notify\.mobile_app_gone_phone doesn.t exist/.test(btn || ''), btn);
  await fbq(page, `.drawer [data-act="pdis"][data-k="${SVC}"]`).click();
  const one = await until(async () => { const v = await seen(); return v.n === 1 ? v : null; }, 5000);
  check('0.9.0 two problems, one dismissed: the chip stays, says 1, and Dismissed appears', !!one && one.chip === '1 problem' && one.dis === '1 dismissed', one);
  check('0.9.0 ... the list\'s badge counts down to 1', !!one && one.badge === '1', one);
  check('0.9.0 ... and the drawer lists the one left, with a way to the dismissed one', !!one && one.rows === 1 && (await el(page, (b) => !!b._$.drawer.querySelector('.pother [data-act="pdis-list"]'))), one);
  const st1 = await until(async () => { const d = await stored(); return d.length ? d : null; }, 5000);
  check('0.9.0 the dismissal is kept with the function (shared, synced): what, and when', !!st1 && st1.length === 1 && st1[0].k === SVC && st1[0].at > 0 && !st1[0].gone, st1);
  // the toast's Undo brings it straight back
  await fbq(page, '.toast:not([hidden]) [data-act="toast-act"]').click();
  const undone = await until(async () => { const v = await seen(); return v.n === 2 ? v : null; }, 5000);
  check('0.9.0 Undo on the toast brings it back', !!undone && undone.chip === '2 problems' && !undone.dis && undone.badge === '2', undone);
  await fbq(page, `.drawer [data-act="pdis"][data-k="${SVC}"]`).click();
  await until(async () => (await seen()).n === 1 || null, 5000);
  await fbq(page, `.drawer [data-act="pdis"][data-k="${MISS}"]`).click();
  const none = await until(async () => { const v = await seen(); return v.n === 0 ? v : null; }, 5000);
  check('0.9.0 the only problem left, dismissed: the chip goes, Dismissed stays (2)', !!none && !none.chip && none.dis === '2 dismissed', none);
  check('0.9.0 ... the badge next to the function\'s name goes', !!none && !none.badge, none);
  check('0.9.0 ... and so do the marks on the box and the arrow', !!none && !none.box && !none.arrow, none);
  // the Dismissed menu: what's there, and Bring back
  await el(page, (b) => b._closeDrawer());
  await fbq(page, '.pdchip').click();
  await fbq(page, '.drawer .probs .prow').first().waitFor({ timeout: 5000 });
  const menu = await el(page, (b) => ({ title: b._$.drawer.querySelector('.dtitle').textContent, rows: [...b._$.drawer.querySelectorAll('.prow')].map((r) => r.querySelector('.ptxt').textContent), back: b._$.drawer.querySelectorAll('[data-act="pdis-back"]').length, dis: b._$.drawer.querySelectorAll('[data-act="pdis"]').length }));
  check('0.9.0 Dismissed opens the dismissed ones, each with Bring back', /^Dismissed: /.test(menu.title) && menu.rows.length === 2 && menu.back === 2 && menu.dis === 0, menu);
  await fbq(page, `.drawer [data-act="pdis-back"][data-k="${MISS}"]`).click();
  const back = await until(async () => { const v = await seen(); return v.n === 1 ? v : null; }, 5000);
  check('0.9.0 Bring back: it counts again, on the chip, the badge and the board', !!back && back.chip === '1 problem' && back.dis === '1 dismissed' && back.badge === '1' && back.box, back);
  // a fresh page: still dismissed
  await page.reload();
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  const again = await until(async () => { const v = await seen(); return v.n === 1 && v.dis ? v : null; }, 15000);
  check('0.9.0 after a reload, what was dismissed still is', !!again && again.chip === '1 problem' && again.dis === '1 dismissed', again);
  // fixed: the dismissal notes since when, and is forgotten a day later
  page.allowFail = [/^automation\/config$/];
  await api(page, 'DELETE', `config/automation/config/${ID}`);
  await until(() => page.evaluate((k) => !document.querySelector('home-assistant').hass.states[k], KEY), 10000);
  await el(page, (b) => { b._configChanged(); return b._open(b._data.ui.current, true); });
  const gone = await until(async () => { const d = await stored(); return d.length && d[0].gone ? d : null; }, 10000);
  check('0.9.0 once the problem is fixed, the dismissal notes when it went', !!gone && gone.length === 1 && gone[0].k === SVC, gone);
  check('0.9.0 ... and nothing shows: no chip, no Dismissed, no badge', !!(await until(async () => { const v = await seen(); return !v.chip && !v.dis && !v.badge ? v : null; }, 5000)));
  await el(page, (b, l) => { b._data.layouts[l].dismissed[0].gone -= 25 * 3600 * 1000; return b._open(b._data.ui.current, true); }, lid);
  const forgot = await until(async () => { const d = await stored(); return d.length === 0 ? true : null; }, 10000);
  check('0.9.0 a day after it\'s fixed the dismissal is forgotten (so if it breaks again, it shows)', !!forgot);
  check('0.9.0 dismissing: no errors', page.logs.length === 0, page.logs);
});

test('0.9.1 focus goes back to what opened a dialog or the drawer, even when the board redrew it meanwhile', async ({ browser }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const focused = () => el(page, (b) => { const a = b.shadowRoot.activeElement; return a ? (a.dataset.act || a.className || a.tagName) : null; });
  await fbq(page, '.lfoot [data-act="about"]').focus();
  await page.keyboard.press('Enter');
  await fbq(page, '.modal .dlg').waitFor({ timeout: 5000 });
  // the list is drawn anew while the dialog is open (a count changed): the About button is a new element
  await el(page, (b) => b._renderList());
  await page.keyboard.press('Escape');
  const back = await until(async () => { const f = await focused(); return f === 'about' ? f : null; }, 3000);
  check('0.9.1 a dialog gives focus back to its button, though the list was redrawn while it was open', back === 'about', await focused());
  await fbq(page, '.tools [data-act="runs"]').focus();
  await page.keyboard.press('Enter');
  await fbq(page, '.drawer .dhead').waitFor({ timeout: 5000 }); await page.waitForTimeout(200);
  await el(page, (b) => b._renderHeader());
  await page.keyboard.press('Escape');
  const back2 = await until(async () => { const f = await focused(); return f === 'runs' ? f : null; }, 3000);
  check('0.9.1 ... and so does the drawer, though the toolbar was redrawn', back2 === 'runs', await focused());
  check('0.9.1 focus back: no errors', page.logs.length === 0, page.logs);
});

test('0.9.1 a layout another board saved meanwhile, unheard of: the save meets the conflict and takes that layout', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const label = await el(page, (b) => b._model.label);
  // this board's first save, so the store has its layout at a revision this board knows
  await el(page, (b) => { const L = b._data.layouts[b._model.label]; L.notes = (L.notes || []).concat([{ id: 'n1', text: 'mine', x: 0, y: 0 }]); b._save(); });
  await until(() => ((fake.store.data.layouts || {})[label] || { notes: [] }).notes.some((n) => n.text === 'mine') || null, 8000);
  // another board saves it, and word of that doesn't reach this one (lost, or still on its way)
  const other = JSON.parse(JSON.stringify(fake.store.data.layouts[label]));
  other.notes = [{ id: 'n2', text: 'from the other board', x: 40, y: 40 }];
  fake.store.data = Object.assign({}, fake.store.data, { layouts: Object.assign({}, fake.store.data.layouts, { [label]: other }) });
  fake.store.revs = Object.assign({}, fake.store.revs, { [label]: (fake.store.revs[label] || 0) + 1 });
  // this board then changes it too: its save carries the old revision
  await el(page, (b) => { const L = b._data.layouts[b._model.label]; L.notes = (L.notes || []).concat([{ id: 'n3', text: 'mine too', x: 80, y: 0 }]); b._save(); });
  const took = await until(() => el(page, (b, l) => ((b._data.layouts[l] || {}).notes || []).some((n) => n.text === 'from the other board') || null, label), 8000);
  const kept = (fake.store.data.layouts[label].notes || []).map((n) => n.text);
  check('0.9.1 a save at a stale revision is refused, and this board takes the other board\'s layout', !!took && kept.join() === 'from the other board', { kept, mine: await el(page, (b, l) => (b._data.layouts[l].notes || []).map((n) => n.text), label) });
  check('0.9.1 ... and says it was rearranged on another board', /another board/.test(await fbq(page, '.toast').textContent().catch(() => '')));
  check('0.9.1 conflict: no errors', page.logs.length === 0, page.logs);
});

test('0.9.1 a simulated state stays marked when Home Assistant\'s word of it comes after its answer', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const DOOR = 'cover.garage_door';
  // the answer to setting the state comes first, the state event 300 ms later (on a busy Home Assistant)
  fake.stateLag = 300;
  await el(page, (b, k) => b._execTest({ kind: 'state', target: k, state: 'open' }), DOOR);
  const mark = () => el(page, (b, k) => { const n = b._els.get(k); return !!n && n.classList.contains('sim'); }, DOOR);
  const shown = await until(async () => (await mark()) || null, 3000);
  await sleep(800);
  check('0.9.1 a simulated state is marked, though Home Assistant\'s state event came after its answer', !!shown && await mark());
  await fake.setState(DOOR, 'closed');
  check('0.9.1 ... and the mark goes when the device reports', await until(async () => !(await mark()) || null, 3000));
  check('0.9.1 simulated: no errors', page.logs.length === 0, page.logs);
});

test('0.9.1 an arrow\'s choices come in the same order every time, whatever order Home Assistant lists them in', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const k = 'input_boolean.garage_auto_close';
  const order = async (list) => {
    fake.answers = { get_triggers_for_target: list, get_conditions_for_target: list.map((t) => t.replace('turned_', 'is_')) };
    return el(page, (b, k) => b._linkChoices({ kinds: ['trigger', 'condition'], other: k }).then((cs) => cs.map((c) => c.item.trigger || c.item.condition)), k);
  };
  const a = await order(['switch.turned_on', 'switch.turned_off']), b = await order(['switch.turned_off', 'switch.turned_on']);
  fake.answers = null;
  check('0.9.1 an arrow\'s choices come in one order, whatever order Home Assistant lists them in (they were in its order, which changes)', JSON.stringify(a) === JSON.stringify(b) && a.length >= 4, { a, b });
});

test('0.9.2 a board started on another board\'s registries keeps a function made elsewhere since', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  // this board closes (you go to another page in Home Assistant); its registries stay for the next board in this tab
  await page.evaluate(() => { document.querySelector('functions-board').remove(); });
  // meanwhile another admin, on another device, makes a function: a new label, on the list, with a layout
  const lid = 'fb_elsewhere';
  fake.labels.push({ label_id: lid, name: 'Made elsewhere', icon: 'mdi:star', color: null, description: null, created_at: Date.now() / 1000, modified_at: Date.now() / 1000 });
  const layout = { nodes: { 'automation.garage_left_open': { x: 10, y: 20 } }, notes: [{ id: 'n1', text: 'from the other board', x: 0, y: 0 }] };
  fake.store.data = Object.assign({}, fake.store.data, { functions: fake.store.data.functions.concat([lid]), layouts: Object.assign({}, fake.store.data.layouts, { [lid]: layout }) });
  fake.store.revs = Object.assign({}, fake.store.revs, { [lid]: 1 });
  // you come back to the board within a few minutes: a new board element in the same tab
  await page.evaluate(() => window.__fbAttach());
  await until(() => el(page, (b) => !!(b._data && !b._booting) || null), 10000);
  await fake.idle(800);
  const kept = fake.store.data.layouts[lid], listed = fake.store.data.functions.includes(lid);
  check('0.9.2 the other board\'s function and its layout are still in the store', !!kept && listed && JSON.stringify(kept) === JSON.stringify(layout), { listed, kept });
  check('0.9.2 ... and this board shows it', await until(() => el(page, (b, l) => b._data.functions.includes(l) || null, lid), 5000), await el(page, (b) => b._data.functions));
  check('0.9.2 warm registries: no errors', page.logs.length === 0, page.logs);
});

test('0.9.1 a focused box keeps focus when the board is drawn again around it', async ({ browser }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  // a box, focused from the keyboard (as roving focus does), then the board drawn anew (a state or a config
  // changed): every box is a new element, and focus must land on the same box again, not on the page
  const key = await el(page, (b) => { const n = [...b._els.values()][1]; n.focus(); return n.dataset.key; });
  await el(page, (b) => b._render());
  const now = await el(page, (b) => { const a = b.shadowRoot.activeElement; return a && a.classList.contains('node') ? a.dataset.key : (a ? a.tagName : null); });
  check('0.9.1 a focused box keeps focus when the board is drawn again', !!key && now === key, { key, now });
  check('0.9.1 redraw focus: no errors', page.logs.length === 0, page.logs);
});

test('0.10.0 the same board taken off the page and put back carries on', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const DOOR = 'cover.garage_door';
  // (the door is outside the function: its state is in its box's title)
  const sub = () => el(page, (b, k) => { const n = b._els.get(k); return n ? n.getAttribute('title') : null; }, DOOR);
  // taken off (its clock stops) and the same element put back, as a dashboard does with a card it moves
  await page.evaluate(() => { const b = document.querySelector('functions-board'), p = b.parentNode; b.remove(); window.__fbBack = () => p.appendChild(b); });
  await sleep(300);
  await page.evaluate(() => window.__fbBack());
  await fake.idle(400);
  const was = await sub();
  await fake.setState(DOOR, was && /· open/i.test(was) ? 'closed' : 'open');
  const want = was && /· open/i.test(was) ? /· closed/i : /· open/i;
  const now = await until(async () => { const t = await sub(); return t && want.test(t) ? t : null; }, 5000);
  check('0.10.0 put back, the board still shows what Home Assistant changes (its clock runs again)', !!now, { was, now: await sub() });
  check('0.10.0 put back: no errors', page.logs.length === 0, page.logs);
});

test('0.10.0 a call that fails is reported: in the Diagnostics file, anonymised or not', async ({ browser, fake }) => {
  const fs = require('fs');
  // the board's first read of this user's data fails (it carries on without it, as before)
  let failed = 0;
  fake.answers = { 'frontend/get_user_data': (m) => { if (m.key === 'functions_board' && !failed++) throw Object.assign(new Error('planted: light.someones_lamp is gone'), { code: 'planted_failure' }); return { value: null }; } };
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const file = async (anon) => {
    await fbq(page, '[data-act="about"]').first().click();
    await fbq(page, '.modal [data-act="diag"]').click();
    await fbq(page, '.modal .dlg.diag').waitFor({ timeout: 8000 });
    await fbq(page, `.modal input[name="${anon ? 'danon' : 'dreal'}"]`).check();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), fbq(page, '.modal [data-act="diag-go"]').click()]);
    const text = fs.readFileSync(await dl.path(), 'utf8');
    return { text, json: JSON.parse(text) };
  };
  const anon = await file(true);
  const e = (anon.json.board_errors || []).find((x) => x.code === 'planted_failure');
  check('0.10.0 a failed call is in the Diagnostics file: the kind of call, its type, its code', failed === 1 && !!e && e.kind === 'ws' && e.type === 'frontend/get_user_data', anon.json.board_errors);
  check('0.10.0 ... anonymised, without the failure\'s message (it can name things in a home)', !/someones_lamp/.test(anon.text));
  const real = await file(false);
  check('0.10.0 ... with real names, with its message', /light\.someones_lamp is gone/.test(real.text));
  // (the planted failure is reported, as it should be: nothing else is)
  const other = page.logs.filter((l) => !/frontend\/get_user_data failed \(planted_failure\)/.test(l));
  check('0.10.0 failure reported: no errors', other.length === 0 && other.length < page.logs.length, page.logs);
});

test('0.10.0 a config read before a save isn\'t taken for the saved one', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const K = 'automation.garage_left_open', id = fake.states.get(K).attributes.id;
  // the next read of its config answers what was there when it was asked, but slowly: the save lands meanwhile
  let hold = true;
  fake.answers = { 'automation/config': async (m) => {
    const a = fake.answers; fake.answers = null;
    const then = await fake.ws(m);
    fake.answers = a;
    if (hold && m.entity_id === K) { hold = false; await sleep(800); }
    return then;
  } };
  await el(page, (b, k) => { b._store.changed('cfg:'); window.__fbRead = b._fetchConfig(k); }, K);
  await sleep(100);
  fake.autos[id] = Object.assign({}, fake.autos[id] || {}, { alias: 'Garage: saved since' });
  delete fake.autoByEntity[K];
  await fake._automationSaved(id);
  const old = await el(page, () => window.__fbRead.then((c) => c && c.alias));
  const now = await el(page, (b, k) => b._fetchConfig(k).then((c) => c && c.alias), K);
  check('0.10.0 the read asked before the save answers what was there then', !!old && old !== 'Garage: saved since', old);
  check('0.10.0 ... but isn\'t kept as the current config: the next read has the saved one', now === 'Garage: saved since', { old, now });
  check('0.10.0 config before a save: no errors', page.logs.length === 0, page.logs);
});

test('0.10.0 a restore planned just after an automation was deleted makes it again', async ({ browser, fake }) => {
  fake.store.mode = 'full';
  const { page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  const K = 'automation.garage_left_open', id = fake.states.get(K).attributes.id;
  await el(page, async (b, l) => { window.__fbSnap = await b._verSnapshot(l); }, lid);
  // deleted, and the plan made at once: before the board has heard of it, or reloaded its registries
  await fake.api('DELETE', 'config/automation/config/' + id);
  const plan = await el(page, (b, l) => b._verPlan(l, window.__fbSnap), lid);
  check('0.10.0 the plan made right after the delete makes the automation again (not "the same")', plan.recreate.includes(K) && !plan.same.includes(K), plan);
  check('0.10.0 restore plan: no errors', page.logs.length === 0, page.logs);
});

test('0.10.0 an automation turned off after the board was built becomes a warning without opening it again', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const K = 'automation.garage_left_open';
  const off = () => el(page, (b, k) => (b._model.problems || []).some((p) => p.kind === 'm_off' && p.ref === k), K);
  check('0.10.0 on to start with: no warning', !(await off()));
  // turned off elsewhere, with Home Assistant's word of it coming late (as on a busy one)
  await fake.setState(K, 'off', undefined, 400);
  const w = await until(async () => (await off()) || null, 8000);
  check('0.10.0 turned off, its warning shows, with no reopening', !!w);
  check('0.10.0 turned off later: no errors', page.logs.length === 0, page.logs);
});

// what Home Assistant changed while the board wasn't listening: an automation's config saved (no reload event
// reaches the board), and a function made on another board (no store message reaches it)
async function missWhileAway(page, fake) {
  const K = 'automation.garage_left_open', cfg = fake.autoByEntity[K];
  fake.autoByEntity[K] = Object.assign({}, cfg, { triggers: cfg.triggers.concat([{ trigger: 'state', entity_id: 'binary_sensor.movement_backyard', to: 'on' }]) });
  const lid = 'fb_while_away';
  fake.labels.push({ label_id: lid, name: 'Made while away', icon: 'mdi:star', color: null, description: null, created_at: Date.now() / 1000, modified_at: Date.now() / 1000 });
  fake.store.data = Object.assign({}, fake.store.data, { functions: fake.store.data.functions.concat([lid]) });
  return { K, lid };
}
// whether the board shows both: the new trigger's arrow, and the function on its list
const sawBoth = (page, K, lid) => el(page, (b, [k, l]) => (b._model && b._model.edges.some((e) => e.from === 'binary_sensor.movement_backyard' && e.to === k) && b._data.functions.includes(l)) || null, [K, lid]);
const shown = (page, K) => el(page, (b, k) => ({ fns: b._data.functions, trig: b._model && b._model.edges.filter((e) => e.to === k).map((e) => e.from) }), K);

test('0.10.0 a board put back on the page catches up with what changed while it was away', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  // taken off (a dashboard keeps its card while you're on another page), and put back later: the same element
  await page.evaluate(() => { const b = document.querySelector('functions-board'), p = b.parentNode; b.remove(); window.__fbBack = () => p.appendChild(b); });
  await fake.idle(300);
  const { K, lid } = await missWhileAway(page, fake);
  await page.evaluate(() => window.__fbBack());
  const ok = await until(() => sawBoth(page, K, lid), 8000);
  check('0.10.0 put back: the board shows the config saved and the function made while it was away', !!ok, await shown(page, K));
  check('0.10.0 caught up on its return: no errors', page.logs.length === 0, page.logs);
});

test('0.10.0 when the connection comes back, the board catches up with what it missed', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  // the connection lost (Home Assistant restarting, say): its changes meanwhile never reach the board
  const { K, lid } = await missWhileAway(page, fake);
  await fake.idle(300);
  const before = await sawBoth(page, K, lid);
  await page.evaluate(() => window.__fbReconnect());
  const ok = await until(() => sawBoth(page, K, lid), 8000);
  check('0.10.0 connection back: the board shows the config saved and the function made while it was down', !before && !!ok, { before, now: await shown(page, K) });
  check('0.10.0 caught up after the connection came back: no errors', page.logs.length === 0, page.logs);
});

test('0.10.0 a change saved while the board is off the page is written', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  await fake.idle(300);
  await page.evaluate(() => { const b = document.querySelector('functions-board'), p = b.parentNode; b.remove(); window.__fbOff = b; window.__fbBack = () => { p.appendChild(b); window.__fbOff = null; }; });
  // (as when a load the board started before it left drops a gone layout, and saves)
  await page.evaluate((l) => { const b = window.__fbOff; b._layout(l).notes.push({ id: 'offpage', text: 'saved off the page', x: 0, y: 0 }); b._save(); }, lid);
  const written = await until(() => (((fake.store.data.layouts || {})[lid] || {}).notes || []).some((n) => n.id === 'offpage') || null, 5000);
  check('0.10.0 off the page, a save is written at once (its clock is stopped)', !!written, (fake.store.data.layouts || {})[lid]);
  await page.evaluate(() => window.__fbBack());
  check('0.10.0 saved off the page: no errors', page.logs.length === 0, page.logs);
});

test('0.10.0 an automation in the registry that isn\'t loaded: no config asked, no failure reported', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  // left over in the registry (its YAML gone): no state, no config; Home Assistant answers not_found for it
  const X = 'automation.fb_left_over';
  fake.entities.set(X, { entity_id: X, id: 'fbleftover01', platform: 'automation', unique_id: 'fbleftover', labels: [lid], area_id: null, device_id: null, disabled_by: null, hidden_by: null, name: null, original_name: 'Left over', icon: null, categories: {}, config_entry_id: null, has_entity_name: false, entity_category: null, options: {} });
  const n0 = fake.calls.length;
  await el(page, (b) => { b._store.changed('reg'); return b._reload(); });
  await until(() => el(page, (b, k) => (b._model && b._model.nodes.has(k)) || null, X), 8000);
  await el(page, (b) => b._scanProblems());
  await fake.idle(400);
  const asked = fake.calls.slice(n0).filter((c) => c.type === 'automation/config' && c.msg.entity_id === X).length;
  const errs = await el(page, (b) => b._ha.errors.map((e) => e.what + ' ' + e.code));
  check('0.10.0 not loaded: its box is on the board, and its config isn\'t asked for', asked === 0, { asked });
  check('0.10.0 not loaded: no failure reported for it', errs.length === 0, errs);
  check('0.10.0 not loaded: no errors', page.logs.length === 0, page.logs);
});

// 0.11.3 versions: make active, Save and Save as copy (found on a real home: going back to a good version from a
// throwaway left the good one not active)
test('0.11.3 versions: a version is made active, never overwritten but by Save; unsaved changes; Save as copy', async ({ browser, fake }) => {
  fake.store.mode = 'full';
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const LEFT = 'automation.garage_left_open', aid = fake.states.get(LEFT).attributes.id, orig = JSON.parse(JSON.stringify(fake.autos[aid]));
  const setAlias = async (alias, extra) => { fake.autos[aid] = Object.assign({}, fake.autos[aid], { alias }, extra || {}); if (fake.autoByEntity[LEFT]) fake.autoByEntity[LEFT] = Object.assign({}, fake.autoByEntity[LEFT], { alias }, extra || {}); await el(page, (b) => b._store.changed('cfg:')); };
  const rows = () => el(page, async (b) => { await b._renderVersions(); return [...b._$.drawer.querySelectorAll('.vlist .vrow')].map((r) => ({ id: r.dataset.id || null, name: r.querySelector('.vh b').textContent, on: r.classList.contains('on'), top: r.classList.contains('top'), save: !!r.querySelector('[data-act="ver-over"]') })); });
  const snapOf = async (id) => (await ws(page, { type: 'functions_board/version_get', label: garage, version_id: id })).snapshot.items[LEFT].cfg;
  const newVersion = async (name) => {
    await fbq(page, '.drawer [data-act="ver-new"]').first().click();
    await fbq(page, '.modal input[name="vname"]').fill(name);
    await fbq(page, '.modal [data-act="ver-save"]').click();
    await until(async () => (await rows()).some((r) => r.name === name) || null, 8000);
  };
  await fbq(page, '.tools [data-act="versions"]').click();
  await fbq(page, '.drawer .vlist .vrow').first().waitFor({ timeout: 10000 });
  await newVersion('Good');
  await setAlias('Garage: left open (broken)', { actions: [] });
  let R = await rows();
  check('0.11.3 a change shows "Unsaved changes" at the top, with Save (over Good) and Save as copy', R[0].top && R[0].on && R[0].id === null && /Unsaved/.test(R[0].name) && R[0].save && !R.find((r) => r.name === 'Good').on, R);
  await newVersion('Throwaway');
  R = await rows();
  check('0.11.3 Save as copy makes a new version, pinned at the top as the active one, with Save and Save as copy on it', R[0].name === 'Throwaway' && R[0].top && R[0].on && R[0].save
    && !(await fbq(page, '.drawer .vrow.top [data-act="ver-restore"]').count()) && (await fbq(page, '.drawer .vrow.top [data-act="ver-new"]').count()) === 1, R);
  // only the layout changed (no wiring): that's a change too (0.11.3), Save over Throwaway keeps the layout in it
  const thr = R[0].id;
  await el(page, (b, l) => { b._data.layouts[l].dir = 'down'; b._save(); }, garage);
  R = await rows();
  check('0.11.3 only the layout changed: Unsaved changes, the same as Throwaway but for the layout, with Save', R[0].id === null && R[0].save && /Throwaway/.test(await fbq(page, '.drawer .vrow.top .vm').textContent()) && /layout/.test(await fbq(page, '.drawer .vrow.top .vm').textContent()) && !R.find((r) => r.id === thr).on, R);
  await fbq(page, '.drawer .vrow.top [data-act="ver-over"]').click();
  await fbq(page, '.modal [data-act="ver-over-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 8000);
  const throwLayout = (await ws(page, { type: 'functions_board/version_get', label: garage, version_id: thr })).snapshot.layout;
  R = await rows();
  check('0.11.3 ... Save puts the layout in the version, and it\'s the active one again', !!throwLayout && throwLayout.dir === 'down' && R[0].id === thr && R[0].on, throwLayout && throwLayout.dir);
  // a position left over from a box that's gone isn't a change
  await el(page, (b, l) => { b._data.layouts[l].nodes['automation.gone_long_ago'] = { x: 5, y: 5 }; b._save(); }, garage);
  R = await rows();
  check('0.11.3 ... a position left over from a box that\'s gone isn\'t a change', R[0].id === thr && R[0].on, R);
  const good = R.find((r) => r.name === 'Good'), bad = R.find((r) => r.name === 'Throwaway');
  // back to Good, with Home Assistant writing the config back a little differently from how it was saved (as it
  // does: a field it adds), so what's there after isn't byte for byte the version
  const saved = fake._automationSaved.bind(fake);
  fake._automationSaved = async (id) => { fake.autos[id] = Object.assign({ description: 'as Home Assistant writes it' }, fake.autos[id]); return saved(id); };
  await el(page, (b, id) => b._verRestore(id), good.id);
  await fbq(page, '.modal .vrdlg').waitFor({ timeout: 15000 });
  const dlg = await fbq(page, '.modal .vrdlg').innerText();
  check('0.11.3 making Good active: the dialog says what\'s there now is saved as the throwaway, so nothing needs saving', /already saved as "Throwaway"/.test(dlg) && !(await fbq(page, '.modal input[name="vbackup"]').count()), dlg.slice(0, 300));
  await fbq(page, '.modal [data-act="ver-restore-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 20000);
  await fake.idle(400);
  R = await rows();
  check('0.11.3 ... Good is active, pinned at the top', R[0].id === good.id && R[0].on && R[0].top && !R.find((r) => r.id === bad.id).on, R);
  check('0.11.3 ... though Home Assistant wrote it back with a field more', fake.autos[aid].description === 'as Home Assistant writes it');
  check('0.11.3 ... and the throwaway is still there as it was saved', (await snapOf(bad.id)).alias === 'Garage: left open (broken)' && (await snapOf(good.id)).alias === orig.alias);
  fake._automationSaved = saved;
  // a real change, then Save over Good
  await setAlias('Garage: left open (better)');
  R = await rows();
  check('0.11.3 a change after making Good active: "Unsaved changes", and Save is over Good', R[0].id === null && R[0].save && /Good/.test(await fbq(page, '.drawer .vrow.top .vm').textContent()), R);
  await fbq(page, '.drawer [data-act="ver-over"]').click();
  const over = await fbq(page, '.modal .dlg').innerText();
  check('0.11.3 Save asks first, naming the version it replaces, and offers Save as copy instead', /Save over "Good"\?/.test(over) && /Save as copy/.test(over), over);
  await fbq(page, '.modal [data-act="ver-over-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 8000);
  R = await rows();
  check('0.11.3 ... Good now holds the change and is active; the throwaway is untouched', R[0].id === good.id && R[0].on && (await snapOf(good.id)).alias === 'Garage: left open (better)' && (await snapOf(bad.id)).alias === 'Garage: left open (broken)', R);
  // unsaved changes, then make the throwaway active: saving them first is ticked
  await setAlias('Garage: left open (unsaved)');
  await el(page, (b, id) => b._verRestore(id), bad.id);
  await fbq(page, '.modal .vrdlg').waitFor({ timeout: 15000 });
  check('0.11.3 making another version active with unsaved changes: saving them first is ticked', await fbq(page, '.modal input[name="vbackup"]').isChecked());
  await fbq(page, '.modal [data-act="ver-restore-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 20000);
  await fake.idle(400);
  R = await rows();
  const kept = R.find((r) => /Before making "Throwaway" active/.test(r.name));
  check('0.11.3 ... they\'re kept as a new version, and the throwaway is active', R[0].id === bad.id && R[0].on && !!kept && (await snapOf(kept.id)).alias === 'Garage: left open (unsaved)', R);
  check('0.11.3 versions: no errors', page.logs.length === 0, page.logs);
});

// an automation or script added to the fake Home Assistant, as its editor would make it
async function addPiece(page, fake, id, config, labels = []) {
  const [dom, oid] = id.split('.'), uid = 'fb' + oid;
  fake.entities.set(id, { entity_id: id, id: 'fbid' + oid, platform: dom, unique_id: dom === 'automation' ? uid : oid, labels: labels.slice(), area_id: null, device_id: null, disabled_by: null, hidden_by: null, name: null, original_name: config.alias, icon: null, categories: {}, config_entry_id: null, has_entity_name: false, entity_category: null, options: {} });
  if (dom === 'automation') { fake.autos[uid] = Object.assign({ id: uid }, config); await fake.setState(id, 'on', { friendly_name: config.alias, id: uid, last_triggered: null, mode: 'single', current: 0 }); }
  else { fake.scripts[oid] = config; await fake.setState(id, 'off', { friendly_name: config.alias, last_triggered: null, mode: 'single', current: 0 }); }
  await el(page, (b) => b._store.changed('reg'));
}
const rows = (page) => el(page, (b) => b._mgr.cands.map((c) => ({ name: c.name, key: c.key, members: c.members, parts: c.parts.length, offers: c.offers.length, fn: c.fn })));
const rowWith = async (page, id) => (await rows(page)).find((c) => c.members.includes(id));
const card = (page, r) => fbq(page, `.modal .cand[data-key="${r.key}"]`);
async function openImport(page) {
  await fbq(page, '.empty.wel [data-act="import"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
}

test('0.11.0 the import offers to merge groups that may be one system, says why, and separates them again', async ({ browser, fake }) => {
  const { page } = await session(browser, 'owner');
  // a bedtime system that also switches the garage's left-open alert on and off
  await addPiece(page, fake, 'automation.fb_bedtime_lights_out', { alias: 'Bedtime: lights out', triggers: [{ trigger: 'time', at: '22:30:00' }], conditions: [], actions: [
    { action: 'light.turn_off', target: { entity_id: 'light.bed_light' } }, { action: 'lock.lock', target: { entity_id: 'lock.front_door' } },
    { action: 'automation.turn_on', target: { entity_id: 'automation.garage_left_open' } }] });
  await addPiece(page, fake, 'automation.fb_bedtime_lamp', { alias: 'Bedtime: bedside glow', triggers: [{ trigger: 'state', entity_id: 'light.bed_light', to: 'off' }], conditions: [],
    actions: [{ action: 'light.turn_on', target: { entity_id: 'light.ceiling_lights' }, data: { brightness_pct: 5 } }] });
  await openImport(page);
  const bed = await rowWith(page, 'automation.fb_bedtime_lights_out');
  check('0.11.0 Bedtime is a group of its own', bed && bed.members.includes('automation.fb_bedtime_lamp') && !bed.members.includes('automation.garage_left_open'), bed);
  const offer = bed && (await card(page, bed).locator('.coffer').count()) ? await card(page, bed).locator('.coffer').innerText() : '';
  check('0.11.0 it offers to merge with the garage, and says why', /Merge with Garage/.test(offer) && /Bedtime: lights out turns Garage: left open on and off/.test(offer), offer);
  if (!offer) return;
  await card(page, bed).locator('[data-act="mgr-merge"]').click();
  const m = await rowWith(page, 'automation.fb_bedtime_lights_out');
  check('0.11.0 merged: one group with both, named after both', m.parts === 2 && m.members.includes('automation.garage_left_open') && m.name === 'Garage & Bedtime', m);
  const made = (await card(page, m).locator('.cmade').count()) ? await card(page, m).locator('.cmade').innerText() : '';
  check('0.11.0 merged: it says what it\'s made from', /Made from/.test(made) && /Garage/.test(made) && /Bedtime/.test(made) && /Separate/.test(made), made);
  check('0.11.0 merged: focus is on the merged group', await el(page, (b, k) => { const a = b.shadowRoot.activeElement; return !!(a && a.closest(`.cand[data-key="${k}"]`)); }, m.key));
  if (!/Separate/.test(made)) return;
  await card(page, m).locator('[data-act="mgr-split"]').click();
  const apart = (await rows(page)).filter((c) => c.members.includes('automation.fb_bedtime_lights_out') || c.members.includes('automation.garage_left_open'));
  check('0.11.0 Separate: the two groups again', apart.length === 2 && apart.every((c) => c.parts === 1), apart);
  // Merge into…: any other group
  const b2 = await rowWith(page, 'automation.fb_bedtime_lights_out');
  await card(page, b2).locator('[data-act="mgr-merge-menu"]').click();
  const items = await page.locator('functions-board .menu [data-act="mgr-merge-to"]').allInnerTexts();
  check('0.11.0 Merge into lists the other groups', items.some((t) => /Morning/.test(t)) && items.some((t) => /Garage/.test(t)) && !items.some((t) => /Bedtime/.test(t)), items);
  await page.locator('functions-board .menu [data-act="mgr-merge-to"]', { hasText: 'Morning' }).click();
  const bm = await rowWith(page, 'automation.fb_bedtime_lights_out');
  check('0.11.0 Merge into: Bedtime and Morning are one group', bm.parts === 2 && bm.members.includes('automation.morning_lights_and_blinds'), bm);
  if (bm.parts !== 2) return;
  await card(page, bm).locator('[data-act="mgr-split"]').click();
  // merged with the garage again, renamed, ticked kept through it, imported as one function
  const b3 = await rowWith(page, 'automation.fb_bedtime_lights_out');
  await card(page, b3).locator('[data-act="mgr-expand"]').click();
  await card(page, b3).locator('input[data-id="automation.fb_bedtime_lamp"]').uncheck();
  await card(page, b3).locator('[data-act="mgr-merge"]').click();
  const m2 = await rowWith(page, 'automation.fb_bedtime_lights_out');
  check('0.11.0 a piece unticked stays unticked when its group is merged', !(await card(page, m2).locator('input[data-id="automation.fb_bedtime_lamp"]').isChecked()));
  await card(page, m2).locator('input.cname').fill('Evening');
  await card(page, m2).locator('[data-act="mgr-import-one"]').click();
  await until(() => el(page, (b) => !b._mgr.busy && b._data.functions.some((l) => b._fnName(l) === 'Evening')), 15000);
  await fake.idle(400);
  const lid = await el(page, (b) => b._data.functions.find((l) => b._fnName(l) === 'Evening'));
  check('0.11.0 the merged group is one function with both systems in it', !!lid && await hasLabel(page, 'automation.fb_bedtime_lights_out', lid) && await hasLabel(page, 'automation.garage_left_open', lid), lid);
  check('0.11.0 ... without the piece left unticked', !!lid && !(await hasLabel(page, 'automation.fb_bedtime_lamp', lid)));
  const done = await rowWith(page, 'automation.fb_bedtime_lights_out');
  check('0.11.0 imported: it can\'t be separated any more', done && done.fn === lid && !(await card(page, done).locator('[data-act="mgr-split"]').count()), done);
  check('0.11.0 merging: no errors', page.logs.length === 0, page.logs);
});

test('0.11.0 a category over two groups is an offer to merge them; one over a single group still brings in what\'s filed there', async ({ browser, fake }) => {
  const { page } = await session(browser, 'owner');
  fake.categories.automation = [{ category_id: 'CATDAILY', name: 'Daily', icon: 'mdi:calendar' }, { category_id: 'CATUPKEEP', name: 'Upkeep', icon: 'mdi:wrench' }];
  const file = (id, cid) => { fake.entities.get(id).categories = { automation: cid }; };
  file('automation.garage_left_open', 'CATDAILY'); file('automation.morning_lights_and_blinds', 'CATDAILY');
  ['automation.furnace_filter_count_down_daily', 'automation.furnace_filter_due_alert', 'automation.backyard_motion_light'].forEach((id) => file(id, 'CATUPKEEP'));
  await el(page, (b) => b._store.changed('reg'));
  await openImport(page);
  const g = await rowWith(page, 'automation.garage_left_open');
  const offer = g && (await card(page, g).locator('.coffer').count()) ? await card(page, g).locator('.coffer').innerText() : '';
  check('0.11.0 the garage and the morning are filed under one category: an offer to merge them', /Merge with Morning/.test(offer) && /Filed under Daily/.test(offer) && !g.members.includes('automation.morning_lights_and_blinds'), { offer, g });
  if (!offer) return;
  await card(page, g).locator('[data-act="mgr-merge"]').click();
  const m = await rowWith(page, 'automation.garage_left_open');
  check('0.11.0 merged by their category, it\'s named after it', m && m.parts === 2 && m.name === 'Daily' && m.members.includes('automation.morning_lights_and_blinds'), m);
  const u = await rowWith(page, 'automation.furnace_filter_due_alert');
  const src = u ? await card(page, u).locator('.csrc').last().innerText() : '';
  check('0.11.0 a category over one group brings in what else is filed there, named after it', u && u.name === 'Upkeep' && u.members.includes('automation.backyard_motion_light') && /category \+ wiring/.test(src), { u, src });
  check('0.11.0 categories: no errors', page.logs.length === 0, page.logs);
});

test('0.11.0 the import reads Node-RED flows while the board does: a flow\'s scripts are one group, the flow listed; a disabled tab is marked on its box', async ({ browser, fake }) => {
  const { page } = await session(browser, 'owner');
  await addPiece(page, fake, 'script.fb_pond_fill_on', { alias: 'Pond fill on', sequence: [{ action: 'switch.turn_on', target: { entity_id: 'switch.decorative_lights' } }] });
  await addPiece(page, fake, 'script.fb_pond_fill_off', { alias: 'Pond fill off', sequence: [{ action: 'switch.turn_off', target: { entity_id: 'switch.decorative_lights' } }] });
  const nrGroup = { id: 't1:a1', tab: 't1', tabLabel: 'Pond flows', name: 'Pond level', size: 5, trig: ['binary_sensor.basement_floor_wet'], read: [], change: [], calls: ['script.fb_pond_fill_on', 'script.fb_pond_fill_off'], events: [], off: true };
  await openImport(page);
  check('0.11.0 Node-RED off: the scripts no flow of Home Assistant\'s runs are in no group', !(await rowWith(page, 'script.fb_pond_fill_on')));
  // the board reads Node-RED (its switch on), and a flow runs both scripts
  await el(page, (b, g) => { b._data.ui.nodered = true; b._nrCache = { at: Date.now() + 3600000, base: '/api/hassio_ingress/abc/', slug: 'abc_nodered', groups: [g] }; }, nrGroup);
  await fbq(page, '.modal [data-act="mgr-rescan"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  const r = await rowWith(page, 'script.fb_pond_fill_on');
  check('0.11.0 Node-RED on: the two scripts the flow runs are one group', r && r.members.includes('script.fb_pond_fill_off') && !r.members.some((x) => x.startsWith('nr:')), r);
  if (!r) return;
  await card(page, r).locator('[data-act="mgr-expand"]').click();
  const flow = (await card(page, r).locator('.mrow2').count()) ? await card(page, r).locator('.mrow2').innerText() : '';
  check('0.11.0 the flow is listed with the group, and its tab is disabled', /Pond level/.test(flow) && /Pond flows, which is disabled/.test(flow), flow);
  await card(page, r).locator('[data-act="mgr-import-one"]').click();
  await until(() => el(page, (b) => !b._mgr.busy && b._data.functions.length >= 1), 15000);
  await fbq(page, '.modal [data-act="modal-cancel"]').first().click();
  await fake.idle(400);
  const box = await until(() => el(page, (b) => {
    const n = b._model && b._model.nodes.get('nr:t1:a1'), d = b.shadowRoot.querySelector('.node[data-key="nr:t1:a1"]');
    return n && d ? { text: b._status(n).text, off: d.classList.contains('off') } : null;
  }), 8000);
  check('0.11.0 the flow\'s box says its tab is disabled, and is drawn off', box && /its tab is disabled/.test(box.text) && box.off, box);
  check('0.11.0 Node-RED in the import: no errors', page.logs.length === 0, page.logs);
});

test('0.11.0 deleting a function and its items never deletes what\'s shared: it stays, in its other functions', async ({ browser, fake }) => {
  fake.store.mode = 'full';
  const { page } = await imported(browser);
  const furnace = await openFn(page, /furnace/i), garage = await el(page, (b) => b._data.functions.find((l) => /garage/i.test(b._fnName(l))));
  // in the furnace function: its due alert is also in the garage function; its reset script is run by an automation
  // outside it; a third automation of it is read by a template helper outside it; its count-down is its own
  const DUE = 'automation.furnace_filter_due_alert', DOWN = 'automation.furnace_filter_count_down_daily', RESET = 'script.filter_reset', CHECK = 'automation.fb_filter_monthly_check';
  const lab = async (id, labels) => ws(page, { type: 'config/entity_registry/update', entity_id: id, labels });
  await lab(DUE, [furnace, garage]);
  await addPiece(page, fake, 'automation.fb_reset_on_button', { alias: 'Reset the filter from the button', triggers: [{ trigger: 'state', entity_id: 'button.push' }], conditions: [], actions: [{ action: 'script.filter_reset' }] });
  await addPiece(page, fake, CHECK, { alias: 'Furnace filter: monthly check', triggers: [{ trigger: 'time', at: '09:00:00' }], conditions: [], actions: [] });
  await lab(CHECK, [furnace]);
  fake.entities.set('sensor.fb_filter_report', { entity_id: 'sensor.fb_filter_report', id: 'fbidreport', platform: 'template', unique_id: 'fbreport', labels: [], categories: {}, area_id: null, device_id: null, config_entry_id: null, disabled_by: null, hidden_by: null, name: null, original_name: 'Filter report', icon: null, has_entity_name: false, entity_category: null, options: {} });
  fake.sources['sensor.fb_filter_report'] = { entities: [CHECK] };
  // a group outside holds one piece; a Node-RED flow runs another; a meter helper of the function was set up with a
  // sensor that isn't in it (deleting the helper would delete both)
  const WEEKLY = 'automation.fb_filter_weekly', SAY = 'script.fb_filter_say', PEAK = 'sensor.fb_filter_peak', OFF = 'sensor.fb_filter_offpeak';
  await addPiece(page, fake, WEEKLY, { alias: 'Furnace filter: weekly look', triggers: [{ trigger: 'time', at: '10:00:00' }], conditions: [], actions: [] });
  await addPiece(page, fake, SAY, { alias: 'Furnace filter: say it', sequence: [] });
  await lab(WEEKLY, [furnace]); await lab(SAY, [furnace]);
  await fake.setState('group.fb_upkeep', 'on', { friendly_name: 'Upkeep rules', entity_id: [WEEKLY] });
  await el(page, (b, s) => { b._nrCache = { at: Date.now() + 3600000, base: '/api/hassio_ingress/abc/', slug: 'abc_nodered', groups: [{ id: 't1:a1', tab: 't1', tabLabel: 'Upkeep flows', name: 'Filter talk', size: 3, trig: [], read: [], change: [], calls: [s], events: [], off: false }] }; }, SAY);
  fake.helperEntries = [{ entry_id: 'fbmeter1', domain: 'utility_meter', title: 'Filter meter' }];
  for (const [id, nm] of [[PEAK, 'Filter meter peak'], [OFF, 'Filter meter off-peak']]) {
    fake.entities.set(id, { entity_id: id, id: 'fbid' + nm.length + id.length, platform: 'utility_meter', unique_id: id, labels: id === PEAK ? [furnace] : [], categories: {}, area_id: null, device_id: null, config_entry_id: 'fbmeter1', disabled_by: null, hidden_by: null, name: null, original_name: nm, icon: null, has_entity_name: false, entity_category: null, options: {} });
    await fake.setState(id, '0', { friendly_name: nm });
  }
  await el(page, (b) => b._store.changed('reg'));
  await fake.idle(400);
  await fbq(page, '.title [data-act="fn-menu"]').click();
  await fbq(page, '.menu [data-act="fnm-delall"]').click();
  await fbq(page, '.modal [data-act="del-go"]').waitFor({ timeout: 10000 });
  const rows = await page.locator('functions-board .modal .drow').evaluateAll((els) => els.map((x) => ({ text: x.innerText, on: x.querySelector('input').checked, off: x.querySelector('input').disabled })));
  const row = (re) => rows.find((r) => re.test(r.text)) || {};
  check('0.11.0 a piece also in another function stays, and says why', /stays: it's also in Garage/.test(row(/Furnace filter: due alert/).text) && row(/Furnace filter: due alert/).off && !row(/Furnace filter: due alert/).on, rows);
  check('0.11.0 a script run from outside the function stays, and says by what', /stays: used outside this function by Reset the filter from the button/.test(row(/Furnace filter: reset/).text) && row(/Furnace filter: reset/).off, rows);
  check('0.11.0 a piece a helper outside reads stays', /stays: used outside this function by Filter report/.test(row(/monthly check/).text) && row(/monthly check/).off, rows);
  check('0.11.0 a piece a group outside holds stays', /stays: used outside this function by Upkeep rules/.test(row(/weekly look/).text) && row(/weekly look/).off, rows);
  check('0.11.0 a script a Node-RED flow runs stays', /stays: used outside this function by Filter talk \(Node-RED\)/.test(row(/say it/).text) && row(/say it/).off, rows);
  check('0.11.0 a helper set up with something outside the function stays', /stays: deleting it would also delete Filter meter off-peak/.test(row(/Filter meter peak/).text) && row(/Filter meter peak/).off, rows);
  check('0.11.0 a piece nothing else has is ticked to go', row(/count down daily/).on && !row(/count down daily/).off, rows);
  const note = await fbq(page, '.modal').innerText();
  check('0.11.0 the dialog says what\'s shared is never deleted', /What's shared is never deleted/.test(note), note);
  // even ticked by hand, a shared piece isn't deleted
  await page.locator('functions-board .modal .drow', { hasText: 'due alert' }).locator('input').evaluate((x) => { x.disabled = false; x.checked = true; });
  await fbq(page, '.modal [data-act="del-go"]').click();
  await until(() => el(page, (b, l) => !b._data.functions.includes(l), furnace), 8000);
  await fake.idle(400);
  const there = (id) => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], id);
  check('0.11.0 the function\'s own piece is deleted', !(await there(DOWN)));
  const kept = {}; for (const id of [DUE, RESET, CHECK, WEEKLY, SAY, PEAK]) kept[id] = await there(id);
  check('0.11.0 every shared piece is still there', Object.values(kept).every(Boolean) && fake.helperEntries.length === 1, kept);
  check('0.11.0 ... and still in its other function', await hasLabel(page, DUE, garage) && !(await hasLabel(page, DUE, furnace)));
  check('0.11.0 deleting with what\'s shared: no errors', page.logs.length === 0, page.logs);
});

test('0.11.0 restoring a version never turns off or deletes what was added since and is shared: it only leaves the function', async ({ browser, fake }) => {
  fake.store.mode = 'full';
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i), morning = await el(page, (b) => b._data.functions.find((l) => /morning/i.test(b._fnName(l))));
  // a version of the garage, saved before anything was added
  const snap = await el(page, (b, l) => b._verSnapshot(l), garage);
  const v = await ws(page, { type: 'functions_board/version_save', label: garage, name: 'Before', snapshot: snap });
  // added since: an automation also in the morning function, a script an automation outside runs, one of its own
  const SH = 'automation.fb_garage_and_morning', RUN = 'script.fb_garage_chime', OWN = 'automation.fb_garage_only';
  await addPiece(page, fake, SH, { alias: 'Garage and morning light', triggers: [{ trigger: 'time', at: '06:00:00' }], conditions: [], actions: [] });
  await addPiece(page, fake, RUN, { alias: 'Garage chime', sequence: [] });
  await addPiece(page, fake, OWN, { alias: 'Garage only check', triggers: [{ trigger: 'time', at: '07:00:00' }], conditions: [], actions: [] });
  await addPiece(page, fake, 'automation.fb_chime_at_noon', { alias: 'Chime at noon', triggers: [{ trigger: 'time', at: '12:00:00' }], conditions: [], actions: [{ action: 'script.fb_garage_chime' }] });
  for (const [id, labels] of [[SH, [garage, morning]], [RUN, [garage]], [OWN, [garage]]]) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels });
  // changed since, so restore writes them back: one also in the morning function, a script an automation outside
  // runs, and one only the garage's
  const LEFT = 'automation.garage_left_open', STOP = 'automation.garage_closed_stop_timer', aid = (k) => fake.states.get(k).attributes.id;
  const edit = (k, alias) => { fake.autos[aid(k)] = Object.assign({}, fake.autos[aid(k)], { alias }); if (fake.autoByEntity[k]) fake.autoByEntity[k] = Object.assign({}, fake.autoByEntity[k], { alias }); };
  edit(LEFT, 'Garage: left open (edited)'); edit(STOP, 'Garage: closed, stop timer (edited)');
  fake.scripts.close_garage = Object.assign({}, fake.scripts.close_garage, { alias: 'Close garage (edited)' });
  await addPiece(page, fake, 'automation.fb_close_at_night', { alias: 'Close at night', triggers: [{ trigger: 'time', at: '23:00:00' }], conditions: [], actions: [{ action: 'script.close_garage' }] });
  await ws(page, { type: 'config/entity_registry/update', entity_id: LEFT, labels: [garage, morning] });
  await el(page, (b) => { b._store.changed('reg'); b._store.changed('cfg:'); });
  await fake.idle(400);
  await el(page, (b, id) => b._verRestore(id), v.id);
  await fbq(page, '.modal .vrdlg').waitFor({ timeout: 15000 });
  const text = await fbq(page, '.modal .vrdlg').innerText();
  check('0.11.0 restore: what\'s shared is listed apart, only taken out of the function, with why', /only taken out of this function \(never turned off or deleted\)/.test(text)
    && /Garage and morning light \(stays: it's also in Morning\)/.test(text) && /Garage chime \(stays: used outside this function by Chime at noon\)/.test(text), text);
  const sharedLine = (text.match(/Shared with another function[^\n]*/) || [''])[0];
  check('0.11.0 restore: what\'s only the function\'s is offered per-item actions, not listed as shared', !/Garage only check/.test(sharedLine) && /Garage only check/.test(text) && (await fbq(page, `.modal select.vextra[data-k="${OWN}"]`).count()) === 1, text);
  const warn = (await fbq(page, '.modal .vwshared').count()) ? await fbq(page, '.modal .vwshared').innerText() : '';
  check('0.11.0 restore warns that what it writes back changes in the other function too', /making this version active changes them there too/.test(warn) && /Garage: left open \(also in Morning\)/.test(warn), warn);
  check('0.11.0 ... and where something outside uses it', /Close garage \(used outside this function by Close at night\)/.test(warn), warn);
  check('0.11.0 ... but not for what only this function has (written back all the same)', !/stop timer/.test(warn) && /stop timer/.test(text), { warn, text });
  await fbq(page, `.modal select.vextra[data-k="${OWN}"]`).selectOption('delete');
  await fbq(page, '.modal [data-act="ver-restore-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 20000);
  await fake.idle(500);
  const st = (id) => page.evaluate((k) => { const s = document.querySelector('home-assistant').hass.states[k]; return s ? s.state : null; }, id);
  check('0.11.0 restore: the function\'s own piece added since is deleted', (await st(OWN)) === null);
  check('0.11.0 restore: the shared automation is still there, still on, still in its other function, out of this one', (await st(SH)) === 'on' && await hasLabel(page, SH, morning) && !(await hasLabel(page, SH, garage)), { state: await st(SH) });
  check('0.11.0 restore: the script used outside is still there, out of this function', (await st(RUN)) !== null && !(await hasLabel(page, RUN, garage)));
  check('0.11.0 restoring with what\'s shared: no errors', page.logs.length === 0, page.logs);
});

// an automation or script added to the fake Home Assistant, as its editor would make it
async function addAuto(page, fake, id, config) {
  const oid = id.split('.')[1], uid = 'fb' + oid;
  fake.entities.set(id, { entity_id: id, id: 'fbid' + oid, platform: 'automation', unique_id: uid, labels: [], area_id: null, device_id: null, disabled_by: null, hidden_by: null, name: null, original_name: config.alias, icon: null, categories: {}, config_entry_id: null, has_entity_name: false, entity_category: null, options: {} });
  fake.autos[uid] = Object.assign({ id: uid }, config);
  await fake.setState(id, 'on', { friendly_name: config.alias, id: uid, last_triggered: null, mode: 'single', current: 0 });
}

test('0.11.1 a scene or group draws no arrows to what it sets or holds, only into what triggers on it or reads it', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const SC = 'scene.fb_sleep', GR = 'group.fb_morning_lights', HLP = 'sensor.fb_sleep_since';
  const members = ['light.bed_light', 'light.ceiling_lights', 'light.kitchen_lights', 'light.office_rgbw_lights', 'cover.living_room_window', 'lock.front_door'];
  await fake.setState(SC, '2026-11-20T03:00:00+00:00', { friendly_name: 'Sleep', entity_id: members });
  await fake.setState(GR, 'on', { friendly_name: 'Morning lights', entity_id: ['light.kitchen_lights', 'light.bed_light'] });
  await addAuto(page, fake, 'automation.fb_sleep_at_night', { alias: 'Morning: sleep scene at night', triggers: [{ trigger: 'time', at: '22:30:00' }], conditions: [], actions: [{ action: 'scene.turn_on', target: { entity_id: SC } }, { action: 'homeassistant.turn_on', target: { entity_id: GR } }] });
  await addAuto(page, fake, 'automation.fb_after_sleep', { alias: 'Morning: after the sleep scene', triggers: [{ trigger: 'state', entity_id: SC }], conditions: [], actions: [{ action: 'light.turn_off', target: { entity_id: 'light.office_rgbw_lights' } }] });
  fake.entities.set(HLP, { entity_id: HLP, id: 'fbidsince', platform: 'template', unique_id: 'fbsince', labels: [], categories: {}, area_id: null, device_id: null, config_entry_id: null, disabled_by: null, hidden_by: null, name: null, original_name: 'Sleep since', icon: null, has_entity_name: false, entity_category: null, options: {} });
  await fake.setState(HLP, '3', { friendly_name: 'Sleep since' });
  fake.sources[HLP] = { entities: [SC] };
  const morning = await el(page, (b) => b._data.functions.find((l) => /morning/i.test(b._fnName(l))));
  for (const id of ['automation.fb_sleep_at_night', 'automation.fb_after_sleep', HLP]) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [morning] });
  await el(page, (b) => b._store.changed('reg'));
  await openFn(page, /morning/i);
  await until(() => el(page, (b, [sc, l]) => { if (b._model && b._model.nodes.get(sc) && b._model.edges.some((e) => e.from === sc && e.role === 'source')) return true; b._open(l, true); return null; }, [SC, morning]), 12000, 700);
  const m = await el(page, (b, [sc, gr]) => ({ from: b._model.edges.filter((e) => e.from === sc).map((e) => e.role + ':' + e.to).sort(), group: b._model.edges.filter((e) => e.from === gr).map((e) => e.to).sort(),
    status: b._status(b._model.nodes.get(sc)).text, gstatus: b._status(b._model.nodes.get(gr)).text, groupWant: ['light.bed_light', 'light.kitchen_lights'].filter((x) => b._model.nodes.has(x)), onBoard: ['light.kitchen_lights', 'cover.living_room_window', 'light.office_rgbw_lights'].filter((x) => b._model.nodes.has(x)) }), [SC, GR]);
  check('0.11.1 the scene\'s members that are on the board are there (so arrows could have been drawn)', m.onBoard.length === 3, m);
  check('0.11.1 a scene draws no arrow to anything it sets', !m.from.some((x) => /^action:/.test(x) && members.includes(x.slice(7))), m.from);
  check('0.11.1 ... only into what triggers on it and what reads it', JSON.stringify(m.from) === JSON.stringify(['source:' + HLP, 'trigger:automation.fb_after_sleep']), m.from);
  check('0.11.1 its box says how many it sets', /sets 6 entities/.test(m.status), m.status);
  check('0.11.1 a group draws no arrow to its members either, those on the board included', m.groupWant.length > 0 && m.group.length === 0, m);
  check('0.11.1 its box says how many members it has', /2 members/.test(m.gstatus), m.gstatus);
  check('0.11.1 scenes: no errors', page.logs.length === 0, page.logs);
});

test('0.11.1 a loop through a scene is still found, with no arrow to what the scene sets', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const SC = 'scene.fb_evening', A = 'automation.fb_evening_again';
  await fake.setState(SC, '2026-11-20T03:00:00+00:00', { friendly_name: 'Evening', entity_id: ['light.kitchen_lights', 'light.bed_light'] });
  await addAuto(page, fake, A, { alias: 'Morning: evening scene when the kitchen lights come on', triggers: [{ trigger: 'state', entity_id: 'light.kitchen_lights', to: 'on' }], conditions: [], actions: [{ action: 'scene.turn_on', target: { entity_id: SC } }] });
  const morning = await el(page, (b) => b._data.functions.find((l) => /morning/i.test(b._fnName(l))));
  await ws(page, { type: 'config/entity_registry/update', entity_id: A, labels: [morning] });
  await el(page, (b) => b._store.changed('reg'));
  await openFn(page, /morning/i);
  await until(() => el(page, (b, [a, l]) => { if (b._model && b._model.nodes.has(a) && b._model.nodes.has('light.kitchen_lights')) return true; b._open(l, true); return null; }, [A, morning]), 12000, 700);
  const m = await el(page, (b, [a, sc]) => ({ loops: b._model.edges.filter((e) => e.loop).map((e) => e.from + '>' + e.to).sort(), fromScene: b._model.edges.filter((e) => e.from === sc).map((e) => e.to) }), [A, SC]);
  check('0.11.1 the scene draws no arrow to the light it sets', !m.fromScene.includes('light.kitchen_lights'), m);
  check('0.11.1 ... and the loop through it is still marked', m.loops.includes(A + '>' + SC) && m.loops.includes('light.kitchen_lights>' + A), m);
  check('0.11.1 scene loop: no errors', page.logs.length === 0, page.logs);
});

test('0.11.1 the sandbox finds the device box of what an action on a device changes, not a box "not on this board", and says over it what was called', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const dev = await el(page, (b) => b._ents.find((e) => e.entity_id === 'climate.heatpump').device_id);
  // a second climate entity on the device (a second zone): an action on the device reaches both, and the step is still one arrow
  fake.entities.set('climate.fb_heatpump_zone2', { entity_id: 'climate.fb_heatpump_zone2', id: 'fbidhpz2', platform: 'demo', unique_id: 'fbhpz2', labels: [], categories: {}, area_id: null, device_id: dev, config_entry_id: null, disabled_by: null, hidden_by: null, name: null, original_name: 'HeatPump zone 2', icon: null, has_entity_name: false, entity_category: null, options: {} });
  await fake.setState('climate.fb_heatpump_zone2', 'heat', { friendly_name: 'HeatPump zone 2', hvac_modes: ['off', 'heat'] });
  await addAuto(page, fake, 'automation.fb_heat_off_open', { alias: 'Garage open: heat pump off', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open' }], conditions: [], actions: [{ action: 'climate.set_hvac_mode', target: { device_id: dev }, data: { hvac_mode: 'off' } }] });
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'automation.fb_heat_off_open', labels: [garage] });
  await el(page, (b) => b._store.changed('reg'));
  const D = 'device:' + dev;
  await until(() => el(page, (b, [d, l]) => { if (b._model && b._model.nodes.has(d)) return true; b._open(l, true); return null; }, [D, garage]), 12000, 700);
  check('0.11.1 the device is a box on the board and its entity is not', await el(page, (b, d) => b._model.nodes.has(d) && !b._model.nodes.has('climate.heatpump'), D));
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  await fbq(page, '.drawer .sbent').selectOption('cover.garage_door');
  await fbq(page, '.drawer .sbval-sel').selectOption('open');
  await fbq(page, '.drawer [data-act="sbx-set"]').click();
  await until(() => el(page, (b) => (b._sbx && !b._sbx.busy && b._sbx.eng.log.some((e) => e.kind === 'call' && e.key === 'automation.fb_heat_off_open')) || null), 15000);
  const f = await el(page, (b, d) => {
    const a = b._sbx.eng.log.find((e) => e.kind === 'call' && e.key === 'automation.fb_heat_off_open'), act = b._sbx.acts.find((x) => a.id >= x.a && a.id <= x.b);
    const fl = b._flowBuild(act);
    return { ghosts: [...fl.ghosts.keys()], links: fl.steps.flatMap((s) => s.links.map((l) => l.a + '>' + l.b)), boxes: fl.steps.filter((s) => s.e.kind === 'state' && s.e.key === 'climate.heatpump').map((s) => s.box) };
  }, D);
  check('0.11.1 no temporary box for the device\'s entity', !f.ghosts.includes('~climate.heatpump'), f);
  check('0.11.1 the action goes from the automation to the device box, once', f.links.filter((x) => x === 'automation.fb_heat_off_open>' + D).length === 1, f);
  check('0.11.1 ... and the entity\'s change shows on the device box', f.boxes.length > 0 && f.boxes.every((x) => x === D), f);
  // the call's step, and each entity's change: in words over the device box
  const say = async (re) => el(page, (b, [d, src]) => {
    const i = b._flow.steps.findIndex((s) => new RegExp(src).test(b._flowText(s.e)) && (s.box === d || s.links.some((l) => l.b === d)));
    if (i < 0) return { i };
    b._flowGo(i, false);
    return { i, says: [...b.shadowRoot.querySelectorAll('.flow .fsay')].map((x) => [x.dataset.key, x.textContent]) };
  }, [D, re.source]);
  await el(page, (b) => { b._clock.cancel('lit'); });
  const call = await say(/set_hvac_mode/);
  check('0.11.1 over the device box: the call, to which of its entities, with what', JSON.stringify(call.says) === JSON.stringify([[D, 'climate.set_hvac_mode → HeatPump, HeatPump zone 2 (hvac_mode: off)']]), call);
  const ch = await say(/HeatPump zone 2 →/);
  check('0.11.1 ... and on a change, which entity changed to what', ch.says && ch.says.length === 1 && ch.says[0][0] === D && /^HeatPump zone 2 → /i.test(ch.says[0][1]), ch);
  // a step after the call that says nothing over the device box: the call's words are still there, not marked
  const later = await el(page, (b, d) => {
    const c = b._flow.steps.findIndex((s) => s.e.kind === 'call' && b._flowSays(s).length), i = b._flow.steps.findIndex((s, j) => j > c && !b._flowSays(s).length);
    if (i < 0) return { i };
    b._flowGo(i, false);
    return { i, says: [...b.shadowRoot.querySelectorAll('.flow .fsay')].map((x) => [x.dataset.key, x.classList.contains('now'), x.textContent]) };
  }, D);
  check('0.11.1 the words stay over the box after their step, unmarked, until a later step there says more', later.i > 0 && later.says.length === 1 && later.says[0][0] === D && later.says[0][1] === false, later);
  // playing: each step's wait, up to the first with words over a box (played at once, not waited for)
  const waits = await el(page, (b) => {
    const got = [], after = b._clock.after.bind(b._clock), at = b._flow.steps.findIndex((s) => b._flowSays(s).length);
    b._clock.after = (name, ms, fn) => { if (name !== 'lit') return after(name, ms, fn); got.push([b._flow.at, ms]); if (b._flow.at < at) fn(); return null; };
    try { b._flowPlay(); } finally { b._clock.after = after; }
    return { at, got };
  });
  const wSay = waits.got.find(([i]) => i === waits.at), wRest = waits.got.filter(([i]) => i !== waits.at);
  check('0.11.1 playing: the step with words over a box waits long enough to read them (2 s or more), the others under 1 s', waits.at >= 0 && !!wSay && wSay[1] >= 2000 && wRest.length > 0 && wRest.every(([, ms]) => ms < 1000), waits);
  const own = await el(page, (b) => { const i = b._flow.steps.findIndex((s) => s.e.kind === 'trigger'); b._flowGo(i, false); return b.shadowRoot.querySelectorAll('.flow .fsay').length; });
  check('0.11.1 ... and nothing over a box that is what the step reached', own === 0, own);
  check('0.11.1 sandbox device: no errors', page.logs.length === 0, page.logs);
});

test('0.11.1 a trigger that starts both ways: a problem, said in the sandbox with Dismiss; any problem can be ignored for good', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const A = 'automation.fb_door_moved', K = 't_both|' + A;
  await addAuto(page, fake, A, { alias: 'Garage: door moved', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', from: ['closed', 'open'] }], conditions: [], actions: [] });
  await ws(page, { type: 'config/entity_registry/update', entity_id: A, labels: [garage] });
  await el(page, (b) => b._store.changed('reg'));
  const probs = () => el(page, (b) => ({ shown: (b._model.problems || []).map((p) => p.kind + '|' + p.ref), dis: (b._model.dismissed || []).map((p) => p.kind + '|' + p.ref), ign: (b._model.ignored || []).map((p) => p.kind + '|' + p.ref) }));
  await until(() => el(page, (b, [k, l]) => { if (b._model && (b._model.problems || []).some((p) => p.kind + '|' + p.ref === k)) return true; b._open(l, true); return null; }, [K, garage]), 12000, 700);
  await fbq(page, '.pchip').click();
  await fbq(page, '.drawer .probs .prow').first().waitFor({ timeout: 5000 });
  const row = await el(page, (b, k) => { const r = b._$.drawer.querySelector(`[data-k="${k}"]`).closest('.prow'); return { text: r.querySelector('.ptxt').textContent, acts: [...r.querySelectorAll('[data-act]')].map((x) => x.dataset.act) }; }, K);
  check('0.11.1 a state trigger with From [closed, open] and no To is a warning that says why', /Garage: door moved \(automation\.fb_door_moved\) starts both ways: its trigger on Garage Door lists closed, open under From and has no To/.test(row.text), row);
  check('0.11.1 ... with Dismiss and Ignore for good', row.acts.includes('pdis') && row.acts.includes('pdis-ever'), row);
  // the sandbox says it when it happens, with Dismiss
  await el(page, (b) => b._closeDrawer());
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  const setDoor = async (v) => {
    await fbq(page, '.drawer .sbent').selectOption('cover.garage_door');
    await fbq(page, '.drawer .sbval-sel').selectOption(v);
    await fbq(page, '.drawer [data-act="sbx-set"]').click();
    await until(() => el(page, (b, x) => (b._sbx && !b._sbx.busy && b._sbx.eng.get('cover.garage_door').state === x) || null, v), 10000);
  };
  await setDoor('open');
  const note = await until(() => el(page, (b, k) => { const x = b._$.drawer.querySelector(`.sbtl [data-act="sbx-pdis"][data-k="${k}"]`); return x ? x.closest('.dbrow').textContent : null; }, K), 5000);
  check('0.11.1 the sandbox says it started on a change into a From state, with Dismiss', /door moved started on Garage Door changing to open\. Its trigger lists open under From/.test(note || ''), note);
  await fbq(page, `.drawer [data-act="sbx-pdis"][data-k="${K}"]`).click();
  const p1 = await until(async () => { const v = await probs(); return v.dis.includes(K) ? v : null; }, 5000);
  check('0.11.1 Dismiss in the sandbox: the problem goes under Dismissed', !!p1 && !p1.shown.includes(K), p1);
  check('0.11.1 ... and the note isn\'t shown any more', !(await el(page, (b, k) => !!b._$.drawer.querySelector(`.sbtl [data-k="${k}"]`), K)));
  await setDoor('closed');
  const again = await el(page, (b) => ({ fired: b._sbx.eng.log.filter((e) => e.kind === 'trigger' && e.key === 'automation.fb_door_moved').length, notes: b._$.drawer.querySelectorAll('.sbtl [data-act="sbx-pdis"]').length }));
  check('0.11.1 ... nor said again when it fires again', again.fired === 2 && again.notes === 0, again);
  await el(page, (b) => b._closeDrawer());
  // ignore for good, from the dismissed list
  await fbq(page, '.pdchip').click();
  await fbq(page, `.drawer [data-act="pdis-ever"][data-k="${K}"]`).click();
  const p2 = await until(async () => { const v = await probs(); return v.ign.includes(K) ? v : null; }, 5000);
  check('0.11.1 Ignore for good: neither a problem nor dismissed', !!p2 && !p2.shown.includes(K) && !p2.dis.includes(K), p2);
  const kept = await until(async () => { const d = ((await store(page)).layouts[garage] || {}).dismissed || []; const x = d.find((y) => y.k === K); return x && x.ever ? x : null; }, 5000);
  check('0.11.1 ... kept with the function as ignored for good', !!kept, kept);
  await el(page, (b) => b._openProblems());
  const foot = await el(page, (b) => { const x = b._$.drawer.querySelector('.pother .pever'); return x ? x.textContent : null; });
  check('0.11.1 the problems drawer says how many are ignored for good, with a way back', /1 ignored for good · Bring them back as dismissed/.test(foot || ''), foot);
  // fixed and a day on: an ignored one isn't forgotten, as a dismissal would be
  await el(page, (b, [l, k]) => { const d = b._data.layouts[l].dismissed.find((x) => x.k === k); d.gone = Date.now() - 30 * 3600 * 1000; }, [garage, K]);
  fake.autos.fbfb_door_moved.triggers = [{ trigger: 'state', entity_id: 'cover.garage_door', from: 'closed', to: 'open' }];
  await el(page, (b, l) => { b._configChanged(); return b._open(l, true); }, garage);
  const still = await until(async () => { const d = ((await store(page)).layouts[garage] || {}).dismissed || []; const v = await probs(); return !v.ign.includes(K) && !v.shown.includes(K) ? d : null; }, 10000);
  check('0.11.1 ... and when the problem goes, it stays ignored for good (never forgotten)', !!still && still.some((x) => x.k === K && x.ever), still);
  // back as dismissed
  fake.autos.fbfb_door_moved.triggers = [{ trigger: 'state', entity_id: 'cover.garage_door', from: ['closed', 'open'] }];
  await el(page, (b, l) => { b._configChanged(); return b._open(l, true); }, garage);
  await until(async () => (await probs()).ign.includes(K) || null, 10000);
  await el(page, (b) => b._openProblems());
  await fbq(page, '.drawer [data-act="pdis-unever"]').click();
  const p3 = await until(async () => { const v = await probs(); return v.dis.includes(K) ? v : null; }, 5000);
  check('0.11.1 Bring them back as dismissed: under Dismissed again', !!p3 && !p3.ign.includes(K), p3);
  // the toast's Undo after Ignore for good puts it back where it was
  await fbq(page, '.pdchip').click();
  await fbq(page, `.drawer [data-act="pdis-ever"][data-k="${K}"]`).click();
  await until(async () => (await probs()).ign.includes(K) || null, 5000);
  await fbq(page, '.toast:not([hidden]) [data-act="toast-act"]').click();
  const p4 = await until(async () => { const v = await probs(); return v.dis.includes(K) ? v : null; }, 5000);
  check('0.11.1 Undo after Ignore for good: dismissed again, as it was', !!p4 && !p4.ign.includes(K), p4);
  check('0.11.1 both ways and ignoring: no errors', page.logs.length === 0, page.logs);
});

test('0.11.1 the sandbox: what the automations read, with values either side of a threshold, attributes, presses, the other triggers, script fields and the clock', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const ent = (id, extra) => Object.assign({ entity_id: id, id: 'fbid' + id.replace(/\W/g, ''), platform: 'demo', unique_id: 'u' + id, labels: [], categories: {}, area_id: null, device_id: null, config_entry_id: null, disabled_by: null, hidden_by: null, name: null, original_name: id, icon: null, has_entity_name: false, entity_category: null, options: {} }, extra || {});
  fake.entities.set('sensor.fb_co2', ent('sensor.fb_co2'));
  await fake.setState('sensor.fb_co2', '760', { friendly_name: 'Garage CO2', device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' });
  const zha = { trigger: 'device', device_id: 'fbzha1', domain: 'zha', type: 'remote_button_short_press', subtype: 'turn_on' };
  const autos = {
    'automation.fb_co2_high': { alias: 'Garage: CO2 high', triggers: [{ trigger: 'air_quality.co2_crossed_threshold', target: { entity_id: 'sensor.fb_co2' }, options: { behavior: 'each', threshold: { type: 'above', value: { active_choice: 'number', number: 1100 } } } }], actions: [] },
    'automation.fb_dim': { alias: 'Garage: light dimmed', triggers: [{ trigger: 'light.brightness_crossed_threshold', target: { entity_id: 'light.garage_light' }, options: { threshold: { type: 'below', value: { number: 50 } } } }], actions: [] },
    'automation.fb_remote': { alias: 'Garage: remote button', triggers: [zha], actions: [] },
    'automation.fb_boot': { alias: 'Garage: after a restart', triggers: [{ trigger: 'homeassistant', event: 'start' }, { trigger: 'webhook', webhook_id: 'fb-garage', allowed_methods: ['POST'] }, { trigger: 'tag', tag_id: 'fb-tag' }, { trigger: 'conversation', command: ['open the garage [door]'] }], actions: [] },
  };
  for (const [id, cfg] of Object.entries(autos)) { await addAuto(page, fake, id, Object.assign({ conditions: [] }, cfg)); await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [garage] }); }
  if (!fake.states.has('light.garage_light')) { fake.entities.set('light.garage_light', ent('light.garage_light')); await fake.setState('light.garage_light', 'on', { friendly_name: 'Garage light', brightness: 180 }); }
  await fake.setState('light.garage_light', 'on', Object.assign({}, (fake.states.get('light.garage_light') || {}).attributes, { brightness: 180 }));
  fake.scripts.fb_open_to = { alias: 'Open the garage to', fields: { height: { example: 50, selector: { number: {} } } }, sequence: [{ action: 'cover.set_cover_position', target: { entity_id: 'cover.garage_door' }, data: { position: '{{ height }}' } }] };
  fake.entities.set('script.fb_open_to', ent('script.fb_open_to', { platform: 'script', unique_id: 'fb_open_to' }));
  await fake.setState('script.fb_open_to', 'off', { friendly_name: 'Open the garage to' });
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'script.fb_open_to', labels: [garage] });
  await el(page, (b) => b._store.changed('reg'));
  await until(() => el(page, (b, l) => { if (b._model && b._model.nodes.has('automation.fb_boot') && b._model.nodes.has('automation.fb_co2_high') && b._model.nodes.has('script.fb_open_to')) return true; b._open(l, true); return null; }, garage), 15000, 700);
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  const D = (fn, arg) => el(page, fn, arg);
  // Set: grouped, the CO2 sensor among what the automations read, with 1101 picked
  const co2 = await D((b) => {
    const r = b._$.drawer, sel = r.querySelector('.sbent');
    sel.value = 'sensor.fb_co2'; sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const v = r.querySelector('.sbval-sel');
    const at = r.querySelector('.sbattr');
    return { group: sel.querySelector('option[value="sensor.fb_co2"]').parentNode.label, picked: v.value, opts: [...v.options].map((o) => o.textContent), attr: at.hidden, attrs: [...at.options].map((o) => o.value), groups: at.querySelectorAll('optgroup').length };
  });
  check('0.11.1 Set: the CO2 sensor is under "Read by the automations"', co2.group === 'Read by the automations', co2);
  check('0.11.1 ... its values say why: 1101 above 1100 (picked) and 1100 at it', co2.picked === '1101' && co2.opts.includes('1101 · above 1100: Garage: CO2 high') && co2.opts.includes('1100 · at 1100, not past it: Garage: CO2 high'), co2);
  check('0.11.2 ... its attribute choice has its other attributes (none of them read, so no groups)', co2.attr === false && co2.groups === 0 && co2.attrs.join() === ',device_class,unit_of_measurement', co2);
  const fired = (k) => D((b, x) => b._sbx.eng.log.filter((e) => e.kind === 'trigger' && e.key === x).length, k);
  const settle = () => until(() => D((b) => (b._sbx && !b._sbx.busy) || null), 10000);
  await fbq(page, '.drawer [data-act="sbx-set"]').click(); await settle();
  check('0.11.1 Set 1101: the CO2 trigger fires', (await fired('automation.fb_co2_high')) === 1);
  // an attribute: brightness
  const br = await D((b) => {
    const r = b._$.drawer, sel = r.querySelector('.sbent');
    sel.value = 'light.garage_light'; sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const at = r.querySelector('.sbattr'), opts = [...at.options].map((o) => o.value);
    at.value = 'brightness'; at.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { hidden: at.hidden, opts, vals: [...r.querySelector('.sbval-sel').options].map((o) => o.value), picked: r.querySelector('.sbval-sel').value };
  });
  check('0.11.1 an attribute a trigger reads (brightness) can be picked beside the state', !br.hidden && br.opts.join() === ',brightness', br);
  check('0.11.1 ... with 49 (below 50) picked', br.picked === '49' && br.vals.includes('50'), br);
  await fbq(page, '.drawer [data-act="sbx-set"]').click(); await settle();
  check('0.11.1 Set brightness 49: the light keeps its state, the attribute changes, the trigger fires', (await D((b) => [b._sbx.eng.get('light.garage_light').state, b._sbx.eng.get('light.garage_light').attributes.brightness])).join() === 'on,49' && (await fired('automation.fb_dim')) === 1);
  // a ZHA button, Home Assistant starting, a webhook, a tag, a sentence
  const rows = await D((b) => [...b._$.drawer.querySelectorAll('.sbctl .sbl')].map((x) => x.textContent));
  check('0.11.1 rows for a device\'s button, the webhook, the tag, Assist and HA, as the function has them', ['Press', 'Webhook', 'Tag', 'Assist', 'HA'].every((x) => rows.includes(x)) && !rows.includes('Calendar'), rows);
  const press = await D((b) => [...b._$.drawer.querySelector('.sbpress').options].map((o) => o.textContent));
  check('0.11.1 the button is named by its type and subtype', press.length === 1 && /remote button short press · turn on/.test(press[0]), press);
  await fbq(page, '.drawer [data-act="sbx-press"]').click(); await settle();
  await fbq(page, '.drawer [data-act="sbx-ha"]').click(); await settle();
  await fbq(page, '.drawer [data-act="sbx-hook"]').click(); await settle();
  await fbq(page, '.drawer [data-act="sbx-tag"]').click(); await settle();
  check('0.11.1 pressing it, HA starting, the webhook and the tag each fire theirs', (await fired('automation.fb_remote')) === 1 && (await fired('automation.fb_boot')) === 3);
  await fbq(page, '.drawer .sbsay-sel').selectOption({ index: 0 }); await fbq(page, '.drawer [data-act="sbx-say"]').click(); await settle();
  check('0.11.1 ... and saying its sentence fires the conversation trigger', (await fired('automation.fb_boot')) === 4);
  // a script's fields
  const vars = await D((b) => { const r = b._$.drawer, run = r.querySelector('.sbrun'); run.value = 'script.fb_open_to'; run.dispatchEvent(new Event('change', { bubbles: true, composed: true })); return { hidden: r.querySelector('.sbvarsw').hidden, v: r.querySelector('.sbvars-sel').value }; });
  check('0.11.1 Run a script with fields: its examples to start from', !vars.hidden && vars.v === '{"height":50}', vars);
  // the clock: the day and time, Advance by (1 min picked), what's due as buttons, Jump to
  const t0 = await D((b) => ({ now: b._sbx.eng.now, head: b._$.drawer.querySelector('.sbclock').textContent, adv: b._$.drawer.querySelector('.sbadv-sel').value, jump: [...b._$.drawer.querySelector('.sbjump-sel').options].map((o) => o.textContent) }));
  check('0.11.1 the clock shows the day, the date and the time to the second', /\d{2}:\d{2}:\d{2}$/.test(t0.head) && /,/.test(t0.head), t0.head);
  check('0.11.1 Advance by: 1 min picked; Jump to: midnight among the times', t0.adv === '60000' && t0.jump.some((x) => /Midnight/.test(x)), t0);
  await fbq(page, '.drawer [data-act="sbx-advby"]').click(); await settle();
  check('0.11.1 Advance runs the clock 1 minute', (await D((b) => b._sbx.eng.now)) - t0.now === 60000);
  const mid = await D((b) => { const s = b._$.drawer.querySelector('.sbjump-sel'), o = [...s.options].find((x) => /Midnight/.test(x.textContent)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true, composed: true })); return +o.value; });
  await fbq(page, '.drawer [data-act="sbx-jump"]').click(); await settle();
  check('0.11.1 Jump to midnight', (await D((b) => b._sbx.eng.now)) === mid);
  await D((b) => { const s = b._$.drawer.querySelector('.sbjump-sel'); s.value = '\u0001other'; s.dispatchEvent(new Event('change', { bubbles: true, composed: true })); b._$.drawer.querySelector('input.sbjump').value = '+90 min'; });
  const before = await D((b) => b._sbx.eng.now);
  await fbq(page, '.drawer [data-act="sbx-jump"]').click(); await settle();
  check('0.11.1 Jump to, typed: +90 min', (await D((b) => b._sbx.eng.now)) - before === 90 * 60000);
  check('0.11.1 the new sandbox controls: no errors', page.logs.length === 0, page.logs);
});

test('0.11.2 the sandbox: summaries, variables, undo and again, states, step-through, breakpoints, how a device answers, what if, the clock at speed, the explorer and coverage', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  const D = (fn, arg) => el(page, fn, arg);
  const settle = () => until(() => D((b) => (b._sbx && !b._sbx.busy) || null), 10000);
  const open = async () => { await D((b) => { const s = b._$.drawer.querySelector('.sbent'); s.value = 'cover.garage_door'; s.dispatchEvent(new Event('change', { bubbles: true, composed: true })); const v = b._$.drawer.querySelector('.sbval-sel'); v.value = 'open'; v.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }); await fbq(page, '.drawer [data-act="sbx-set"]').click(); await settle(); };
  await open();
  // a sentence of what came of it, before its rows
  const sum = await D((b) => { const x = b._$.drawer.querySelector('.sbtl .sbsum'); return x ? x.textContent : null; });
  check('0.11.2 each thing you do starts with a sentence of what came of it', /Started 2 automations: Garage: start open timer/.test(sum || '') && /changed Garage open timer → active/.test(sum || '') && /next: .*at/.test(sum || ''), sum);
  // variables at a row
  const vars = await D((b) => { const row = [...b._$.drawer.querySelectorAll('.sbtl .dbrow.k-call')][0]; row.click(); const p = b._$.drawer.querySelector('.sbvp'); return { hidden: p.hidden, text: p.textContent }; });
  check('0.11.2 picking a row shows its variables: the trigger that started the run', !vars.hidden && /"to_state"/.test(vars.text) && /"open"/.test(vars.text), vars);
  // Again, and Undo
  const again = await D((b) => [...b._$.drawer.querySelectorAll('.sbrec [data-act="sbx-again"]')].map((x) => x.textContent));
  check('0.11.2 Again lists what you did', again.length === 1 && /Garage Door/.test(again[0]), again);
  await fbq(page, '.drawer [data-act="sbx-undo"]').click(); await settle();
  const undone = await D((b) => ({ st: b._sbx.eng.get('cover.garage_door').state, steps: b._sbx.rec.steps.length, rows: b._sbx.eng.log.length }));
  check('0.11.2 Undo: back to the start, the door as it was, no steps kept', undone.st !== 'open' && undone.steps === 0, undone);
  await open();
  await fbq(page, '.drawer [data-act="sbx-again"]').click(); await settle();
  check('0.11.2 Again with nothing to change says so (the door is already open)', (await D((b) => b._sbx.eng.log.some((e) => e.kind === 'note' && /already/.test(e.text)))));
  // the flow bar: back to before this
  await D((b) => b._sbxRewind(0)); await settle();
  await open();
  check('0.11.2 the flow bar offers Back to before this', await D((b) => !!b._$.litbar.querySelector('[data-act="flow-undo"]')));
  await D((b) => b._$.litbar.querySelector('[data-act="flow-undo"]').click()); await settle();
  check('0.11.2 ... which undoes it', (await D((b) => b._sbx.rec.steps.length)) === 0);
  // the states tab
  await open();
  await fbq(page, '.drawer .sbtabs [data-tab="st"]').click();
  const sts = await D((b) => { const r = b._$.drawer.querySelector('.sbst'); const rows = [...r.querySelectorAll('.sbsr')]; return { hidden: r.hidden, changed: rows.filter((x) => x.classList.contains('ch')).map((x) => x.dataset.key), first: rows.slice(0, rows.filter((x) => x.classList.contains('ch')).length).every((x) => x.classList.contains('ch')), all: rows.length }; });
  check('0.11.2 States: every entity, the ones changed in the sandbox marked and first', !sts.hidden && sts.first && sts.changed.includes('cover.garage_door') && sts.changed.includes('timer.garage_open') && sts.all > sts.changed.length, sts);
  await D((b) => { const x = b._$.drawer.querySelector('.sbst [data-act="sbx-st-reset"][data-k="cover.garage_door"]'); x.click(); }); await settle();
  check('0.11.2 Put back: the door as it is in your home', await D((b) => b._sbx.eng.get('cover.garage_door').state === b._sbx.eng.real['cover.garage_door'].state));
  await fbq(page, '.drawer .sbtabs [data-tab="tl"]').click();
  // step-through
  await D((b) => b._sbxRewind(0)); await settle();
  await D((b) => { const c = b._$.drawer.querySelector('.sbstep'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true, composed: true })); });
  await open();
  const p1 = await D((b) => ({ n: b._sbx.eng.paused.size, q: b._$.drawer.querySelector('.sbask .sbpause') ? b._$.drawer.querySelector('.sbask .sbpause').textContent : null, timer: b._sbx.eng.get('timer.garage_open').state }));
  check('0.11.2 Step through: both runs pause before their action, each shown with Step and Continue', p1.n === 2 && /Paused before: timer.start/.test(p1.q || '') && p1.timer !== 'active', p1);
  await fbq(page, '.drawer .sbpause [data-act="sbx-stepone"]').first().click();
  await until(() => D((b) => (b._sbx.eng.get('timer.garage_open').state === 'active' && b._sbx.eng.paused.size === 1) || null), 5000);
  check('0.11.2 Step: one goes on (the timer starts), the other still waits', true);
  await fbq(page, '.drawer [data-act="sbx-continue"]').first().click(); await settle();
  check('0.11.2 Continue: none waits', (await D((b) => b._sbx.eng.paused.size)) === 0);
  await D((b) => { const c = b._$.drawer.querySelector('.sbstep'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true, composed: true })); });
  // a breakpoint on one automation, from its box
  await D((b) => b._sbxRewind(0)); await settle();
  await D((b) => { b._sel = 'automation.garage_start_open_timer'; b._renderNodebar(); });
  await D((b) => b._$.nodebar.querySelector('[data-act="sbx-break"]').click());
  await open();
  check('0.11.2 Pause here on a box: that automation pauses', (await D((b) => [b._sbx.eng.paused.size, b._sbx.eng.breaks.has('automation.garage_start_open_timer')])).join() === '1,true');
  await fbq(page, '.drawer [data-act="sbx-continue"]').click(); await settle();
  await D((b) => { b._sbx.eng.breaks.clear(); });
  // how a device answers
  await D((b) => b._sbxRewind(0)); await settle();
  await D((b) => { const r = b._$.drawer; r.querySelector('.sbdev').value = 'cover.garage_door'; r.querySelector('.sbhow').value = 'slow'; });
  await fbq(page, '.drawer [data-act="sbx-behave"]').click();
  await D((b) => b._sbxStep({ op: 'run', id: 'script.close_garage', conds: true, ti: null })); await settle();
  const slow = await D((b) => ({ st: b._sbx.eng.get('cover.garage_door').state, due: b._sbx.eng.pending().map((x) => x.label), rec: b._sbx.rec.steps.map((x) => x.op) }));
  check('0.11.2 a door set to answer slowly is closing first, its end due, and the set-up kept as a step', /clos/.test(slow.st) && slow.due.some((x) => /Garage Door answers/.test(x)) && slow.rec[0] === 'behave', slow);
  // what if
  await D((b) => b._sbxRewind(0)); await settle();
  await D((b) => { const s = b._$.drawer.querySelector('.sbwhat'); s.value = 'cut'; });
  await fbq(page, '.drawer [data-act="sbx-whatif"]').click(); await settle();
  const cut = await D((b) => ({ door: b._sbx.eng.get('cover.garage_door').state, back: [...b._$.drawer.querySelector('.sbwhat').options].some((o) => o.value === 'back') }));
  check('0.11.2 What if a power cut: what the automations read goes unavailable, and The power comes back is offered', cut.door === 'unavailable' && cut.back, cut);
  await D((b) => { const s = b._$.drawer.querySelector('.sbwhat'); s.value = 'back'; });
  await fbq(page, '.drawer [data-act="sbx-whatif"]').click(); await settle();
  check('0.11.2 ... and back', await D((b) => b._sbx.eng.get('cover.garage_door').state !== 'unavailable'));
  // the clock at speed
  const t0 = await D((b) => b._sbx.eng.now);
  await D((b) => { const s = b._$.drawer.querySelector('.sbspeed'); s.value = '60'; s.dispatchEvent(new Event('change', { bubbles: true, composed: true })); });
  await page.waitForTimeout(2300);
  await D((b) => { const s = b._$.drawer.querySelector('.sbspeed'); s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true, composed: true })); });
  await settle();
  const ran = (await D((b) => b._sbx.eng.now)) - t0;
  check('0.11.2 the clock at 60×: a minute a second', ran >= 60000 && ran <= 180000 && (await D((b) => b._sbx.rec.steps.filter((x) => x.op === 'advance').length)) === 1, ran);
  // the explorer
  await D((b) => b._sbxRewind(0)); await settle();
  await fbq(page, '.drawer .sbtabs [data-tab="ex"]').click();
  await fbq(page, '.drawer .sbex [data-act="sbx-explore"]').click();
  await until(() => D((b) => (b._sbx.ex && !b._sbx.ex.running) || null), 60000);
  const ex = await D((b) => ({ runs: b._sbx.ex.runs.length, text: b._$.drawer.querySelector('.sbex').textContent, opened: b._sbx.ex.runs.find((r) => r.step.id === 'cover.garage_door' && r.step.state === 'open') }));
  check('0.11.2 Explore: each thing tried from the start, opening the door among them, starting the timer', ex.runs > 3 && !!ex.opened && ex.opened.started.includes('automation.garage_start_open_timer'), ex);
  const i = await D((b) => b._sbx.ex.runs.findIndex((r) => r.step.id === 'cover.garage_door' && r.step.state === 'open'));
  await D((b, n) => b._$.drawer.querySelector(`.sbex [data-act="sbx-ex-show"][data-i="${n}"]`).click(), i);
  await until(() => D((b) => (b._sbx.tab === 'tl' && !b._sbx.busy && b._sbx.rec.steps.length >= 1) || null), 15000);
  check('0.11.2 ... Show plays one in the sandbox: the door open, and the clock run on as it went', await D((b) => b._sbx.rec.steps[0].id === 'cover.garage_door' && b._sbx.eng.log.some((e) => e.kind === 'trigger' && e.key === 'automation.garage_left_open')));
  // coverage: what you did here
  await fbq(page, '.drawer .sbtabs [data-tab="cov"]').click();
  await D((b) => { const c = b._$.drawer.querySelector('.sbcovmine'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true, composed: true })); });
  await fbq(page, '.drawer [data-act="sbx-cov-run"]').click();
  await until(() => D((b) => (b._sbx.cov && !b._sbx.cov.running) || null), 15000);
  const cov = await D((b) => { const r = b._$.drawer.querySelector('.sbcov'); return { sum: r.querySelector('p b') ? r.querySelector('p b').textContent : '', started: [...r.querySelectorAll('.sbcv[data-key="automation.garage_start_open_timer"] li')].map((x) => x.className), uncov: [...b._$.board.querySelectorAll('.node.uncov')].map((x) => x.dataset.key) }; });
  check('0.11.2 Coverage: what you did reaches the open-timer automation fully', cov.started.length > 0 && cov.started.every((c) => c === 'cv-ok') && /reached fully/.test(cov.sum), cov);
  check('0.11.2 ... and nothing on the board is marked unreached that was reached', !cov.uncov.includes('automation.garage_start_open_timer'), cov.uncov);
  check('0.11.2 the sandbox\'s new tools: no errors', page.logs.length === 0, page.logs);
});

pwTest.afterAll(() => done());

test('0.11.2 the sandbox: a helper follows what it reads, by the rule functions_board/sources gives', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  // a threshold helper in the garage function, on a sensor the garage reads; the integration says how it follows it
  const HOT = 'binary_sensor.fb_garage_hot', T = 'sensor.fb_garage_temp';
  for (const [id, platform, st] of [[HOT, 'threshold', 'off'], [T, 'template', '20']]) {
    fake.entities.set(id, { entity_id: id, id: 'fbid' + id.length + platform, platform, unique_id: id, labels: [], categories: {}, area_id: null, device_id: null, config_entry_id: null, disabled_by: null, hidden_by: null, name: null, original_name: id === HOT ? 'Garage hot' : 'Garage temperature', icon: null, has_entity_name: false, entity_category: null, options: {} });
    await fake.setState(id, st, { friendly_name: id === HOT ? 'Garage hot' : 'Garage temperature' });
  }
  fake.sources[HOT] = { entities: [T], domains: [], all: false, how: 'options', rule: { kind: 'threshold', entity: T, lower: null, upper: 25, hysteresis: 1 } };
  await ws(page, { type: 'config/entity_registry/update', entity_id: HOT, labels: [garage] });
  await fake.idle(400);
  await until(() => el(page, (b, h) => !!(b._model && b._model.nodes.has(h) && b._src.get(h)) || null, HOT), 10000);
  // a config changed just now: the board let go of what helpers read, and the sandbox starts before it asks again
  await el(page, (b) => { b._src = new Map(); });
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  const said = await el(page, (b) => b._sbx.eng.log.filter((e) => e.kind === 'note').map((e) => e.text).join(' | '));
  check('0.11.2 the sandbox says which helpers follow what they read', /follow what they read here.*Garage hot/.test(said), said);
  await el(page, (b, t) => b._sbx.eng.userSet(t, '26.5'), T);
  await until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 10000);
  const got = await el(page, (b, h) => ({ st: b._sbx.eng.get(h).state, row: (b._sbx.eng.log.find((e) => e.kind === 'state' && e.key === h) || {}).follows, real: b._hass.states[h].state }), HOT);
  check('0.11.2 a threshold helper turns on when its sensor passes the limit and the hysteresis, here only', got.st === 'on' && got.real === 'off' && got.row === T, got);
  await el(page, (b) => b._renderSbx());
  const text = await fbq(page, '.drawer .sbtl').innerText();
  check('0.11.2 ... and its row says what it follows', /Garage hot → on[\s\S]*follows Garage temperature/.test(text), text.slice(0, 600));
});

test('0.11.2 a saved check replays a helper that follows what it reads', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const HOT = 'binary_sensor.fb_garage_hot', T = 'sensor.fb_garage_temp';
  for (const [id, platform, st] of [[HOT, 'threshold', 'off'], [T, 'template', '20']]) {
    fake.entities.set(id, { entity_id: id, id: 'fbid' + id.length + platform, platform, unique_id: id, labels: [], categories: {}, area_id: null, device_id: null, config_entry_id: null, disabled_by: null, hidden_by: null, name: null, original_name: id, icon: null, has_entity_name: false, entity_category: null, options: {} });
    await fake.setState(id, st, {});
  }
  fake.sources[HOT] = { entities: [T], domains: [], all: false, how: 'options', rule: { kind: 'threshold', entity: T, lower: null, upper: 25, hysteresis: 1 } };
  await ws(page, { type: 'config/entity_registry/update', entity_id: HOT, labels: [garage] });
  await fake.idle(400);
  await until(() => el(page, (b, h) => !!(b._model && b._model.nodes.has(h)) || null, HOT), 10000);
  const res = await el(page, async (b, a) => {
    b._src = new Map();  // as after a config change: the replay asks for the rules itself
    const L = b._layout(a.garage);
    L.checks = [{ id: 'fbhot1', name: 'Hot when warm', at: Date.now(), start: {}, items: [], steps: [{ op: 'set', id: a.T, state: '26.5' }], answers: [], expect: [{ k: 'state', id: a.HOT, state: 'on' }] }];
    await b._runChecks(a.garage, null, true);
    const r = b._checkRes.get(a.garage).res.get('fbhot1');
    return { ok: r.ok, got: r.res.map((x) => x.got) };
  }, { garage, T, HOT });
  check('0.11.2 a saved check replays a threshold helper following its sensor', res.ok && res.got[0] === 'on', res);
});

test('0.11.2 the sandbox, whole home: the automations outside the function that its changes reach run too', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  // outside the garage function: one the door reaches, one that reaches, and one nothing in it reaches
  await fake.setState('input_boolean.fb_porch', 'off', { friendly_name: 'Porch light on' });
  await fake.setState('input_boolean.fb_porch2', 'off', { friendly_name: 'Porch counted' });
  await fake.setState('input_boolean.fb_far', 'off', { friendly_name: 'Far away' });
  await addPiece(page, fake, 'automation.fb_porch_door', { alias: 'Porch with the garage door', mode: 'single', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open' }], conditions: [], actions: [{ action: 'input_boolean.turn_on', target: { entity_id: 'input_boolean.fb_porch' } }] });
  await addPiece(page, fake, 'automation.fb_porch_next', { alias: 'After the porch', mode: 'single', triggers: [{ trigger: 'state', entity_id: 'input_boolean.fb_porch', to: 'on' }], conditions: [], actions: [{ action: 'input_boolean.turn_on', target: { entity_id: 'input_boolean.fb_porch2' } }] });
  // one that starts from what the function only reads, never changes or fires itself (the timer's finished event)
  await fake.setState('input_boolean.fb_timer_note', 'off', { friendly_name: 'Timer noted' });
  await addPiece(page, fake, 'automation.fb_timer_note', { alias: 'Note the timer', mode: 'single', triggers: [{ trigger: 'event', event_type: 'timer.finished' }], conditions: [], actions: [{ action: 'input_boolean.turn_on', target: { entity_id: 'input_boolean.fb_timer_note' } }] });
  await addPiece(page, fake, 'automation.fb_far', { alias: 'Far away', mode: 'single', triggers: [{ trigger: 'state', entity_id: 'input_boolean.fb_far', to: 'on' }], conditions: [], actions: [{ action: 'input_boolean.turn_off', target: { entity_id: 'input_boolean.fb_far' } }] });
  await fake.idle(400);
  await openFn(page, /garage/i);
  await fbq(page, '.tools [data-act="sandbox"]').click();
  // the intro offers it
  check('0.11.2 the sandbox\'s intro offers whole home', await fbq(page, '.modal input[name="sbxwhole"]').count() === 1);
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  const D = (fn, arg) => el(page, fn, arg);
  const settle = () => until(() => D((b) => (b._sbx && !b._sbx.busy) || null), 10000);
  check('0.11.2 off by default: only the function\'s own run', (await D((b) => b._sbx.outside.size)) === 0);
  await D((b) => { const c = b._$.drawer.querySelector('.sbwhole'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true, composed: true })); });
  await until(() => D((b) => (b._sbx && b._sbx.outside.size) || null), 10000);
  await settle();
  const got = await D((b) => ({ out: [...b._sbx.outside].sort(), kept: b._data.ui.sbxWhole, note: b._sbx.eng.log.filter((e) => e.kind === 'note').map((e) => e.text).join(' | '), row: b._$.drawer.querySelector('.sbctl').innerText }));
  check('0.11.2 whole home takes the automations the door reaches, and the ones those reach, not the rest', got.out.join() === 'automation.fb_porch_door,automation.fb_porch_next,automation.fb_timer_note', got.out);
  check('0.11.2 ... including one that starts from what the function only reads (an event it listens to)', got.out.includes('automation.fb_timer_note'), got.out);
  check('0.11.2 ... says so when it starts, and in its row; the choice is kept with your display settings', /Whole home: 3 automations outside this function run too.*Porch with the garage door/.test(got.note) && /3 automations outside/.test(got.row) && got.kept === true, got);
  const open = async () => { await D((b) => { const s = b._$.drawer.querySelector('.sbent'); s.value = 'cover.garage_door'; s.dispatchEvent(new Event('change', { bubbles: true, composed: true })); const v = b._$.drawer.querySelector('.sbval-sel'); v.value = 'open'; v.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }); await fbq(page, '.drawer [data-act="sbx-set"]').click(); await settle(); };
  await open();
  const after = await D((b) => ({ p: b._sbx.eng.get('input_boolean.fb_porch').state, p2: b._sbx.eng.get('input_boolean.fb_porch2').state, real: b._hass.states['input_boolean.fb_porch'].state,
    ghosts: [...b._$.flow.querySelectorAll('.ghost')].map((x) => x.textContent), cov: (() => { b._sbx.cov = { running: false, n: 0, engs: [] }; b._sbx.covMine = true; const l = b._sbxCovList(); return l.length > 0 && l.every((x) => !/fb_porch/.test(x.id)); })() }));
  check('0.11.2 opening the door runs both outside automations, in the sandbox only', after.p === 'on' && after.p2 === 'on' && after.real === 'off', after);
  check('0.11.2 ... shown beside the board as not on it, and left out of the function\'s coverage', after.ghosts.some((t) => /Porch with the garage door/.test(t)) && after.cov, after);
  // a check saved in whole home replays the outside automations it had
  const rec = await D((b) => b._sbx.rec.items.filter((k) => /fb_porch/.test(k)).sort());
  check('0.11.2 what you did keeps the outside automations that took part, for a saved check', rec.join() === 'automation.fb_porch_door,automation.fb_porch_next', rec);
  await D((b) => { const c = b._$.drawer.querySelector('.sbwhole'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true, composed: true })); });
  await until(() => D((b) => (b._sbx && b._sbx.outside.size === 0 && !b._data.ui.sbxWhole) || null), 10000);
  check('0.11.2 turning it off starts again with the function alone', true);
});

test('0.11.2 saved checks: edit one (name, step order and values, what it expects), share it as text, import one', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const D = (fn, arg) => el(page, fn, arg);
  await D((b, label) => {
    b._layout(label).checks = [{ id: 'fbck1', name: 'Door left open', at: Date.now(), start: {}, items: [], answers: [],
      steps: [{ op: 'advance', ms: 60000 }, { op: 'set', id: 'cover.garage_door', state: 'open' }],
      expect: [{ k: 'state', id: 'timer.garage_open', state: 'active' }, { k: 'ran', id: 'automation.garage_start_open_timer' }] }];
  }, garage);
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbchk [data-act="chk-edit"]').click();
  // the set step up, its value changed; the time step's seconds changed; one expectation out, one added
  await fbq(page, '.modal [data-act="chk-st-up"][data-i="1"]').click();
  const first = await fbq(page, '.modal .cked li >> nth=0').innerText();
  check('0.11.2 Earlier moves a step up', /Garage Door/.test(first), first);
  await D((b) => { const m = b._$.modal; const v = (sel, x) => { const i = m.querySelector(sel); if (i) i.value = x; }; v('input[data-ckst="0"]', 'opening'); v('input[data-ckst="1"]', '120'); });
  await fbq(page, '.modal [data-act="chk-x-del"][data-i="1"]').click();
  await D((b) => { const m = b._$.modal; m.querySelector('select[name="ckxk"]').value = 'state'; m.querySelector('select[name="ckxid"]').value = 'cover.garage_door'; m.querySelector('input[name="ckxs"]').value = 'opening'; });
  await fbq(page, '.modal [data-act="chk-x-add"]').click();
  // adding a run expectation on something that doesn't run says so
  await D((b) => { const m = b._$.modal; m.querySelector('select[name="ckxk"]').value = 'ran'; m.querySelector('select[name="ckxid"]').value = 'cover.garage_door'; });
  await fbq(page, '.modal [data-act="chk-x-add"]').click();
  const said = await fbq(page, '.modal .dval').innerText();
  check('0.11.2 an expectation that something runs needs an automation or a script', /Only an automation or a script runs/.test(said), said);
  // typed last, so only saving reads it
  await fbq(page, '.modal .ckdlg input[name="ckname"]').fill('Door open, timer on');
  await fbq(page, '.modal [data-act="chk-edit-go"]').click();
  const c = await D((b, label) => JSON.parse(JSON.stringify(b._checksOf(label)[0])), garage);
  check('0.11.2 editing keeps the check (same id) with the new name, step order and values, and expectations', c.id === 'fbck1' && c.name === 'Door open, timer on'
    && c.steps[0].op === 'set' && c.steps[0].state === 'opening' && c.steps[1].op === 'advance' && c.steps[1].ms === 120000
    && c.expect.length === 2 && c.expect[0].k === 'state' && c.expect[0].id === 'timer.garage_open' && c.expect[1].id === 'cover.garage_door' && c.expect[1].state === 'opening', c);
  // share: the check as text, without its id
  await fbq(page, '.drawer .sbchk [data-act="chk-export"]').click();
  const text = await fbq(page, '.modal textarea.ckjson').inputValue();
  const o = JSON.parse(text);
  check('0.11.2 Share gives the check as text, marked as one, without its id', o.functions_board_check === 1 && !('id' in o) && o.name === 'Door open, timer on' && o.steps.length === 2, o);
  await fbq(page, '.modal [data-act="modal-cancel"]').click();
  // import: what was shared comes back as a new check; something else doesn't
  await fbq(page, '.drawer .sbchk [data-act="chk-import"]').click();
  await fbq(page, '.modal textarea.ckjson').fill('{"name": "not one"}');
  await fbq(page, '.modal [data-act="chk-import-go"]').click();
  const bad = await fbq(page, '.modal .dval').innerText();
  check('0.11.2 Import refuses text that isn\'t a shared check', /isn't a check copied with Share/.test(bad), bad);
  await fbq(page, '.modal textarea.ckjson').fill(text.replace('Door open, timer on', 'From a friend'));
  await fbq(page, '.modal [data-act="chk-import-go"]').click();
  const list = await D((b, label) => b._checksOf(label).map((x) => ({ id: x.id, name: x.name, steps: x.steps.length })), garage);
  check('0.11.2 ... and adds a shared one as a new check with its own id', list.length === 2 && list[1].name === 'From a friend' && list[1].id !== 'fbck1' && list[1].steps === 2, list);
  const rows = await fbq(page, '.drawer .sbchk').innerText();
  check('0.11.2 ... listed with the others', /From a friend/.test(rows) && /Door open, timer on/.test(rows), rows);
});

test('0.11.2 the sandbox: replay a period from history, and how it compares with what really happened', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  await openFn(page, /garage/i);
  const iso = (ms) => new Date(ms).toISOString();
  let asked = null;
  // the door opened an hour in; the open timer's automation ran then; the closed one ran at two hours in, which the
  // sandbox can't (nothing closes the door here)
  fake.history = (from, to, ids) => {
    asked = asked || [];
    asked.push(ids);
    const H = 3600e3;
    return {
      'cover.garage_door': [{ s: 'closed', a: { friendly_name: 'Garage Door' }, lu: from / 1000 }, { s: 'open', lu: (from + H) / 1000 }],
      'automation.garage_start_open_timer': [{ s: 'on', a: { last_triggered: iso(from - 24 * H) }, lu: from / 1000 }, { s: 'on', a: { last_triggered: iso(from + H) }, lu: (from + H) / 1000 }],
      'automation.garage_closed_stop_timer': [{ s: 'on', a: { last_triggered: iso(from - 24 * H) }, lu: from / 1000 }, { s: 'on', a: { last_triggered: iso(from + 2 * H) }, lu: (from + 2 * H) / 1000 }],
    };
  };
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbhist').waitFor({ timeout: 10000 });
  const D = (fn, arg) => el(page, fn, arg);
  await D((b) => { const s = b._$.drawer.querySelector('.sbhist'); s.value = 'h6'; });
  const t0 = Date.now();
  await fbq(page, '.drawer [data-act="sbx-history"]').click();
  await until(() => D((b) => (b._sbx && b._sbx.hist && !b._sbx.busy) || null), 20000);
  const r = await D((b) => ({ at: b._sbx.rec.at, steps: b._sbx.rec.steps, door: b._sbx.eng.get('cover.garage_door').state, real: b._hass.states['cover.garage_door'].state,
    pane: (b._$.drawer.querySelector('.sbhp') || {}).innerText || '', cmp: b._sbx.hist.cmp.map((x) => [x.id, x.same]) }));
  check('0.11.2 a replay asks Home Assistant\'s history for what the function reads and its automations', !!asked && asked.flat().includes('cover.garage_door') && asked.flat().includes('automation.garage_start_open_timer'), asked);
  check('0.11.2 ... starts from the home six hours ago and replays the door opening, in the sandbox only', Math.abs(r.at - (t0 - 6 * 3600e3)) < 120e3 && r.steps.some((x) => x.op === 'set' && x.id === 'cover.garage_door' && x.state === 'open') && r.door === 'open' && r.real !== 'open', r);
  check('0.11.2 ... says how many real changes it replayed, and over what time', /Replayed 1 real change from/.test(r.pane), r.pane);
  check('0.11.2 ... the open timer\'s automation ran when it did in your home', r.cmp.some(([id, same]) => id === 'automation.garage_start_open_timer' && same) && /The same as in your home:.*Garage: start open timer/.test(r.pane), r);
  check('0.11.2 ... and the one that ran in your home but not here is listed, with when', r.cmp.some(([id, same]) => id === 'automation.garage_closed_stop_timer' && !same) && /Garage: closed, stop timer ran 1× in your home and 0× here/.test(r.pane), r.pane);
  // what was replayed can be kept as a check
  check('0.11.2 ... and can be saved as a check (Save as a check is on)', await D((b) => !b._$.drawer.querySelector('[data-act="chk-save"]').disabled));
});

test('0.11.2 the sandbox: a notification\'s buttons to press, and the messages Zigbee2MQTT and Frigate send', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  // in the garage: a notification with a button, the automation that answers it, a Zigbee2MQTT button and Frigate
  await addPiece(page, fake, 'automation.fb_ask_close', { alias: 'Ask to close', mode: 'single', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open' }], conditions: [],
    actions: [{ action: 'notify.mobile_app_phone', data: { message: 'The garage is open', data: { actions: [{ action: 'FB_CLOSE_GARAGE', title: 'Close it' }, { action: 'URI', title: 'Open the app', uri: '/lovelace' }] } } }] });
  await addPiece(page, fake, 'automation.fb_on_close', { alias: 'Close when asked', mode: 'single', triggers: [{ trigger: 'event', event_type: 'mobile_app_notification_action', event_data: { action: 'FB_CLOSE_GARAGE' } }], conditions: [], actions: [{ action: 'script.close_garage' }] });
  await addPiece(page, fake, 'automation.fb_z2m', { alias: 'Garage button', mode: 'single', triggers: [{ trigger: 'mqtt', topic: 'zigbee2mqtt/garage_button', payload: 'single', value_template: '{{ value_json.action }}' }], conditions: [], actions: [{ action: 'script.close_garage' }] });
  await addPiece(page, fake, 'automation.fb_frigate', { alias: 'Someone at the garage', mode: 'single', triggers: [{ trigger: 'mqtt', topic: 'frigate/events' }], conditions: [], actions: [] });
  for (const id of ['automation.fb_ask_close', 'automation.fb_on_close', 'automation.fb_z2m', 'automation.fb_frigate']) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [garage] });
  await fake.idle(400);
  await until(() => el(page, (b) => (b._model && b._model.nodes.has('automation.fb_on_close')) || null), 10000);
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  const D = (fn, arg) => el(page, fn, arg);
  const settle = () => until(() => D((b) => (b._sbx && !b._sbx.busy) || null), 10000);
  const opts = await D((b) => [...(b._$.drawer.querySelector('.sbnact') || { options: [] }).options].map((o) => [o.value, o.textContent]));
  check('0.11.2 the Notification row lists the buttons the function would put on one (not a link button)', opts.length === 1 && opts[0][0] === 'FB_CLOSE_GARAGE' && /Close it/.test(opts[0][1]), opts);
  // the door open in the sandbox, then the button pressed: the answering automation closes it
  await D((b) => b._sbx.eng.userSet('cover.garage_door', 'open')); await settle();
  await fbq(page, '.drawer [data-act="sbx-nact"]').click(); await settle();
  const after = await D((b) => ({ door: b._sbx.eng.get('cover.garage_door').state, ran: b._sbx.eng.log.some((e) => e.kind === 'trigger' && e.key === 'automation.fb_on_close'), step: b._sbx.rec.steps[b._sbx.rec.steps.length - 1] }));
  check('0.11.2 pressing it fires the phone\'s event: the automation answering it runs and closes the door', after.ran && /clos/.test(after.door) && after.step.op === 'event' && after.step.type === 'mobile_app_notification_action' && after.step.data.action === 'FB_CLOSE_GARAGE', after);
  // the MQTT row: Zigbee2MQTT's action as the JSON it sends; Frigate's events
  const pays = async (topic) => D((b, t) => { const d = b._$.drawer; const f = d.querySelector('.sbtop-sel'); if (f) { f.value = t; f.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } b._sbxPayloads(); return [...d.querySelector('.sbpay-sel').options].map((o) => [o.value, o.textContent]); }, topic);
  const z = await pays('zigbee2mqtt/garage_button');
  check('0.11.2 a Zigbee2MQTT button\'s action is suggested as the JSON it sends', z.some(([v]) => v === '{"action":"single"}'), z);
  const fr = await pays('frigate/events');
  check('0.11.2 Frigate\'s events are suggested: a person, a car, gone', fr.filter(([, l]) => /What it sends/.test(l)).length === 3 && fr.some(([v]) => /"label":"person"/.test(v)), fr);
});

test('0.11.3 an MQTT entity on the board follows its topic: an arrow from the topic\'s box, which a publish points to', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const LOCK = 'lock.shed_lock', TOPIC = 'fbtest/shed/lock';
  // what functions_board/sources says for the test home's MQTT lock (its state topic, as configuration.yaml has it)
  fake.sources[LOCK] = { entities: [], domains: [], all: false, how: 'mqtt', topics: [TOPIC], rule: { kind: 'mqtt', domain: 'lock', state: { topic: TOPIC, how: 'map', map: { LOCKED: 'locked', UNLOCKED: 'unlocked', None: 'unknown' }, blank: 'skip' } } };
  await addPiece(page, fake, 'automation.fb_shed_says', { alias: 'Shed: say it is locked', mode: 'single', triggers: [{ trigger: 'time', at: '22:00:00' }], conditions: [], actions: [{ action: 'mqtt.publish', data: { topic: TOPIC, payload: 'LOCKED' } }] });
  await addPiece(page, fake, 'automation.fb_shed_locked', { alias: 'Shed: when it locks', mode: 'single', triggers: [{ trigger: 'state', entity_id: LOCK, to: 'locked' }], conditions: [], actions: [{ action: 'light.turn_off', target: { entity_id: 'light.bed_light' } }] });
  for (const id of ['automation.fb_shed_says', 'automation.fb_shed_locked']) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [garage] });
  await fake.idle(400);
  await until(() => el(page, (b, a) => (b._model && b._model.nodes.has(a.LOCK) && b._model.edges.some((e) => e.from === 'mqtt:' + a.TOPIC && e.to === a.LOCK)) || null, { LOCK, TOPIC }), 10000);
  const m = await el(page, (b, a) => ({
    member: b._model.nodes.get(a.LOCK).kind, asked: b._src.has(a.LOCK), light: b._src.has('light.bed_light'),
    pub: b._model.edges.filter((e) => e.from === 'automation.fb_shed_says').map((e) => e.role + ':' + e.to),
    into: b._model.edges.filter((e) => e.to === a.LOCK).map((e) => e.role + ':' + e.from).sort(),
  }), { LOCK, TOPIC });
  check('0.11.3 the MQTT lock isn\'t a member, and the board asked what it follows (and not for a plain light)', m.member !== 'member' && m.asked && !m.light, m);
  check('0.11.3 the publish is an arrow to the topic\'s box, not to an mqtt.publish action box', m.pub.length === 1 && m.pub[0] === 'action:mqtt:' + TOPIC, m.pub);
  check('0.11.3 the topic\'s box has an arrow into the lock that follows it', m.into.includes('source:mqtt:' + TOPIC), m.into);
  check('0.11.3 the MQTT chain: no errors', page.logs.length === 0, page.logs);
});

test('0.11.3 the notification builder: a script made from what\'s picked, opened in it again, tried in the sandbox, undone; edited by hand it opens in Home Assistant\'s editor', async ({ browser, fake }) => {
  fake.store.mode = 'full';
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const KEY = 'script.garage_left_open_2', OID = 'garage_left_open_2';
  fake.states.delete(KEY);
  const rcp = fbq(page, '.tools [data-act="recipes"]');
  const hasRcp = (await rcp.isVisible()) && /Recipes/.test(await rcp.innerText());
  check('0.11.3 the toolbar has a Recipes menu', hasRcp);
  if (!hasRcp) return;
  await rcp.click();
  const menu = await fbq(page, '.menu').innerText();
  check('0.11.3 ... with Notification in it', /Notification/.test(menu), menu);
  await fbq(page, '.menu [data-act="nb-new"]').click();
  await fbq(page, '.modal .nbdlg').waitFor({ timeout: 5000 });
  const dlg = await fbq(page, '.modal .nbdlg').innerText();
  check('0.11.3 the builder lists the person with their phone, the phone (Android), speakers and text-to-speech', /Test Owner/.test(dlg) && /Test phone/i.test(dlg) && /Android/.test(dlg) && !!(await fbq(page, '.modal select[name="nbtts"] option[value="tts.google_translate_en_com"]').count()), dlg.slice(0, 600));
  // nothing picked: it says what's missing
  await fbq(page, '.modal [data-act="nb-save"]').click();
  check('0.11.3 Save asks for a name first', /Give it a name/.test(await fbq(page, '.modal .aval').innerText()));
  await fbq(page, '.modal input[name="nbname"]').fill('Garage left open 2');
  await fbq(page, '.modal textarea[name="nbmsg"]').fill('The garage is still open');
  await fbq(page, '.modal [data-act="nb-save"]').click();
  check('0.11.3 ... and who gets it', /Pick who gets it/.test(await fbq(page, '.modal .aval').innerText()));
  await fbq(page, '.modal input[name="nbp"][value="person.test_owner"]').check();
  await fbq(page, '.modal select[name="nblevel"]').selectOption('time');
  await fbq(page, '.modal [data-act="nb-add-btn"]').click();
  await fbq(page, '.modal input[name="nbbt"]').fill('Close it');
  await fbq(page, '.modal select[data-nbact="b0"]').selectOption('run:script.close_garage');
  check('0.11.3 a button added keeps what was typed above it', (await fbq(page, '.modal textarea[name="nbmsg"]').inputValue()) === 'The garage is still open' && await fbq(page, '.modal input[name="nbp"][value="person.test_owner"]').isChecked());
  await fbq(page, '.modal input[name="nbwait"]').fill('20');
  await fbq(page, '.modal [data-act="nb-save"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 15000);
  const cfg = fake.scripts[OID];
  check('0.11.3 Save writes an ordinary script: to the phone, time-sensitive, a button of the run\'s own, waiting 20 minutes, then closing the garage',
    !!cfg && cfg.alias === 'Garage left open 2' && cfg.mode === 'parallel' && cfg.sequence[1].action === 'notify.mobile_app_test_phone' && cfg.sequence[1].data.data.priority === 'high'
    && cfg.sequence[1].data.data.actions[0].action === '{{ fb_id }}_1' && cfg.sequence[2].timeout.minutes === 20 && cfg.sequence[cfg.sequence.length - 1].choose[0].sequence[0].action === 'script.close_garage'
    && /notification builder/.test(cfg.description), cfg);
  await until(async () => (await hasLabel(page, KEY, garage)) || null, 10000);
  check('0.11.3 ... in the function', await hasLabel(page, KEY, garage));
  const L = await until(async () => { const x = (await store(page)).layouts[garage]; return x && x.builders ? x : null; }, 8000) || {};
  check('0.11.3 ... and what was picked is kept in its layout', !!(L.builders && L.builders[KEY] && L.builders[KEY].spec.buttons[0].title === 'Close it' && L.builders[KEY].spec.people[0].id === 'person.test_owner'), L.builders);
  await until(() => el(page, (b, k) => (b._model && b._model.nodes.has(k)) || null, KEY), 10000);
  // Edit on its box: the builder again, with what was picked
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), KEY);
  const reopened = await fbq(page, '.modal .nbdlg').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('0.11.3 Edit on its box opens the builder with what was picked', reopened && (await fbq(page, '.modal input[name="nbname"]').inputValue()) === 'Garage left open 2' && (await fbq(page, '.modal input[name="nbbt"]').inputValue()) === 'Close it'
    && (await fbq(page, '.modal select[data-nbact="b0"]').inputValue()) === 'run:script.close_garage' && (await fbq(page, '.modal select[name="nblevel"]').inputValue()) === 'time');
  // tried in the sandbox, not saved: it runs there (its templates are the real Home Assistant's to render: the fake
  // has none, so the sandbox asks; tests/e2e/builder.test.js presses its button)
  await fbq(page, '.modal [data-act="nb-try"]').click();
  const ran = await until(() => el(page, (b, k) => (b._sbxOn() && b._sbx.opts.items.some((x) => x.id === k) && b._sbx.eng.log.some((e) => e.kind === 'trigger' && e.key === k)) || null, KEY), 15000);
  check('0.11.3 Try in sandbox runs it there, as it is in the builder', !!ran && await el(page, (b, k) => JSON.stringify(b._sbx.opts.items.find((x) => x.id === k).cfg.sequence[1].data.data.actions) === JSON.stringify([{ action: '{{ fb_id }}_1', title: 'Close it' }]), KEY));
  const tst = await el(page, (b) => b._$.toast.textContent);
  check('0.11.3 ... and says how to get back to the builder', /Back to the builder/.test(tst), tst);
  check('0.11.3 ... and nothing was sent for real', !fake.calls.some((c) => (c.kind === 'svc' && c.domain === 'notify') || (c.kind === 'ws' && c.type === 'call_service' && c.msg.domain === 'notify')));
  await el(page, (b) => b._closeDrawer());
  // a change saved, then undone
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), KEY);
  await fbq(page, '.modal .nbdlg').waitFor({ timeout: 5000 });
  await fbq(page, '.modal textarea[name="nbmsg"]').fill('Changed message');
  await fbq(page, '.modal [data-act="nb-save"]').click();
  await until(() => (fake.scripts[OID].sequence[1].data.message === 'Changed message') || null, 10000);
  check('0.11.3 a change saved writes over the same script', Object.keys(fake.scripts).filter((k) => k.startsWith('garage_left_open_2')).length === 1);
  await fbq(page, '.toast:not([hidden]) [data-act="toast-act"]').click();
  await until(() => (fake.scripts[OID].sequence[1].data.message === 'The garage is still open') || null, 10000);
  await until(() => el(page, (b) => (!b._undoBusy && b._redoStack.length > 0) || null), 10000);
  check('0.11.3 ... and Undo puts the script back as it was', fake.scripts[OID].sequence[1].data.message === 'The garage is still open');
  // edited by hand: Home Assistant's editor, with a word why
  fake.scripts[OID] = Object.assign({}, fake.scripts[OID], { sequence: fake.scripts[OID].sequence.concat([{ delay: 5 }]) });
  await el(page, (b) => b._store.changed('cfg:'));
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), KEY);
  await until(() => el(page, (b) => (b._drawer && b._drawer.mode === 'frame' && b._drawer.url) || null), 8000);
  check('0.11.3 edited by hand, it opens in Home Assistant\'s editor and says why', await el(page, (b) => b._$.modal.hidden && /\/config\/script\/edit\//.test(b._drawer.url)) && /Edited by hand/.test(await fbq(page, '.toast').innerText()));
  // Organise only: the builder opens, Save doesn't
  fake.store.mode = 'organise';
  await fake.notifyStore({ what: 'mode', mode: 'organise', client: '' });
  await until(() => el(page, (b) => !b._full() || null), 5000);
  await el(page, (b) => b._bldNew());
  check('0.11.3 in Organise only mode the builder can\'t save', await fbq(page, '.modal [data-act="nb-save"]').isDisabled());
});

test('0.11.3 versions: Save is there when no version is noted as the one made (saved before the board noted it), and the open drawer follows a change', async ({ browser, fake }) => {
  fake.store.mode = 'full';
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const LEFT = 'automation.garage_left_open', aid = fake.states.get(LEFT).attributes.id;
  const rows = () => el(page, (b) => [...b._$.drawer.querySelectorAll('.vlist .vrow')].map((r) => ({ id: r.dataset.id || null, name: r.querySelector('.vh b').textContent, on: r.classList.contains('on'), save: !!r.querySelector('[data-act="ver-over"]') })));
  await fbq(page, '.tools [data-act="versions"]').click();
  await fbq(page, '.drawer .vlist .vrow').first().waitFor({ timeout: 10000 });
  await fbq(page, '.drawer [data-act="ver-new"]').first().click();
  await fbq(page, '.modal input[name="vname"]').fill('Old');
  await fbq(page, '.modal [data-act="ver-save"]').click();
  await until(async () => (await rows()).some((r) => r.name === 'Old' && r.on) || null, 8000);
  // as for versions saved before the board noted which one is active
  delete fake.vactive[garage];
  // a change saved in Home Assistant, the drawer open: it follows, without being opened again
  await api(page, 'POST', `config/automation/config/${aid}`, Object.assign({}, fake.autos[aid], { alias: 'Garage: left open (rewired)' }));
  const R = await until(async () => { const r = await rows(); return r[0] && r[0].id === null ? r : null; }, 10000) || await rows();
  check('0.11.3 the open Versions drawer follows a change saved in Home Assistant: Unsaved changes', R[0] && R[0].id === null && /Unsaved/.test(R[0].name), R);
  check('0.11.3 ... and Save is there, over the newest version (none was noted as the one made)', R[0] && R[0].save && /Old/.test(await fbq(page, '.drawer .vrow.top .vm').textContent()), R);
});

test('0.11.3 versions: deleting one offers to delete what only it has from Home Assistant, unticked', async ({ browser, fake }) => {
  fake.store.mode = 'full';
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  const OID = 'fb_only_in_a_version', KEY = 'script.' + OID;
  const rows = () => el(page, async (b) => { await b._renderVersions(); return [...b._$.drawer.querySelectorAll('.vlist .vrow')].map((r) => ({ id: r.dataset.id || null, name: r.querySelector('.vh b').textContent })); });
  const label = async (on) => {
    await ws(page, { type: 'config/entity_registry/update', entity_id: KEY, labels: on ? [garage] : [] });
    await until(() => el(page, (b, a) => (!!(b._model && b._model.nodes.has(a[0])) === a[1]) || null, [KEY, on]), 10000);
  };
  const saveAs = async (name) => {
    await fbq(page, '.drawer [data-act="ver-new"]').first().click();
    await fbq(page, '.modal input[name="vname"]').fill(name);
    await fbq(page, '.modal [data-act="ver-save"]').click();
    await until(async () => (await rows()).some((r) => r.name === name) || null, 8000);
  };
  const delDialog = async (name) => {
    const v = (await rows()).find((r) => r.name === name);
    await el(page, (b, id) => b._verDelDlg(id), v.id);
    await fbq(page, '.modal [data-act="ver-del-go"]').waitFor({ timeout: 10000 });
    return fbq(page, '.modal .dlg').innerText();
  };
  await api(page, 'POST', `config/script/config/${OID}`, { alias: 'Only in a version', sequence: [{ delay: 1 }] });
  await until(() => el(page, (b, k) => !!b._entMap.get(k) || null, KEY), 10000);
  await label(true);
  await fbq(page, '.tools [data-act="versions"]').click();
  await fbq(page, '.drawer .vlist .vrow').first().waitFor({ timeout: 10000 });
  await saveAs('With it');
  await label(false);
  let txt = await delDialog('With it');
  const n = await fbq(page, '.modal [data-vdel]').count();
  check('0.11.3 deleting a version lists what only it has: the script taken out of the function, not what a function still has', n === 1 && /Only in a version/.test(txt) && !/Garage: left open/.test(txt), txt);
  check('0.11.3 ... unticked', !(await fbq(page, '.modal [data-vdel]').isChecked()));
  await fbq(page, '.modal [data-act="ver-del-go"]').click();
  await until(async () => !(await rows()).some((r) => r.name === 'With it') || null, 8000);
  check('0.11.3 ... unticked, nothing more is deleted: the script is still there', !!fake.scripts[OID]);
  // again, ticked this time
  await label(true);
  await saveAs('With it again');
  await label(false);
  await delDialog('With it again');
  await fbq(page, '.modal [data-vdel]').check();
  await fbq(page, '.modal [data-act="ver-del-go"]').click();
  await until(() => (!fake.scripts[OID]) || null, 10000);
  check('0.11.3 ... ticked, it\'s deleted from Home Assistant with the version', !fake.scripts[OID] && !(await rows()).some((r) => r.name === 'With it again'));
  // something a function has, or another version, isn't offered
  await saveAs('Plain');
  txt = await delDialog('Plain');
  check('0.11.3 a version whose pieces are all in a function: nothing offered', (await fbq(page, '.modal [data-vdel]').count()) === 0, txt);
  await fbq(page, '.modal [data-act="modal-cancel"]').click();
});

test('0.13.0 the sandbox\'s Press row: every trigger of the function\'s devices, with its choices; an MQTT one sent as its message', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  // the test home's Hall remote (MQTT) and scene keypad (Z-Wave), as recorded (tests/board/capture.js: devTrig)
  const remote = fake.devices.find((d) => d.name === 'Hall remote').id, keypad = fake.devices.find((d) => d.name === 'Scene keypad').id;
  const scene2 = { trigger: 'device', device_id: keypad, domain: 'zwave_js', type: 'event.value_notification.central_scene', property: 'scene', property_key: '002', endpoint: 0, command_class: 91, subtype: 'Endpoint 0 Scene 002' };
  await addPiece(page, fake, 'automation.fb_remote_on', { alias: 'Garage: remote on', mode: 'single', triggers: [{ trigger: 'device', domain: 'mqtt', device_id: remote, type: 'button_short_press', subtype: 'on' }], conditions: [], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.bed_light' } }] });
  await addPiece(page, fake, 'automation.fb_keypad_held', { alias: 'Garage: keypad 2 held', mode: 'single', triggers: [Object.assign({ value: 2 }, scene2)], conditions: [], actions: [{ action: 'input_boolean.toggle', target: { entity_id: 'input_boolean.vacation_mode' } }] });
  for (const id of ['automation.fb_remote_on', 'automation.fb_keypad_held']) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [garage] });
  await fake.idle(400);
  await until(() => el(page, (b) => (b._model && b._model.nodes.has('automation.fb_remote_on') && b._model.nodes.has('automation.fb_keypad_held')) || null), 10000);
  fake.calls.length = 0;
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbpress').waitFor({ timeout: 10000 });
  const asked = fake.calls.filter((c) => /^(device_automation|mqtt\/device)/.test(c.type)).map((c) => c.type + ':' + (c.msg.device_id || (c.msg.trigger || {}).device_id));
  check('0.13.0 the board asks for the devices\' triggers, their choices, and the MQTT one\'s discovery configs', asked.includes('device_automation/trigger/list:' + remote) && asked.includes('device_automation/trigger/list:' + keypad)
    && asked.some((x) => x === 'device_automation/trigger/capabilities:' + keypad) && asked.includes('mqtt/device/debug_info:' + remote) && !asked.includes('mqtt/device/debug_info:' + keypad), asked);
  const groups = await fbq(page, '.drawer .sbpress').evaluate((s) => [...s.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]));
  check('0.13.0 the Press row: what the automations use, then the devices\' other triggers', groups.length === 2 && groups[0][1].includes('Hall remote: button short press · on') && groups[0][1].includes('Scene keypad: central scene · Endpoint 0 Scene 002 · KeyHeldDown')
    && groups[1][1].includes('Scene keypad: central scene · Endpoint 0 Scene 003') && groups[1][1].includes('Hall remote: button long press · off'), groups);
  check('0.13.0 a trigger the automations use has no choices left to pick', await fbq(page, '.drawer .sbpressx').evaluate((x) => x.hidden));
  await fbq(page, '.drawer .sbpress').selectOption({ label: 'Scene keypad: central scene · Endpoint 0 Scene 002' }, { timeout: 5000 });
  check('0.13.0 one of the device\'s own: its choices beside it', (await fbq(page, '.drawer .sbpressx select option').allTextContents()).join() === 'KeyPressed,KeyReleased,KeyHeldDown,KeyPressed2x,KeyPressed3x');
  const settle = () => until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 10000);
  const ran = (id) => el(page, (b, k) => b._sbx.eng.log.filter((e) => e.kind === 'trigger' && e.key === k).length, id);
  await fbq(page, '.drawer .sbpressx select').selectOption({ label: 'KeyReleased' }, { timeout: 5000 });
  await fbq(page, '.drawer [data-act="sbx-press"]').click(); await settle();
  check('0.13.0 released: the automation waiting for held doesn\'t start', (await ran('automation.fb_keypad_held')) === 0);
  await fbq(page, '.drawer .sbpressx select').selectOption({ label: 'KeyHeldDown' }, { timeout: 5000 });
  await fbq(page, '.drawer [data-act="sbx-press"]').click(); await settle();
  check('0.13.0 held: it starts, and the step is kept with the choice for a check', (await ran('automation.fb_keypad_held')) === 1 && await el(page, (b) => JSON.parse(b._sbx.rec.steps[b._sbx.rec.steps.length - 1].key).value === 2));
  await fbq(page, '.drawer .sbpress').selectOption({ label: 'Hall remote: button short press · on' }, { timeout: 5000 });
  await fbq(page, '.drawer [data-act="sbx-press"]').click(); await settle();
  const m = await el(page, (b) => b._sbx.eng.log.filter((e) => e.kind === 'mqtt').map((e) => e.text + ' ' + e.payload));
  check('0.13.0 the remote\'s button: sent as its discovered message, which starts the automation on it', JSON.stringify(m) === '["fbtest/hall_remote/action on_single"]' && (await ran('automation.fb_remote_on')) === 1, m);
  check('0.13.0 the Press row: no errors, and nothing sent that changes anything', page.logs.length === 0 && !fake.calls.some((c) => c.kind === 'svc' || /^(call_service|fire_event|execute_script)$/.test(c.type)), page.logs);
});

test('0.13.0 the sandbox\'s Z-Wave row: a value the automations listen for, reported with one of its states; what shows it follows', async ({ browser, fake }) => {
  const { page } = await imported(browser);
  const garage = await openFn(page, /garage/i);
  // the test home's Z-Wave lock, as recorded (tests/board/capture.js: zwave)
  const lock = fake.devices.find((d) => d.name === 'Front door lock').id, LOCK = 'lock.entry_front_door_lock', JAM = 'binary_sensor.entry_front_door_lock_lock_jammed';
  await addPiece(page, fake, 'automation.fb_lock_secured', { alias: 'Garage: lock secured', mode: 'single', triggers: [{ trigger: 'zwave_js.value_updated', device_id: lock, command_class: 98, property: 'currentMode', to: 'Secured' }], conditions: [], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.bed_light' } }] });
  await addPiece(page, fake, 'automation.fb_lock_jammed', { alias: 'Garage: lock jammed', mode: 'single', triggers: [{ trigger: 'state', entity_id: JAM, to: 'on' }], conditions: [], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.porch_light' } }] });
  for (const id of ['automation.fb_lock_secured', 'automation.fb_lock_jammed']) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [garage] });
  await fake.idle(400);
  await until(() => el(page, (b) => (b._model && b._model.nodes.has('automation.fb_lock_secured') && b._model.nodes.has('automation.fb_lock_jammed')) || null), 10000);
  fake.calls.length = 0;
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  check('0.13.0 the board asks for the lock\'s values', fake.calls.some((c) => c.type === 'functions_board/zwave_values' && c.msg.device_id === lock));
  const row = (await fbq(page, '.drawer .sbzw').count()) > 0;
  const groups = !row ? [] : await fbq(page, '.drawer .sbzw').evaluate((s) => [...s.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]));
  check('0.13.0 the Z-Wave row: the value the automation listens for first, then the device\'s others', row && groups.length === 2 && JSON.stringify(groups[0][1]) === JSON.stringify(['Front door lock: Current lock mode · Door Lock']) && groups[1][1].includes('Front door lock: Lock state · Notification'), groups);
  if (!row) return;
  const vals = await fbq(page, '.drawer .sbzwv-sel option').allTextContents();
  check('0.13.0 ... with its states to report, the one it has now marked', vals.includes('Secured') && vals.some((x) => /Unsecured/.test(x) && /now/i.test(x)), vals);
  const settle = () => until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 10000);
  await fbq(page, '.drawer .sbzwv-sel').selectOption({ label: 'Secured' }, { timeout: 5000 });
  await fbq(page, '.drawer [data-act="sbx-zw"]').click(); await settle();
  const r = await el(page, (b, a) => ({ lock: b._sbx.eng.get(a.LOCK).state, ran: b._sbx.eng.log.filter((e) => e.kind === 'trigger' && e.key === 'automation.fb_lock_secured').length, step: b._sbx.rec.steps[b._sbx.rec.steps.length - 1] }), { LOCK });
  check('0.13.0 Secured reported: the automation on it starts, the lock is locked, and the step is kept for a check', r.ran === 1 && r.lock === 'locked' && r.step.op === 'zwave' && r.step.value === 255, r);
  await fbq(page, '.drawer .sbzw').selectOption({ label: 'Front door lock: Lock state · Notification' }, { timeout: 5000 });
  await fbq(page, '.drawer .sbzwv-sel').selectOption({ label: 'Lock jammed' }, { timeout: 5000 });
  await fbq(page, '.drawer [data-act="sbx-zw"]').click(); await settle();
  const j = await el(page, (b, a) => ({ jam: b._sbx.eng.get(a.JAM).state, ran: b._sbx.eng.log.some((e) => e.kind === 'trigger' && e.key === 'automation.fb_lock_jammed'), ev: b._sbx.eng.log.filter((e) => e.kind === 'event').map((e) => e.text) }), { JAM });
  check('0.13.0 Lock jammed reported: its binary sensor on, and the automation on that starts (a state: no Notification event, as in Z-Wave JS)', j.jam === 'on' && j.ran && !j.ev.includes('zwave_js_notification'), j);
  check('0.13.0 the Z-Wave row: no errors, and nothing sent that changes anything', page.logs.length === 0 && !fake.calls.some((c) => c.kind === 'svc' || /^(call_service|fire_event|execute_script)$/.test(c.type)), page.logs);
});

test('0.13.0 touch: a box lifts at a phone\'s long-press (half a second, or when the phone says so) and buzzes as Home Assistant does', async ({ browser }) => {
  const { ctx, page } = await imported(browser, { mobile: true });
  await openFn(page, /garage/i);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const key = GARAGE[1];
  const where = () => el(page, (b, k) => { const n = b._model.nodes.get(k), r = b._els.get(k).getBoundingClientRect(); return { x: n.x, y: n.y, cx: r.left + r.width / 2, cy: r.top + r.height / 2, vx: b._view.x }; }, key);
  const lifted = () => el(page, (b, k) => b._els.get(k).classList.contains('lifted'), key);
  // Home Assistant's frontend turns a 'haptic' event into the companion app's buzz: count them
  await page.evaluate(() => { window.__fbHaptic = []; window.addEventListener('haptic', (e) => window.__fbHaptic.push(e.detail)); });
  await el(page, (b, k) => { b._listOpen = false; b._renderList(); b._centerOn(k); }, key);
  await page.waitForTimeout(500);
  let p = await where();
  await touch('touchStart', p.cx, p.cy);
  await page.waitForTimeout(350);
  check('0.13.0 not lifted before a long-press', !(await lifted()));
  await page.waitForTimeout(300);
  check('0.13.0 lifted after half a second held, as a phone\'s own long-press', await lifted());
  check('0.13.0 ... with one buzz, as Home Assistant\'s buttons make it (its haptic event)', JSON.stringify(await page.evaluate(() => window.__fbHaptic)) === '["medium"]', await page.evaluate(() => window.__fbHaptic));
  for (let i = 1; i <= 6; i++) { await touch('touchMove', p.cx + 10 * i, p.cy); await page.waitForTimeout(16); }
  await touch('touchEnd');
  await page.waitForTimeout(400);
  let q = await where();
  const k = await el(page, (b) => b._view.k);
  check('0.13.0 ... and then the box moves with the finger, the board stays', Math.abs(q.x - p.x - 60 / k) < 3 && q.vx === p.vx, { p, q, k });
  // the phone's long-press (its contextmenu) before half a second: lifted then, and the phone's menu kept shut
  p = q;
  await page.evaluate(() => { window.__fbHaptic = []; });
  await touch('touchStart', p.cx, p.cy);
  await page.waitForTimeout(150);
  const shut = await el(page, (b, k) => { const ev = new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true }); b._els.get(k).dispatchEvent(ev); return ev.defaultPrevented; }, key);
  check('0.13.0 the phone\'s long-press lifts the box at that moment, its own menu kept shut', shut && (await lifted()) && (await page.evaluate(() => window.__fbHaptic.length)) === 1);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', p.cx, p.cy + 10 * i); await page.waitForTimeout(16); }
  await touch('touchEnd');
  await page.waitForTimeout(400);
  q = await where();
  check('0.13.0 ... and it moves', Math.abs(q.y - p.y - 60 / k) < 3 && q.vx === p.vx, { p, q });
  check('0.13.0 touch hold: no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('0.13.1 the sandbox\'s controls in sections under headers, each folded away and kept so', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await openFn(page, /garage/i);
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  await until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 15000);
  const secs = () => el(page, (b) => [...b._$.drawer.querySelectorAll('.sbctl .sbsec')].map((s) => {
    const h = s.querySelector('.sbsech button');
    return { k: h.dataset.k, head: h.textContent.trim(), open: h.getAttribute('aria-expanded'), hidden: s.querySelector('.sbsecb').hidden, rows: [...s.querySelectorAll('.sbl')].map((x) => x.textContent), off: h.disabled };
  }));
  let s = await secs();
  check('0.13.1 five sections, each under its header', s.map((x) => x.head).join('|') === 'Change something|Send an event|Run and replay|Time|Settings', s);
  const rows = Object.fromEntries(s.map((x) => [x.k, x.rows.join(',')]));
  check('0.13.1 ... each holding its own rows', rows.change === 'Set' && rows.events === 'Event' && rows.run === 'Run,What if,Replay' && rows.time === 'Clock,Jump to' && rows.setup === 'Device,Home,Debug', rows);
  check('0.13.1 ... all open at first', s.every((x) => x.open === 'true' && !x.hidden), s);
  const runs = await el(page, (b) => [...b._$.drawer.querySelector('.sbrun').options].map((o) => o.value));
  await fbq(page, '.drawer .sbrun').selectOption(runs[runs.length - 1]);
  await fbq(page, '.drawer .sbsech [data-k="run"]').click();
  s = await secs();
  const run = s.find((x) => x.k === 'run');
  check('0.13.1 its header folds a section away (said to a screen reader too)', run.open === 'false' && run.hidden && s.filter((x) => x.k !== 'run').every((x) => !x.hidden), s);
  check('0.13.1 ... kept with your own display settings', JSON.stringify(await el(page, (b) => b._data.ui.sbxShut)) === '["run"]');
  await fbq(page, '.drawer .sbsech [data-k="run"]').click();
  check('0.13.1 ... opened again, the pick in it as it was', (await el(page, (b) => [b._$.drawer.querySelector('#sbsecb-run').hidden, b._$.drawer.querySelector('.sbrun').value, b._data.ui.sbxShut])).join() === [false, runs[runs.length - 1], undefined].join());
  await fbq(page, '.drawer .sbsech [data-k="run"]').click();
  await el(page, (b) => { b._renderSbxCtl(); b._sbx.busy = true; b._renderSbx(); });
  s = await secs();
  check('0.13.1 ... still folded when the controls are drawn again', s.find((x) => x.k === 'run').hidden, s);
  check('0.13.1 the headers still work while a run is busy', s.every((x) => !x.off), s);
  await el(page, (b) => { b._sbx.busy = false; b._renderSbx(); });
  await fbq(page, '.drawer .sbsech [data-k="run"]').click();
  s = await secs();
  check('0.13.1 ... and opens again', !s.find((x) => x.k === 'run').hidden && (await el(page, (b) => b._data.ui.sbxShut)) === undefined, s);
  check('0.13.1 sandbox sections: no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('0.13.2 audit fixes: durations, drawer back/focus, check steps, s_missing, renamed scripts/helpers, history banner, debugger, builder', async ({ browser, fake }) => {
  const { ctx, page } = await imported(browser);
  const garage = await openFn(page, /garage/i);

  // 1 & 4 & 11 & Issue #72: durations, zwave/behave step text, history banner clearing, _sbxOn guard
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  await until(() => el(page, (b) => (b._sbx && b._sbx.eng && !b._sbx.busy) || null), 15000);
  const sbxRes = await el(page, (b) => {
    const advTxt = b._chkStepText({ op: 'advance', ms: 900000 });
    const zwTxt = b._chkStepText({ op: 'zwave', dev: 'd1', id: '2-98-0-currentMode', value: 255 });
    const behTxt = b._chkStepText({ op: 'behave', id: 'light.porch_light', how: 'slow', ms: 5000 });
    b._sbx.eng.now += 900000;
    b._renderSbx();
    const clkTitle = b._$.drawer.querySelector('.sbclock').title;
    const jumpLabels = [...b._$.drawer.querySelectorAll('.sbjump-sel option')].map((o) => o.textContent);
    // Issue #72 jitter guard: _sbxOn() must be false when eng is not ready yet
    const realEng = b._sbx.eng;
    b._sbx.eng = null;
    const onWithoutEng = b._sbxOn();
    b._sbx.eng = realEng;
    // history banner cleared on manual step
    b._sbx.hist = { kind: 'h6', from: 0, to: 1, n: 0, cut: false, inputs: 0, cmp: [] };
    return { advTxt, zwTxt, behTxt, clkTitle, jumpLabels, onWithoutEng };
  });
  check('0.13.2 durations render as M:SS (not wall-clock AM/PM) in check steps, clock tooltip, and Jump to',
    /15:00/.test(sbxRes.advTxt) && !/\b(?:AM|PM)\b/i.test(sbxRes.advTxt)
    && /15:00/.test(sbxRes.clkTitle) && !/\b(?:AM|PM)\b/i.test(sbxRes.clkTitle)
    && sbxRes.jumpLabels.some((l) => /\bin (?:\d+d )?\d+:\d\d(?::\d\d)?\b/.test(l)) && !sbxRes.jumpLabels.some((l) => /\b(?:AM|PM)\b/i.test(l)), sbxRes);
  check('0.13.2 _chkStepText handles zwave and behave steps instead of falling through',
    /Z-Wave/.test(sbxRes.zwTxt) && !/due/.test(sbxRes.zwTxt)
    && /slow/.test(sbxRes.behTxt) && !/due/.test(sbxRes.behTxt), sbxRes);
  check('0.13.2 _sbxOn is false until sandbox engine is initialized', sbxRes.onWithoutEng === false);
  await el(page, (b) => b._sbxDo(async () => {}));
  check('0.13.2 manual sandbox step clears stale history replay banner', await el(page, (b) => b._sbx.hist === null));
  await el(page, (b) => { b._sbx.hist = { kind: 'h6', from: 0, to: 1, n: 0, cut: false, inputs: 0, cmp: [] }; return b._sbxRewind(0); });
  check('0.13.2 sandbox rewind clears stale history replay banner', await el(page, (b) => b._sbx.hist === null));
  await fbq(page, '.drawer [data-act="close"]').click();

  // 3: _drawerBack vs _drawerFocusBack collision (Trace Back button & focus restoration)
  const dbgBtn = fbq(page, '.tools [data-act="debug"]');
  await dbgBtn.focus();
  await dbgBtn.click();
  await fbq(page, '.drawer .dbg').waitFor({ timeout: 10000 });
  await el(page, (b) => {
    b._litRun = { e: { key: 'automation.garage_auto_close', run: { domain: 'automation', item_id: 'garage_auto_close', run_id: 'r1' } }, tr: null };
    b._openLitTrace();
  });
  check('0.13.2 Trace opened from Debug sets _drawerBack to debug while keeping _drawerFocusBack as DOM element',
    await el(page, (b) => b._drawerBack === 'debug' && b._drawerFocusBack instanceof Element));
  await fbq(page, '.drawer [data-act="back"]').click();
  check('0.13.2 Trace Back button returns to Debug drawer', await el(page, (b) => b._drawer && b._drawer.mode === 'debug'));
  await fbq(page, '.drawer [data-act="close"]').click();
  check('0.13.2 closing drawer restores focus to the button that opened it',
    await el(page, (b) => b.shadowRoot.activeElement && b.shadowRoot.activeElement.dataset && b.shadowRoot.activeElement.dataset.act === 'debug'));

  // 11: _dbgCall accepts floor_id/label_id and keeps rapid same-second live repeat calls
  await dbgBtn.click();
  await fbq(page, '.drawer .dbg').waitFor({ timeout: 10000 });
  const dbgCount = await el(page, (b) => {
    b._model.nodes.set('floor:first', { key: 'floor:first', kind: 'outside', name: 'First' });
    b._model.nodes.set('label:night', { key: 'label:night', kind: 'outside', name: 'Night' });
    const now = Date.now() / 1000;
    const targetEnt = [...b._dbg.ents][0];
    b._dbgCall({ domain: 'light', service: 'turn_on', service_data: { floor_id: 'first' }, context_id: 'c_fl', when: now }, true);
    b._dbgCall({ domain: 'light', service: 'turn_on', service_data: { label_id: 'night' }, context_id: 'c_lb', when: now }, true);
    b._dbgCall({ domain: 'cover', service: 'toggle', service_data: { entity_id: targetEnt }, context_id: 'c_rep', when: now }, true);
    b._dbgCall({ domain: 'cover', service: 'toggle', service_data: { entity_id: targetEnt }, context_id: 'c_rep', when: now }, true);
    return {
      fl: b._dbg.entries.some((e) => e.ctx === 'c_fl'),
      lb: b._dbg.entries.some((e) => e.ctx === 'c_lb'),
      rep: b._dbg.entries.filter((e) => e.ctx === 'c_rep').length,
    };
  });
  check('0.13.2 debugger captures floor_id/label_id calls and both rapid same-second live repeat calls',
    dbgCount.fl && dbgCount.lb && dbgCount.rep === 2, dbgCount);
  await fbq(page, '.drawer [data-act="close"]').click();

  // 6: missing targetless service (s_missing) shows Show button in Problems drawer and marks box + arrow
  await addPiece(page, fake, 'automation.fb_missing_svc', {
    alias: 'Garage: broken notify', mode: 'single',
    triggers: [{ trigger: 'state', entity_id: 'cover.garage_door', to: 'open' }],
    conditions: [],
    actions: [{ action: 'notify.mobile_app_gone_phone', data: { message: 'hi' } }],
  });
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'automation.fb_missing_svc', labels: [garage] });
  await fake.idle(400);
  await until(() => el(page, (b) => (b._model && b._model.nodes.has('svc:notify.mobile_app_gone_phone')) || null), 10000);
  const svcMarked = await el(page, (b) => {
    const n = b._model.nodes.get('svc:notify.mobile_app_gone_phone');
    const e = b._model.edges.find((x) => x.to === 'svc:notify.mobile_app_gone_phone');
    return { nodeProb: n && n.prob, edgeProb: e && e.prob };
  });
  check('0.13.2 missing targetless service marks svc box and arrow on the board', svcMarked.nodeProb === 'error' && svcMarked.edgeProb === true, svcMarked);
  await fbq(page, '.pchip').click();
  await fbq(page, '.drawer .probs .prow').first().waitFor({ timeout: 10000 });
  const hasShow = await el(page, (b) => !!b._$.drawer.querySelector('.probs [data-act="prob-go"][data-key="svc:notify.mobile_app_gone_phone"]'));
  check('0.13.2 Problems drawer has Show button targeting svc: box for s_missing', hasShow);
  await fbq(page, '.drawer [data-act="close"]').click();

  // 12: Notification Builder skips disabled script IDs in _entMap and rejects blank button titles
  const bldCheck = await el(page, (b) => {
    b._entMap.set('script.garage_alert', { entity_id: 'script.garage_alert', disabled_by: 'user' });
    const nextId = b._bldNewId('Garage Alert');
    b._entMap.delete('script.garage_alert');
    const whyBlank = b._bldWhy(
      { message: 'Open', phones: [{ svc: 'mobile_app_p', os: 'ios', name: 'P' }], people: [], speakers: [], tts: null, buttons: [] },
      'Alert',
      { buttons: [{ title: '   ', then: [] }] },
    );
    return { nextId, whyBlank };
  });
  check('0.13.2 builder skips disabled script IDs and validates blank button titles',
    bldCheck.nextId === 'garage_alert_2' && /label|blank/i.test(bldCheck.whyBlank || ''), bldCheck);

  // 7: _verSnapshot uses reg.unique_id for renamed scripts
  const renamedSnap = await el(page, async (b) => {
    const k = 'script.renamed_alias';
    b._ents.push({ entity_id: k, unique_id: 'orig_script_uid', platform: 'script', labels: [b._data.ui.current] });
    b._entMap.set(k, b._ents[b._ents.length - 1]);
    const origWs = b._ws.bind(b), origApi = b._api.bind(b);
    let apiPath = null;
    b._ws = async (msg, o) => (msg.type === 'script/config' && msg.entity_id === k ? { config: { alias: 'Renamed', sequence: [] } } : origWs(msg, o));
    b._api = async (m, p, body, o) => { if (p.startsWith('config/script/config/')) { apiPath = p; return { alias: 'Renamed', sequence: [] }; } return origApi(m, p, body, o); };
    try {
      const snap = await b._verSnapshot(b._data.ui.current);
      return { id: snap.items[k] && snap.items[k].id, yaml: snap.items[k] && snap.items[k].yaml, apiPath };
    } finally {
      b._ws = origWs; b._api = origApi;
      b._ents.pop(); b._entMap.delete(k);
    }
  });
  check('0.13.2 _verSnapshot resolves renamed script via registry unique_id',
    renamedSnap.id === 'orig_script_uid' && renamedSnap.yaml === false && renamedSnap.apiPath === 'config/script/config/orig_script_uid', renamedSnap);

  // Phase 2 (HACS review hardening): version diff, plan, and restore enforce VER_DOMAINS / VER_HELPERS allowlist
  const allowRes = await el(page, async (b) => {
    const label = b._data.ui.current;
    const rogueSnap = {
      fmt: 1,
      members: ['cloud.evil', 'config/auth.evil'],
      items: {
        'cloud.evil': { dom: 'cloud', id: '1', name: 'Evil cloud', cfg: { x: 1 } },
        'config/auth.evil': { dom: 'config/auth', id: '2', name: 'Evil auth', cfg: { y: 2 } },
      },
      devices: {},
      layout: null,
    };
    const sent = [];
    const origWs = b._ws.bind(b);
    b._ws = async (msg, o) => {
      if (msg && /^(cloud|config\/auth)\//.test(msg.type || '')) { sent.push(msg.type); return null; }
      if (msg && msg.type === 'functions_board/version_active' && msg.version_id === '0'.repeat(32)) return null;
      return origWs(msg, o);
    };
    try {
      const diff = await b._verDiff(label, rogueSnap);
      const plan = await b._verPlan(label, rogueSnap);
      // Even if a caller bypasses _verPlan and passes a rogue item directly to _verRestoreGo, it must never send WS
      b._verPending = { label, v: { id: '0'.repeat(32), name: 'Rogue', snapshot: rogueSnap }, plan: { write: ['cloud.evil'], recreate: ['config/auth.evil'], rejoin: [], shared: [], added: [] }, devmap: {}, savedAs: null };
      b._$.modal.innerHTML = '<div class="dlg"><div class="aval"></div><button data-act="ver-restore-go">Go</button></div>';
      await b._verRestoreGo();
      return { sent, planWrite: plan.write.length, planRecreate: plan.recreate.length, diffChanged: diff.changed.size };
    } finally {
      b._ws = origWs;
      b._verPending = null;
    }
  });
  check('0.13.3 version restore domain allowlist blocks non-allowlisted WS commands in diff, plan, and restore',
    allowRes.sent.length === 0 && allowRes.planWrite === 0 && allowRes.planRecreate === 0 && allowRes.diffChanged === 0, allowRes);

  // Phase 2: saved checks are persisted via functions_board/set_checks, never inside functions_board/set_layout
  const chkSep = await el(page, async (b) => {
    const label = b._data.ui.current;
    b._setChecks(label, [{ id: 'sep1', name: 'Separate check', at: Date.now(), start: {}, items: [], steps: [{ op: 'advance', ms: 1000 }], answers: [], expect: [{ k: 'ran', id: 'automation.garage_left_open' }] }]);
    b._save();
    await b._flushSave();
    await b._saveChain;
    // Move a box and save layout: layout write must NOT contain checks
    b._layout(label).nodes['cover.garage_door'] = { x: 123, y: 456 };
    b._save();
    await b._flushSave();
    await b._saveChain;
    return { sepChecks: b._sepChecks, hasInChecks: b._checksOf(label).length === 1, hasInLayout: 'checks' in b._layout(label) };
  });
  const fakeChk = fake.checks[garage] || [];
  const fakeLay = (fake.store.data.layouts || {})[garage] || {};
  check('0.13.3 saved checks are stored via functions_board/set_checks and excluded from set_layout payloads',
    chkSep.sepChecks && chkSep.hasInChecks && !chkSep.hasInLayout && fakeChk.length === 1 && fakeChk[0].id === 'sep1' && !('checks' in fakeLay),
    { chkSep, fakeChk, hasLayChecks: 'checks' in fakeLay });

  // Phase 2/3: deleting a function cleans up its decoupled checks, Undo restores them, and About dialog opens at top
  await fbq(page, '[data-act="about"]').first().click();
  await page.waitForTimeout(120);
  const aboutTop = await el(page, (b) => {
    const dlg = b._$.modal.querySelector('.dlg.about');
    const top = dlg ? dlg.scrollTop : -1;
    b._closeModal();
    return top;
  });
  check('0.13.3 opening tall About dialog keeps scroll at top (preventScroll on initial button focus)', aboutTop === 0, aboutTop);

  const delUndoChecks = await el(page, async (b) => {
    const prevMode = b._fbMode;
    b._fbMode = 'full';
    try {
      const label = b._data.ui.current;
      await b._deleteFnDialog(label, false);
      await b._deleteGo();
      await b._flushSave();
      await b._saveChain;
      const afterDel = (b._data.checks || {})[label] || [];
      await b._undo();
      await b._flushSave();
      await b._saveChain;
      const restoredLabel = b._data.ui.current;
      const afterUndo = b._checksOf(restoredLabel);
      return { afterDelLen: afterDel.length, afterUndoLen: afterUndo.length, id: afterUndo[0] && afterUndo[0].id };
    } finally {
      b._fbMode = prevMode;
    }
  });
  check('0.13.3 deleting a function removes its decoupled checks and Undo restores them',
    delUndoChecks.afterDelLen === 0 && delUndoChecks.afterUndoLen === 1 && delUndoChecks.id === 'sep1', delUndoChecks);

  // 0.14.0: per-item restore choices for items added since the saved version (turn off / leave on & unlabel / delete)
  const garageNow = await el(page, (b) => b._data.ui.current);
  const baseSnap = await el(page, (b, l) => b._verSnapshot(l), garageNow);
  const baseVer = await ws(page, { type: 'functions_board/version_save', label: garageNow, name: 'Before per-item additions', desc: '', snapshot: baseSnap });
  const A_OFF = 'automation.fb_peritem_off', A_LEAVE = 'automation.fb_peritem_leave', A_DEL = 'automation.fb_peritem_del', S_LEAVE = 'script.fb_peritem_leave';
  await addPiece(page, fake, A_OFF, { alias: 'Added: turn off', triggers: [{ trigger: 'time', at: '01:00:00' }], conditions: [], actions: [] }, [garageNow]);
  await addPiece(page, fake, A_LEAVE, { alias: 'Added: leave on', triggers: [{ trigger: 'time', at: '02:00:00' }], conditions: [], actions: [] }, [garageNow]);
  await addPiece(page, fake, A_DEL, { alias: 'Added: delete me', triggers: [{ trigger: 'time', at: '03:00:00' }], conditions: [], actions: [] }, [garageNow]);
  await addPiece(page, fake, S_LEAVE, { alias: 'Added script: leave', sequence: [] }, [garageNow]);
  await el(page, (b) => { b._fbMode = 'full'; b._store.changed('reg'); b._store.changed('cfg:'); });
  await fake.idle(400);
  await el(page, (b, id) => b._verRestore(id), baseVer.id);
  await fbq(page, '.modal .vrdlg').waitFor({ timeout: 15000 });
  const optCheck = await el(page, (b, [aOff, aLeave, aDel, sLeave]) => {
    const vals = (k) => { const s = b._$.modal.querySelector(`select.vextra[data-k="${k}"]`); return s ? [...s.options].map((o) => o.value) : null; };
    return { aOff: vals(aOff), aLeave: vals(aLeave), aDel: vals(aDel), sLeave: vals(sLeave) };
  }, [A_OFF, A_LEAVE, A_DEL, S_LEAVE]);
  check('0.14.0 version restore offers per-item selectors with off/leave/delete for automations and leave/delete for scripts',
    JSON.stringify(optCheck.aOff) === '["off","leave","delete"]'
    && JSON.stringify(optCheck.aLeave) === '["off","leave","delete"]'
    && JSON.stringify(optCheck.aDel) === '["off","leave","delete"]'
    && JSON.stringify(optCheck.sLeave) === '["leave","delete"]', optCheck);
  await fbq(page, `.modal select.vextra[data-k="${A_OFF}"]`).selectOption('off');
  await fbq(page, `.modal select.vextra[data-k="${A_LEAVE}"]`).selectOption('leave');
  await fbq(page, `.modal select.vextra[data-k="${A_DEL}"]`).selectOption('delete');
  await fbq(page, `.modal select.vextra[data-k="${S_LEAVE}"]`).selectOption('leave');
  await fbq(page, '.modal input[name="vbackup"]').uncheck();
  await fbq(page, '.modal [data-act="ver-restore-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 20000);
  await fake.idle(500);
  const stOf = (id) => page.evaluate((k) => { const s = document.querySelector('home-assistant').hass.states[k]; return s ? s.state : null; }, id);
  const perRes = {
    offState: await stOf(A_OFF),
    leaveState: await stOf(A_LEAVE),
    leaveLabeled: await hasLabel(page, A_LEAVE, garageNow),
    delState: await stOf(A_DEL),
    scriptState: await stOf(S_LEAVE),
    scriptLabeled: await hasLabel(page, S_LEAVE, garageNow),
  };
  check('0.14.0 version restore applies per-item choices: off turns off, leave removes from function while leaving on, delete deletes',
    perRes.offState === 'off'
    && perRes.leaveState === 'on' && !perRes.leaveLabeled
    && perRes.delState === null
    && perRes.scriptState !== null && !perRes.scriptLabeled, perRes);

  check('0.13.2 audit fixes: no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('0.15.0 Template Studio, 12-Recipes Gallery, Template helper config flow, and Automation recipes', async ({ browser, fake }) => {
  const { ctx, page } = await imported(browser);
  const garage = await openFn(page, /garage/i);

  // 1. Organise only mode: Recipes Gallery lists all 12 recipes, Template Studio Save is disabled
  await fbq(page, '.tools [data-act="recipes"]').click();
  await fbq(page, '.menu [data-act="rcp-gallery"]').click();
  await fbq(page, '.modal .rcpdlg').waitFor({ timeout: 8000 });
  const totalCards = await fbq(page, '.modal .rcpcard').count();
  await fbq(page, '.modal [data-act="rcp-cat"][data-cat="template"]').click();
  const tplCards = await fbq(page, '.modal .rcpcard').count();
  await fbq(page, '.modal [data-act="rcp-cat"][data-cat="automation"]').click();
  const autoCards = await fbq(page, '.modal .rcpcard').count();
  check('0.15.0 Recipes Gallery lists all 14 recipes (11 templates, 1 notification, 2 automations)',
    totalCards === 14 && tplCards === 11 && autoCards === 2, { totalCards, tplCards, autoCards });

  // Open Template Studio via toolbar -> opens Big-Picture -> Small-Picture Goal Wizard first!
  await fbq(page, '.modal [data-act="modal-cancel"]').click();
  await fbq(page, '.tools [data-act="recipes"]').click();
  await fbq(page, '.menu [data-act="ts-open"]').click();
  await fbq(page, '.modal .tsdlg .tswiz').waitFor({ timeout: 8000 });
  const goalCount = await fbq(page, '.modal .tsgoalcard').count();
  await fbq(page, '.modal .tsgoalcard[data-goal="bool"]').click();
  const narrowedCount = await fbq(page, '.modal .tsgoalcard').count();
  await fbq(page, '.modal .tsgoalcard[data-kind="tpl_compare"]').click();
  const hasStep3 = await fbq(page, '.modal select[name="ts_cmpmode"]').count();
  check('0.15.0 Template Studio guides users Big Picture -> Narrow Down -> Setup without requiring Jinja knowledge',
    goalCount === 4 && narrowedCount === 3 && hasStep3 === 1, { goalCount, narrowedCount, hasStep3 });

  // Verify interactive Jinja helper guide explains what float & expand do before inserting
  await fbq(page, '.modal [data-act="ts-mode"][data-mode="custom"]').click();
  await fbq(page, '.modal [data-act="ts-help-pick"][data-key="expand"]').click();
  const expandCard = await fbq(page, '.modal .tshicard').innerText();
  await fbq(page, '.modal [data-act="ts-help-pick"][data-key="float"]').click();
  const floatCard = await fbq(page, '.modal .tshicard').innerText();
  check('0.15.0 Interactive helper cards explain what expand and float do and why you need them before inserting',
    /full state object/i.test(expandCard) && /decimal number/i.test(floatCard) && /always stores entity states as text/i.test(floatCard),
    { expandCard: expandCard.slice(0, 120), floatCard: floatCard.slice(0, 120) });

  // Organise only mode -> Save disabled
  const disInOrg = await fbq(page, '.modal [data-act="ts-save"]').isDisabled();
  check('0.15.0 Template Studio disables Save Template helper in Organise only mode', disInOrg);

  // Test linter + 1-click auto-fix + clickable concept learning pill in Custom Jinja mode
  await fbq(page, '.modal textarea[name="tstpl"]').fill("{{ states('sensor.room_temp') | float > 22 }}");
  await fbq(page, '.modal [data-act="ts-fix"]').first().waitFor({ timeout: 5000 });
  const warnBefore = await fbq(page, '.modal .tswarn').allInnerTexts();
  await fbq(page, '.modal [data-act="ts-fix"]').first().click();
  const fixedVal = await fbq(page, '.modal textarea[name="tstpl"]').inputValue();
  const clausesN = await fbq(page, '.modal .tscl').count();
  await fbq(page, '.modal .tsconcept[data-key="float"]').first().click();
  const popTxt = await fbq(page, '.modal .tsconceptpop').innerText();
  check('0.15.0 Template Studio linter flags unavailable trap, 1-click auto-fixes, and clause concept pill explains float',
    warnBefore.some((w) => /Unavailable trap/i.test(w)) && fixedVal === "{{ states('sensor.room_temp') | float(0) > 22 }}" && clausesN >= 1 && /decimal number/i.test(popTxt),
    { warnBefore, fixedVal, clausesN, popTxt: popTxt.slice(0, 120) });
  await fbq(page, '.modal [data-act="modal-cancel"]').click();

  // 2. Switch to Full manager mode and create a real Template helper via HA's config flow
  fake.store.mode = 'full';
  await fake.notifyStore({ what: 'mode', mode: 'full', client: '' });
  await until(() => el(page, (b) => b._fbMode === 'full' || null), 5000);

  await fbq(page, '.tools [data-act="recipes"]').click();
  await fbq(page, '.menu [data-act="rcp-gallery"]').click();
  await fbq(page, '.modal .rcpcard[data-kind="tpl_any_all"]').click();
  await fbq(page, '.modal .tsdlg').waitFor({ timeout: 8000 });
  await fbq(page, '.modal input[name="tsname"]').fill('Garage anything open');
  await fbq(page, '.modal .tsep [data-act="ts-ent-toggle"][data-k="cover.garage_door"]').click();
  const genJinja = await fbq(page, '.modal textarea[name="tstpl"]').inputValue();
  const genAvail = await fbq(page, '.modal textarea[name="tsavail"]').inputValue();
  check('0.15.0 Guided Template recipe generates live Jinja and has_value() availability guard',
    genJinja.includes("expand(['cover.garage_door'])") && genAvail.includes("has_value('cover.garage_door')"), { genJinja, genAvail });

  await fbq(page, '.modal [data-act="ts-save"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 15000);
  const createdId = 'binary_sensor.garage_anything_open';
  await until(() => el(page, (b, k) => (b._model && b._model.nodes.has(k)) || null, createdId), 15000);
  const savedSpec = await el(page, (b, [l, k]) => (b._data.layouts[l].builders || {})[k], [garage, createdId]);
  check('0.15.0 Saving Template helper creates standard HA template entity, labels it into function, and records recipe spec',
    !!savedSpec && savedSpec.kind === 'tpl_any_all' && fake.entities.has(createdId), savedSpec);

  // Clicking Edit on the recipe-built Template helper reopens directly in its Recipe
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), createdId);
  await fbq(page, '.modal .tsdlg').waitFor({ timeout: 8000 });
  const reopenedMode = await el(page, (b) => b._stu && { mode: b._stu.mode, kind: b._stu.kind, entryId: b._stu.entryId });
  check('0.15.0 Unchanged recipe Template helper reopens in Guided Recipe mode with entryId for updates',
    !!reopenedMode && reopenedMode.mode === 'recipe' && reopenedMode.kind === 'tpl_any_all' && !!reopenedMode.entryId, reopenedMode);
  await fbq(page, '.modal [data-act="modal-cancel"]').click();

  // Hand-edit the template in HA -> reopening falls back to Explain & Inspect mode (not overwriting user edits)
  fake.sources[createdId].templates.state = "{{ is_state('cover.garage_door', 'open') }}";
  fake.sources[createdId].rule.state = "{{ is_state('cover.garage_door', 'open') }}";
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), createdId);
  await fbq(page, '.modal .tsdlg').waitFor({ timeout: 8000 });
  const handMode = await el(page, (b) => b._stu && { mode: b._stu.mode, tpl: b._stu.template });
  check('0.15.0 Hand-edited Template helper opens in Explain & Inspect mode instead of overwriting user Jinja',
    !!handMode && handMode.mode === 'explain' && handMode.tpl.includes("is_state('cover.garage_door'"), handMode);
  await fbq(page, '.modal [data-act="modal-cancel"]').click();

  // 3. Automation Recipe (#12 Motion-activated light): creates real HA automation and labels into function
  await fbq(page, '.tools [data-act="recipes"]').click();
  await fbq(page, '.menu [data-act="ar-new"][data-kind="auto_motion_light"]').click();
  await fbq(page, '.modal .ardlg').waitFor({ timeout: 8000 });
  await fbq(page, '.modal input[name="arname"]').fill('Garage motion light');
  await fbq(page, '.modal input[name="ar_sens"]').first().check();
  await fbq(page, '.modal input[name="ar_lights"]').first().check();
  await fbq(page, '.modal [data-act="ar-save"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 15000);
  const madeAuto = await until(() => el(page, (b, l) => Object.keys(b._data.layouts[l].builders || {}).find((k) => k.startsWith('automation.')) || null, garage), 10000);
  check('0.15.0 Automation Recipe creates standard HA automation and records builder spec', !!madeAuto, madeAuto);

  check('0.15.0 Template Studio & Recipes: no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});
