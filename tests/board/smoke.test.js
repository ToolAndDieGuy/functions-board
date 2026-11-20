// The board starts on the fake Home Assistant, imports the test config's functions and draws the garage.
const { test } = require('./fixtures');
const { session, fbq, board, until, importAll, openFn, suite } = require('./helpers');
const { check, done } = suite('board-smoke');

test('the board starts, imports and draws the garage', async ({ browser, fake }) => {
  const { page } = await session(browser);
  await fbq(page, '.empty.wel').waitFor({ timeout: 15000 });
  check('smoke: the first-run welcome shows', true);
  await importAll(page);
  const fns = await board(page).evaluate((b) => b._data.functions.length);
  check('smoke: import makes functions (labels in the fake)', fns >= 3 && fake.labels.length >= 3, { fns, labels: fake.labels.map((l) => l.name) });
  await openFn(page, /garage/i);
  const n = await until(() => board(page).evaluate((b) => b.shadowRoot.querySelectorAll('.nodes .node').length), 10000);
  check('smoke: the garage is drawn', n >= 6, n);
  check('smoke: no errors', page.logs.length === 0, page.logs);
});

// The fake's jitter mode (FB_JITTER, fake-ha.js) does what it says: with it, an event sent while answering a call
// reaches the page sometimes before the answer and sometimes after, and events keep their order; without it, the
// event always comes first (as the fake has always done). A jitter that changed nothing would let every board test
// pass under it without having tried anything.
test('the fake\'s jitter puts events before and after answers', async ({ browser }) => {
  const { FakeHA } = require('./fake-ha');
  const probe = async (jitter) => {
    const f = new FakeHA({ jitter });
    const { ctx, page } = await f.open(browser, {});
    const r = await page.evaluate(async () => {
      const conn = document.querySelector('home-assistant').hass.connection, got = [], order = [];
      await conn.subscribeMessage((ev) => got.push(ev.data.n), { type: 'subscribe_events', event_type: 'fb_probe' });
      for (let n = 0; n < 40; n++) {
        await conn.sendMessagePromise({ type: 'fire_event', event_type: 'fb_probe', event_data: { n } });
        order.push(got.includes(n) ? 'before' : 'after');
      }
      for (let i = 0; i < 50 && got.length < 40; i++) await new Promise((x) => setTimeout(x, 100));
      return { order, got };
    });
    await ctx.close();
    return { before: r.order.filter((x) => x === 'before').length, after: r.order.filter((x) => x === 'after').length, inOrder: r.got.join() === [...Array(40).keys()].join() };
  };
  const plain = await probe(''), shaken = await probe('smoke');
  check('J1 without jitter, an event always comes before the answer it goes with', plain.before === 40 && plain.inOrder, plain);
  check('J2 with jitter, events come both before and after their answers, and in order', shaken.before >= 3 && shaken.after >= 3 && shaken.inOrder, shaken);
});
// A call the board reports as failed is an error in a board test (tests/board/fake-ha.js), as a failed answer is in
// the real-HA suites, unless the test says it expects that call to fail (page.allowFail). Without it, a failure the
// board reports when nothing has gone wrong (an expected one not marked optional) would pass every test.
test('a failure the board reports is an error in the test, unless it is expected', async ({ browser, fake }) => {
  const { page } = await session(browser);
  await fbq(page, '.empty.wel').waitFor({ timeout: 15000 });
  fake.answers = { 'config/category_registry/list': () => { throw Object.assign(new Error('planted'), { code: 'planted_failure' }); } };
  await board(page).evaluate((b) => b._ws({ type: 'config/category_registry/list', scope: 'automation' }, { fallback: [] }));
  await until(() => page.logs.length || null, 3000);
  check('J3 a reported failure is in the page\'s errors', page.logs.some((l) => /^reported: .*config\/category_registry\/list failed \(planted_failure\)/.test(l)), page.logs);
  page.logs = []; page.allowFail = [/^config\/category_registry\/list$/];
  await board(page).evaluate((b) => b._ws({ type: 'config/category_registry/list', scope: 'automation' }, { fallback: [] }));
  await page.waitForTimeout(300);
  check('J3 ... and not when the test expects that call to fail', page.logs.length === 0, page.logs);
  fake.answers = null;
});
test.afterAll(() => done());
