// Plain-English version diffs (0.16.0). Run: node --test tests/ver_diff.test.js
const { diffConfigs, diffSnapshots, fmtDiffDur } = require('./lib/board-lib');
const { check } = require('./lib/check');

// 1. Duration formatting
check('fmtDiffDur formats HH:MM:SS, objects, and numbers cleanly',
  fmtDiffDur('00:15:00') === '15 min'
  && fmtDiffDur({ minutes: 10 }) === '10 min'
  && fmtDiffDur({ hours: 1, minutes: 30 }) === '1 h 30 min'
  && fmtDiffDur(45) === '45 s',
  [fmtDiffDur('00:15:00'), fmtDiffDur({ minutes: 10 }), fmtDiffDur({ hours: 1, minutes: 30 }), fmtDiffDur(45)]);

// 2. Identical configs produce no diffs (even with reordered keys)
const baseAuto = {
  alias: 'Garage Light',
  mode: 'single',
  triggers: [{ trigger: 'state', entity_id: 'binary_sensor.motion', to: 'on', for: '00:10:00' }],
  conditions: [{ condition: 'time', after: '22:00:00', before: '06:00:00' }],
  actions: [{ delay: '00:10:00' }, { action: 'light.turn_on', target: { entity_id: 'light.garage' }, data: { brightness: 120 } }],
};
check('identical configs produce empty diff', diffConfigs(baseAuto, JSON.parse(JSON.stringify(baseAuto)), 'automation').length === 0);

// 3. Delay & trigger `for:` wait changes produce plain-English sentences
const changedAuto = {
  alias: 'Garage Light',
  mode: 'restart',
  triggers: [
    { trigger: 'state', entity_id: 'binary_sensor.motion', to: 'on', for: '00:15:00' },
    { trigger: 'time', at: '07:00:00' },
  ],
  conditions: [{ condition: 'time', after: '21:00:00', before: '06:00:00' }],
  actions: [
    { delay: '00:15:00' },
    { action: 'light.turn_on', target: { entity_id: 'light.garage' }, data: { brightness: 220 } },
    { action: 'notify.mobile_app', data: { message: 'Done' } },
  ],
};
const lines = diffConfigs(baseAuto, changedAuto, 'automation');
const texts = lines.map((l) => l.text);
check('reports run mode change in plain English', texts.some((t) => /Run mode changed from single to restart/i.test(t)), texts);
check('reports wait duration change ("Waits 15 min instead of 10 min")', texts.some((t) => /Waits 15 min instead of 10 min/i.test(t)), texts);
check('reports added time trigger', lines.some((l) => l.kind === 'added' && l.area === 'trigger' && /07:00:00/.test(l.text)), lines);
check('reports time window condition change', texts.some((t) => /Time window.*after 22:00:00.*after 21:00:00/i.test(t)), texts);
check('reports action parameter change (brightness 120 -> 220)', texts.some((t) => /brightness.*120.*220/i.test(t)), texts);
check('reports added action', lines.some((l) => l.kind === 'added' && l.area === 'action' && /notify\.mobile_app/.test(l.text)), lines);

// 4. Helper diffs (input_select options, timer duration, input_number range)
const selDiff = diffConfigs({ name: 'Mode', options: ['Home', 'Away'] }, { name: 'Mode', options: ['Home', 'Vacation'] }, 'input_select');
check('helper option additions and removals are listed plainly',
  selDiff.some((l) => l.kind === 'added' && /Vacation/.test(l.text))
  && selDiff.some((l) => l.kind === 'removed' && /Away/.test(l.text)),
  selDiff);

const timerDiff = diffConfigs({ name: 'Fan timer', duration: '00:05:00' }, { name: 'Fan timer', duration: '00:20:00' }, 'timer');
check('timer duration change reads plainly', timerDiff.some((l) => /Waits 20 min instead of 5 min/i.test(l.text)), timerDiff);

// 5. Full snapshot diff: added member, removed member, changed item, layout change
const snapA = {
  members: ['automation.a', 'input_boolean.old'],
  items: {
    'automation.a': { dom: 'automation', name: 'A', cfg: baseAuto },
    'input_boolean.old': { dom: 'input_boolean', name: 'Old Flag', cfg: { name: 'Old Flag' } },
  },
  layout: { nodes: { 'automation.a': { x: 0, y: 0 } } },
};
const snapB = {
  members: ['automation.a', 'script.new_one'],
  items: {
    'automation.a': { dom: 'automation', name: 'A', cfg: changedAuto },
    'script.new_one': { dom: 'script', name: 'New Script', cfg: { alias: 'New Script', sequence: [] } },
  },
  layout: { nodes: { 'automation.a': { x: 100, y: 50 } } },
};
const sd = diffSnapshots(snapA, snapB);
check('diffSnapshots detects added, removed, changed items and layout change',
  sd.items.some((x) => x.key === 'script.new_one' && x.status === 'added')
  && sd.items.some((x) => x.key === 'input_boolean.old' && x.status === 'removed')
  && sd.items.some((x) => x.key === 'automation.a' && x.status === 'changed' && x.lines.length >= 4)
  && sd.layoutChanged === true,
  sd);
