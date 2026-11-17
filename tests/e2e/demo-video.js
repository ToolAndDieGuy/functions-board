// A short demo video of the board, recorded on the demo Home Assistant: the test config with the "Away mode"
// function added (tests/e2e/demo/: automations 5001-5006, scripts secure_house and welcome_home, packages/away.yaml).
// sh tests/setup.sh demo && sh tests/start-ha.sh demo && FB_HA_CONFIG=$PWD/ha-demo/config venv314/bin/python tests/e2e/apitest.py
// node tests/e2e/demo-video.js -> frames and an ffmpeg concat list in FB_VIDEO_OUT/frames (default /tmp/fb-video)
// FB_TOUR=sandbox records the sandbox tour instead (Garage: the door opened in the sandbox, the clock moved on,
// what it sets off played on the board). Make the video from the frames with:
//   ffmpeg -f concat -i FB_VIDEO_OUT/frames/list.ffconcat -vf "fps=30,format=yuv420p" -c:v libx264 -crf 20 out.mp4
// It resets the board, imports the functions (Away mode and Garage apart) and plays a scripted tour with a
// visible cursor and captions. Everything shown is the demo setup: no real names, places or devices.
const path = require('path');
const fs = require('fs');
const { chromium, BASE, auth, session, ws, svc, ready, fbq, board, until, reset } = require('./lib');

const OUT = process.env.FB_VIDEO_OUT || '/tmp/fb-video';
const W = 1600, H = 900, SCALE = 1.2;
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b), [method, p, body]);

const GARAGE = ['automation.garage_start_open_timer', 'automation.garage_left_open', 'automation.garage_closed_stop_timer',
  'automation.garage_restart_timer_when_reopened', 'script.close_garage', 'input_boolean.garage_auto_close', 'timer.garage_open'];
const PAUL = 'device_tracker.demo_paulus', ANNE = 'device_tracker.demo_anne_therese', HOME = 'binary_sensor.anyone_home';
const GRACE = 'timer.away_grace', MODE = 'input_select.house_mode', SECURE = 'script.secure_house', FRONT = 'lock.front_door';
const ALARM = 'alarm_control_panel.security';

// the house at rest: someone home, mode Home, doors unlocked, lights on, alarm off
async function rest(page) {
  await api(page, 'POST', 'states/' + PAUL, { state: 'home', attributes: { friendly_name: 'Paulus', source_type: 'gps' } });
  await api(page, 'POST', 'states/' + ANNE, { state: 'not_home', attributes: { friendly_name: 'Anne Therese', source_type: 'gps' } });
  await svc(page, 'timer', 'cancel', {}, { entity_id: GRACE });
  await svc(page, 'input_select', 'select_option', { option: 'Home' }, { entity_id: MODE });
  await svc(page, 'lock', 'unlock', {}, { entity_id: [FRONT, 'lock.kitchen_door'] });
  await svc(page, 'light', 'turn_on', {}, { entity_id: ['light.kitchen_lights', 'light.ceiling_lights', 'light.living_room_rgbww_lights', 'light.office_rgbw_lights'] });
  await svc(page, 'light', 'turn_off', {}, { entity_id: 'light.entrance_color_white_lights' });
  await svc(page, 'alarm_control_panel', 'alarm_disarm', { code: '1234' }, { entity_id: ALARM }).catch(() => {});
  await svc(page, 'climate', 'set_temperature', { temperature: 68 }, { entity_id: 'climate.heatpump' });
  await svc(page, 'cover', 'close_cover', {}, { entity_id: 'cover.garage_door' });
  for (const n of await ws(page, { type: 'persistent_notification/get' }).catch(() => [])) await svc(page, 'persistent_notification', 'dismiss', { notification_id: n.notification_id });
}

