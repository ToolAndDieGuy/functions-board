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
test.afterAll(() => done());
