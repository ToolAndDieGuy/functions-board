// Option: Home Assistant reads Node-RED's flows itself, with an address and login set in the integration's
// options. Needs two real Node-REDs on this machine (see tests/e2e/nodered/README.md):
//   127.0.0.1:1880  like the Node-RED app's direct access: no Node-RED login, a Home Assistant login (Basic) in front
//   127.0.0.1:1881  a plain Node-RED with its own login (adminAuth), user fbr
// both with the same flows: one group in tab t1 wired to the garage function's helpers.
// FB_NR_PW is the test password both accept.  node tests/e2e/nodered-server.test.js
const { execSync } = require('child_process');
const { chromium, BASE, session, ws, fbq, board, ready, until, suite, openFn, reset, importAll } = require('./lib');
const { check, done } = suite('nodered-server');

const PW = process.env.FB_NR_PW;
const el = (page, fn, arg) => board(page).evaluate(fn, arg);

async function options(page, values) {
  // the integration's options form, as Settings shows it: keep mode and card as they are
  const entry = (await ws(page, { type: 'config_entries/get', domain: 'functions_board' }))[0];
  const api = (m, p, d) => page.evaluate(([m, p, d]) => document.querySelector('home-assistant').hass.callApi(m, p, d), [m, p, d]);
  const form = await api('POST', 'config/config_entries/options/flow', { handler: entry.entry_id });
  const keep = Object.fromEntries(form.data_schema.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]));
  return api('POST', `config/config_entries/options/flow/${form.flow_id}`, { mode: keep.mode, card: keep.card, ...values });
}

(async () => {
  if (!PW) { console.log('FB_NR_PW not set: skipped'); process.exit(0); }
  const browser = await chromium.launch();
  const { ctx, page } = await session(browser, 'owner');
  page.allowFail = [/^supervisor\/api$/];  // the test Home Assistant has no Supervisor
  await page.goto(BASE + '/');
  await ready(page);

  // ---- the options form checks the address and login before keeping them
  let r = await options(page, { nodered_url: 'http://127.0.0.1:1880', nodered_username: 'fb-reader', nodered_password: 'wrong' });
  check('a wrong Home Assistant login for the app\'s port is refused, with words', r.type === 'form' && r.errors.base === 'nodered_invalid_auth', r.errors);
  r = await options(page, { nodered_url: 'http://127.0.0.1:1999', nodered_username: 'fb-reader', nodered_password: PW });
  check('nothing at the address: says it couldn\'t reach Node-RED', r.type === 'form' && r.errors.base === 'nodered_cannot_connect', r.errors);
  r = await options(page, { nodered_url: '127.0.0.1:1880', nodered_username: 'fb-reader', nodered_password: PW });
  check('an address without http:// is pointed out', r.type === 'form' && r.errors.nodered_url === 'invalid_url', r.errors);
  r = await options(page, { nodered_url: 'http://127.0.0.1:1880/', nodered_username: 'fb-reader', nodered_password: PW });
  check('the app\'s port with a Home Assistant login: kept', r.type === 'create_entry', r);

  // ---- the board: nothing read until Node-RED is switched on in the Key
  await reset(page);
  await importAll(page);
  await ws(page, { type: 'frontend/set_user_data', key: 'functions_board_ui', value: null });
  await page.goto(BASE + '/functions');
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  page.sent.length = 0;
  await openFn(page, /garage/i);
  await page.waitForTimeout(800);
  check('switched off: Home Assistant isn\'t asked to read Node-RED', !page.sent.some((m) => m.type === 'functions_board/nodered'));
  if (await fbq(page, '.legend .lg').count() === 0) await fbq(page, '[data-act="legend"]').click();
  await fbq(page, '.legend input[data-nr]').check();
  const has = () => el(page, (b) => b._model && b._model.nodes.has('nr:t1:a1'));
  check('switched on: the flows Home Assistant read are boxes, wired to the function', await until(has, 8000)
    && await el(page, (b) => b._model.edges.some((e) => e.from === 'input_boolean.garage_auto_close' && e.to === 'nr:t1:a1')));
  check('no note and no Open Node-RED button: nothing to open first', (await fbq(page, '.legend .lgerr').count()) === 0);
  check('no ingress anything', !page.sent.some((m) => m.type === 'supervisor/api' && /ingress/.test(m.endpoint)) && !(await page.evaluate(() => document.cookie)).includes('ingress'));
  const kept = (await ws(page, { type: 'functions_board/nodered' })).kept;
  check('the summary is kept for every board', kept && kept.slug === 'server' && kept.groups.some((g) => g.name === 'Door watcher'), kept);
  check('the flows themselves are not kept', !JSON.stringify(kept).includes('"wires"'));

  // ---- Node-RED goes away: the last read shows, with when, and why
  execSync("pkill -f '[n]ode gate.js' || true");
  await page.waitForTimeout(31000);  // past Home Assistant's 30-second cache
  await el(page, (b) => { b._nrCache = null; return b._open(b._model.label, true).then(() => b._renderLegend()); });
  const t = await fbq(page, '.legend .lgerr').textContent().catch(() => '');
  check('unreachable: says so, and shows the flows read before, with when', /couldn't reach Node-RED/.test(t) && /Showing the flows read/.test(t) && await has(), t);
  execSync('cd /home/claude/nr-test && (nohup node gate.js > gate.log 2>&1 &)');
  await page.waitForTimeout(1500);

  // ---- a Node-RED with its own login (adminAuth): a token, as node-red-admin gets one
  r = await options(page, { nodered_url: 'http://127.0.0.1:1881', nodered_username: 'fbr', nodered_password: 'wrong' });
  check('its own login, wrong password: refused', r.type === 'form' && r.errors.base === 'nodered_invalid_auth', r.errors);
  r = await options(page, { nodered_url: 'http://127.0.0.1:1881', nodered_username: 'fbr', nodered_password: PW });
  check('its own login: kept', r.type === 'create_entry', r);
  r = await options(page, { nodered_url: 'http://127.0.0.1:1881', nodered_username: 'fbr' });
  check('saving the options again without the password keeps it', r.type === 'create_entry', r);  // the read below proves it
  await el(page, (b) => { b._nrCache = null; return b._open(b._model.label, true).then(() => b._renderLegend()); });
  check('read with a Node-RED token: the boxes', await until(has, 8000) && (await fbq(page, '.legend .lgerr').count()) === 0);

  // ---- address cleared: back to reading through the Node-RED page in the browser only
  r = await options(page, {});
  check('no address: reading from Home Assistant is off', r.type === 'create_entry');
  const n0 = page.sent.length;
  await el(page, (b) => { b._nrCache = null; return b._open(b._model.label, true).then(() => b._renderLegend()); });
  await until(async () => /no apps|No Node-RED/.test(await fbq(page, '.legend').textContent()), 8000);
  check('... and the board looks for the Node-RED app instead', page.sent.slice(n0).some((m) => m.type === 'supervisor/api'));
  await fbq(page, '.legend input[data-nr]').uncheck();
  check('no errors', page.logs.length === 0, page.logs);
  await ctx.close();
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
