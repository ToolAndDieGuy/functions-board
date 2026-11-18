// Real Home Assistant, real frontend: first run, import, migration from per-user data, live sync,
// dashboard card modes, non-admin. Run apitest.py first (it writes the tokens). node ui.test.js
const path = require('path');
const { chromium, BASE, SHOTS, session, ws, ready, fbq, board, until, suite, reset } = require('./lib');
const { test } = require('./fixtures');
const { check, done } = suite('ui');

test('ui', async ({ browser }) => {

  // ---------- reset the test instance ----------
  {
    const { ctx, page } = await session(browser, 'owner');
    await page.goto(BASE + '/');
    await ready(page);
    await reset(page);
    check('reset test instance', true);
    await ctx.close();
  }

  // ---------- first run, import ----------
  {
    const { ctx, page } = await session(browser, 'owner');
    await page.goto(BASE + '/functions');
    await fbq(page, '.empty.wel').waitFor({ state: 'visible', timeout: 30000 });
    check('welcome on first run', true);
    const boardCls = await board(page).evaluate((el) => el.shadowRoot.querySelector('.board').className);
    check('key and zoom hidden on welcome', /firstrun/.test(boardCls) && !(await fbq(page, '.legend').isVisible()) && !(await fbq(page, '.zoom').isVisible()), boardCls);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, '10-welcome.png') });
    await fbq(page, '.empty.wel [data-act="import"]').click();
    await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 15000 });
    const txt = await fbq(page, '.modal').innerText();
    const names = await page.locator('functions-board .modal input').evaluateAll((els) => els.map((e) => e.value).join('|'));
    check('manager lists the filter group', /Filter/i.test(names) && /2 automations · 1 script · 2 helpers/.test(txt), names + ' / ' + txt.slice(-300));
    await fbq(page, '.modal [data-act="mgr-import-one"]').first().click();
    await until(() => board(page).evaluate((el) => el._mgr && !el._mgr.busy && el._data.functions.length > 0), 10000);
    await page.waitForTimeout(800);
    await fbq(page, '.modal [data-act="close"], .modal [data-act="modal-cancel"]').first().click();
    await page.waitForTimeout(800);
    const cls2 = await board(page).evaluate((el) => el.shadowRoot.querySelector('.board').className);
    check('first-run state cleared after import', !/firstrun/.test(cls2), cls2);
    check('key visible on a board', await fbq(page, '.legend').isVisible());
    check('nodes drawn', (await fbq(page, '.nodes .node').count()) >= 5, await fbq(page, '.nodes .node').count());
    const shared = await ws(page, { type: 'functions_board/get' });
    check('saved to shared store', (shared.data.functions || []).length === 1, JSON.stringify(shared.data).slice(0, 200));
    check('no errors during first run', page.logs.length === 0, page.logs.join(' | '));
    await page.screenshot({ path: path.join(SHOTS, '11-board.png') });
    await ctx.close();
  }

  // ---------- migration from per-user data (the dashboard-card version) ----------
  {
    const { ctx, page } = await session(browser, 'owner');
    await page.goto(BASE + '/');
    await ready(page);
    const label = (await ws(page, { type: 'config/label_registry/list' }))[0];
    const legacy = { v: 1, functions: [label.label_id], layouts: { [label.label_id]: { nodes: { 'automation.furnace_filter_due_alert': { x: 900, y: 40 } }, frames: [{ id: 'f1', title: 'Old frame', x: 0, y: -60, w: 400, h: 300 }], notes: [], view: null, categories: null } }, ui: { current: label.label_id, list: true, outside: true, suggest: true, legend: false } };
    await ws(page, { type: 'frontend/set_user_data', key: 'functions_board', value: legacy });
    await ws(page, { type: 'functions_board/set', data: {} });
    await ws(page, { type: 'frontend/set_user_data', key: 'functions_board_ui', value: null });
    await page.goto(BASE + '/functions');
    await fbq(page, '.toast:not([hidden])').waitFor({ timeout: 20000 }).catch(() => {});
    const toast = await fbq(page, '.toast').innerText().catch(() => '');
    check('migration toast shown', /Moved your functions/.test(toast), toast);
    await page.waitForTimeout(1500);
    const shared = await ws(page, { type: 'functions_board/get' });
    const L = shared.data.layouts && shared.data.layouts[label.label_id];
    check('legacy layout moved into the shared store', L && L.frames && L.frames[0] && L.frames[0].title === 'Old frame' && L.nodes['automation.furnace_filter_due_alert'] && L.nodes['automation.furnace_filter_due_alert'].x === 900, JSON.stringify(shared.data).slice(0, 300));
    check('per-user UI prefs carried over (key hidden)', !(await fbq(page, '.legend .lg').count()));
    const still = await ws(page, { type: 'frontend/get_user_data', key: 'functions_board' });
    check('legacy per-user copy left in place for rollback', still && still.value && still.value.functions && still.value.functions.length === 1);
    check('frame from legacy layout drawn', (await fbq(page, '.frames .frame').count()) === 1, await fbq(page, '.frames .frame').count());
    await page.reload();
    await page.waitForTimeout(3000);
    check('no second migration toast after reload', !(await fbq(page, '.toast:not([hidden])').count()) || !/Moved/.test(await fbq(page, '.toast').innerText()));
    check('no errors during migration', page.logs.length === 0, page.logs.join(' | '));
    await ctx.close();
  }

  // ---------- live sync between two open boards ----------
  {
    const a = await session(browser, 'owner');
    const b = await session(browser, 'owner');
    await a.page.goto(BASE + '/functions');
    await b.page.goto(BASE + '/functions');
    await fbq(a.page, '.nodes .node').first().waitFor({ timeout: 20000 });
    await fbq(b.page, '.nodes .node').first().waitFor({ timeout: 20000 });
    const before = await fbq(b.page, '.notes .note').count();
    await fbq(a.page, '[data-act="note"]').click();
    await fbq(a.page, '.notes textarea').last().fill('synced note');
    await fbq(a.page, '.vp').click({ position: { x: 40, y: 40 } });
    const after = await until(async () => { const n = await fbq(b.page, '.notes .note').count(); return n === before + 1 ? n : 0; }, 6000) || await fbq(b.page, '.notes .note').count();
    check('a note added in one browser shows in the other', after === before + 1, before + ' -> ' + after);
    await a.ctx.close(); await b.ctx.close();
  }

  // ---------- dashboard card + panel view ----------
  {
    const { ctx, page } = await session(browser, 'owner');
    await page.goto(BASE + '/');
    await ready(page);
    const panels = await ws(page, { type: 'get_panels' });
    const url = panels.functions.config._panel_custom.module_url;
    await ws(page, { type: 'lovelace/resources/create', res_type: 'module', url });
    await ws(page, { type: 'lovelace/dashboards/create', url_path: 'fb-test', title: 'FB test', icon: 'mdi:test-tube', mode: 'storage', require_admin: false, show_in_sidebar: true });
    await ws(page, { type: 'lovelace/config/save', url_path: 'fb-test', config: { views: [
      { title: 'Masonry', path: 'card', cards: [{ type: 'custom:functions-board' }] },
      { title: 'Panel', path: 'panel', type: 'panel', cards: [{ type: 'custom:functions-board' }] },
      { title: 'Sections', path: 'sections', type: 'sections', sections: [{ type: 'grid', cards: [{ type: 'custom:functions-board' }] }] },
    ] } });
    await page.goto(BASE + '/fb-test/card');
    await fbq(page, '.board').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    let cls = await board(page).evaluate((el) => el.shadowRoot.querySelector('.board').className);
    check('masonry card mode', /m-card/.test(cls), cls);
    check('card hint shown in card mode', await fbq(page, '.cardhint').first().isVisible());
    await page.screenshot({ path: path.join(SHOTS, '12-card.png') });
    await page.goto(BASE + '/fb-test/panel');
    await page.waitForTimeout(3000);
    cls = await board(page).evaluate((el) => el.shadowRoot.querySelector('.board').className);
    check('panel view mode', /m-view/.test(cls), cls);
    check('no card hint in panel view', !(await fbq(page, '.cardhint').first().isVisible()));
    await page.screenshot({ path: path.join(SHOTS, '13-panelview.png') });
    await page.goto(BASE + '/fb-test/sections');
    await page.waitForTimeout(3000);
    const box = await board(page).boundingBox();
    check('sections view: card fills its section', box && box.width >= 450, JSON.stringify(box));
    await page.screenshot({ path: path.join(SHOTS, '14-sections.png') });
    check('no errors in dashboard modes', page.logs.length === 0, page.logs.join(' | '));
    await ctx.close();
  }

  // ---------- non-admin ----------
  {
    const { ctx, page } = await session(browser, 'user');
    await page.goto(BASE + '/');
    await ready(page);
    const side = await page.evaluate(() => Object.keys(document.querySelector('home-assistant').hass.panels));
    check('non-admin: no Functions in sidebar', !side.includes('functions'), side.join(','));
    await page.goto(BASE + '/fb-test/panel');
    await fbq(page, '.noadmin').waitFor({ timeout: 20000 }).catch(() => {});
    const t = await fbq(page, '.noadmin').innerText().catch(() => '');
    check('non-admin on a dashboard sees the admin message', /administrator/.test(t), t);
    await page.screenshot({ path: path.join(SHOTS, '15-nonadmin-card.png') });
    await ctx.close();
  }

});
test.afterAll(() => done());
