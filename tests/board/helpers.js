// The browser suites' helpers (tests/e2e/lib.js), with the same names and the same use, for the board tests
// on the fake Home Assistant (layer 3). A suite moves here by requiring this instead of ../e2e/lib and
// ./fixtures from here: session() opens the board on this test's fake, and ws(), svc(), states() and the rest
// reach that fake through the page's own hass, as they reach the real one there.
const lib = require('../e2e/lib');

// set by fixtures.js for each test: that test's fake Home Assistant (and every fake it made: freshBoard starts anew)
const current = { fake: null, all: [] };

async function session(browser, who = 'owner', opts = {}) {
  if (!current.fake) throw new Error('board helpers: no fake Home Assistant (use the test from tests/board/fixtures.js)');
  if (who === 'user') current.fake.admin = false;
  const viewport = opts.mobile ? { width: 390, height: 844 } : opts.viewport || { width: 1400, height: 860 };
  const r = await current.fake.open(browser, { light: opts.light, viewport, reducedMotion: opts.reducedMotion, clock: opts.clock });
  return { ctx: r.ctx, page: r.page };
}
// reset(): the board's data back to none, as on the real Home Assistant; freshBoard(): a new fake Home Assistant,
// as the real one is after reset (the pages of the old one stay open until the test ends)
async function reset() { if (current.fake) { current.fake.store = { data: {}, revs: {}, mode: current.fake.store.mode }; current.fake.labels = []; current.fake.versions = {}; } }
async function freshBoard(browser, opts = {}) {
  if (opts.reset !== false && current.fake) {
    const { FakeHA } = require('./fake-ha');
    current.fake = new FakeHA({ mode: current.fake.store.mode });
    current.all.push(current.fake);
  }
  return session(browser, 'owner', opts);
}

// Import every group the manager detects, as a first-time user would, then close the manager.
async function importAll(page) {
  await lib.fbq(page, '.empty.wel [data-act="import"]').click();
  await lib.fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  await lib.fbq(page, '.modal [data-act="mgr-selall"]').click();
  await lib.fbq(page, '.modal [data-act="mgr-import-sel"]').click();
  await lib.until(async () => (await lib.board(page).evaluate((el) => !(el._mgr && el._mgr.busy) && (el._data.functions || []).length)), 15000);
  await lib.fbq(page, '.modal [data-act="modal-cancel"]').first().click().catch(() => {});
  // the labels it made set off a reload of the registries: wait until the board has done with it
  await current.fake.idle(500);
}
// Open a function by its label's name (regex), then wait until the board has finished drawing it.
async function openFn(page, re) {
  const id = await lib.openFn(page, re);
  await current.fake.idle(400);
  return id;
}

module.exports = Object.assign({}, lib, { current, session, reset, freshBoard, importAll, openFn, BASE: 'http://fake.ha' });