async function setup(browser) {
  const { ctx, page } = await session(browser, 'owner', { viewport: { width: W, height: H } });
  await page.goto(BASE + '/');
  await ready(page);
  await reset(page);
  await rest(page);
  await page.goto(BASE + '/functions');
  await fbq(page, '.empty.wel [data-act="import"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  const cands = await el(page, (b) => b._mgr.cands.map((c) => ({ name: c.name, icon: c.icon, color: c.color, members: c.members })));
  // the import finds Away mode and Garage as one group (Secure the house calls Close garage); the demo keeps them apart
  const groups = [];
  for (const c of cands) {
    if (/away/i.test(c.name)) {
      groups.push({ name: 'Away mode', icon: 'mdi:home-export-outline', color: 'indigo', ids: c.members.filter((k) => !GARAGE.includes(k)) });
      groups.push({ name: 'Garage', icon: 'mdi:garage', color: 'amber', ids: c.members.filter((k) => GARAGE.includes(k)) });
    } else groups.push({ name: c.name, icon: c.icon, color: c.color, ids: c.members });
  }
  for (const g of groups) await el(page, (b, g) => b._importGroup(g.name, g.icon, g.color, g.ids, false, null), g);
  await page.waitForTimeout(1500);
  await fbq(page, '.modal [data-act="modal-cancel"]').first().click().catch(() => {});
  const entries = await ws(page, { type: 'config_entries/get', domain: 'functions_board' });
  const flow = await api(page, 'POST', 'config/config_entries/options/flow', { handler: entries[0].entry_id });
  await api(page, 'POST', 'config/config_entries/options/flow/' + flow.flow_id, { mode: 'full', card: false });
  const labels = await ws(page, { type: 'config/label_registry/list' });
  const away = labels.find((l) => l.name === 'Away mode').label_id;
  // the automatic layout runs the whole chain left to right; wrap it into two rows, as a person would drag it:
  // leaving on top, from House mode on (what Away does) below
  await el(page, (b, id) => b._open(id), away);
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await el(page, (b) => {
    const L = b._layout(b._model.label), ns = [...b._model.nodes.values()];
    L.nodes = {}; b._place();
    const cut = b._model.nodes.get('input_select.house_mode').x;
    const top = ns.filter((n) => n.x < cut), low = ns.filter((n) => n.x >= cut);
    const y1 = Math.max(...top.map((n) => n.y + n.h)), y0 = Math.min(...low.map((n) => n.y));
    const ty = Math.min(...top.map((n) => n.y));
    top.forEach((n) => { L.nodes[n.key] = { x: n.x, y: n.y - ty }; });
    low.forEach((n) => { L.nodes[n.key] = { x: n.x - cut, y: n.y - y0 + (y1 - ty) + 170 }; });
    b._place(); b._render(); b._save();
  });
  await page.waitForTimeout(1200);
  // a tidy first look: Away mode open, the list shown, the key folded away
  await el(page, (b, id) => { b._data.ui.legend = false; b._data.ui.list = true; b._data.ui.current = id; b._save(); }, away);
  await page.waitForTimeout(1500);
  await ctx.close();
  return away;
}

// the cursor and the captions are drawn into the page, so the recording shows them
const OVERLAY = () => {
  const add = () => {
    if (document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .08s';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.4 12.8 L16.5 12.8 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const r = document.createElement('div');
    r.id = 'demo-ripple';
    r.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #ffb300;opacity:0;z-index:2147483646;pointer-events:none';
    document.body.appendChild(r);
    const cap = document.createElement('div');
    cap.id = 'demo-cap';
    cap.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);max-width:880px;padding:12px 22px;border-radius:12px;background:rgba(10,12,16,.86);color:#fff;font:500 20px/1.35 Roboto,system-ui,sans-serif;text-align:center;z-index:2147483645;pointer-events:none;opacity:0;transition:opacity .35s;box-shadow:0 6px 24px rgba(0,0,0,.4)';
    document.body.appendChild(cap);
    window.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    window.addEventListener('mousedown', (e) => {
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      r.animate([{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 450, easing: 'ease-out' });
      c.style.transform = 'translate(-3px,-2px) scale(.85)';
    }, true);
    window.addEventListener('mouseup', () => { c.style.transform = 'translate(-3px,-2px)'; }, true);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
};
// centred over the board, or over the part of it the drawer leaves free
const caption = (page, text) => page.evaluate((t) => {
  const c = document.getElementById('demo-cap');
  if (!t) { c.style.opacity = '0'; return; }
  const find = (root) => { for (const e of root.querySelectorAll('*')) { if (e.tagName === 'FUNCTIONS-BOARD') return e; if (e.shadowRoot) { const f = find(e.shadowRoot); if (f) return f; } } return null; };
  const b = find(document), vp = b && b._$ && b._$.vp.getBoundingClientRect(), d = b && b._$ && b._drawer && !b._$.drawer.hidden ? b._$.drawer.getBoundingClientRect() : null;
  const left = vp ? vp.left : 0, right = d ? d.left : (vp ? vp.right : window.innerWidth);
  c.style.left = (left + right) / 2 + 'px';
  c.style.maxWidth = Math.min(880, right - left - 40) + 'px';
  c.innerHTML = t; c.style.opacity = '1';
}, text);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const away = await setup(browser);
  if (process.env.FB_DEMO_SETUP_ONLY) {
    const { ctx, page } = await session(browser, 'owner', { viewport: { width: W, height: H } });
    await ctx.addInitScript(() => { localStorage.setItem('dockedSidebar', '"auto"'); });
    await page.goto(BASE + '/functions/' + away); await ready(page); await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await el(page, (b) => { b._data.ui.list = false; b._renderList(); b._fit(); });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'overview.png') });
    await browser.close(); return;
  }

  // frames straight from Chromium at device pixels (W*SCALE x H*SCALE); Playwright's own recorder pads a scaled
  // page into the frame instead of scaling it, and compresses text hard
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: 'dark' });
  await ctx.addInitScript((a) => { try { localStorage.setItem('hassTokens', JSON.stringify(a)); } catch (e) {} }, auth('owner'));
  await ctx.addInitScript(OVERLAY);
  await ctx.addInitScript(() => { try { localStorage.setItem('dockedSidebar', '"auto"'); } catch (e) {} });
  const page = await ctx.newPage();
  const FR = path.join(OUT, 'frames');
  fs.rmSync(FR, { recursive: true, force: true });
  fs.mkdirSync(FR, { recursive: true });
  const shots = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    const file = path.join(FR, String(shots.length).padStart(6, '0') + '.jpg');
    shots.push({ file, t: f.metadata.timestamp });
    fs.writeFile(file, Buffer.from(f.data, 'base64'), () => {});
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });
  page.logs = [];
  page.on('pageerror', (e) => page.logs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  const mark = (what) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's  ' + what);

  let mx = W / 2, my = H / 2;
  const move = async (x, y, ms = 650) => {
    const steps = Math.max(8, Math.round(ms / 16));
    await page.mouse.move(x, y, { steps });
    mx = x; my = y;
  };
  const click = async (x, y, ms) => { await move(x, y, ms); await page.waitForTimeout(140); await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up(); };
  const boxOf = async (sel) => { const b = await fbq(page, sel).first().boundingBox(); if (!b) throw new Error('not on screen: ' + sel); return b; };
  const clickSel = async (sel, ms) => { const b = await boxOf(sel); await click(b.x + b.width / 2, b.y + b.height / 2, ms); };
  const nodeAt = (key) => el(page, (b, k) => { const e = b._els.get(k); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 }; }, key);
  const clickNode = async (key, ms) => { const p = await nodeAt(key); if (!p) throw new Error('no box ' + key); await click(p.x, p.y, ms); };
  // frame some boxes in the part of the board the drawer leaves free, gliding there over ms
  const frame = (keys, kmax, room = 90, ms = 900) => el(page, (b, [keys, kmax, room, ms]) => new Promise((done) => {
    const ns = (keys ? keys.map((x) => b._model.nodes.get(x)) : [...b._model.nodes.values()]).filter(Boolean);
    const x0 = Math.min(...ns.map((n) => n.x)), x1 = Math.max(...ns.map((n) => n.x + n.w));
    const y0 = Math.min(...ns.map((n) => n.y)), y1 = Math.max(...ns.map((n) => n.y + n.h));
    const vw = b._openWidth(), vh = b._$.vp.clientHeight - room;
    const k = Math.min(kmax, (vw - 60) / (x1 - x0), (vh - 70) / (y1 - y0));
    const to = { k, x: vw / 2 - ((x0 + x1) / 2) * k, y: (vh - (y1 - y0) * k) / 2 - y0 * k + 10 }, from = { ...b._view };
    const t0 = performance.now(), ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = ms ? Math.min(1, (now - t0) / ms) : 1, e = ease(t);
      b._view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      b._applyView();
      if (b._sel) b._positionNodebar();
      if (t < 1) requestAnimationFrame(step); else { b._saveView(); done(); }
    };
    requestAnimationFrame(step);
  }), [keys, kmax, room, ms]);
  const ROW1 = [PAUL, ANNE, HOME, 'input_boolean.guest_mode', 'automation.away_everyone_left_start_grace_timer', GRACE, 'event:timer.finished', 'automation.away_grace_over_set_house_to_away'];
  const OUTS = ['lock.front_door', 'lock.kitchen_door', 'script.close_garage', 'light.kitchen_lights', 'light.ceiling_lights', 'light.living_room_rgbww_lights', 'light.office_rgbw_lights', 'climate.heatpump', ALARM];
  // run a test from a box's bar: pick a choice (chip text) and/or type a state
  const test = async (key, opt) => {
    console.log('   test', key, 'k=' + (await el(page, (b) => b._view.k.toFixed(2))));
    await clickNode(key);
    await page.waitForTimeout(500);
    if (!(await fbq(page, '.nodebar [data-act="test"]').first().isVisible())) {
      await page.screenshot({ path: path.join(OUT, 'fail.png') });
      console.log('no Test after clicking', key, JSON.stringify(await el(page, (b, k) => ({ sel: b._sel, lit: !!b._lit, at: (() => { const r = b._els.get(k).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() }), key)));
    }
    await clickSel('.nodebar [data-act="test"]', 500);
    await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    if (opt.pick) { await clickSel(`.modal .tchoice [data-act="test-pick"]:has-text("${opt.pick}")`, 450); await page.waitForTimeout(400); }
    if (opt.state != null) {
      const f = fbq(page, '.modal input[name="tf0"]');
      const b = await f.boundingBox();
      await click(b.x + b.width - 30, b.y + b.height / 2, 400);
      await f.fill('');
      await f.type(opt.state, { delay: 70 });
      await page.waitForTimeout(400);
    }
    await clickSel('.modal [data-act="test-run"]', 500);
  };

  let from;
  if (process.env.FB_TOUR === 'sandbox') {
    const labels = await ws(page, { type: 'config/label_registry/list' });
    const garage = labels.find((l) => l.name === 'Garage').label_id;
    const G = ['cover.garage_door', 'timer.garage_open', 'automation.garage_start_open_timer', 'automation.garage_left_open', 'automation.garage_closed_stop_timer', 'script.close_garage', 'input_boolean.garage_auto_close'];
    await page.goto(BASE + '/functions/' + garage);
    await ready(page);
    await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
    await el(page, (b) => { b._data.ui.list = false; b._renderList(); delete b._data.ui.sbxIntro; });
    await frame(G, 1.1, 20, 0);
    await move(W * 0.55, H * 0.5, 10);
    await page.waitForTimeout(1200);
    from = Date.now() / 1000 - 1.0;
    mark('start');
    await caption(page, 'New: a <b>Sandbox</b>. Try a function out on a copy of its states.<br>Nothing it does reaches your home.');
    await page.waitForTimeout(3800);
    await clickSel('.tools [data-act="sandbox"]', 900);
    await fbq(page, '.modal .sbxdlg').waitFor({ timeout: 5000 });
    await caption(page, null);
    await page.waitForTimeout(3600);
    await clickSel('.modal [data-act="sbx-start"]', 700);
    await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
    await frame(G, 1.0, 140);
    await caption(page, 'Turn auto-close on and open the garage door: <b>in the sandbox only</b>.');
    await page.waitForTimeout(1600);
    await fbq(page, '.drawer .sbent').selectOption('input_boolean.garage_auto_close');
    await clickSel('.drawer .sbval', 600);
    await fbq(page, '.drawer .sbval').type('on', { delay: 90 });
    await clickSel('.drawer [data-act="sbx-set"]', 400);
    await until(() => el(page, (b) => !b._sbx.busy || null), 8000);
    await page.waitForTimeout(1400);
    await fbq(page, '.drawer .sbent').selectOption('cover.garage_door');
    await clickSel('.drawer .sbval', 500);
    await fbq(page, '.drawer .sbval').type('open', { delay: 90 });
    await clickSel('.drawer [data-act="sbx-set"]', 400);
    await caption(page, 'What that sets off plays on the board, step by step:<br>the open timer starts, and its box shows the time left.');
    await until(() => el(page, (b) => (b._flow && b._flow.at === b._flow.steps.length - 1) || null), 15000);
    await page.waitForTimeout(3200);
    await caption(page, 'It has its own clock. <b>Next</b> jumps to what\'s due: 15 minutes on.');
    await page.waitForTimeout(2600);
    await clickSel('.drawer .sbnext', 700);
    await caption(page, 'Timer finished → <b>Left open</b> runs → its checks pass ✓ → a notification<br>(dashed: not on this board) → Close garage → the door closes.');
    await page.waitForTimeout(900);
    await until(() => el(page, (b) => (b._flow && b._flow.at === b._flow.steps.length - 1) || null), 30000);
    await page.waitForTimeout(2200);
    await caption(page, 'Step back and forth in the bar, or click a row in the log.');
    for (let i = 0; i < 4; i++) { await clickSel('.litbar [data-act="flow-prev"]', i ? 250 : 800); await page.waitForTimeout(900); }
    const trig = await el(page, (b) => b._flow.steps.findIndex((x) => x.e.kind === 'trigger' && x.e.key === 'automation.garage_left_open'));
    await clickSel(`.litbar .fstep[data-i="${trig}"]`, 700);
    await page.waitForTimeout(2600);
    mark('sandbox');
    await caption(page, '<b>Functions Board</b> &nbsp;·&nbsp; free and open source, installs through the Marketplace<br>github.com/ToolAndDieGuy/functions-board');
    await page.waitForTimeout(4500);
    mark('end');
  } else {
  await page.goto(BASE + '/functions/' + away);
  await ready(page);
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await until(() => el(page, (b) => b._cond && b._cond.size > 0), 8000);
  // the debugger looks back 15 minutes: clear it now (this part is cut from the video) so it shows only the tour
  await el(page, (b) => b._openDebug());
  await until(() => el(page, (b) => b._dbg && b._dbg.rec), 8000);
  await page.waitForTimeout(1500);
  await el(page, (b) => { b._dbg.entries = []; b._dbg.byId = new Map(); b._dbg.cleared = Date.now(); b._renderDbg(); b._closeDrawer(); });
  await frame(null, 1.0, 20, 0);
  await move(W * 0.62, H * 0.45, 10);
  await page.waitForTimeout(1200);
  from = Date.now() / 1000 - 1.0;
  mark('start');

  // 1: what it is
  await caption(page, 'Home Assistant files automations, scripts and helpers in separate lists.<br>Functions Board puts each <b>job in the house</b> on one whiteboard.');
  await page.waitForTimeout(3800);
  await clickSel('button.ib[data-act="togglelist"]', 800);
  await page.waitForTimeout(300);
  await frame(null, 1.0, 20);
  await caption(page, '<b>Away mode</b>: 6 automations, 2 scripts, 4 helpers and the devices they touch,<br>wired together straight from their own configs. Arrows are coloured by what they do.');
  await page.waitForTimeout(4600);

  // 2: a chain lit
  await caption(page, 'Click anything to light its whole chain, upstream and downstream.');
  await page.waitForTimeout(600);
  await clickNode(SECURE, 900);
  await page.waitForTimeout(3200);
  await caption(page, 'A box from another function shows where they connect: <b>Close garage</b> belongs to Garage.');
  await page.waitForTimeout(3200);
  await el(page, (b) => b._select(null));
  await caption(page, null);
  await page.waitForTimeout(500);
  mark('chain');

  // 3: a simulated departure, on a board big enough to watch
  await caption(page, '<b>Test</b> any box. Here: simulate the last person leaving.');
  await frame(ROW1.slice(0, 6), 1.25);
  await page.waitForTimeout(400);
  await test(PAUL, { state: 'not_home' });
  await el(page, (b) => b._select(null));
  await caption(page, 'Anyone home turns off, so the grace timer starts.');
  await until(() => el(page, (b, k) => b._hass.states[k].state === 'active', GRACE), 8000);
  await page.waitForTimeout(3000);
  mark('departure');

  // 4: skip the grace period: the whole chain runs
  await caption(page, 'No need to wait 5 minutes: <b>finish the timer now</b>.');
  await frame([GRACE, 'event:timer.finished', 'automation.away_grace_over_set_house_to_away', PAUL, HOME], 1.25, 90, 700);
  await test(GRACE, { pick: 'Finish now' });
  await el(page, (b) => b._select(null));
  await frame([MODE, 'automation.away_secure_the_house', SECURE].concat(OUTS), 1.0, 40, 1100);
  await caption(page, 'House mode goes to Away, which runs Secure the house:<br>doors locked, garage closed, lights off, heat down, alarm armed.');
  await until(() => el(page, (b, k) => b._hass.states[k].state === 'armed_away', ALARM), 12000);
  await page.waitForTimeout(3600);
  mark('chain ran');

  // 5: the debugger looks back over the last 15 minutes: why did the alarm arm?
  await caption(page, '<b>Debug</b> shows what happened and what caused it.');
  await clickSel('[data-act="debug"]', 800);
  await until(() => el(page, (b) => b._dbg && b._dbg.entries && b._dbg.entries.length), 8000);
  await frame(null, 1.0, 40);
  await page.waitForTimeout(2600);
  await caption(page, 'Why did the alarm arm? Pick its row: the chain that caused it lights up, step by step.');
  // the alarm's first change (Arming) is the one Secure the house caused; Armed away comes from the panel itself
  const row = await until(() => el(page, (b, k) => { const e = b._dbg.entries.slice().reverse().find((x) => x.kind === 'state' && x.key === k && x.state === 'arming'); return e ? e.id : null; }, ALARM), 8000);
  await page.waitForTimeout(400);
  await clickSel(`.drawer .dbrow[data-id="${row}"]`, 900);
  await page.waitForTimeout(1800);
  console.log('   lit steps', await el(page, (b) => (b._litSteps || []).length));
  // the chain stays lit with the drawer closed: replay it on the whole board
  await clickSel('.drawer [data-act="close"]', 700);
  await page.waitForTimeout(200);
  await frame(null, 1.0, 60, 800);
  await caption(page, 'Why did the alarm arm? Its row lights the chain that caused it, step by step.');
  await clickSel('.litbar [data-act="lit-replay"]', 700);
  await page.waitForTimeout(6400);
  await clickSel('.litbar [data-act="lit-clear"]', 600).catch(() => {});
  await el(page, (b) => { b._select(null); b._closeDrawer(); });
  await caption(page, null);
  await page.waitForTimeout(500);
  mark('why');

  // 6: an alert, tested without touching a real door
  await caption(page, 'A door unlocked while everyone is away? Test it without touching the door.');
  await frame([FRONT, 'lock.kitchen_door', 'automation.away_door_unlocked_while_away', 'svc:persistent_notification.create', 'light.entrance_color_white_lights', 'climate.heatpump'], 1.3);
  await test(FRONT, { state: 'unlocked' });
  await el(page, (b) => b._select(null));
  await caption(page, 'The alert fires and the entrance light comes on.');
  await page.waitForTimeout(3400);
  mark('door');

  // 7: back home
  await caption(page, 'And someone comes back: the mode resets and the alarm disarms.');
  await frame(null, 1.0, 40, 1000);
  await test(PAUL, { state: 'home' });
  await el(page, (b) => b._select(null));
  await until(() => el(page, (b, k) => b._hass.states[k].state === 'disarmed', ALARM), 12000);
  await page.waitForTimeout(3400);
  mark('home');

  // end card
  await frame(null, 1.0, 20);
  await caption(page, '<b>Functions Board</b> &nbsp;·&nbsp; free and open source, installs through the Marketplace<br>github.com/ToolAndDieGuy/functions-board');
  await page.waitForTimeout(4500);
  mark('end');
  }

  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(500);
  const until_ = Date.now() / 1000;
  await ctx.close();
  // an ffmpeg concat list: each frame held until the next one came (the screencast sends a frame only on change)
  const use = shots.filter((x, i) => x.t >= from || (shots[i + 1] && shots[i + 1].t > from));
  const lines = ['ffconcat version 1.0'];
  use.forEach((x, i) => {
    const t0 = Math.max(x.t, from), t1 = use[i + 1] ? use[i + 1].t : until_;
    lines.push('file ' + path.basename(x.file), 'duration ' + Math.max(0.001, t1 - t0).toFixed(4));
  });
  lines.push('file ' + path.basename(use[use.length - 1].file));
  fs.writeFileSync(path.join(FR, 'list.ffconcat'), lines.join('\n') + '\n');
  console.log('frames: ' + use.length + ' over ' + (until_ - from).toFixed(1) + ' s', page.logs.length ? page.logs : '');
  // put the demo house back at rest
  const s = await session(browser, 'owner', { viewport: { width: W, height: H } });
  await s.page.goto(BASE + '/'); await ready(s.page); await rest(s.page); await s.ctx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
