// The README's screenshots, taken on the test Home Assistant's demo setup. Run apitest.py first (tokens).
// node tests/e2e/screens.js [name]   (name: a regular expression; only matching shots are written)
// It resets the board, imports the demo functions and writes docs/images/<name>.png (FB_SHOTS_OUT to change).
// Tests run for real on the test Home Assistant; the garage is put back at rest at the end.
// With sharp installed (NODE_PATH), the PNGs are written with a palette, about a fifth of the size.
const path = require('path');
const fs = require('fs');
const { chromium, BASE, session, ws, svc, states, ready, fbq, board, until, reset } = require('./lib');

let sharp = null;
try { if (!process.env.FB_SHOTS_RAW) sharp = require('sharp'); } catch (e) { /* PNGs stay as the browser writes them */ }
const OUT = process.env.FB_SHOTS_OUT || path.join(__dirname, '..', '..', 'docs', 'images');
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
// GitHub shows a README image at most about 880 pixels wide: pages of about 1100 by 700 stay readable there
const W = 1440, H = 820;
const DOOR = 'cover.garage_door', TIMER = 'timer.garage_open', AUTO = 'input_boolean.garage_auto_close';
const START = 'automation.garage_start_open_timer', LEFT = 'automation.garage_left_open';
const CLOSED = 'automation.garage_closed_stop_timer', CLOSE = 'script.close_garage';

