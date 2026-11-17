// The sandbox (Phase 10) on the test Home Assistant: the garage function run on a copy of its states, templates
// rendered by the real Home Assistant, and nothing sent to it that changes anything.  node tests/e2e/sandbox.test.js
const path = require('path');
const { chromium, BASE, STATE, session, ws, fbq, board, ready, until, suite, openFn, reset, importAll } = require('./lib');
const { check, done } = suite('sandbox');
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const DOOR = 'cover.garage_door', TIMER = 'timer.garage_open', AUTO = 'input_boolean.garage_auto_close';

(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await session(browser, 'owner', { viewport: { width: 1500, height: 900 } });
  await page.goto(BASE + '/');
  await ready(page);
  await reset(page);
  await importAll(page);
  await page.goto(BASE + '/functions');
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await openFn(page, /garage/i);
  const real0 = await page.evaluate((ids) => Object.fromEntries(ids.map((i) => [i, document.querySelector('home-assistant').hass.states[i].state])), [DOOR, TIMER, AUTO]);
  // everything that could change Home Assistant, from here on
  const changes = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/(states|services|events)\//.test(r.url())) changes.push(r.url()); });
  page.sent.length = 0;
  const changing = () => page.sent.filter((m) => /^(call_service|fire_event|execute_script)$/.test(m.type)).concat(changes);

  await fbq(page, '.tools [data-act="sandbox"]').click();
  // a dialog first, every time: what it's for and what it can't do, to click through
  await fbq(page, '.modal .sbxdlg').waitFor({ timeout: 5000 });
  const intro = await fbq(page, '.modal .sbxdlg').textContent();
  check('opening the sandbox shows what it is for, that nothing reaches your home, and its limits', /rehearsal/.test(intro) && /Nothing here reaches your home/.test(intro) && (await fbq(page, '.modal .sbxl li').count()) === 9 && /doesn't prove/.test(intro), intro.slice(0, 120));
  await fbq(page, '.modal [data-act="modal-cancel"]').click();
  check('Cancel: no sandbox', await el(page, (b) => !b._sbx && !b._$.board.classList.contains('sbx')));
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click();
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  // don't show it again: ticked, the next opening goes straight in; the i shows it any time, and unticking brings it back
  await fbq(page, '.drawer [data-act="sbx-about"]').click();
  await fbq(page, '.modal .sbxdlg').waitFor({ timeout: 5000 });
  check('the i in the drawer shows the dialog again, with Close (the sandbox is already open)', (await fbq(page, '.modal [data-act="modal-cancel"]').count()) === 0 && /Close/.test(await fbq(page, '.modal [data-act="sbx-start"]').textContent()));
  await fbq(page, '.modal input[name="sbxskip"]').check();
  await fbq(page, '.modal [data-act="sbx-start"]').click();
  check('... closing it leaves the sandbox open', await el(page, (b) => b._sbxOn()));
  await fbq(page, '.drawer [data-act="close"]').click();
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await page.waitForTimeout(600);
  check('"don\'t show this again": the sandbox opens straight away', (await fbq(page, '.modal .sbxdlg').count()) === 0 && await el(page, (b) => b._sbxOn()));
  await until(async () => (await ws(page, { type: 'frontend/get_user_data', key: 'functions_board_ui' })).value?.ui?.sbxIntro === false || null, 4000);
  check('... saved with your own display settings', (await ws(page, { type: 'frontend/get_user_data', key: 'functions_board_ui' })).value.ui.sbxIntro === false);
  await fbq(page, '.drawer [data-act="sbx-about"]').click();
  await fbq(page, '.modal input[name="sbxskip"]').uncheck();
  await fbq(page, '.modal [data-act="sbx-start"]').click();
  check('unticked from the i: it shows again next time', await el(page, (b) => b._data.ui.sbxIntro === undefined));
  check('the sandbox opens in the drawer, the board is marked', await el(page, (b) => b._$.board.classList.contains('sbx') && !b._$.sbxpill.hidden && b._drawer.mode === 'sandbox'));
  check('it runs every automation and script on the board', await el(page, (b) => [...b._sbx.eng.items.keys()].filter((k) => k.startsWith('automation.')).length >= 3 && b._sbx.eng.items.has('script.close_garage')));

  // auto-close on, in the sandbox only
  await fbq(page, '.drawer .sbent').selectOption(AUTO);
  await fbq(page, '.drawer .sbval').fill('on');
  await fbq(page, '.drawer [data-act="sbx-set"]').click();
  await until(() => el(page, (b, k) => b._sbx.eng.get(k).state === 'on', AUTO), 5000);
  // open the door
  await fbq(page, '.drawer .sbent').selectOption(DOOR);
  await fbq(page, '.drawer .sbval').fill('open');
  await fbq(page, '.drawer [data-act="sbx-set"]').click();
  const started = await until(() => el(page, (b, k) => b._sbx.eng.get(k).state === 'active' || null, TIMER), 8000);
  check('opening the door starts the open timer (Garage: start open timer)', !!started);
  const box = await el(page, (b, k) => { const n = b._els.get(k), sub = n.querySelector('.sub'); return { text: sub ? sub.textContent : n.dataset.sbx, mark: n.classList.contains('sbch') }; }, DOOR);
  check('the door\'s box shows the sandbox\'s state, marked as changed from your home', /open/i.test(box.text) && box.mark, box);
  check('the timeline lists your change, the trigger and the timer starting', await el(page, (b) => { const L = b._sbx.eng.log; return L.some((e) => e.kind === 'state' && e.by === 'you') && L.some((e) => e.kind === 'trigger' && e.key === 'automation.garage_start_open_timer') && L.some((e) => e.kind === 'call' && e.svc === 'timer.start'); }));
  const next = await fbq(page, '.drawer .sbnext').textContent();
  check('what comes next: the timer, in 15 minutes', /15:00/.test(next), next);

  // run to it: the timer finishes, "left open" fires, the notification is a call it can't follow, the script closes the door
  await fbq(page, '.drawer [data-act="sbx-next"]').click();
  const closed = await until(() => el(page, (b, k) => b._sbx.eng.get(k).state === 'closed' || null, DOOR), 10000);
  check('15 minutes on: left open fires and the script closes the door', !!closed);
  const L = await el(page, (b) => b._sbx.eng.log.map((e) => ({ kind: e.kind, key: e.key, svc: e.svc, ok: e.ok, unknown: e.unknown, msg: e.msg, text: e.text })));
  check('its condition (door open) passed', L.some((e) => e.kind === 'cond' && e.key === 'automation.garage_left_open' && e.ok === true), L.filter((e) => e.kind === 'cond'));
  check('the notification is listed as a message, not as a gap', L.some((e) => e.kind === 'call' && e.svc === 'persistent_notification.create' && !e.unknown));
  check('closing it cancels the timer (Garage: closed, stop timer)', L.some((e) => e.kind === 'trigger' && e.key === 'automation.garage_closed_stop_timer'));
  check('the clock moved 15 minutes', await el(page, (b) => Math.round((b._sbx.eng.now - b._sbx.eng.log[0].t) / 60000) === 15));
  check('the chain is lit on the board', await until(() => el(page, (b) => !!(b._lit && b._lit.keys.size > 1) || null), 4000));
  const rows = await fbq(page, '.drawer .sbtl .dbrow').count();
  check('the timeline shows every step', rows >= 12, rows);

  // templates: Home Assistant renders them from the sandbox's states
  const t1 = await el(page, (b) => b._sbxTpl("{{ is_state('cover.garage_door', 'closed') and is_state('input_boolean.garage_auto_close', 'on') }}", {}));
  check('a template reads the sandbox\'s states, rendered by Home Assistant', t1.ok && t1.value === true && t1.partly.length === 0, t1);
  const t2 = await el(page, (b) => b._sbxTpl("{{ (now() - states.cover.garage_door.last_changed).total_seconds() | int }}", {}));
  check('... and its clock: the door closed 0 s ago on the sandbox clock', t2.ok && t2.value === 0, t2);
  const t3 = await el(page, (b) => b._sbxTpl("{{ states | selectattr('entity_id', 'eq', 'input_boolean.garage_auto_close') | map(attribute='state') | list }}", {}));
  check('every state at once (states | ...) reads the sandbox\'s too', t3.ok && JSON.stringify(t3.value) === '["on"]' && t3.partly.length === 0, t3);
  const t3b = await el(page, (b) => b._sbxTpl("{% set e = 'cover.' ~ 'garage_door' %}{{ states[e].state }} {{ states['cover'] | selectattr('entity_id', 'eq', e) | map(attribute='state') | first }}", {}));
  check('a state looked up by a variable (states[e]) reads the sandbox\'s', t3b.ok && t3b.value === 'closed closed', t3b);
  const t3c = await el(page, (b) => b._sbxTpl("{{ closest('zone.home') }}", {}));
  check('locations are marked partly real', t3c.partly.includes('closest'), t3c);
  const t4 = await el(page, (b) => b._sbxTpl('{{ this is not a template', {}));
  check('one Home Assistant can\'t render comes back as not rendered', !t4.ok, t4);

  // what it can't know, it asks
  const asked = el(page, (b) => { const e = b._sbx.eng; const run = { item: { id: 'automation.garage_left_open' }, vars: {}, cause: null }; return e._cond({ condition: 'sun', after: 'sunset' }, run); });
  await fbq(page, '.drawer .sbq [data-v="1"]').waitFor({ timeout: 5000 });
  check('a sun condition: the question shows in the drawer', /sun/i.test(await fbq(page, '.drawer .sbq').textContent()));
  await fbq(page, '.drawer .sbq [data-v="1"]').click();
  check('... and your answer is used', (await asked).ok === true);

  // run as if a chosen trigger fired: the trigger picker follows the automation picked
  await fbq(page, '.drawer .sbrun').selectOption('automation.garage_start_open_timer');
  const trigOpts = await fbq(page, '.drawer .sbtrig option').allTextContents();
  check('Run offers the automation\'s triggers to stand in for', trigOpts.length === 2 && /as if 1\. state: Garage Door/.test(trigOpts[0]), trigOpts);
  await fbq(page, '.drawer .sbtrig').selectOption('0');
  await fbq(page, '.drawer [data-act="sbx-run"]').click();
  check('... and runs it as if that trigger fired', await until(() => el(page, (b) => b._sbx.eng.log.some((e) => e.kind === 'trigger' && /as if trigger 1/.test(e.text)) || null), 5000));

  // the box bar and tests act on the sandbox
  await el(page, (b, k) => b._select(k), DOOR);
  const bar = await fbq(page, '.nodebar').textContent();
  check('the box bar offers sandbox actions, not your real ones', /Set in the sandbox/.test(bar) && !(await fbq(page, '.nodebar [data-act="toggle"]').count()), bar);
  await el(page, (b, k) => b._doTest({ kind: 'state', target: k, state: 'off' }), AUTO);
  check('a test goes to the sandbox', await el(page, (b, k) => b._sbx.eng.get(k).state === 'off', AUTO));
  await el(page, (b) => b._pause(b._$.pause));
  check('Pause would change your real automations: it says to close the sandbox', /Close the sandbox/.test(await fbq(page, '.toast').textContent()));

  await page.screenshot({ path: path.join(STATE, 'shots', 'sandbox.png') });
  check('nothing was sent to Home Assistant that changes anything', changing().length === 0, changing());
  const real1 = await page.evaluate((ids) => Object.fromEntries(ids.map((i) => [i, document.querySelector('home-assistant').hass.states[i].state])), [DOOR, TIMER, AUTO]);
  check('your home\'s states are as they were', JSON.stringify(real0) === JSON.stringify(real1), [real0, real1]);

  // closing it: the board shows your home again
  await fbq(page, '.drawer [data-act="close"]').click();
  check('closed: the board shows your home\'s states again', await el(page, (b, k) => !b._sbx && !b._$.board.classList.contains('sbx') && !b._els.get(k).dataset.sbx && !b._els.get(k).classList.contains('sbch'), DOOR));
  check('no errors', page.logs.length === 0, page.logs);
  await ctx.close();
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
