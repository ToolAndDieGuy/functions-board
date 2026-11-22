// The notification builder (0.11.3) on the test Home Assistant: a script written from what's picked, taken by Home
// Assistant as it is (it opens in the builder again), run for real to the test home's phone (its pushes come over
// the mobile app's websocket channel: nothing leaves this machine), a button pressed on it answering that run only;
// tried in the sandbox with Home Assistant rendering its templates and nothing sent; edited by hand, it opens in
// Home Assistant's editor.  node tests/e2e/builder.test.js
const fs = require('fs');
const path = require('path');
const { BASE, session, ws, svc, fbq, board, ready, until, suite, openFn, reset, importAll, sleep } = require('./lib');
const { test } = require('./fixtures');
const { check, done } = suite('builder');
const { nbSame } = require('../lib/board-lib');
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b), [method, p, body]);
const OID = 'garage_open_notify', KEY = 'script.' + OID, CLOSE = 'script.close_garage';

async function setMode(page, mode) {
  const entries = await ws(page, { type: 'config_entries/get', domain: 'functions_board' });
  const flow = await api(page, 'POST', 'config/config_entries/options/flow', { handler: entries[0].entry_id });
  await api(page, 'POST', 'config/config_entries/options/flow/' + flow.flow_id, { mode, card: false });
  await until(() => el(page, (b, m) => b._fbMode === m, mode), 8000);
}
// the test phone's webhook (hasetup.js registered it): its pushes are read on the mobile app's websocket channel
function phoneWebhook() {
  const f = path.join(__dirname, '..', '..', 'ha', 'config', '.storage', 'core.config_entries');
  const e = JSON.parse(fs.readFileSync(f, 'utf8')).data.entries.find((x) => x.domain === 'mobile_app' && x.data && x.data.device_name === 'Test phone');
  return e && e.data.webhook_id;
}

