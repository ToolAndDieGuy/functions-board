// The isolation fixture (tests/e2e/fixtures.js), proven: a test that changes Home Assistant and then fails half
// way leaves nothing behind for the next test. Runs in order, without a browser.
const { test, expect } = require('./fixtures');
const ha = require('./ha-api');
const { suite } = require('./lib');
const { check, done } = suite('isolation');

const LEFT = 'automation.garage_left_open', SCRIPT = 'close_garage';
let before = null;

test('a test that changes things and fails half way', async () => {
  test.fail(true, 'planted: it throws after its changes');
  before = { left: (await ha.rest('GET', 'states/' + LEFT)).state, script: await ha.rest('GET', 'config/script/config/' + SCRIPT) };
  await ha.rest('POST', 'config/automation/config/fbleak1', { alias: 'Leak test', triggers: [{ trigger: 'event', event_type: 'fb_leak' }], actions: [] });
  await ha.rest('POST', 'config/script/config/' + SCRIPT, Object.assign({}, before.script, { sequence: [] }));
  await ha.rest('POST', 'services/automation/turn_' + (before.left === 'on' ? 'off' : 'on'), { entity_id: LEFT });
  await ha.ws({ type: 'config/label_registry/create', name: 'Leak label' });
  await ha.ws({ type: 'functions_board/set', data: { v: 1, functions: ['leak'], layouts: {} } });
  await new Promise((r) => setTimeout(r, 1500));
  throw new Error('planted failure, after changing Home Assistant');
});

test('the next test finds everything as it was', async () => {
  expect(before, 'the first test ran').toBeTruthy();
  const states = await ha.rest('GET', 'states');
  check('isolation: an automation a failed test added is gone', !states.some((s) => s.attributes && s.attributes.id === 'fbleak1'));
  const script = await ha.rest('GET', 'config/script/config/' + SCRIPT);
  check('isolation: a script it changed is back as it was', JSON.stringify(script) === JSON.stringify(before.script), script);
  check('isolation: an automation it switched is back on or off as before', (await ha.rest('GET', 'states/' + LEFT)).state === before.left);
  check('isolation: its label is gone', !(await ha.ws({ type: 'config/label_registry/list' })).some((l) => l.name === 'Leak label'));
  const store = await ha.ws({ type: 'functions_board/get' });
  check('isolation: the board\'s data it wrote is cleared', !((store.data || {}).functions || []).includes('leak'), store.data);
});
test.afterAll(() => done());
