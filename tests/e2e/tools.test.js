// Phase 9: the developer tools on the board, on the real test Home Assistant. Tests (9.2), monitors and live checks
// (9.3), the function debugger (9.4, with 4.5) and notifications (9.5). Run apitest.py first (tokens).
// node tools.test.js [filter]   (filter: run only cases whose name matches)
const { chromium, BASE, session, ws, svc, states, ready, fbq, board, until, suite, reset, importAll, openFn, sleep } = require('./lib');
const { test: pwTest } = require('./fixtures');
const test = (name, fn) => (only && !only.test(name) ? pwTest.skip(name, () => {}) : pwTest(name, fn));
const { check, done } = suite('tools');
// FB_ONLY=<pattern> runs only the parts whose names match (Playwright's --grep picks whole tests)
const only = process.env.FB_ONLY ? new RegExp(process.env.FB_ONLY, 'i') : null;

const DOOR = 'cover.garage_door', TIMER = 'timer.garage_open', AUTO = 'input_boolean.garage_auto_close';
const START = 'automation.garage_start_open_timer', LEFT = 'automation.garage_left_open', CLOSED = 'automation.garage_closed_stop_timer';

async function imported(browser, opts) {
  const s = await session(browser, 'owner', opts);
  // Home Assistant keeps the last 5 traces per automation: one listed a moment ago can be gone when the board
  // asks for it (the board then leaves that run unexplained), so a missed trace/get is no error here
  s.page.allowFail = [/^trace\/get$/];
  await s.page.goto(BASE + '/');
  await ready(s.page);
  await reset(s.page);
  await importAll(s.page);
  return s;
}
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const store = async (page) => (await ws(page, { type: 'functions_board/get' })).data;
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b).catch((e) => { throw new Error(m + ' ' + p + ': ' + JSON.stringify(e)); }), [method, p, body]);
const st = (page, id) => page.evaluate((k) => { const s = document.querySelector('home-assistant').hass.states[k]; return s ? { state: s.state, ctx: s.context && s.context.id, lt: s.attributes.last_triggered } : null; }, id);
async function setMode(page, mode) {
  const entries = await ws(page, { type: 'config_entries/get', domain: 'functions_board' });
  const flow = await api(page, 'POST', 'config/config_entries/options/flow', { handler: entries[0].entry_id });
  await api(page, 'POST', 'config/config_entries/options/flow/' + flow.flow_id, { mode, card: false });
  await until(() => el(page, (b, m) => b._fbMode === m, mode), 8000);
}
const select = (page, key) => el(page, (b, k) => b._select(k), key);
const lastRun = async (page, item) => {
  const l = await ws(page, { type: 'trace/list', domain: 'automation', item_id: item });
  return l.sort((a, b) => Date.parse(b.timestamp.start) - Date.parse(a.timestamp.start))[0] || null;
};
const isoAgo = (s) => new Date(Date.now() - s * 1000).toISOString();
// the door closed, the timer idle and auto-close off: the garage at rest
async function rest(page) {
  await svc(page, 'cover', 'close_cover', {}, { entity_id: DOOR });
  await svc(page, 'timer', 'cancel', {}, { entity_id: TIMER });
  await svc(page, 'input_boolean', 'turn_off', {}, { entity_id: AUTO });
  await until(async () => (await states(page, [DOOR]))[DOOR] === 'closed', 15000);
  await page.waitForTimeout(400);
}
// what a case made in Home Assistant (config API paths) goes again after it, also when a check failed half-way
const cleanup = [];

