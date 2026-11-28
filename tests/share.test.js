// Share a Function — YAML Package Export & Anonymizer Canary Tests (0.16.0).
// Run: node --test tests/share.test.js
const { exportFunctionPackage } = require('./lib/board-lib');
const { check } = require('./lib/check');

// Canary fixture with distinctive synthetic personal details (never real home names)
const CANARIES = [
  'Bramblewood', 'bramblewood', 'canary_shed', 'canary_phone', 'secret_door',
  'alex@canary-example.test', '192.168.77.42', 'AA:BB:CC:11:22:33',
  '+1-555-867-5309', 'tok_99887766554433221100abcd', 'custom/bramblewood_box/cmd',
  'Private alert copy for Alex', 'canary.internal.local',
];

const pkg = {
  name: 'Bramblewood Shed Alert',
  automations: [
    {
      entity_id: 'automation.bramblewood_door_open',
      cfg: {
        id: '1700000001234',
        alias: 'Bramblewood Secret Door Left Open',
        description: 'Notifies Alex when the canary_shed door is open.',
        triggers: [
          { trigger: 'state', entity_id: 'cover.secret_door', to: 'open', for: '00:10:00' },
          { trigger: 'mqtt', topic: 'zigbee2mqtt/bramblewood_box/set', payload: 'open' },
        ],
        conditions: [
          { condition: 'template', value_template: "{{ states('sensor.bramblewood_temp') | float(0) > 5 and 'cover.secret_door' in area_entities('canary_shed') }}" },
        ],
        actions: [
          {
            action: 'notify.mobile_app_canary_phone',
            data: {
              title: 'Bramblewood Alert',
              message: 'Private alert copy for Alex at https://canary.internal.local/cam (192.168.77.42, alex@canary-example.test, +1-555-867-5309, AA:BB:CC:11:22:33, tok_99887766554433221100abcd)',
            },
          },
          { action: 'light.turn_on', target: { area_id: 'canary_shed', device_id: 'dev_bramblewood_01' } },
        ],
      },
    },
  ],
  scripts: [
    {
      entity_id: 'script.bramblewood_notify',
      cfg: {
        alias: 'Bramblewood Notify Script',
        sequence: [{ action: 'light.turn_off', target: { entity_id: 'light.bramblewood_lamp' } }],
      },
    },
  ],
  helpers: [
    {
      entity_id: 'input_boolean.bramblewood_mute',
      dom: 'input_boolean',
      id: 'bramblewood_mute',
      cfg: { name: 'Bramblewood Mute', icon: 'mdi:bell-off' },
    },
  ],
  templates: [
    {
      entity_id: 'sensor.bramblewood_status',
      dom: 'sensor',
      name: 'Bramblewood Status',
      state: "{{ 'Open' if is_state('cover.secret_door', 'open') else 'Closed' }}",
      availability: "{{ has_value('cover.secret_door') }}",
    },
  ],
  entities: [
    { entity_id: 'cover.secret_door', name: 'Bramblewood Secret Door' },
    { entity_id: 'sensor.bramblewood_temp', name: 'Bramblewood Temp' },
    { entity_id: 'light.bramblewood_lamp', name: 'Bramblewood Lamp' },
  ],
  areas: [{ area_id: 'canary_shed', name: 'Bramblewood Shed' }],
  devices: [{ id: 'dev_bramblewood_01', name: 'Bramblewood Controller' }],
};

// 1. Anonymized export (default)
const anon = exportFunctionPackage(pkg, { anonymize: true });
check('anonymized package includes automation, script, input_boolean, and template sections',
  /^automation:/m.test(anon.yaml)
  && /^script:/m.test(anon.yaml)
  && /^input_boolean:/m.test(anon.yaml)
  && /^template:/m.test(anon.yaml),
  anon.yaml.slice(0, 400));

check('stats counts all 4 sections accurately',
  anon.stats.automations === 1 && anon.stats.scripts === 1 && anon.stats.helpers === 1 && anon.stats.templates === 1,
  anon.stats);

const leaked = CANARIES.filter((c) => anon.yaml.toLowerCase().includes(c.toLowerCase()));
check('zero privacy canaries leak in anonymized YAML export (entities, areas, emails, IPs, MACs, phones, tokens, URLs, copy)',
  leaked.length === 0,
  { leaked, yaml: anon.yaml });

check('preserves generic HA services like light.turn_on and light.turn_off',
  anon.yaml.includes('light.turn_on') && anon.yaml.includes('light.turn_off'),
  anon.yaml);

check('preserves consistent placeholder for cover.secret_door across automation and template',
  (anon.yaml.match(/cover\.cover_1/g) || []).length >= 3,
  anon.yaml);

check('includes placeholder checklist in header comment',
  anon.yaml.includes('# Placeholders to replace') && anon.placeholders.includes('cover.cover_1'),
  anon.placeholders);

// 2. Non-anonymized export preserves real names & entity IDs
const real = exportFunctionPackage(pkg, { anonymize: false });
check('non-anonymized export preserves real entity IDs and names',
  real.yaml.includes('cover.secret_door') && real.yaml.includes('Bramblewood Secret Door Left Open'),
  real.yaml.slice(0, 400));
check('filename uses function slug when not anonymized and shared_function when anonymized',
  anon.filename === 'shared_function.yaml' && real.filename === 'bramblewood_shed_alert.yaml',
  { anon: anon.filename, real: real.filename });
