// Versions (0.8.0) on the test Home Assistant's garage: save a version, change things, see the difference in a
// version's tab, try it in the sandbox, restore it (Full manager) with what was added since turned off or deleted,
// and a replaced device offered a replacement.  node tests/e2e/versions.test.js
const { chromium, BASE, session, ws, svc, fbq, board, ready, until, suite, openFn, reset, importAll } = require('./lib');
const { test } = require('./fixtures');
const { check, done } = suite('versions');
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b), [method, p, body]);
const LEFT = 'automation.garage_left_open', LEFT_ID = '2002';

async function setMode(page, mode) {
  const entries = await ws(page, { type: 'config_entries/get', domain: 'functions_board' });
  const flow = await api(page, 'POST', 'config/config_entries/options/flow', { handler: entries[0].entry_id });
  await api(page, 'POST', 'config/config_entries/options/flow/' + flow.flow_id, { mode, card: false });
  await until(() => el(page, (b, m) => b._fbMode === m, mode), 8000);
}
const vlist = (page) => el(page, (b) => [...b._$.drawer.querySelectorAll('.vlist .vrow:not(.cur)')].map((r) => ({ id: r.dataset.id, name: r.querySelector('.vh b').textContent, on: r.classList.contains('on'), restore: !r.querySelector('[data-act="ver-restore"]').disabled })));
const settled = (page) => until(() => el(page, (b) => (b._model && !b._$.loading.hidden === false) || null), 15000);