test('9.2 Organise only: Test is shown, switched off', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'organise');
  await openFn(page, /garage/i);
  await select(page, AUTO);
  const b = fbq(page, '.nodebar [data-act="test"]');
  check('9.2 Organise only: the Test button is there but off', (await b.count()) === 1 && await b.isDisabled());
  check('9.2 Organise only: Watch triggers still works (it only reads)', await el(page, (bb) => { bb._select('automation.garage_left_open'); return !!bb.shadowRoot.querySelector('.nodebar [data-act="watch"]:not([disabled])'); }));
  check('9.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.2 a helper changes through its own action; the first test asks; each is logged', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  await rest(page);
  await openFn(page, /garage/i);
  await select(page, AUTO);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  check('9.2 the first test of a session says what tests do', (await fbq(page, '.modal .warnbox').count()) === 1);
  check('9.2 a toggle offers its own actions', (await fbq(page, '.modal [data-act="test-pick"]').count()) === 3);
  await fbq(page, '.modal [data-act="test-pick"][data-id="on"]').click();
  check('9.2 the dialog says what will happen', /Turn on Garage auto-close/.test(await fbq(page, '.modal .twhat').textContent()));
  const t0 = isoAgo(2);
  await fbq(page, '.modal [data-act="test-run"]').click();
  check('9.2 the helper changed for real', await until(async () => (await states(page, [AUTO]))[AUTO] === 'on', 5000));
  check('9.2 the toast says it can\'t be undone', /can't be undone/.test(await fbq(page, '.toast').textContent()));
  await page.waitForTimeout(2500);
  const lb = await ws(page, { type: 'logbook/get_events', start_time: t0, entity_ids: [AUTO] });
  check('9.2 the test is in the logbook', lb.some((x) => x.name === 'Functions Board' && /^test: Turn on Garage auto-close/.test(x.message)), lb);
  await select(page, AUTO);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  check('9.2 the second test of the session doesn\'t ask again', (await fbq(page, '.modal .warnbox').count()) === 0);
  await fbq(page, '.modal [data-act="test-pick"][data-id="off"]').click();
  await fbq(page, '.modal [data-act="test-run"]').click();
  check('9.2 and runs', await until(async () => (await states(page, [AUTO]))[AUTO] === 'off', 5000));
  // a counter set to a value
  await openFn(page, /furnace/i);
  await select(page, 'counter.filter_countdown');
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal [data-act="test-pick"][data-id="set"]').click();
  await fbq(page, '.modal input[name="tf0"]').fill('42');
  await fbq(page, '.modal [data-act="test-run"]').click();
  check('9.2 a counter is set through counter.set_value', await until(async () => (await states(page, ['counter.filter_countdown']))['counter.filter_countdown'] === '42', 5000));
  await svc(page, 'counter', 'reset', {}, { entity_id: 'counter.filter_countdown' });
  check('9.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.2 a simulated state sets off the function and stays marked until the device reports', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  await rest(page);
  await openFn(page, /garage/i);
  const before = await st(page, START);
  await select(page, DOOR);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  check('9.2 a device entity gets Simulate a state, with the states its triggers wait for', /Simulate/.test(await fbq(page, '.modal .tdlg').textContent())
    && await el(page, (b) => [...b.shadowRoot.querySelectorAll('.modal datalist option')].map((o) => o.value).includes('open')));
  await fbq(page, '.modal input[name="tf0"]').fill('open');
  check('9.2 it says only Home Assistant\'s copy changes', /Home Assistant's copy/.test(await fbq(page, '.modal .twhat').textContent()));
  await fbq(page, '.modal [data-act="test-run"]').click();
  check('9.2 the state is set', await until(async () => (await st(page, DOOR)).state === 'open', 5000));
  check('9.2 and the automation it triggers ran', await until(async () => (await st(page, START)).lt !== before.lt, 5000));
  await page.waitForTimeout(1200);
  const box = await el(page, (b, k) => { const n = b._els.get(k); return { sim: n.classList.contains('sim'), tip: n.title }; }, DOOR);
  check('9.2 the box is marked simulated', box.sim && /simulated/.test(box.tip), box);
  // the device reports again (here: a real close)
  await svc(page, 'cover', 'close_cover', {}, { entity_id: DOOR });
  await until(async () => (await st(page, DOOR)).state === 'closed', 15000);
  await page.waitForTimeout(1500);
  check('9.2 the mark goes when the device reports', !(await el(page, (b, k) => b._els.get(k).classList.contains('sim'), DOOR)));
  check('9.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.2 an event is fired with the data its trigger expects; kept as a button; undo and redo', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  await rest(page);
  const lid = await openFn(page, /garage/i);
  await select(page, 'event:timer.finished');
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  await page.waitForTimeout(1500);  // Home Assistant's YAML editor loads
  const pre = await el(page, (b) => { const t = b._tst, spec = t.specs[0]; return b._buildTest(spec, b._readFields(spec)); });
  check('9.2 the event data is filled in from the trigger', pre && pre.event_type === 'timer.finished' && pre.event_data.entity_id === 'timer.garage_open', pre);
  await fbq(page, '.modal input[name="keep"]').check();
  const before = await lastRun(page, '2002');
  await fbq(page, '.modal [data-act="test-run"]').click();
  check('9.2 firing it set off Garage: left open', await until(async () => { const r = await lastRun(page, '2002'); return r && (!before || r.run_id !== before.run_id); }, 6000));
  const tool = await el(page, (b) => { const n = [...b._model.nodes.values()].find((x) => x.kind === 'tool'); return n && { key: n.key, name: n.name, edge: b._model.edges.some((e) => e.from === n.key && e.to === 'event:timer.finished') }; });
  check('9.2 the kept test is a button on the board, wired to the event', tool && tool.edge && /Fire timer.finished/.test(tool.name), tool);
  await page.waitForTimeout(1500);
  const L = (await store(page)).layouts[lid];
  check('9.2 it is stored in the layout, not in Home Assistant', L && L.tools && L.tools.length === 1 && L.tools[0].test.kind === 'event' && L.nodes[tool.key], L && L.tools);
  const r1 = await lastRun(page, '2002');
  await fbq(page, `.node[data-key="${tool.key}"] [data-act="tool-run"]`).click();
  check('9.2 one click runs it again (no second question this session)', await until(async () => { const r = await lastRun(page, '2002'); return r && r.run_id !== r1.run_id; }, 6000) && (await fbq(page, '.modal .dlg').count()) === 0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);
  check('9.2 undo takes the button away', !(await el(page, (b, k) => b._model.nodes.has(k), tool.key)));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(800);
  check('9.2 redo puts it back', await el(page, (b, k) => b._model.nodes.has(k), tool.key));
  // editing it
  await select(page, tool.key);
  await fbq(page, '.nodebar [data-act="tool-del"]').click();
  await page.waitForTimeout(1500);
  check('9.2 Remove deletes the button', !((await store(page)).layouts[lid].tools || []).length);
  check('9.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.2 run an automation with and without its conditions; a script with its fields', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  await rest(page);
  const lid = await openFn(page, /garage/i);
  const r0 = await lastRun(page, '2002');
  await select(page, LEFT);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  await fbq(page, '.modal [data-act="test-run"]').click();
  const r1 = await until(async () => { const r = await lastRun(page, '2002'); return r && (!r0 || r.run_id !== r0.run_id) && r.state === 'stopped' ? r : null; }, 6000);
  check('9.2 run with its conditions: the door is closed, so it stops', r1 && r1.script_execution === 'failed_conditions', r1);
  await select(page, LEFT);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal input[name="tf0"]').uncheck();
  check('9.2 unticked, it says it skips them', /without checking its conditions/.test(await fbq(page, '.modal .twhat').textContent()));
  await fbq(page, '.modal [data-act="test-run"]').click();
  const r2 = await until(async () => { const r = await lastRun(page, '2002'); return r && r.run_id !== r1.run_id && r.state === 'stopped' ? r : null; }, 6000);
  check('9.2 run without its conditions: it finishes', r2 && r2.script_execution === 'finished', r2);
  // a script with a field
  const sid = 'fb_greet_' + Date.now();
  cleanup.push('config/script/config/' + sid);
  await api(page, 'POST', 'config/script/config/' + sid, { alias: 'FB greet', fields: { who: { name: 'Who', required: true, selector: { text: {} } } },
    sequence: [{ action: 'persistent_notification.create', data: { notification_id: 'fb_greet', title: 'FB greet', message: 'Hello {{ who }}' } }] });
  const sk = 'script.' + sid;
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], sk), 8000);
  await ws(page, { type: 'config/entity_registry/update', entity_id: sk, labels: [lid] });
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), sk), 10000);
  await select(page, sk);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  await fbq(page, '.modal [data-act="test-run"]').click();
  check('9.2 a required field must be filled in', /Fill in Who/.test(await fbq(page, '.toast').textContent()) && (await fbq(page, '.modal .tdlg').count()) === 1);
  await page.waitForTimeout(1500);
  await el(page, (b) => {
    const s = b.shadowRoot.querySelector('.modal ha-selector');
    if (s) s.dispatchEvent(new CustomEvent('value-changed', { detail: { value: 'Alex' } }));
    else b.shadowRoot.querySelector('.modal input[name="tf0"]').value = 'Alex';
  });
  await fbq(page, '.modal [data-act="test-run"]').click();
  const note = await until(async () => (await ws(page, { type: 'persistent_notification/get' })).find((n) => n.notification_id === 'fb_greet'), 6000);
  check('9.2 the script ran with its field', note && note.message === 'Hello Alex', note);
  await svc(page, 'persistent_notification', 'dismiss_all');
  check('9.2 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.3 each check arrow shows whether it passes right now', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await rest(page);
  await openFn(page, /garage/i);
  const eid = DOOR + '>' + LEFT;
  const mark = () => el(page, (b, id) => { const g = b.shadowRoot.querySelector(`.edges g.cres[data-edge="${id}"]`); return g ? g.getAttribute('class') : null; }, eid);
  check('9.3 the door is closed: the check on it shows a cross', await until(async () => /\bbad\b/.test((await mark()) || ''), 6000), await mark());
  check('9.3 the mark says what it checks', /Condition 1: fails right now/.test(await el(page, (b, id) => b.shadowRoot.querySelector(`.edges g.cres[data-edge="${id}"] title`).textContent, eid)));
  await svc(page, 'cover', 'open_cover', {}, { entity_id: DOOR });
  check('9.3 the door opens: it turns into a tick by itself', await until(async () => /\bok\b/.test((await mark()) || ''), 15000), await mark());
  await fbq(page, '[data-act="hl"]').click();
  await fbq(page, '.menu [data-act="hl-cond"]').click();
  await page.keyboard.press('Escape');
  check('9.3 the Arrows menu switches them off', await until(async () => (await mark()) === null, 3000));
  await fbq(page, '[data-act="hl"]').click();
  await fbq(page, '.menu [data-act="hl-cond"]').click();
  await page.keyboard.press('Escape');
  check('9.3 and on again', await until(async () => !!(await mark()), 3000));
  await rest(page);
  check('9.3 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.3 hovering an arrow from a template shows its value now', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await rest(page);
  const lid = await openFn(page, /garage/i);
  const aid = 'fbtpl' + Date.now();
  cleanup.push('config/automation/config/' + aid);
  await api(page, 'POST', 'config/automation/config/' + aid, { alias: 'FB template check', triggers: [{ trigger: 'state', entity_id: DOOR }],
    conditions: [{ condition: 'template', value_template: "{{ is_state('input_boolean.garage_auto_close', 'on') }}" }], actions: [] });
  const ak = 'automation.fb_template_check';
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], ak), 8000);
  await ws(page, { type: 'config/entity_registry/update', entity_id: ak, labels: [lid] });
  const eid = AUTO + '>' + ak;
  await until(() => el(page, (b, id) => b._model && b._model.edges.some((e) => e.id === id), eid), 10000);
  await page.waitForTimeout(800);
  const hover = () => el(page, (b, id) => {
    const p = b.shadowRoot.querySelector(`.edges path.hit[data-e="${id}"]`), q = p.getPointAtLength(p.getTotalLength() / 2), m = p.getScreenCTM();
    const x = q.x * m.a + m.e, y = q.y * m.d + m.f;
    p.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: x, clientY: y }));
    return !!p;
  }, eid);
  await hover();
  const tip = () => el(page, (b) => (b._$.ttip.hidden ? '' : b._$.ttip.textContent));
  check('9.3 the tooltip shows the template and its value: off now', await until(async () => /is_state/.test(await tip()) && /\bfalse\b/i.test(await tip()), 5000), await tip());
  await svc(page, 'input_boolean', 'turn_on', {}, { entity_id: AUTO });
  check('9.3 the value follows the state while hovering', await until(async () => /\btrue\b/i.test(await tip()), 5000), await tip());
  await el(page, (b, id) => b.shadowRoot.querySelector(`.edges path.hit[data-e="${id}"]`).dispatchEvent(new PointerEvent('pointerout', { bubbles: true })), eid);
  check('9.3 leaving the arrow hides it and stops listening', await until(async () => (await tip()) === '' && !(await el(page, (b) => !!b._tt)), 2000));
  await rest(page);
  check('9.3 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.3 Watch triggers pulses the trigger arrow while the automation is off; nothing runs', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await rest(page);
  await openFn(page, /garage/i);
  await svc(page, 'automation', 'turn_off', {}, { entity_id: [START, 'automation.garage_restart_timer_when_reopened'] });
  await page.waitForTimeout(500);
  const before = await st(page, START);
  await select(page, START);
  await fbq(page, '.nodebar [data-act="watch"]').click();
  check('9.3 the box shows it is being watched', await until(() => el(page, (b, k) => b._els.get(k).classList.contains('watching'), START), 4000));
  await svc(page, 'cover', 'open_cover', {}, { entity_id: DOOR });
  check('9.3 the door opening would fire it: counted', await until(() => el(page, (b, k) => (b._tw.get(k) || {}).hits >= 1, START), 15000));
  check('9.3 its trigger arrow pulses', await el(page, (b, id) => (b._liveE.get(id) || 0) > Date.now() - 3000, DOOR + '>' + START));
  check('9.3 nothing ran: it is off and the timer never started', (await st(page, START)).lt === before.lt && (await st(page, TIMER)).state === 'idle');
  await select(page, START);
  await fbq(page, '.nodebar [data-act="watch"]').click();
  const hits = await el(page, (b) => [...b._tw.values()].reduce((n, w) => n + w.hits, 0));
  check('9.3 Stop watching stops it', hits === 0 && !(await el(page, (b, k) => b._els.get(k).classList.contains('watching'), START)));
  await svc(page, 'automation', 'turn_on', {}, { entity_id: [START, 'automation.garage_restart_timer_when_reopened'] });
  await rest(page);
  check('9.3 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.3 a monitor box lists the latest events of one type', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  const lid = await openFn(page, /garage/i);
  await fbq(page, '[data-act="debug"]').click();
  await fbq(page, '.drawer [data-act="dbg-mon"]').click();
  await fbq(page, '.modal input[name="topic"]').fill('fb_test_event');
  await fbq(page, '.modal [data-act="mon-make"]').click();
  const key = await until(() => el(page, (b) => { const n = [...b._model.nodes.values()].find((x) => x.kind === 'tool' && x.tool.topic === 'fb_test_event'); return n && n.key; }), 4000);
  check('9.3 the monitor box is on the board', !!key);
  await page.waitForTimeout(800);
  await ws(page, { type: 'fire_event', event_type: 'fb_test_event', event_data: { n: 1 } });
  await ws(page, { type: 'fire_event', event_type: 'fb_test_event', event_data: { n: 2 } });
  const rows = () => el(page, (b, k) => [...b._els.get(k).querySelectorAll('.mrow .mv')].map((x) => x.textContent), key);
  check('9.3 it lists them, newest first', await until(async () => { const r = await rows(); return r.length === 2 && /"n":2/.test(r[0]) && /"n":1/.test(r[1]); }, 5000), await rows());
  await page.waitForTimeout(1500);
  const L = (await store(page)).layouts[lid];
  check('9.3 the box is kept in the layout, its events are not', L.tools.length === 1 && L.tools[0].type === 'monitor' && !JSON.stringify(L).includes('"n":2'), L.tools);
  // one from an event box, wired to it
  await el(page, (b) => { b._centerOn('event:timer.finished'); b._select('event:timer.finished'); });
  await fbq(page, '.nodebar [data-act="monitor"]').click();
  check('9.3 Monitor on an event box adds one wired to it', await until(() => el(page, (b) => b._model.edges.some((e) => e.role === 'tool' && e.from === 'event:timer.finished')), 4000));
  // switching functions stops listening
  await openFn(page, /furnace/i);
  check('9.3 another function open: the monitors stop listening', await el(page, (b) => b._monSubs.size === 0));
  await openFn(page, /garage/i);
  await page.waitForTimeout(500);
  check('9.3 and listen again when it opens', await el(page, (b) => b._monSubs.size === 2));
  check('9.3 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.4 the debugger: a change, the run it set off, what that run changed; the chain lights step by step', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await rest(page);
  await openFn(page, /garage/i);
  await fbq(page, '[data-act="debug"]').click();
  check('9.4 the debug panel opens and records', await until(() => el(page, (b) => b._dbg && b._dbg.rec), 5000));
  await svc(page, 'cover', 'open_cover', {}, { entity_id: DOOR });
  const find = (pred) => el(page, (b, src) => { const f = new Function('e', 'return ' + src); const e = b._dbg.entries.slice().reverse().find((x) => f(x)); return e ? { id: e.id, kind: e.kind, key: e.key, by: e.by, src: e.src } : null; }, pred);
  const timerRow = await until(() => find(`e.kind === 'state' && e.key === '${TIMER}' && e.state === 'active'`), 15000);
  const runRow = await find(`e.kind === 'run' && e.key === '${START}'`);
  const doorRow = await find(`e.kind === 'state' && e.key === '${DOOR}'`);
  check('9.4 the door\'s change is listed, by you', doorRow && /you/.test(doorRow.by && doorRow.by.text), doorRow);
  check('9.4 the run it set off, with what triggered it', runRow && /cover\.garage_door/.test(runRow.src), runRow);
  check('9.4 what that run changed, with the run as its cause', timerRow && timerRow.by && timerRow.by.key === START, timerRow);
  check('9.4 the action call is listed too', !!(await find(`e.kind === 'call' && e.svc === 'timer.start'`)));
  check('9.4 the rows are in the panel', await until(async () => (await fbq(page, '.drawer .dbrow').count()) >= 3, 3000));
  await fbq(page, `.drawer .dbrow[data-id="${timerRow.id}"]`).click();
  await page.waitForTimeout(250);
  const first = await el(page, (b) => [...b._lit.keys]);
  await page.waitForTimeout(2200);
  const lit = await el(page, (b) => ({ keys: [...b._lit.keys], edges: [...b._lit.edges], steps: b._litSteps.map((s) => s.kind + ':' + s.key) }));
  check('9.4 picking it lights the chain one step at a time', first.length === 1 && first[0] === DOOR, first);
  check('9.4 the whole chain: door, the automation, the timer', [DOOR, START, TIMER].every((k) => lit.keys.includes(k)), lit);
  check('9.4 with the arrows between them', lit.edges.includes(DOOR + '>' + START) && lit.edges.includes(START + '>' + TIMER), lit);
  check('9.4 the bar lists the steps', (await fbq(page, '.litbar .lstep').count()) >= 3 && !(await fbq(page, '.litbar').isHidden()));
  await fbq(page, '.litbar [data-act="lit-clear"]').click();
  check('9.4 Clear puts the board back', await el(page, (b) => !b._lit && b._$.litbar.hidden));
  await rest(page);
  check('9.4 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.4 why didn\'t it run: the condition that stopped it, named', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await rest(page);
  await openFn(page, /garage/i);
  await fbq(page, '[data-act="debug"]').click();
  await until(() => el(page, (b) => b._dbg && b._dbg.rec), 5000);
  await ws(page, { type: 'fire_event', event_type: 'timer.finished', event_data: { entity_id: TIMER } });
  const row = await until(() => el(page, (b, k) => { const e = b._dbg.entries.slice().reverse().find((x) => x.kind === 'run' && x.key === k && x.why); return e ? e.why : null; }, LEFT), 12000);
  check('9.4 the timeline says which condition stopped it and what it saw', /condition 1 wasn't met: Garage Door is open \(it was closed, needs open\)/.test(row || ''), row);
  await select(page, LEFT);
  const why = await until(async () => { const t = await fbq(page, '.drawer .dwhy').textContent().catch(() => ''); return /wasn't met/.test(t) ? t : null; }, 6000);
  check('9.4 selecting the automation answers why did or didn\'t it run', !!why && /Conditions not met/.test(why), why);
  check('9.4 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('4.5 a run from the Runs list lights its path, with its trace a click away', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await rest(page);
  await svc(page, 'cover', 'open_cover', {}, { entity_id: DOOR });
  await until(async () => (await states(page, [DOOR]))[DOOR] === 'open', 15000);
  await ws(page, { type: 'fire_event', event_type: 'timer.finished', event_data: { entity_id: TIMER } });
  await page.waitForTimeout(1500);
  await openFn(page, /garage/i);
  await fbq(page, '[data-act="runs"]').click();
  await fbq(page, '.drawer .run').first().waitFor({ timeout: 8000 });
  const i = await el(page, (b, k) => b._runs.findIndex((r) => r.key === k && r.script_execution === 'finished'), LEFT);
  await fbq(page, `.drawer .run[data-run="${i}"]`).click();
  await until(() => el(page, (b) => !!b._lit), 5000);
  await page.waitForTimeout(1500);
  const lit = await el(page, (b) => ({ keys: [...b._lit.keys], edges: [...b._lit.edges] }));
  check('4.5 the trigger arrow it fired on lights', lit.edges.includes('event:timer.finished>' + LEFT) || lit.edges.includes(TIMER + '>' + LEFT), lit);
  check('4.5 and the arrows to what it called', lit.edges.includes(LEFT + '>svc:persistent_notification.create'), lit);
  check('4.5 the Runs list stays open', await el(page, (b) => b._drawer && b._drawer.mode === 'runs'));
  check('4.5 the bar shows when and how it ended', /Finished/.test(await fbq(page, '.litbar').textContent()));
  await fbq(page, '.litbar [data-act="lit-trace"]').click();
  check('4.5 Open trace opens Home Assistant\'s trace in the drawer', await until(() => el(page, (b) => b._drawer && b._drawer.mode === 'frame' && /\/trace\/2002\?run_id=/.test(b._drawer.url)), 3000));
  await fbq(page, '.drawer [data-act="back"]').click();
  check('4.5 Back returns to the Runs list', await until(() => el(page, (b) => b._drawer && b._drawer.mode === 'runs'), 3000));
  await rest(page);
  await svc(page, 'persistent_notification', 'dismiss_all');
  check('4.5 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('9.5 a notification: test it, and what it sent lately', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  await rest(page);
  const lid = await openFn(page, /garage/i);
  const aid = 'fbnotify' + Date.now();
  cleanup.push('config/automation/config/' + aid);
  await api(page, 'POST', 'config/automation/config/' + aid, { alias: 'FB auto-close notice', triggers: [{ trigger: 'state', entity_id: AUTO, to: 'on' }],
    actions: [{ action: 'notify.persistent_notification', data: { title: 'FB notice', message: "Auto-close is {{ states('input_boolean.garage_auto_close') }}" } }] });
  const ak = 'automation.fb_auto_close_notice', box = 'svc:notify.persistent_notification';
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], ak), 8000);
  await ws(page, { type: 'config/entity_registry/update', entity_id: ak, labels: [lid] });
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), box), 10000);
  await svc(page, 'input_boolean', 'turn_on', {}, { entity_id: AUTO });
  await page.waitForTimeout(1500);
  await select(page, box);
  await fbq(page, '.nodebar [data-act="messages"]').click();
  const msgs = await until(async () => { const t = await fbq(page, '.drawer .msgs').textContent().catch(() => ''); return /Auto-close is on/.test(t) ? t : null; }, 8000);
  check('9.5 Messages lists what it sent, from the traces', !!msgs && /FB notice/.test(msgs), msgs);
  await svc(page, 'persistent_notification', 'dismiss_all');
  await fbq(page, '.drawer [data-act="close"]').click();
  await select(page, box);
  await fbq(page, '.nodebar [data-act="test"]').click();
  await fbq(page, '.modal .tdlg').waitFor({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const pre = await el(page, (b) => { const t = b._tst, spec = t.specs[0]; return b._buildTest(spec, b._readFields(spec)); });
  check('9.5 the test starts from what the automation sends', pre && pre.service === 'notify.persistent_notification' && /Auto-close is/.test(pre.data.message), pre);
  await fbq(page, '.modal [data-act="test-run"]').click();
  const note = await until(async () => (await ws(page, { type: 'persistent_notification/get' })).find((n) => n.title === 'FB notice'), 6000);
  check('9.5 the test notification is sent, with its template filled in', note && note.message === 'Auto-close is on', note);
  await svc(page, 'persistent_notification', 'dismiss_all');
  await rest(page);
  check('9.5 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('7.5 draw an arrow and remove it: the config ends as it started, and both steps undo', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  await rest(page);
  await ws(page, { type: 'frontend/set_user_data', key: 'functions_board_ui', value: null });
  const lid = await openFn(page, /garage/i);
  const aid = 'fbarrow' + Date.now();
  cleanup.push('config/automation/config/' + aid);
  const start = { alias: 'FB arrow test', description: '', triggers: [{ trigger: 'state', entity_id: DOOR, to: 'open' }], conditions: [], actions: [], mode: 'single' };
  await api(page, 'POST', 'config/automation/config/' + aid, start);
  const ak = 'automation.fb_arrow_test';
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], ak), 8000);
  await ws(page, { type: 'config/entity_registry/update', entity_id: ak, labels: [lid] });
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k), ak), 10000);
  const cfg = () => api(page, 'GET', 'config/automation/config/' + aid);
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
  const c0 = canon(await cfg());
  // drag from the helper's handle onto the automation (the Key closed, so it covers neither)
  await el(page, (b, k) => { b._data.ui.legend = false; b._renderLegend(); b._centerOn(k); b._select(k); }, AUTO);
  await page.waitForTimeout(400);
  const hb = await fbq(page, '.lh').boundingBox();
  const tb = await fbq(page, `.node[data-key="${ak}"]`).boundingBox();
  check('7.5 a selected box has a handle to draw from', !!hb && !!tb, { hb, tb });
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
  await page.mouse.up();
  await fbq(page, '.modal .adlg').waitFor({ timeout: 8000 });
  check('7.5 the popup offers what the link can mean, from Home Assistant\'s lists', /It changes state/.test(await fbq(page, '.modal').textContent()) && (await fbq(page, '.modal [data-act="lnk-pick"]').count()) >= 2);
  check('7.5 the first time, it says comments in automations.yaml are lost', /comments in that file are lost/.test(await fbq(page, '.modal').textContent()));
  await fbq(page, '.modal input[name="lstate"]').fill('on');
  const prev = await fbq(page, '.modal pre.yprev').textContent();
  check('7.5 it shows the YAML it will add', /triggers:\n  - trigger: state\n    entity_id: input_boolean.garage_auto_close\n    to: "on"/.test(prev), prev);
  await fbq(page, '.modal [data-act="arw-save"]').click();
  const c1 = await until(async () => { const c = await cfg(); return c.triggers.length === 2 ? c : null; }, 8000);
  check('7.5 saving adds the trigger to the config', c1 && c1.triggers[1].entity_id === AUTO && c1.triggers[1].to === 'on', c1 && c1.triggers);
  const eid = AUTO + '>' + ak;
  check('7.5 the arrow appears', await until(() => el(page, (b, id) => b._model.edges.some((e) => e.id === id && e.role === 'trigger'), eid), 8000));
  await page.keyboard.press('Control+z');
  check('7.5 undo puts the old config back exactly', await until(async () => canon(await cfg()) === c0, 8000));
  await page.keyboard.press('Control+Shift+z');
  check('7.5 redo adds it again', await until(async () => (await cfg()).triggers.length === 2, 8000));
  await until(() => el(page, (b, id) => b._model.edges.some((e) => e.id === id), eid), 8000);
  await page.waitForTimeout(600);
  // remove it again: click the arrow, Remove…
  await el(page, (b, id) => {
    const p = b.shadowRoot.querySelector(`.edges path.hit[data-e="${id}"]`), q = p.getPointAtLength(p.getTotalLength() / 2), m = p.getScreenCTM();
    b._edgeClick(id, { clientX: q.x * m.a + m.e, clientY: q.y * m.d + m.f });
  }, eid);
  check('7.5 clicking an arrow says what it means', /Garage auto-close triggers FB arrow test/.test(await fbq(page, '.edgebar').textContent()));
  await fbq(page, '.edgebar [data-act="arw-remove"]').click();
  await fbq(page, '.modal .aref').first().waitFor({ timeout: 8000 });
  const t = await fbq(page, '.modal').textContent();
  check('7.5 the dialog lists each reference behind the arrow', /Trigger 2/.test(t) && /removes this trigger/.test(t) && !/comments in that file are lost/.test(t), t);
  await fbq(page, '.modal [data-act="arw-save"]').click();
  check('7.5 removing it leaves the config as it started', await until(async () => canon(await cfg()) === c0, 8000));
  check('7.5 and the arrow goes', await until(() => el(page, (b, id) => !b._model.edges.some((e) => e.id === id), eid), 8000));
  await page.keyboard.press('Control+z');
  check('7.5 undo brings the trigger back', await until(async () => (await cfg()).triggers.length === 2, 8000));
  await page.keyboard.press('Control+Shift+z');
  check('7.5 redo removes it again', await until(async () => canon(await cfg()) === c0, 8000));
  check('7.5 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('7.5 arrows that can\'t be changed from the board say why; Organise only draws nothing', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await setMode(page, 'full');
  await openFn(page, /garage/i);
  // an automation without an id (automations_manual.yaml)
  const eid = await el(page, (b) => { const e = b._model.edges.find((x) => x.to === 'automation.garage_restart_timer_when_reopened' && x.role === 'condition'); return e && e.id; });
  await el(page, (b, id) => b._edgeClick(id, { clientX: 300, clientY: 300 }), eid);
  await fbq(page, '.edgebar [data-act="arw-remove"]').click();
  check('7.5 an automation without an ID: it says so', await until(async () => /has no ID/.test(await fbq(page, '.modal').textContent()), 5000), await fbq(page, '.modal').textContent());
  await fbq(page, '.modal [data-act="modal-cancel"]').click();
  // a source arrow (a template helper's inputs) isn't from an automation config
  await openFn(page, /furnace/i);
  const src = await el(page, (b) => { const e = b._model.edges.find((x) => x.role === 'source'); return e && e.id; });
  if (src) {
    await el(page, (b, id) => b._edgeClick(id, { clientX: 300, clientY: 300 }), src);
    check('7.5 an arrow from a helper\'s own settings can\'t be removed here', await fbq(page, '.edgebar [data-act="arw-remove"]').isDisabled());
  }
  await setMode(page, 'organise');
  await openFn(page, /garage/i);
  await el(page, (b) => b._select('input_boolean.garage_auto_close'));
  check('7.5 Organise only: no handle, Connect is off', (await fbq(page, '.lh').isHidden()) && await fbq(page, '.nodebar [data-act="connect"]').isDisabled());
  check('7.5 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('2.7 Node-RED flows: off means no request; on, its groups are wired to the pieces they use', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  page.allowFail.push(/^supervisor\/api$/);  // the test Home Assistant has no apps
  await ws(page, { type: 'frontend/set_user_data', key: 'functions_board_ui', value: null });
  await page.goto(BASE + '/functions');
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await openFn(page, /garage/i);
  await page.waitForTimeout(800);
  check('2.7 off by default: nothing is asked of the Supervisor or Node-RED', !page.sent.some((m) => m.type === 'supervisor/api'));
  if (await fbq(page, '.legend .lg').count() === 0) await fbq(page, '[data-act="legend"]').click();
  await fbq(page, '.legend input[data-nr]').check();
  const err = await until(async () => { const t = await fbq(page, '.legend').textContent(); return /no apps|No Node-RED/.test(t) ? t : null; }, 8000);
  check('2.7 switched on where there is no Node-RED app: it says so', !!err, err);
  // a Node-RED app's flows, as the reader returns them (the test Home Assistant has none to read)
  await el(page, (b) => {
    b._nrCache = { at: Date.now() + 3600000, base: '/api/hassio_ingress/abc/', slug: 'abc_nodered', groups: [{ id: 't1:a1', tab: 't1', tabLabel: 'Garage flows', name: 'Door watcher', size: 6,
      trig: ['cover.garage_door', 'input_boolean.garage_auto_close'], read: ['timer.garage_open'], change: ['input_boolean.garage_auto_close'], calls: ['script.close_garage'], events: [] }] };
    return b._open(b._model.label, true);
  });
  const m = await el(page, (b) => { const n = b._model.nodes.get('nr:t1:a1'); return n && { kind: n.kind, name: n.name, edges: b._model.edges.filter((e) => e.from === n.key || e.to === n.key).map((e) => e.from + '>' + e.to + ':' + e.role), sub: b._els.get(n.key).querySelector('.sub').textContent }; });
  check('2.7 a flow group is a box of its own', m && m.kind === 'nodered' && m.name === 'Door watcher' && /Node-RED · Garage flows · 6 nodes/.test(m.sub), m);
  check('2.7 wired only to the function\'s own pieces: triggers, reads, changes, runs', m && m.edges.includes('input_boolean.garage_auto_close>nr:t1:a1:trigger') && m.edges.includes('timer.garage_open>nr:t1:a1:condition')
    && m.edges.includes('nr:t1:a1>input_boolean.garage_auto_close:action') && m.edges.includes('nr:t1:a1>script.close_garage:call') && !m.edges.some((x) => x.startsWith('cover.garage_door')), m && m.edges);
  await el(page, (b) => b._openItem(b._model.nodes.get('nr:t1:a1')));
  check('2.7 opening it opens Node-RED at its flow tab in the drawer', await el(page, (b) => b._drawer && b._drawer.url === '/api/hassio_ingress/abc/#flow/t1'));
  await el(page, (b) => b._closeDrawer());
  await fbq(page, '.legend input[data-nr]').uncheck();
  await page.waitForTimeout(1200);
  check('2.7 switched off: the boxes go', await el(page, (b) => ![...b._model.nodes.keys()].some((k) => k.startsWith('nr:'))));
  const L = (await store(page)).layouts[await el(page, (b) => b._model.label)] || {};
  check('2.7 nothing from the flows is stored', !JSON.stringify(L).includes('Door watcher'), L);
  check('2.7 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('2.7 Node-RED flows: not let in yet, the board asks to open Node-RED and never makes a session itself', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await openFn(page, /garage/i);
  const SLUG = 'a0d7b954_nodered_' + Date.now().toString(36);  // a fresh app each run: nothing kept for it yet
  // a Supervisor with a started Node-RED app, whose page answers 401 until "opened", then the flows
  await el(page, (b, slug) => {
    const real = b._ws.bind(b), SLUG = slug;
    window.__nr = { calls: [], open: false };
    b._ws = (m) => {
      if (m.type !== 'supervisor/api') return real(m);
      window.__nr.calls.push(m.endpoint + ' ' + m.method);
      if (m.endpoint === '/addons') return Promise.resolve({ addons: [{ slug: SLUG, state: 'started' }] });
      if (m.endpoint === `/addons/${SLUG}/info`) return Promise.resolve({ ingress_url: '/api/hassio_ingress/xyz/' });
      return Promise.reject(new Error('not expected: ' + m.endpoint));
    };
    const f = window.fetch;
    window.fetch = (u, o) => /hassio_ingress\/xyz\/flows$/.test(String(u))
      ? Promise.resolve(window.__nr.open ? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status: 401 }))
      : f(u, o);
  }, SLUG);
  if (await fbq(page, '.legend .lg').count() === 0) await fbq(page, '[data-act="legend"]').click();
  await fbq(page, '.legend input[data-nr]').check();
  const btn = fbq(page, '.legend [data-act="nr-open"]');
  await btn.waitFor({ timeout: 8000 });
  const t = await fbq(page, '.legend .lgerr').textContent();
  check('2.7n not let in, nothing kept: it asks to open Node-RED once', /Open Node-RED once/.test(t), t);
  check('2.7n no ingress session is made', !(await el(page, () => window.__nr.calls)).some((c) => /ingress/.test(c)), await el(page, () => window.__nr.calls));
  check('2.7n no ingress cookie is written', !(await page.evaluate(() => document.cookie)).includes('ingress_session'));
  await btn.click();
  check('2.7n Open Node-RED opens Home Assistant\'s own Node-RED page in the drawer', await el(page, (b, slug) => b._drawer && b._drawer.url === '/hassio/ingress/' + slug, SLUG));
  // the Node-RED page lets the browser in; on coming back the flows are read again and kept here
  await el(page, (b) => { window.__nr.open = true; b._closeDrawer(); });
  const kept = await until(async () => { const k = (await ws(page, { type: 'functions_board/nodered' })).kept; return k && k.slug === SLUG ? k : null; }, 8000);
  check('2.7n on coming back, the flows are read and the last read is kept by the integration, for every board', kept && kept.slug === SLUG && Array.isArray(kept.groups) && kept.at > 0, kept);
  check('2.7n read: no note any more', await until(async () => (await fbq(page, '.legend .lgerr').count()) === 0 || null, 5000));
  // later, not let in any more, and another board (another device) had read these flows: they show, marked with when
  await el(page, () => { window.__nr.open = false; });
  await ws(page, { type: 'functions_board/nodered_keep', slug: SLUG, client: 'another-board', groups: [{ id: 't1:a1', tab: 't1', tabLabel: 'Garage flows', name: 'Door watcher', size: 6,
    trig: ['input_boolean.garage_auto_close'], read: [], change: [], calls: ['script.close_garage'], events: [] }] });
  await el(page, (b) => { b._nrCache = null; return b._open(b._model.label, true).then(() => b._renderLegend()); });
  const t2 = await fbq(page, '.legend .lgerr').textContent();
  check('2.7n not let in, flows kept: they show, marked "as of"', /Node-RED flows as of .+Open Node-RED to read them again/.test(t2) && await el(page, (b) => b._model.nodes.has('nr:t1:a1')), t2);
  await el(page, (b) => b._openItem(b._model.nodes.get('nr:t1:a1')));
  check('2.7n a kept flow box opens Home Assistant\'s Node-RED page (its own link would not load yet)', await el(page, (b, slug) => b._drawer && b._drawer.url === '/hassio/ingress/' + slug, SLUG));
  await el(page, (b) => { b._nrWait = false; b._closeDrawer(); });
  await fbq(page, '.legend input[data-nr]').uncheck();
  await page.waitForTimeout(800);
  const calls = (await el(page, () => window.__nr.calls)).length;
  await el(page, (b) => { b._nrCache = null; return b._open(b._model.label, true); });
  check('2.7n switched off: Node-RED is not read', (await el(page, () => window.__nr.calls)).length === calls && await el(page, (b) => ![...b._model.nodes.keys()].some((k) => k.startsWith('nr:'))));
  check('2.7n still no session asked for', !(await el(page, () => window.__nr.calls)).some((c) => /ingress/.test(c)));
  check('2.7n no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('4.8 keyboard and screen readers: boxes are named buttons, arrow keys follow the arrows, dialogs keep focus', async ({ browser }) => {
  const { ctx, page } = await imported(browser);
  await openFn(page, /garage/i);
  check('4.8 one box is in the tab order', (await fbq(page, '.nodes .node[tabindex="0"]').count()) === 1);
  const label = await el(page, (b) => b._els.get('automation.garage_left_open').getAttribute('aria-label'));
  check('4.8 a box says what it shows (what it is, its name, its state) and what it is wired to', /^Automation Garage: left open On\b/.test(label) && /Runs Close garage/.test(label) && /Set off by/.test(label), label);
  check('4.8 boxes are buttons', await el(page, (b) => b._els.get('automation.garage_left_open').getAttribute('role') === 'button'));
  await el(page, (b) => { b._centerOn('automation.garage_left_open'); b._els.get('automation.garage_left_open').focus(); });
  await page.keyboard.press('ArrowRight');
  const r1 = await el(page, (b) => [b.shadowRoot.activeElement && b.shadowRoot.activeElement.dataset.key, b._sel]);
  const down = await el(page, (b) => b._visEdges().filter((e) => e.from === 'automation.garage_left_open').map((e) => e.to));
  check('4.8 Right moves along an arrow to what it leads to, and selects it', down.includes(r1[0]) && r1[1] === r1[0], { r1, down });
  await page.keyboard.press('ArrowLeft');
  const r2 = await el(page, (b) => b.shadowRoot.activeElement && b.shadowRoot.activeElement.dataset.key);
  const up = await el(page, (b, k) => b._visEdges().filter((e) => e.to === k).map((e) => e.from), r1[0]);
  check('4.8 Left goes back up an arrow', up.includes(r2), { r2, up });
  await page.keyboard.press(' ');
  check('4.8 Space shows or hides its actions', await el(page, (b, k) => b._sel !== k, r2));
  await page.keyboard.press(' ');
  check('4.8 and again', await el(page, (b, k) => b._sel === k && !b._$.nodebar.hidden, r2));
  // a dialog: focus goes in, stays in, and comes back
  await fbq(page, '.title [data-act="fn-menu"]').focus();
  await fbq(page, '.title [data-act="fn-menu"]').press('Enter');
  await fbq(page, '.menu [data-act="fnm-edit"]').click();
  await page.waitForTimeout(300);
  const d = await el(page, (b) => { const dlg = b.shadowRoot.querySelector('.modal .dlg'); return { role: dlg.getAttribute('role'), modal: dlg.getAttribute('aria-modal'), name: dlg.getAttribute('aria-labelledby'), inside: dlg.contains(b.shadowRoot.activeElement) }; });
  check('4.8 a dialog is named and takes the focus', d.role === 'dialog' && d.modal === 'true' && d.name && d.inside, d);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  check('4.8 Tab stays inside it', await el(page, (b) => b.shadowRoot.querySelector('.modal .dlg').contains(b.shadowRoot.activeElement)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('4.8 closing it puts the focus back', await el(page, (b) => !!b.shadowRoot.activeElement && !b.shadowRoot.querySelector('.modal').contains(b.shadowRoot.activeElement)));
  check('4.8 toasts are announced', await el(page, (b) => b._$.toast.getAttribute('aria-live') === 'polite'));
  check('4.8 no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});


pwTest.afterEach(async ({ browser }) => {
  if (!cleanup.length) return;
  const c = await session(browser, 'owner');
  await c.page.goto(BASE + '/'); await ready(c.page);
  for (const path of cleanup.splice(0)) await api(c.page, 'DELETE', path).catch(() => {});
  await c.ctx.close();
});
// leave the test Home Assistant in Organise only, as the other suites expect
pwTest.afterAll(async ({ browser }) => {
  try {
    const s = await session(browser, 'owner');
    await s.page.goto(BASE + '/'); await ready(s.page);
    const entries = await ws(s.page, { type: 'config_entries/get', domain: 'functions_board' });
    const flow = await s.page.evaluate((h) => document.querySelector('home-assistant').hass.callApi('POST', 'config/config_entries/options/flow', { handler: h }), entries[0].entry_id);
    await s.page.evaluate((id) => document.querySelector('home-assistant').hass.callApi('POST', 'config/config_entries/options/flow/' + id, { mode: 'organise', card: false }), flow.flow_id);
    await s.ctx.close();
  } catch (e) { /* best effort */ }
  done();
});
