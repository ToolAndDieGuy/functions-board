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
  // the next entity picked and typed straight away, before the first Set has settled: what's typed stays
  await fbq(page, '.drawer .sbent').selectOption(DOOR);
  await fbq(page, '.drawer .sbval').fill('open');
  await until(() => el(page, (b) => !b._sbx.busy || null), 8000);
  await page.waitForTimeout(300);
  check('a Set settling later doesn\'t change the entity picked next or clear what\'s typed', await el(page, (b) => b._$.drawer.querySelector('.sbent').value === 'cover.garage_door' && b._$.drawer.querySelector('.sbval').value === 'open'));
  // open the door
  await fbq(page, '.drawer .sbent').selectOption(DOOR);
  await fbq(page, '.drawer .sbval').fill('open');
  await fbq(page, '.drawer [data-act="sbx-set"]').click();
  const started = await until(() => el(page, (b, k) => b._sbx.eng.get(k).state === 'active' || null, TIMER), 8000);
  check('opening the door starts the open timer (Garage: start open timer)', !!started);
  // (the engine is ahead of the board: wait for the board to redraw)
  await until(() => el(page, (b, k) => b._els.get(k).classList.contains('sbch') || null, DOOR), 5000);
  const box = await el(page, (b, k) => { const n = b._els.get(k), sub = n.querySelector('.sub'); return { text: sub ? sub.textContent : n.dataset.sbx, mark: n.classList.contains('sbch') }; }, DOOR);
  check('the door\'s box shows the sandbox\'s state, marked as changed from your home', /open/i.test(box.text) && box.mark, box);
  check('the timeline lists your change, the trigger and the timer starting', await el(page, (b) => { const L = b._sbx.eng.log; return L.some((e) => e.kind === 'state' && e.by === 'you') && L.some((e) => e.kind === 'trigger' && e.key === 'automation.garage_start_open_timer') && L.some((e) => e.kind === 'call' && e.svc === 'timer.start'); }));
  const next = await fbq(page, '.drawer .sbnext').textContent();
  check('what comes next: the timer, in 15 minutes', /15:00/.test(next), next);
  const wait0 = await until(() => el(page, (b, k) => { const n = b._model.nodes.get(k), w = [...b._$.flow.querySelectorAll('.fwait')].find((x) => Math.abs(parseFloat(x.style.left) - (n.x + n.w - 6)) < 1 && Math.abs(parseFloat(x.style.top) - n.y) < 1); return w ? w.textContent : null; }, TIMER), 4000);
  check('0.7.1 the box that waits shows how long, on the sandbox\'s clock', /15:00/.test(wait0 || ''), wait0);

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

  // the flow view (0.7.1): everything Next due set off, played on the board one step at a time
  const dotSeen = await until(() => el(page, (b) => (b._$.edges.querySelector('circle.fdot animateMotion') || b._$.flowx.querySelector('circle.fdot animateMotion')) ? true : null), 6000);
  check('0.7.1 a dot runs along each step\'s arrow as it plays', !!dotSeen);
  const fl = await until(() => el(page, (b) => {
    const f = b._flow;
    if (!f || f.at !== f.steps.length - 1) return null;
    const trig = b._model.edges.find((e) => e.from === 'event:timer.finished' && e.to === 'automation.garage_left_open');
    return { n: f.steps.length, kinds: f.steps.map((s) => s.e.kind), trigLit: !!trig && b._lit.edges.has(trig.id), nums: b._$.flow.querySelectorAll('.fnum').length,
      rows: b._$.drawer.querySelectorAll('.sbtl .dbrow .fsn').length, ok: b._$.edges.querySelectorAll('g.cres.sbxc.ok').length, ghosts: [...b._$.flow.querySelectorAll('.ghost')].map((g) => g.textContent),
      bar: b._$.litbar.textContent + ' ' + [...b._$.litbar.querySelectorAll('.fstep')].map((x) => x.title).join(' | '), dim: b._els.get('automation.garage_start_open_timer').classList.contains('dim') };
  }), 30000);
  check('0.7.1 Next due plays what it set off, step by step to the end', !!fl && fl.n >= 10 && fl.kinds[0] === 'state' && fl.kinds.includes('trigger') && fl.kinds.includes('cond') && fl.kinds.includes('call'), fl);
  check('0.7.1 the arrows it went along are lit, the timer\'s trigger arrow among them', fl && fl.trigLit);
  check('0.7.1 each step has its number, on the board and in the timeline', fl && fl.nums >= 6 && fl.rows === fl.n, fl && [fl.nums, fl.rows, fl.n]);
  check('0.7.1 the checks it made show as passed on their arrows', fl && fl.ok >= 2, fl && fl.ok);
  check('0.7.1 what isn\'t on the board gets a temporary box (the timer.cancelled event)', fl && fl.ghosts.some((g) => /timer\.cancelled/.test(g) && /not on this board/.test(g)), fl && fl.ghosts);
  check('0.7.1 the bar says what each step is by name, not by id', fl && /Step \d+ of \d+/.test(fl.bar) && /Garage: left open triggered/.test(fl.bar) && /Garage: left open runs Close garage/.test(fl.bar) && !/(automation|script)\.[a-z]/.test(fl.bar), fl && fl.bar);
  check('0.7.1 what it didn\'t touch stays readable, a little dimmed', fl && fl.dim && await el(page, (b) => getComputedStyle(b._els.get('automation.garage_start_open_timer')).opacity > 0.3));
  const ghostClear = await el(page, (b) => {
    const m = b._model, ns = [...b._visibleKeys()].map((k) => m.nodes.get(k));
    return [...b._flow.ghosts.values()].every((g) => ns.every((n) => g.x >= n.x + n.w || n.x >= g.x + g.w || g.y >= n.y + n.h || n.y >= g.y + g.h));
  });
  check('0.7.1 temporary boxes don\'t sit on the board\'s boxes', ghostClear);
  // stepping: back one, a row in the timeline, and the box it's at
  await fbq(page, '.litbar [data-act="flow-prev"]').click();
  const back = await el(page, (b) => { const f = b._flow, on = b._$.drawer.querySelector('.sbtl .dbrow.on'); return { at: f.at, n: f.steps.length, row: on && +on.dataset.id === f.steps[f.at].e.id }; });
  check('0.7.1 ◀ goes back a step, and the timeline follows', back.at === back.n - 2 && back.row, back);
  const trigId = await el(page, (b) => b._flow.steps.find((s) => s.e.kind === 'trigger' && s.e.key === 'automation.garage_left_open').e.id);
  await fbq(page, `.drawer .sbtl .dbrow[data-id="${trigId}"]`).click();
  const jumped = await el(page, (b) => ({ cur: b._flow.steps[b._flow.at].e.id, bar: b._$.litbar.querySelector('.fcur').textContent, now: b._lit.now }));
  check('0.7.1 clicking a row in the timeline goes to that step on the board', jumped.cur === trigId && /left open triggered/.test(jumped.bar) && jumped.now === 'automation.garage_left_open', jumped);
  await fbq(page, '.flow .ghost').first().dispatchEvent('click');
  check('0.7.1 clicking a temporary box goes to its step', await el(page, (b) => { const s = b._flow.steps[b._flow.at]; return s.links.some((l) => l.b[0] === '~') || (s.box || '')[0] === '~'; }));
  await fbq(page, '.litbar [data-act="lit-clear"]').click();
  check('0.7.1 Clear: the board is back to normal, temporary boxes gone', await el(page, (b) => !b._flow && !b._lit && !b._$.flow.querySelector('.ghost, .fnum') && !b._$.flowx.querySelector('path') && b._$.litbar.hidden));
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

  // a run shaped like a light flashing over MQTT: an event trigger, a check on something not on the board, a script
  // that publishes to the light's /set topic and waits. The automation and script stand in for the garage ones
  await el(page, (b) => {
    const e = b._sbx.eng;
    e.add('automation.garage_left_open', { triggers: [{ trigger: 'event', event_type: 'fb_probe' }], conditions: [{ condition: 'template', value_template: "{{ states('zone.home') not in ['unavailable'] }}" }], actions: [{ action: 'script.close_garage' }] });
    e.add('script.close_garage', { sequence: [{ action: 'mqtt.publish', data: { topic: 'zigbee2mqtt/Garage Lamp/set', payload: '{"effect":"blink"}' } }, { delay: { seconds: 3 } }] });
  });
  await el(page, (b) => b._sbxDo((x) => x.userRun('automation.garage_left_open', true, 0)));
  const fx = await until(() => el(page, (b) => { const f = b._flow; return f && f.at === f.steps.length - 1 ? { steps: f.steps.map((s) => [s.e.kind, s.box, s.links.map((l) => [l.a, l.b, !!l.edge])]), wait: [...b._$.flow.querySelectorAll('.fwait')].map((x) => x.textContent), arrows: b._$.flowx.querySelectorAll('path.fx').length, marks: b._$.flowx.querySelectorAll('g.cres.ok').length, bar: [...b._$.litbar.querySelectorAll('.fstep')].map((x) => x.title).join(' | ') } : null; }), 20000);
  const S = JSON.stringify(fx && fx.steps);
  check('0.7.1 MQTT flash: the event it stood in for, and the sensor it checked, show as temporary boxes with their arrows', !!fx && /"~event:fb_probe","automation.garage_left_open"/.test(S) && /"~zone.home","automation.garage_left_open"/.test(S) && fx.arrows >= 3 && fx.marks === 1, fx);
  check('0.7.1 ... the script call goes along the board\'s arrow, the message to the light\'s /set topic to a temporary box', /"automation.garage_left_open","script.close_garage",true/.test(S) && /"script.close_garage","~mqtt:zigbee2mqtt\/Garage Lamp\/set",false/.test(S), S);
  check('0.7.1 ... and the script waits 0:03, shown on its box', fx && fx.wait.includes('0:03') && /Close garage waits 0:03/.test(fx.bar), fx && [fx.wait, fx.bar]);
  // a topic under one on the board (zigbee2mqtt/Garage Lamp for .../set) goes to that box
  const under = await el(page, (b) => {
    const m = b._model, n = Object.assign({}, m.nodes.get('script.close_garage'), { key: 'mqtt:zigbee2mqtt/Garage Lamp', kind: 'item', x: -5000, y: -5000 });
    m.nodes.set(n.key, n);
    try { const f = b._flowBuild(b._sbx.acts[b._sbx.acts.length - 1]); return f.steps.some((s) => s.links.some((l) => l.b === 'mqtt:zigbee2mqtt/Garage Lamp')) && ![...f.ghosts.keys()].some((k) => k.startsWith('~mqtt:')); }
    finally { m.nodes.delete(n.key); }
  });
  check('0.7.1 ... a message to a topic under one on the board (…/set) goes to that board box', under);

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
