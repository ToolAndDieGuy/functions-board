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

test('0.5.4 touch: a box moves only after a one-second hold; a quick swipe pans', async ({ browser }) => {
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

pwTest.afterAll(() => done());
