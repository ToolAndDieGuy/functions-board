// Size guard rails (5.5): with 1,000 extra automations and 200 helpers, a full import scan takes under 2 s
// and opening a 40-piece function under 500 ms. Writes packages/fb_bulk.yaml into the test instance's config
// (FB_HA_CONFIG), reloads, measures in the real frontend, then removes it again. node size.test.js
const fs = require('fs');
const path = require('path');
const { chromium, BASE, session, ws, svc, ready, board, until, suite, reset } = require('./lib');
const { test } = require('./fixtures');
const { check, done } = suite('size');

const CONFIG = process.env.FB_HA_CONFIG;
const FILE = CONFIG && path.join(CONFIG, 'packages', 'fb_bulk.yaml');

function bulkYaml() {
  // 200 flags; 1,000 automations in groups of five that start from one flag and set the next group's flag
  const out = ['input_boolean:'];
  for (let i = 0; i < 200; i++) out.push(`  fb_bulk_${i}:`, `    name: Bulk flag ${i}`);
  out.push('automation:');
  for (let i = 0; i < 1000; i++) {
    const g = Math.floor(i / 5);
    out.push(`  - id: fb_bulk_${i}`, `    alias: Bulk ${g} step ${i % 5}`,
      '    triggers:', '      - trigger: state', `        entity_id: input_boolean.fb_bulk_${g % 200}`, '        to: "on"',
      '    conditions:', '      - condition: template', `        value_template: "{{ is_state('input_boolean.fb_bulk_${(g + 7) % 200}', 'off') }}"`,
      '    actions:', `      - action: input_boolean.turn_${i % 2 ? 'off' : 'on'}`, '        target:', `          entity_id: input_boolean.fb_bulk_${(g + 1) % 200}`);
  }
  return out.join('\n') + '\n';
}
const count = (page) => page.evaluate(() => Object.keys(document.querySelector('home-assistant').hass.states).filter((k) => /^automation\.bulk_/.test(k)).length);

test('size', async ({ browser }) => {
  if (!CONFIG) throw new Error('set FB_HA_CONFIG to the test instance\'s config folder');
  const { ctx, page } = await session(browser, 'owner', { viewport: { width: 1500, height: 900 } });
  await page.goto(BASE + '/');
  await ready(page);
  await reset(page);
  fs.writeFileSync(FILE, bulkYaml());
  try {
    await svc(page, 'input_boolean', 'reload');
    await svc(page, 'automation', 'reload');
    const n = await until(async () => ((await count(page)) >= 1000 ? count(page) : 0), 60000, 500);
    check('1,000 extra automations loaded', n >= 1000, n);
    // a function of 40 pieces: eight groups of five
    const lab = await ws(page, { type: 'config/label_registry/create', name: 'FB bulk' });
    const ids = [];
    for (let g = 0; g < 8; g++) for (let k = 0; k < 5; k++) ids.push(`automation.bulk_${g}_step_${k}`);
    for (const id of ids) await ws(page, { type: 'config/entity_registry/update', entity_id: id, labels: [lab.label_id] });
    await ws(page, { type: 'functions_board/set', data: { v: 1, functions: [lab.label_id], layouts: {} } });
    await page.goto(BASE + '/functions');
    await page.locator('functions-board .nodes .node').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const t = await board(page).evaluate(async (b, l) => {
      const times = {};
      b._store.forget('cfg:'); b._grefs = null;
      let t0 = performance.now(); await b._open(l); times.openCold = performance.now() - t0;
      t0 = performance.now(); await b._open(l); times.openWarm = performance.now() - t0;
      b._openManager('detect');
      await new Promise((r) => { const w = () => (b._mgr.scanning ? setTimeout(w, 50) : r()); w(); });
      b._store.forget('cfg:');
      t0 = performance.now(); await b._scanFunctions(); times.scan = performance.now() - t0;
      times.groups = b._mgr.cands.length; times.automations = b._mgr.stats.automations;
      return times;
    }, lab.label_id);
    console.log('timings (ms):', JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]))));
    check('a full scan of every automation and script takes under 2 s', t.scan < 2000, t);
    check('opening a 40-piece function takes under 500 ms (configs not cached)', t.openCold < 500, t);
    check('no errors', page.logs.length === 0, page.logs.slice(0, 5));
  } finally {
    fs.unlinkSync(FILE);
    await svc(page, 'automation', 'reload').catch(() => {});
    await svc(page, 'input_boolean', 'reload').catch(() => {});
    // the registry keeps entries of YAML items that went away; remove them so later runs start clean
    for (const e of await ws(page, { type: 'config/entity_registry/list' }).catch(() => [])) {
      if (/^(automation\.bulk_|input_boolean\.fb_bulk_)/.test(e.entity_id)) await ws(page, { type: 'config/entity_registry/remove', entity_id: e.entity_id }).catch(() => {});
    }
    await reset(page).catch(() => {});
    await ctx.close();
  }
});
test.afterAll(() => done());