const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b), [method, p, body]);
async function setMode(page, mode) {
  const entries = await ws(page, { type: 'config_entries/get', domain: 'functions_board' });
  const flow = await api(page, 'POST', 'config/config_entries/options/flow', { handler: entries[0].entry_id });
  await api(page, 'POST', 'config/config_entries/options/flow/' + flow.flow_id, { mode, card: false });
  await until(() => el(page, (b, m) => b._fbMode === m, mode), 8000);
}
// the door closed, the timer idle and auto-close off
async function rest(page) {
  await svc(page, 'cover', 'close_cover', {}, { entity_id: DOOR });
  await svc(page, 'timer', 'cancel', {}, { entity_id: TIMER });
  await svc(page, 'input_boolean', 'turn_off', {}, { entity_id: AUTO });
  await until(async () => (await states(page, [DOOR]))[DOOR] === 'closed', 15000);
}
// where something is on the page: a selector inside the board, or the board itself (null)
const rect = (page, sel) => el(page, (b, s) => {
  const r = (s ? b.shadowRoot.querySelector(s) : b).getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, sel);
const pad = (r, p) => ({ x: r.x - p, y: r.y - p, width: r.width + 2 * p, height: r.height + 2 * p });
const inView = (r, vw, vh) => { const x = Math.max(0, r.x), y = Math.max(0, r.y); return { x, y, width: Math.min(vw, r.x + r.width) - x, height: Math.min(vh, r.y + r.height) - y }; };
async function shot(page, name, clip) {
  if (only && !only.test(name)) return;
  await el(page, (b) => { b._$.toast.hidden = true; });
  await page.waitForTimeout(400);
  const vp = page.viewportSize(), file = path.join(OUT, name + '.png');
  const buf = await page.screenshot({ clip: clip ? inView(clip, vp.width, vp.height) : undefined });
  if (sharp) await sharp(buf).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toFile(file);
  else fs.writeFileSync(file, buf);
  console.log('wrote ' + name + '.png');
}
// centre the view on some boxes, as close as they fit (at most kmax); room: what the boxes may not cover
// at the bottom (a bar along the board's foot)
const frame = (page, keys, kmax, room = 0) => el(page, (b, [keys, kmax, room]) => {
  const ns = keys.map((x) => b._model.nodes.get(x)).filter(Boolean);
  const x0 = Math.min(...ns.map((n) => n.x)), x1 = Math.max(...ns.map((n) => n.x + n.w));
  const y0 = Math.min(...ns.map((n) => n.y)), y1 = Math.max(...ns.map((n) => n.y + n.h));
  const vw = b._openWidth(), vh = b._$.vp.clientHeight - room;
  const k = Math.min(kmax, (vw - 120) / (x1 - x0), (vh - 160) / (y1 - y0));
  b._view = { k, x: vw / 2 - ((x0 + x1) / 2) * k, y: vh / 2 - ((y0 + y1) / 2) * k + 30 };
  b._applyView();
  if (b._sel) b._positionNodebar();
}, [keys, kmax, room]);
const list = (page, open) => el(page, (b, o) => { b._data.ui.list = o; b._renderList(); }, open);
const key = (page, open) => el(page, (b, o) => { b._data.ui.legend = o; b._renderLegend(); }, open);
const members = (page) => el(page, (b) => [...b._model.nodes.values()].filter((n) => n.kind === 'member').map((n) => n.key));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const { ctx, page } = await session(browser, 'owner', { viewport: { width: W, height: H }, scale: 2 });
  page.allowFail = [/^trace\/get$/];
  await page.goto(BASE + '/');
  await ready(page);
  await reset(page);
  await rest(page);

  // import: the groups found on a fresh setup, with Garage open
  await page.goto(BASE + '/functions');
  await fbq(page, '.empty.wel [data-act="import"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  const gi = await el(page, (b) => b._mgr.cands.findIndex((c) => /garage/i.test(c.name)));
  await fbq(page, `.modal [data-act="mgr-expand"][data-ci="${gi}"]`).click();
  await shot(page, 'import', await rect(page, '.modal .dlg.mgr'));
  await fbq(page, '.modal [data-act="mgr-selall"]').click();
  await fbq(page, '.modal [data-act="mgr-import-sel"]').click();
  await until(async () => (await el(page, (b) => !(b._mgr && b._mgr.busy) && (b._data.functions || []).length)), 15000);
  await page.waitForTimeout(800);
  await fbq(page, '.modal [data-act="modal-cancel"]').first().click().catch(() => {});
  await setMode(page, 'full');

  // the Garage function, with the live checks on its arrows
  const labels = await ws(page, { type: 'config/label_registry/list' });
  const garage = labels.find((l) => /garage/i.test(l.name)).label_id;
  await el(page, (b, id) => b._open(id), garage);
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  await key(page, false);
  await until(() => el(page, (b) => b._cond && b._cond.size > 0), 8000);
  await page.waitForTimeout(600);
  await frame(page, await members(page), 1.2);
  await page.waitForTimeout(800);
  await shot(page, 'board', await rect(page, null));

  // the Key: what boxes, arrows and marks mean
  await key(page, true);
  await page.waitForTimeout(400);
  await shot(page, 'key', pad(await rect(page, '.legend'), 12));
  await key(page, false);

  // a box clicked: its chain lit, its bar of actions and tools (the list closed, for room)
  await list(page, false);
  await el(page, (b, k) => b._select(k), LEFT);
  await frame(page, [START, CLOSED, TIMER, LEFT, CLOSE, AUTO], 1.3);
  await page.waitForTimeout(600);
  await shot(page, 'focus', await rect(page, '.main'));

  // the Arrows menu: how far a selection lights, which arrows show, the live checks
  await el(page, (b) => b._select(null));
  await fbq(page, '[data-act="hl"]').first().click();
  await page.waitForTimeout(400);
  await shot(page, 'arrows', await rect(page, '.main'));
  await page.keyboard.press('Escape');

  // the function's menu
  await list(page, true);
  await fbq(page, '.fnrow [data-act="fn-menu"]').first().click();
  await page.waitForTimeout(400);
  const menu = await rect(page, '.menu'), host = await rect(page, null);
  await shot(page, 'menu', pad({ x: host.x, y: menu.y - 70, width: menu.x + menu.width - host.x, height: menu.height + 90 }, 8));
  await page.keyboard.press('Escape');
  await list(page, false);

  // Test on the garage door: a simulated state, kept on the board as a button; the debugger records it
  await fbq(page, '[data-act="debug"]').first().click();
  await until(() => el(page, (b) => b._dbg && b._dbg.rec), 5000);
  await page.waitForTimeout(1500);
  await fbq(page, '.drawer [data-act="dbg-clear"]').click();
  await el(page, (b, k) => b._select(k), DOOR);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  await fbq(page, '.modal input[name="tf0"]').fill('open');
  await fbq(page, '.modal input[name="keep"]').check();
  await page.waitForTimeout(300);
  await shot(page, 'test', pad(await rect(page, '.modal .tdlg'), 24));

  // run it: the change, the run it set off, what that run changed; picking the timer's row lights the chain
  await fbq(page, '.modal [data-act="test-run"]').click();
  const timerRow = await until(() => el(page, (b, k) => { const e = b._dbg.entries.slice().reverse().find((x) => x.kind === 'state' && x.key === k && x.state === 'active'); return e ? e.id : null; }, TIMER), 15000);
  await page.waitForTimeout(800);
  await fbq(page, `.drawer .dbrow[data-id="${timerRow}"]`).click();
  await page.waitForTimeout(3200);
  await frame(page, [START, TIMER], 1.6, 90);
  await page.waitForTimeout(400);
  await shot(page, 'debug', await rect(page, null));

  // why didn't it run: the timer finishes with the door already closed
  await fbq(page, '.litbar [data-act="lit-clear"]').click().catch(() => {});
  await rest(page);
  await page.waitForTimeout(1500);
  await fbq(page, '.drawer [data-act="dbg-clear"]').click();
  await ws(page, { type: 'fire_event', event_type: 'timer.finished', event_data: { entity_id: TIMER } });
  await until(() => el(page, (b, k) => b._dbg.entries.some((x) => x.kind === 'run' && x.key === k && x.why), LEFT), 12000);
  await el(page, (b, k) => b._select(k), LEFT);
  await until(async () => /wasn't met/.test(await fbq(page, '.drawer .dwhy').textContent().catch(() => '')), 8000);
  await frame(page, [LEFT, CLOSE], 1.2);
  await page.waitForTimeout(600);
  await shot(page, 'why', await rect(page, null));

  // the kept test button, and a monitor box on the event the timer fires
  await el(page, (b) => { b._closeDrawer(); b._select(null); });
  const evKey = await el(page, (b) => [...b._model.nodes.keys()].find((k) => k.startsWith('event:timer.finished')));
  await el(page, (b, k) => b._select(k), evKey);
  await fbq(page, '.nodebar [data-act="monitor"]').click();
  await fbq(page, '.modal [data-act="mon-make"]').click().catch(() => {});
  await page.waitForTimeout(800);
  await ws(page, { type: 'fire_event', event_type: 'timer.finished', event_data: { entity_id: TIMER } });
  await page.waitForTimeout(1500);
  const tools = await el(page, (b) => [...b._model.nodes.values()].filter((n) => n.kind === 'tool').map((n) => n.key));
  await el(page, (b) => b._select(null));
  await frame(page, tools.concat([DOOR, evKey]), 1.5);
  await page.waitForTimeout(800);
  await shot(page, 'tools', await rect(page, '.main'));

  // the arrow editor: Garage auto-close turning on sets off Garage: left open
  await el(page, (b, k) => { b._centerOn(k); b._select(k); }, AUTO);
  await page.waitForTimeout(400);
  await el(page, (b, [a, c]) => b._linkDialog(a, c), [AUTO, LEFT]);
  await fbq(page, '.modal .adlg').waitFor({ timeout: 8000 });
  await fbq(page, '.modal [data-act="lnk-pick"]').filter({ hasText: /turned on/i }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'connect', pad(await rect(page, '.modal .adlg'), 24));
  await page.keyboard.press('Escape');

  // on a phone
  if (!only || only.test('phone')) {
    const phone = await session(browser, 'owner', { mobile: true });
    await phone.page.goto(BASE + '/functions/' + garage);
    await ready(phone.page);
    await fbq(phone.page, '.nodes .node').first().waitFor({ timeout: 15000 });
    await phone.page.waitForTimeout(1000);
    await board(phone.page).evaluate((b, k) => { b._fit(); b._centerOn(k); }, TIMER);
    await phone.page.waitForTimeout(1200);
    await shot(phone.page, 'phone');
    await phone.ctx.close();
  }

  // put the garage back at rest, the board without its tools, and the integration in its default mode
  await el(page, (b) => (b._layout(b._data.ui.current).tools || []).map((t) => t.id).forEach((id) => b._delTool(id)));
  await list(page, true);
  await rest(page);
  await setMode(page, 'organise');
  if (page.logs.length) console.log('logs', JSON.stringify(page.logs));
  await ctx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
