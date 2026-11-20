// The isolation fixture (tests/e2e/fixtures.js), proven: a test that changes Home Assistant and then fails half
// way leaves nothing behind for the next test. Runs in order, without a browser.
const { test, expect } = require('./fixtures');
const ha = require('./ha-api');
const { suite } = require('./lib');
const { check, done } = suite('isolation');

const LEFT = 'automation.garage_left_open', SCRIPT = 'close_garage', LAMP = 'light.bed_light';
let before = null;
const regOf = async () => {
  const [ents, devs, areas] = await ha.ws({ type: 'config/entity_registry/list' }, { type: 'config/device_registry/list' }, { type: 'config/area_registry/list' });
  const e = ents.find((x) => x.entity_id === LAMP), d = e && devs.find((x) => x.id === e.device_id);
  return { name: e ? e.name : undefined, icon: e ? e.icon : undefined, devArea: d ? d.area_id : undefined, devName: d ? d.name_by_user : undefined, dev: d && d.id, areas: areas.map((a) => a.area_id).sort() };
};

test('a test that changes things and fails half way', async () => {
  test.fail(true, 'planted: it throws after its changes');
  before = { left: (await ha.rest('GET', 'states/' + LEFT)).state, script: await ha.rest('GET', 'config/script/config/' + SCRIPT) };
  await ha.rest('POST', 'config/automation/config/fbleak1', { alias: 'Leak test', triggers: [{ trigger: 'event', event_type: 'fb_leak' }], actions: [] });
  await ha.rest('POST', 'config/script/config/' + SCRIPT, Object.assign({}, before.script, { sequence: [] }));
  await ha.rest('POST', 'services/automation/turn_' + (before.left === 'on' ? 'off' : 'on'), { entity_id: LEFT });
  await ha.ws({ type: 'config/label_registry/create', name: 'Leak label' });
  await ha.ws({ type: 'functions_board/set', data: { v: 1, functions: ['leak'], layouts: {} } });
  // a helper and a scene of its own; an area, with a device moved into it; an entity renamed
  before.reg = await regOf();
  await ha.ws({ type: 'input_boolean/create', name: 'Leak switch' });
  await ha.rest('POST', 'config/scene/config/fbleakscene', { name: 'Leak scene', entities: { [LAMP]: { state: 'on' } } });
  const area = await ha.ws({ type: 'config/area_registry/create', name: 'Leak room' });
  if (before.reg.dev) await ha.ws({ type: 'config/device_registry/update', device_id: before.reg.dev, area_id: area.area_id, name_by_user: 'Leak lamp' });
  await ha.ws({ type: 'config/entity_registry/update', entity_id: LAMP, name: 'Leak light', icon: 'mdi:flask' });
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
  check('isolation: a helper it made is gone', !(await ha.ws({ type: 'input_boolean/list' })).some((h) => h.name === 'Leak switch'));
  check('isolation: a scene it made is gone', !states.some((s) => s.attributes && s.attributes.id === 'fbleakscene'));
  const reg = await regOf();
  check('isolation: an entity it renamed has its name and icon back', reg.name === before.reg.name && reg.icon === before.reg.icon, { was: before.reg, now: reg });
  check('isolation: a device it moved and renamed is back in its area, with its name', !!before.reg.dev && reg.devArea === before.reg.devArea && reg.devName === before.reg.devName, { was: before.reg, now: reg });
  check('isolation: an area it made is gone', JSON.stringify(reg.areas) === JSON.stringify(before.reg.areas), { was: before.reg.areas, now: reg.areas });
});
test.afterAll(() => done());