test('versions', async ({ browser }) => {
  const { ctx, page } = await session(browser, 'owner', { viewport: { width: 1500, height: 900 } });
  // a deleted test item's config is asked for once on purpose (the restore plan), and the YAML helpers' editor routes
  page.allowFail = [/^(automation|script)\/config$/];
  await page.goto(BASE + '/');
  await ready(page);
  await reset(page);
  await importAll(page);
  await page.goto(BASE + '/functions');
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await openFn(page, /garage/i);
  const label = await el(page, (b) => b._data.ui.current);
  const original = await api(page, 'GET', `config/automation/config/${LEFT_ID}`);
  // a UI helper in the function, so a helper's settings are kept too
  const helper = await ws(page, { type: 'input_boolean/create', name: 'Garage test switch', icon: 'mdi:toggle-switch' });
  await until(async () => (await ws(page, { type: 'config/entity_registry/list' })).some((e) => e.platform === 'input_boolean' && e.unique_id === helper.id) || null, 8000);
  const hEnt = (await ws(page, { type: 'config/entity_registry/list' })).find((e) => e.platform === 'input_boolean' && e.unique_id === helper.id).entity_id;
  await ws(page, { type: 'config/entity_registry/update', entity_id: hEnt, labels: [label] });
  await until(() => el(page, (b, k) => b._model && b._model.nodes.has(k) || null, hEnt), 10000);

  // the drawer: nothing saved yet
  await fbq(page, '.tools [data-act="versions"]').click();
  await fbq(page, '.drawer .vlist .vrow.cur').waitFor({ timeout: 10000 });
  check('Versions opens a drawer: what\'s there now, active, not saved yet', /not saved as a version/.test(await fbq(page, '.drawer .vlist .vrow.cur').textContent()) && (await vlist(page)).length === 0);

  // save one
  await fbq(page, '.drawer [data-act="ver-new"]').click();
  await fbq(page, '.modal input[name="vname"]').fill('Original');
  await fbq(page, '.modal textarea[name="vdesc"]').fill('as the test config has it');
  await fbq(page, '.modal [data-act="ver-save"]').click();
  await until(async () => (await vlist(page)).length === 1 || null, 10000);
  let L = await vlist(page);
  check('saving keeps it, named, and it\'s marked active (it is what\'s there now)', L[0].name === 'Original' && L[0].on, L);
  const vid = L[0].id;
  const snap = (await ws(page, { type: 'functions_board/version_get', label, version_id: vid })).snapshot;
  check('the snapshot holds the configs, the helper\'s settings, the members and the layout', snap.items[LEFT].cfg.alias === original.alias && snap.items[LEFT].id === LEFT_ID && !snap.items[LEFT].yaml
    && snap.items[hEnt].cfg.name === 'Garage test switch' && snap.members.includes(LEFT) && snap.items['input_boolean.garage_auto_close'].yaml === true && !!snap.layout, Object.keys(snap.items));
  check('organise only: Restore is offered only in Full manager', !L[0].restore);

  // change things in Home Assistant: an automation's config, the helper's name, and a new automation in the function
  await api(page, 'POST', `config/automation/config/${LEFT_ID}`, Object.assign({}, original, { alias: 'Garage: left open (edited)' }));
  await ws(page, { type: 'input_boolean/update', input_boolean_id: helper.id, name: 'Garage test switch 2', icon: 'mdi:toggle-switch' });
  await api(page, 'POST', 'config/automation/config/fbver1', { alias: 'Garage: added later', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door' }], actions: [{ action: 'timer.cancel', target: { entity_id: 'timer.garage_open' } }] });
  await until(() => page.evaluate(() => !!document.querySelector('home-assistant').hass.states['automation.garage_added_later']) || null, 10000);
  await ws(page, { type: 'config/entity_registry/update', entity_id: 'automation.garage_added_later', labels: [label] });
  await page.waitForTimeout(1500);
  await el(page, (b) => b._renderVersions());
  await until(async () => (await vlist(page)).every((x) => !x.on) || null, 10000);
  check('once things change, no version is marked active; what\'s there now is', /not saved as a version/.test(await fbq(page, '.drawer .vlist .vrow.cur').textContent()));

  // a version's tab
  await fbq(page, `.drawer [data-act="ver-open"][data-id="${vid}"]`).click();
  await until(() => el(page, (b) => (b._ver && b._model && b._$.board.classList.contains('vview')) || null), 15000);
  await page.waitForTimeout(800);
  const tab = await el(page, (b, [k, h]) => ({
    tabs: [...b._$.vtabs.querySelectorAll('.vtab')].map((t) => t.textContent.trim()), banner: (b._$.vtabs.querySelector('.vban') || {}).textContent || '',
    chg: [...b._$.nodes.querySelectorAll('.node.vd-chg')].map((n) => n.dataset.key), added: b._model.nodes.has('automation.garage_added_later'), name: b._model.nodes.get(k).name,
  }), [LEFT, hEnt]);
  check('the version opens in a tab beside "Now" (active), with a banner saying it\'s not active', tab.tabs.length === 2 && /Now/.test(tab.tabs[0]) && /active/.test(tab.tabs[0]) && /Original/.test(tab.tabs[1]) && /not active/.test(tab.banner), tab);
  check('... the boxes changed since are marked, and what was added since isn\'t on it', tab.chg.includes(LEFT) && tab.chg.includes(hEnt) && !tab.added && /Added since: 1/.test(tab.banner), tab);
  check('... its board is drawn from the saved configs', (await el(page, (b, k) => b._fetchConfig(k).then((c) => c.alias), LEFT)) === original.alias);
  await fbq(page, '.tools [data-act="arrange"]').click();
  check('... and it can\'t be changed: anything that would change something says so', /saved version/.test(await fbq(page, '.toast').textContent()));
  const live = await el(page, (b, l) => JSON.stringify(b._data.layouts[l] || null), label);
  await el(page, (b, k) => { const L = b._layout(b._model.label); L.nodes[k] = { x: 9999, y: 9999 }; b._save(); }, LEFT);
  await page.waitForTimeout(1200);
  check('... moving boxes on it isn\'t saved over the real layout', (await el(page, (b, l) => JSON.stringify(b._data.layouts[l] || null), label)) === live);

  // the sandbox runs the version
  await el(page, (b) => { b._data.ui.sbxIntro = false; });
  await fbq(page, '.vtabs [data-act="ver-sbx-cur"]').click();
  await until(() => el(page, (b) => (b._sbxOn() && b._sbx.eng && b._sbx.eng.items.size > 0) || null), 15000);
  const sb = await el(page, (b, k) => ({ alias: b._sbx.eng.items.get(k).cfg.alias, title: b._$.drawer.querySelector('.dtitle').textContent, added: b._sbx.eng.items.has('automation.garage_added_later') }), LEFT);
  check('Try in sandbox runs the version\'s own configs, not what\'s there now', sb.alias === original.alias && !sb.added && /Original/.test(sb.title), sb);
  await fbq(page, '.drawer [data-act="close"]').click();

  // a link straight to a version (what "open in a new window" opens)
  await page.goto(BASE + `/functions/${encodeURIComponent(label)}?version=${vid}`);
  await ready(page);
  const viaUrl = await until(() => el(page, (b) => (b._ver && b._ver.name) || null), 15000);
  check('a link to a version opens it in its tab (for seeing it beside what\'s there now)', viaUrl === 'Original', viaUrl);
  await fbq(page, '.vtabs .vtab:not(:has(.ib))').first().click().catch(() => el(page, (b) => b._verView(null)));
  await until(() => el(page, (b) => (!b._ver && b._model) || null), 10000);
  check('the Now tab goes back to what\'s there now', await el(page, (b) => !b._$.board.classList.contains('vview') && !location.search));

  // restore (Full manager): what was added since is turned off this time
  await setMode(page, 'full');
  await fbq(page, '.tools [data-act="versions"]').click();
  await until(async () => (await vlist(page)).some((x) => x.id === vid && x.restore) || null, 10000);
  await fbq(page, `.drawer [data-act="ver-restore"][data-id="${vid}"]`).click();
  await fbq(page, '.modal .vrdlg').waitFor({ timeout: 15000 });
  const dlg = await fbq(page, '.modal .vrdlg').textContent();
  check('Restore lists what changes: configs and settings back, YAML ones that can\'t, what was added since', /get their saved configs or settings back/.test(dlg) && /defined in YAML/.test(dlg) && /Garage: added later/.test(dlg), dlg.slice(0, 400));
  check('... and offers turning off or deleting what was added since', (await fbq(page, '.modal input[name="vextra"]').count()) === 2);
  const bk = await el(page, (b) => { const c = b._$.modal.querySelector('input[name="vbackup"]'); return { there: !!c, ticked: !!c && c.checked, label: c ? c.parentNode.textContent : '', hint: c ? c.parentNode.nextElementSibling.textContent : '' }; });
  check('0.8.1 saving what\'s there now first is a choice, not ticked unless you tick it', bk.there && !bk.ticked && /Before restoring/.test(bk.label), bk);
  check('0.8.1 ... and the dialog says what\'s there now isn\'t saved anywhere (it was edited since)', /isn.t saved as a version/.test(bk.hint), bk.hint);
  await fbq(page, '.modal input[name="vbackup"]').check();
  await fbq(page, '.modal [data-act="ver-restore-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 30000);
  const after = await api(page, 'GET', `config/automation/config/${LEFT_ID}`);
  check('restored: the automation\'s config is back', after.alias === original.alias, after.alias);
  const h2 = (await ws(page, { type: 'input_boolean/list' })).find((x) => x.id === helper.id);
  check('... and the helper\'s settings', h2 && h2.name === 'Garage test switch', h2);
  const off = await until(() => page.evaluate(() => (document.querySelector('home-assistant').hass.states['automation.garage_added_later'] || {}).state === 'off' || null), 10000);
  check('... what was added since is turned off, not deleted', !!off);
  await until(async () => (await vlist(page)).length === 2 || null, 10000);
  L = await vlist(page);
  check('... with the box ticked, what was there before is saved first', L.some((x) => /Before restoring "Original"/.test(x.name)), L);
  check('... and with the added automation still in it (turned off), the function isn\'t marked as exactly that version', !L.find((x) => x.id === vid).on, L);

  // again, deleting what was added since; and a version whose steps use a device that's gone
  await api(page, 'POST', `config/automation/config/${LEFT_ID}`, Object.assign({}, original, { alias: 'Garage: left open (edited again)' }));
  const ghostDev = 'f'.repeat(32), withDev = JSON.parse(JSON.stringify(snap));
  withDev.items[LEFT].cfg.actions = [].concat(withDev.items[LEFT].cfg.actions || [], [{ device_id: ghostDev, domain: 'cover', entity_id: 'cover.garage_door', type: 'close' }]);
  withDev.devices = { [ghostDev]: { name: 'Old garage opener', model: 'GD-1', manufacturer: 'Acme' } };
  const dv = await ws(page, { type: 'functions_board/version_save', label, name: 'With an old opener', snapshot: withDev });
  await el(page, (b) => b._renderVersions());
  await until(async () => (await vlist(page)).some((x) => x.id === dv.id) || null, 10000);
  await fbq(page, `.drawer [data-act="ver-restore"][data-id="${dv.id}"]`).click();
  await fbq(page, '.modal .vrdlg').waitFor({ timeout: 15000 });
  const dd = await el(page, (b) => ({ text: b._$.modal.textContent, pickers: b._$.modal.querySelectorAll('.vdevpick ha-selector, .vdevpick select').length }));
  check('a device its steps use that\'s gone: named, with Home Assistant\'s device picker to choose what replaced it', /Old garage opener/.test(dd.text) && /Acme GD-1/.test(dd.text) && dd.pickers === 1, dd);
  // pick a real device as the replacement: the restored step points at it
  const realDev = (await ws(page, { type: 'config/device_registry/list' })).find((d) => d.name);
  await el(page, (b, [o, n]) => { b._verPending.devmap[o] = n; }, [ghostDev, realDev.id]);
  await fbq(page, '.modal input[name="vextra"][value="delete"]').check();
  const n0 = (await vlist(page)).length;
  await fbq(page, '.modal [data-act="ver-restore-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 30000);
  await el(page, (b) => b._renderVersions());
  await page.waitForTimeout(1500);
  check('0.8.1 with the box left as it is, restoring saves no extra copy', (await vlist(page)).length === n0, await vlist(page));
  const after2 = await api(page, 'GET', `config/automation/config/${LEFT_ID}`);
  check('the replaced device\'s step now names the device picked', JSON.stringify(after2.actions).includes(realDev.id) && !JSON.stringify(after2.actions).includes(ghostDev), after2.actions);
  const gone = await api(page, 'GET', 'config/automation/config/fbver1').then(() => false, () => true);
  check('... and what was added since is deleted, when that\'s chosen', gone);

  // toggling back: restoring "Original" again makes the function exactly that version, and it's marked active
  await el(page, (b) => b._renderVersions());
  await until(async () => (await vlist(page)).some((x) => x.id === vid && x.restore) || null, 10000);
  await fbq(page, `.drawer [data-act="ver-restore"][data-id="${vid}"]`).click();
  await fbq(page, '.modal [data-act="ver-restore-go"]').waitFor({ timeout: 15000 });
  await fbq(page, '.modal [data-act="ver-restore-go"]').click();
  await until(() => el(page, (b) => b._$.modal.hidden || null), 30000);
  await el(page, (b) => b._renderVersions());
  const back = await until(async () => ((await vlist(page)).find((x) => x.id === vid) || {}).on || null, 15000);
  check('switching back to a version: once the function is exactly it again, it\'s the active one', !!back, await vlist(page));
  check('0.8.1 ... and switching back and forth piles up no copies', (await vlist(page)).length === n0, await vlist(page));
  // what's there now is a saved version: the dialog says so (no backup needed)
  const bef = (await vlist(page)).find((x) => /Before restoring/.test(x.name));
  await fbq(page, `.drawer [data-act="ver-restore"][data-id="${bef.id}"]`).click();
  await fbq(page, '.modal .vrdlg').waitFor({ timeout: 15000 });
  const hint2 = await el(page, (b) => b._$.modal.querySelector('input[name="vbackup"]').parentNode.nextElementSibling.textContent);
  check('0.8.1 when what\'s there now is already a saved version, the dialog names it', /already saved as "Original"/.test(hint2), hint2);
  await fbq(page, '.modal [data-act="modal-cancel"]').click();

  // rename and delete
  await fbq(page, `.drawer [data-act="ver-edit"][data-id="${dv.id}"]`).click();
  await fbq(page, '.modal input[name="vname"]').fill('Old opener');
  await fbq(page, '.modal [data-act="ver-edit-save"]').click();
  await until(async () => (await vlist(page)).some((x) => x.name === 'Old opener') || null, 8000);
  await fbq(page, `.drawer [data-act="ver-del"][data-id="${dv.id}"]`).click();
  await fbq(page, '.modal [data-act="ver-del-go"]').click();
  await until(async () => !(await vlist(page)).some((x) => x.id === dv.id) || null, 8000);
  check('a version can be renamed and deleted', true);

  // put the test home back
  await api(page, 'POST', `config/automation/config/${LEFT_ID}`, original);
  await ws(page, { type: 'input_boolean/delete', input_boolean_id: helper.id }).catch(() => {});
  await api(page, 'DELETE', 'config/automation/config/fbver1').catch(() => {});
  await ws(page, { type: 'functions_board/version_delete', label });
  await setMode(page, 'organise');
  check('no errors', page.logs.length === 0, page.logs);
  await ctx.close();
});
test.afterAll(() => done());