test('builder', async ({ browser }) => {
  const { page } = await session(browser, 'owner', { viewport: { width: 1500, height: 900 } });
  page.setDefaultTimeout(20000);
  await page.goto(BASE + '/');
  await ready(page);
  await reset(page);
  await importAll(page);
  await page.goto(BASE + '/functions');
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  const garage = await openFn(page, /garage/i);
  await setMode(page, 'full');
  const webhook = phoneWebhook();
  check('the test phone is registered, pushing over its websocket', !!webhook);
  await page.evaluate((w) => {
    window.__push = [];
    return document.querySelector('home-assistant').hass.connection.subscribeMessage((m) => window.__push.push(m), { type: 'mobile_app/push_notification_channel', webhook_id: w, support_confirm: false });
  }, webhook);
  const pushes = () => page.evaluate(() => window.__push.slice());

  // made in the builder
  await fbq(page, '.tools [data-act="new-script"]').click();
  await fbq(page, '.menu [data-act="nb-new"]').click();
  await fbq(page, '.modal .nbdlg').waitFor({ timeout: 5000 });
  await fbq(page, '.modal input[name="nbname"]').fill('Garage open notify');
  await fbq(page, '.modal input[name="nbtitle"]').fill('Garage');
  await fbq(page, '.modal textarea[name="nbmsg"]').fill("The garage door is {{ states('cover.garage_door') }}");
  await fbq(page, '.modal input[name="nbp"][value="person.test_owner"]').check();
  await fbq(page, '.modal select[name="nblevel"]').selectOption('time');
  await fbq(page, '.modal input[name="nbq"]').check();
  await fbq(page, '.modal input[name="nbqf"]').fill('23:59');
  await fbq(page, '.modal input[name="nbqt"]').fill('00:00');
  await fbq(page, '.modal [data-act="nb-add-btn"]').click();
  await fbq(page, '.modal input[name="nbbt"]').fill('Close it');
  // what it does: Home Assistant's own action editor (loaded here), given the actions as its editor gives them
  await until(() => el(page, (b) => !!b._$.modal.querySelector('.selbox[data-nbsel="b0"] ha-selector') || null), 15000);
  check('a button\'s actions are picked in Home Assistant\'s own action editor', await el(page, (b) => !!b._$.modal.querySelector('.selbox[data-nbsel="b0"] ha-selector') && !!b._$.modal.querySelector('.selbox[data-nbsel="timeout"] ha-selector')));
  await el(page, (b, k) => b._$.modal.querySelector('.selbox[data-nbsel="b0"] ha-selector').dispatchEvent(new CustomEvent('value-changed', { detail: { value: [{ action: k }] } })), CLOSE);
  await fbq(page, '.modal [data-act="nb-add-btn"]').click();
  await fbq(page, '.modal input[name="nbbt"] >> nth=1').fill('Leave it');
  await fbq(page, '.modal [data-act="nb-save"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 20000);
  await until(() => el(page, (b, k) => (b._model && b._model.nodes.has(k)) || null, KEY), 15000);
  const cfg = await api(page, 'GET', 'config/script/config/' + OID);
  const spec = (await ws(page, { type: 'functions_board/get' })).data.layouts[garage].builders[KEY].spec;
  check('Home Assistant took the script as an ordinary one, and keeps it as the builder made it', !!cfg && cfg.alias === 'Garage open notify' && nbSame(cfg, spec), cfg);
  const reg = await until(async () => { const r = await ws(page, { type: 'config/entity_registry/get', entity_id: KEY }); return (r.labels || []).includes(garage) ? r : null; }, 10000);
  check('... it\'s in the function', !!reg, reg && reg.labels);

  // run for real: the phone gets it, with the run's own button ids; a button of another run doesn't answer it
  const close0 = await page.evaluate((k) => document.querySelector('home-assistant').hass.states[k].attributes.last_triggered, CLOSE);
  await svc(page, 'script', 'turn_on', {}, { entity_id: KEY });
  const got = await until(async () => (await pushes()).find((m) => m.message && m.message !== 'clear_notification') || null, 15000);
  const acts = got && got.data && got.data.actions;
  check('run for real: the phone gets the message, rendered by Home Assistant', !!got && got.title === 'Garage' && /^The garage door is (open|closed|opening|closing)$/.test(got.message), got);
  check('... with two buttons whose ids are this run\'s own, and the tag of the run', !!acts && acts.length === 2 && /^fb_[0-9A-Z]{26}_1$/i.test(acts[0].action) && acts[1].action === acts[0].action.replace(/_1$/, '_2') && got.data.tag === acts[0].action.replace(/_1$/, ''), got && got.data);
  check('... time-sensitive on Android: high priority, at once', got && got.data.priority === 'high' && got.data.ttl === 0, got && got.data);
  await ws(page, { type: 'fire_event', event_type: 'mobile_app_notification_action', event_data: { action: 'fb_SOMEONEELSE_1' } });
  await sleep(1500);
  check('a button of another run doesn\'t answer this one', (await page.evaluate((k) => document.querySelector('home-assistant').hass.states[k].state, KEY)) === 'on');
  await ws(page, { type: 'fire_event', event_type: 'mobile_app_notification_action', event_data: { action: acts[0].action } });
  await until(async () => (await page.evaluate((k) => document.querySelector('home-assistant').hass.states[k].attributes.last_triggered, CLOSE)) !== close0 || null, 15000);
  check('pressing Close it runs Close garage', (await page.evaluate((k) => document.querySelector('home-assistant').hass.states[k].attributes.last_triggered, CLOSE)) !== close0);
  const cleared = await until(async () => (await pushes()).find((m) => m.message === 'clear_notification') || null, 10000);
  check('... and the notification is cleared from the phone by its tag', !!cleared && cleared.data && cleared.data.tag === got.data.tag, cleared);
  await until(async () => (await page.evaluate((k) => document.querySelector('home-assistant').hass.states[k].state, KEY)) === 'off' || null, 10000);

  // opened again from its box: the builder, as Home Assistant keeps it
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), KEY);
  await fbq(page, '.modal .nbdlg').waitFor({ timeout: 8000 });
  check('Edit on its box opens the builder again', (await fbq(page, '.modal input[name="nbname"]').inputValue()) === 'Garage open notify' && (await fbq(page, '.modal input[name="nbbt"]').count()) === 2);

  // tried in the sandbox: templates rendered by Home Assistant, the button pressed there, nothing sent
  const n0 = (await pushes()).length;
  page.sent.length = 0;
  await fbq(page, '.modal [data-act="nb-try"]').click();
  const sent = await until(() => el(page, (b) => { const e = b._sbx && b._sbx.eng && b._sbx.eng.log.find((x) => x.kind === 'call' && x.svc === 'notify.mobile_app_test_phone'); return (e && e.data && e.data.data && e.data.data.actions[0].action) || null; }), 20000);
  check('Try in sandbox: the notification sent there, its ids rendered by Home Assistant from the sandbox run\'s context', /^fb_SBX\d+_1$/.test(sent || ''), sent);
  await until(() => el(page, (b, a) => [...b._$.drawer.querySelectorAll('select.sbnact option')].some((o) => o.value === a) || null, sent), 8000);
  await el(page, (b, a) => { b._$.drawer.querySelector('select.sbnact').value = a; }, sent);
  await fbq(page, '.drawer [data-act="sbx-nact"]').click();
  const ran = await until(() => el(page, (b) => (b._sbx.eng.log.some((e) => e.kind === 'call' && e.svc === 'script.close_garage') && b._sbx.eng.log.some((e) => e.kind === 'call' && e.data && e.data.message === 'clear_notification')) || null), 15000);
  check('... the button pressed there clears it and closes the garage in the sandbox', !!ran);
  check('... and nothing was sent to the phone or changed', (await pushes()).length === n0 && !page.sent.some((m) => /^(call_service|fire_event|execute_script)$/.test(m.type)), page.sent.map((m) => m.type));
  await el(page, (b) => b._closeDrawer());

  // edited by hand: Home Assistant's editor
  await api(page, 'POST', 'config/script/config/' + OID, Object.assign({}, cfg, { sequence: cfg.sequence.concat([{ delay: { seconds: 1 } }]) }));
  await until(() => el(page, (b) => b._store.changed('cfg:') || true), 2000);
  await sleep(1000);
  await el(page, (b, k) => b._openItem(b._model.nodes.get(k)), KEY);
  const url = await until(() => el(page, (b) => (b._drawer && b._drawer.mode === 'frame' && b._drawer.url) || null), 10000);
  check('edited by hand, it opens in Home Assistant\'s editor', /\/config\/script\/edit\//.test(url || '') && await el(page, (b) => b._$.modal.hidden), url);
  await el(page, (b) => b._closeDrawer());
  await setMode(page, 'organise');
});
test.afterAll(() => done());
