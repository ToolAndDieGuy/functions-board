// Template Studio & 12 Recipes (0.15.0): Jinja parser, plain-English explainer, unavailable-trap linter & auto-fixes,
// live evaluation probe builder, config template extractor, all 9 Template Helper recipes, and both Automation recipes.
const { check } = require('./lib/check');
const {
  TPL_RECIPES, TPL_RECIPE_KINDS, TPL_GOAL_TREE, AUTO_RECIPE_KINDS, JINJA_GLOSSARY,
  parseTemplate, splitPipes, explainTemplate, lintTemplate, buildExplainProbe,
  extractTemplateEntities, extractTemplatesFromConfig, suggestStatesForEntities,
  cleanTplRecipe, generateTplRecipe, tplSame,
  cleanAutoRecipe, generateAutoRecipe, autoSame, cleanLayout,
} = require('./lib/board-lib');

// ---- 1. Tokenizer, pipe splitting & entity extraction ----
{
  const pipes = splitPipes("states('sensor.a') | default('a|b') | float(0) | round(1)");
  const topPipes = splitPipes("'a|b' | upper");
  check('0.15.0 splitPipes ignores pipes inside quoted strings',
    pipes.length === 4 && pipes[1] === "default('a|b')" && topPipes.length === 2 && topPipes[0] === "'a|b'", { pipes, topPipes });

  const tpl = "{% set t = states('sensor.room_temp') | float(0) %}{# comment #}{% if t > 22 %}Warm{% else %}{{ states.sensor.backup.state }}{% endif %}";
  const toks = parseTemplate(tpl);
  check('0.15.0 parseTemplate recognizes set, comment, if, text, else, expr, endif',
    toks.some((x) => x.kind === 'stmt' && x.tag === 'set' && x.varName === 't')
    && toks.some((x) => x.kind === 'comment')
    && toks.some((x) => x.kind === 'stmt' && x.tag === 'if')
    && toks.some((x) => x.kind === 'expr' && x.body === 'states.sensor.backup.state'), toks);

  const ents = extractTemplateEntities(tpl);
  check('0.15.0 extractTemplateEntities finds both states() and states.domain.entity forms',
    ents.includes('sensor.room_temp') && ents.includes('sensor.backup'), ents);
}

// ---- 2. Plain-English explainer & live clause probe ----
{
  const names = { 'cover.garage_door': 'Garage Door', 'sensor.kitchen_temp': 'Kitchen Temp' };
  const tpl = "{% set temp = states('sensor.kitchen_temp') | float(0) | round(1) %}\n{% if is_state('cover.garage_door', 'open') %}\n  {{ temp }}\n{% else %}\n  Closed\n{% endif %}";
  const exp = explainTemplate(tpl, (id) => names[id] || id);
  check('0.15.0 explainTemplate translates variables, filters, and conditions into plain English using friendly names',
    exp.clauses.length >= 4
    && /Kitchen Temp/.test(exp.clauses[0].english) && /decimal number/.test(exp.clauses[0].english)
    && /Garage Door is 'open'/.test(exp.clauses[1].english)
    && exp.concepts.some((c) => c.key === 'states')
    && exp.concepts.some((c) => c.key === 'float')
    && exp.concepts.some((c) => c.key === 'is_state'), exp);

  const probe = buildExplainProbe(exp.clauses);
  check('0.15.0 buildExplainProbe bundles evaluable clauses into one tojson template',
    !!probe && probe.indices.length >= 2 && /tojson/.test(probe.template), probe);
}

// ---- 3. Smart Linter & Unavailable-Trap auto-fixes ----
{
  const bad1 = "{{ states('sensor.temp') | float > 25 }}";
  const w1 = lintTemplate(bad1);
  const bare = w1.find((x) => x.id === 'bare_num');
  check('0.15.0 linter catches bare | float without default and auto-fixes to | float(0)',
    !!bare && bare.fix(bad1) === "{{ states('sensor.temp') | float(0) > 25 }}", w1);

  const bad2 = "{{ states.sensor.garage_temp.state }}";
  const w2 = lintTemplate(bad2);
  const dot = w2.find((x) => x.id === 'states_dot');
  check('0.15.0 linter catches states.domain.entity.state and auto-fixes to states(\'...\')',
    !!dot && dot.fix(bad2) === "{{ states('sensor.garage_temp') }}", w2);

  const bad3 = "{{ states('sensor.power') > 100 }}";
  const w3 = lintTemplate(bad3);
  const sm = w3.find((x) => x.id === 'str_math');
  check('0.15.0 linter catches string-vs-number comparison on states() and auto-fixes with | float(0)',
    !!sm && sm.fix(bad3) === "{{ states('sensor.power') | float(0) > 100 }}", w3);

  const bad4 = "{{ states('sensor.raw_a') }}";
  const w4 = lintTemplate(bad4);
  const unav = w4.find((x) => x.id === 'unavail_trap');
  check('0.15.0 linter warns on unguarded states() and suggests has_value() availability template',
    !!unav && unav.suggestAvail === "{{ has_value('sensor.raw_a') }}", w4);

  const bad5 = "{% if is_state('light.a', 'on') %}On";
  const w5 = lintTemplate(bad5);
  check('0.15.0 linter catches unclosed if block',
    w5.some((x) => x.id === 'missing_end_if' && x.sev === 'error'), w5);
}

// ---- 4. Extract templates from automation/script configs ----
{
  const cfg = {
    alias: 'Test auto',
    triggers: [{ trigger: 'template', value_template: "{{ states('sensor.a') | float(0) > 10 }}" }],
    conditions: [{ condition: 'template', value_template: "{{ is_state('input_boolean.ok', 'on') }}" }],
    actions: [{ action: 'notify.mobile_app_phone', data: { message: "Value is {{ states('sensor.a') }}" } }],
  };
  const found = extractTemplatesFromConfig(cfg);
  check('0.15.0 extractTemplatesFromConfig finds trigger, condition, and action templates',
    found.length === 3 && found.every((x) => x.place && x.template.includes('{{')), found);
}

// ---- 5. All 17 Template Helper Recipes, Big-to-Small Goal Tree, Smart States & 32-Concept Glossary ----
{
  check('0.15.0 all 17 Template Helper recipes are registered and mapped across all 4 creator goals in TPL_GOAL_TREE',
    TPL_RECIPE_KINDS.size === 17
    && TPL_GOAL_TREE.length === 4
    && [...TPL_RECIPE_KINDS].every((k) => TPL_GOAL_TREE.some((g) => g.kinds.includes(k))), [...TPL_RECIPE_KINDS]);

  check('0.15.0 every JINJA_GLOSSARY entry (32 concepts) has plainName, what, why, example, and snippet()',
    Object.keys(JINJA_GLOSSARY).length === 32
    && ['as_datetime', 'as_local', 'timedelta', 'strftime', 'relative_time', 'abs', 'average', 'bool', 'replace'].every((k) => !!JINJA_GLOSSARY[k])
    && Object.values(JINJA_GLOSSARY).every((v) => v.plainName && v.what && v.why && v.example && typeof v.snippet === 'function' && v.snippet('sensor.temp').length > 0));

  check('0.15.0 suggestStatesForEntities infers domain-appropriate states for covers, locks, people, and lights',
    suggestStatesForEntities(['cover.garage']).includes('open')
    && suggestStatesForEntities(['lock.front']).includes('unlocked')
    && suggestStatesForEntities(['person.sam']).includes('home')
    && suggestStatesForEntities(['light.hall']).includes('on'));

  const rCmpNum = generateTplRecipe('tpl_compare', { mode: 'threshold', entityA: 'sensor.temp', op: 'between', value: 18, valueMax: 24 });
  const rCmpEnt = generateTplRecipe('tpl_compare', { mode: 'entities', entityA: 'sensor.in', op: 'gt', entityB: 'sensor.out' });
  check('0.15.0 #11 Compare recipe handles numeric range and two-sensor comparison with float(0) & has_value()',
    rCmpNum.domain === 'binary_sensor' && rCmpNum.state.includes('18 <= v <= 24') && rCmpNum.availability === "{{ has_value('sensor.temp') }}"
    && rCmpEnt.state.includes('a > b') && rCmpEnt.availability.includes("has_value('sensor.out')"), { rCmpNum, rCmpEnt });

  const rMsg = generateTplRecipe('tpl_message', { parts: [{ text: 'Garage: ', entity: 'cover.garage', fallback: 'offline' }, { text: ' · Inside: ', entity: 'sensor.temp', fallback: 'offline' }] });
  check('0.15.0 #12 Custom text summary recipe builds readable sentence with has_value() guards',
    rMsg.domain === 'sensor' && rMsg.state.includes("Garage: {{ states('cover.garage') if has_value('cover.garage') else 'offline' }}"), rMsg);

  const rCount = generateTplRecipe('tpl_count', { scope: 'entities', entities: ['light.a', 'light.b'], states: ['on'], format: 'phrase', phrase: '{n} lights on' });
  const rCountLbl = generateTplRecipe('tpl_count', { scope: 'label', label: 'garage', domain: 'light', states: ['on'] });
  check('0.15.0 #2 Count recipe generates valid Jinja for entities and label scopes with unavailable filter',
    rCount.domain === 'sensor' && rCount.state.includes("rejectattr('state', 'in', ['unavailable', 'unknown'])") && rCount.state.includes("lights on") && rCount.availability.includes("has_value('light.a')")
    && rCountLbl.state.includes("label_entities('garage')"), { rCount, rCountLbl });

  const rAny = generateTplRecipe('tpl_any_all', { entities: ['binary_sensor.d1', 'binary_sensor.d2'], mode: 'any', states: ['on'] });
  const rAll = generateTplRecipe('tpl_any_all', { entities: ['binary_sensor.d1', 'binary_sensor.d2'], mode: 'all', states: ['off'], requireAllAvailable: true });
  check('0.15.0 #3 Any/all recipe generates binary_sensor for both any and all modes',
    rAny.domain === 'binary_sensor' && rAny.state.includes('matched | count > 0')
    && rAll.state.includes('matched | count == valid | count') && rAll.availability.includes(' and '), { rAny, rAll });

  const rList = generateTplRecipe('tpl_list_names', { entities: ['cover.garage', 'binary_sensor.back'], states: ['open', 'on'], prefix: 'Open: ', emptyText: 'All closed' });
  check('0.15.0 #4 List names recipe maps friendly names and handles empty fallback',
    rList.state.includes("map(attribute='name')") && rList.state.includes('All closed') && rList.state.includes('Open: '), rList);

  const rDur = generateTplRecipe('tpl_duration', { entity: 'cover.garage', targetState: 'open', format: 'readable', inactiveText: 'Closed' });
  check('0.15.0 #5 Duration recipe guards last_changed and availability',
    rDur.state.includes('as_timestamp(now())') && rDur.state.includes('int(0)') && rDur.availability === "{{ has_value('cover.garage') }}", rDur);

  const rFb = generateTplRecipe('tpl_fallback', { entities: ['sensor.primary', 'sensor.backup'], fallback: '0', numeric: true, round: 1 });
  check('0.15.0 #6 Fallback recipe chains has_value() with primary then backup',
    rFb.state.includes("if has_value('sensor.primary')") && rFb.state.includes("elif has_value('sensor.backup')") && rFb.state.includes('float(0)'), rFb);

  const rBat = generateTplRecipe('tpl_low_battery', { threshold: 15, scope: 'all', output: 'both', emptyText: 'All OK' });
  check('0.15.0 #7 Low batteries recipe scans battery device_class and guards float(100) against unavailable',
    rBat.state.includes("eq', 'battery'") && rBat.state.includes('float(100) < 15') && rBat.state.includes('namespace(low=[])'), rBat);

  const rBand = generateTplRecipe('tpl_band', { entity: 'sensor.temp', bands: [{ max: 18, label: 'Cold' }, { max: 24, label: 'Comfortable' }], aboveLabel: 'Warm' });
  check('0.15.0 #8 Comfort band recipe orders bands with float(0) and availability',
    rBand.state.includes('v <= 18') && rBand.state.includes('v <= 24') && rBand.state.includes('Warm') && rBand.availability === "{{ has_value('sensor.temp') }}", rBand);

  const rMath = generateTplRecipe('tpl_math', { entities: ['sensor.t1', 'sensor.t2'], op: 'mean', round: 2, unit: '°C' });
  const rDiff = generateTplRecipe('tpl_math', { entities: ['sensor.in', 'sensor.out'], op: 'diff', round: 1, unit: '°C' });
  check('0.15.0 #9 Math recipe skips non-numeric sensors for mean and computes safe diff',
    rMath.state.includes("map('float', none) | reject('none')") && rDiff.state.includes("states('sensor.in') | float(0) - states('sensor.out') | float(0)"), { rMath, rDiff });

  const rWin = generateTplRecipe('tpl_time_window', { from: '22:00', to: '07:00', days: [0, 1, 2, 3, 4] });
  check('0.15.0 #10 Time window recipe handles overnight wrap and weekday filter',
    rWin.domain === 'binary_sensor' && rWin.state.includes("now() >= today_at('22:00') or now() < today_at('07:00')") && rWin.state.includes('now().weekday() in [0, 1, 2, 3, 4]'), rWin);

  // #13 Sun offset (including "16 hours before sunset" as timestamp, 12h clock, after-sunset timestamp, and binary window)
  const rSunTs = generateTplRecipe('tpl_sun_offset', { event: 'next_setting', dir: 'before', hours: 16, minutes: 0, output: 'timestamp' });
  const rSun12 = generateTplRecipe('tpl_sun_offset', { event: 'next_setting', dir: 'before', hours: 16, minutes: 0, output: 'clock12' });
  const rSunAfterTs = generateTplRecipe('tpl_sun_offset', { event: 'next_setting', dir: 'after', hours: 2, minutes: 0, output: 'timestamp' });
  const rSunAfterBin = generateTplRecipe('tpl_sun_offset', { event: 'next_rising', dir: 'after', hours: 0, minutes: 30, output: 'binary' });
  const sunExp = explainTemplate(rSun12.state);
  check('0.15.0 #13 Sun offset handles 16h before sunset (timestamp/clock12) and after-event rollover without breaking time triggers',
    rSunTs.domain === 'sensor' && rSunTs.device_class === 'timestamp' && rSunTs.state.includes('timedelta(hours=16)') && rSunTs.state.includes('target.isoformat()') && !rSunTs.state.includes('now()')
    && rSun12.device_class === '' && rSun12.state.includes("strftime('%I:%M %p')")
    && rSunAfterTs.device_class === 'timestamp' && rSunAfterTs.state.includes('timedelta(days=1)')
    && rSunAfterBin.domain === 'binary_sensor' && rSunAfterBin.state.includes('prev_dt <= now() < target')
    && ['as_local', 'as_datetime', 'timedelta', 'strftime'].every((k) => sunExp.concepts.some((c) => c.key === k)),
    { rSunTs, rSun12, rSunAfterTs, rSunAfterBin, concepts: sunExp.concepts.map((c) => c.key) });

  // #14 Countdown
  const rCdCal = generateTplRecipe('tpl_countdown', { source: 'entity', entity: 'calendar.family', dir: 'until', unit: 'days' });
  const rCdFix = generateTplRecipe('tpl_countdown', { source: 'fixed', dateStr: '2027-01-01', dir: 'until', unit: 'readable' });
  check('0.15.0 #14 Countdown recipe handles calendar start_time and fixed dates in numeric and readable units',
    rCdCal.unit === 'd' && rCdCal.device_class === 'duration' && rCdCal.state.includes("state_attr('calendar.family', 'start_time')")
    && rCdFix.unit === '' && rCdFix.state.includes("as_datetime('2027-01-01')") && rCdFix.state.includes('secs | abs'), { rCdCal, rCdFix });

  // #15 Attribute extraction
  const rAttrPct = generateTplRecipe('tpl_attribute', { entity: 'light.kitchen', attr: 'brightness', transform: 'pct255' });
  const rAttrTitle = generateTplRecipe('tpl_attribute', { entity: 'climate.home', attr: 'hvac_action', transform: 'title', fallback: 'Idle' });
  check('0.15.0 #15 Attribute recipe converts 0-255 brightness to % and formats raw attributes with fallback',
    rAttrPct.unit === '%' && rAttrPct.state.includes('/ 255 * 100') && rAttrPct.state_class === 'measurement'
    && rAttrTitle.state.includes("replace('_', ' ') | title") && rAttrTitle.state.includes("'Idle'"), { rAttrPct, rAttrTitle });

  // #16 Scale / convert
  const rScaleKw = generateTplRecipe('tpl_scale', { entity: 'sensor.house_power', preset: 'w_to_kw', round: 2 });
  const rScaleTemp = generateTplRecipe('tpl_scale', { entity: 'sensor.temp_c', preset: 'c_to_f', round: 1 });
  const rScaleCustom = generateTplRecipe('tpl_scale', { entity: 'sensor.raw', preset: 'custom', mult: 1.5, offset: -2, round: 1, unit: 'pts' });
  check('0.15.0 #16 Scale recipe converts W->kW, C->F, and custom formulas with matching unit & device_class',
    rScaleKw.unit === 'kW' && rScaleKw.device_class === 'power' && rScaleKw.state.includes('(v / 1000)')
    && rScaleTemp.unit === '°F' && rScaleTemp.device_class === 'temperature'
    && rScaleCustom.unit === 'pts' && rScaleCustom.state.includes('(v * 1.5 - 2)'), { rScaleKw, rScaleTemp, rScaleCustom });

  // #17 Multi-condition AND / OR logic
  const rLogicBin = generateTplRecipe('tpl_logic', { join: 'and', rules: [{ entity: 'cover.garage', op: 'eq', value: 'open' }, { entity: 'sensor.temp', op: 'gt', value: '25' }], asText: false });
  const rLogicTxt = generateTplRecipe('tpl_logic', { join: 'or', rules: [{ entity: 'cover.garage', op: 'eq', value: 'open' }, { entity: 'sensor.temp', op: 'avail', value: '' }], asText: true, trueText: 'Check', falseText: 'OK' });
  check('0.15.0 #17 Logic recipe combines multi-entity rules with AND/OR as binary_sensor or custom text sensor',
    rLogicBin.domain === 'binary_sensor' && rLogicBin.state.includes('c1 and c2') && rLogicBin.state.includes('float(0) > 25')
    && rLogicTxt.domain === 'sensor' && rLogicTxt.state.includes("'Check' if (c1 or c2) else 'OK'") && rLogicTxt.state.includes("has_value('sensor.temp')"), { rLogicBin, rLogicTxt });

  // #18 Map / rename states
  const rMap = generateTplRecipe('tpl_map_state', { entity: 'alarm_control_panel.home', rows: [{ from: 'armed_away', to: 'Armed Away' }, { from: 'disarmed', to: 'Disarmed' }], fallback: 'Other' });
  check('0.15.0 #18 Map-state recipe translates raw states via dict lookup with fallback and availability guard',
    rMap.domain === 'sensor' && rMap.state.includes("'armed_away': 'Armed Away'") && rMap.state.includes("labels.get(states('alarm_control_panel.home'), 'Other')") && rMap.availability === "{{ has_value('alarm_control_panel.home') }}", rMap);

  // Every generated template across all 17 recipes passes our own linter with zero errors and zero bare_num / states_dot warnings!
  const samples = [rCount, rCountLbl, rAny, rAll, rList, rDur, rFb, rBat, rBand, rMath, rDiff, rWin, rCmpNum, rCmpEnt, rMsg, rSunTs, rSun12, rSunAfterTs, rSunAfterBin, rCdCal, rCdFix, rAttrPct, rAttrTitle, rScaleKw, rScaleTemp, rScaleCustom, rLogicBin, rLogicTxt, rMap];
  const badLint = samples.flatMap((r) => lintTemplate(r.state).filter((w) => w.sev === 'error' || w.id === 'bare_num' || w.id === 'states_dot'));
  check('0.15.0 all 17 generated Template Helper recipes pass Template Studio linter cleanly', badLint.length === 0, badLint);

  // Reopen matcher: matches with whitespace differences, fails when hand-edited
  const spec = cleanTplRecipe('tpl_count', { scope: 'entities', entities: ['light.a'], states: ['on'] });
  check('0.15.0 tplSame matches generated template (whitespace-insensitive) and rejects hand edits',
    tplSame(generateTplRecipe('tpl_count', spec).state.replace(/\n/g, '   '), 'tpl_count', spec)
    && !tplSame('{{ 42 }}', 'tpl_count', spec));
}

// ---- 6. Automation Recipes (#11 Left-open alert, #12 Motion light) + cleanLayout ----
{
  check('0.15.0 both Automation recipes are registered', AUTO_RECIPE_KINDS.size === 2, [...AUTO_RECIPE_KINDS]);

  const loSpec = cleanAutoRecipe('auto_left_open', {
    entity: 'cover.garage_door', state: 'open', minutes: 15, repeat: 10,
    conditionEntity: 'input_boolean.alerts', then: [{ action: 'script.notify_garage' }], cleared: [{ action: 'script.notify_clear' }],
  });
  const loCfg = generateAutoRecipe('auto_left_open', loSpec, { alias: 'Garage left open' });
  check('0.15.0 #11 Left-open recipe builds standard HA automation with for-trigger, repeat, and cleared wait',
    loCfg.mode === 'restart'
    && loCfg.triggers[0].entity_id === 'cover.garage_door' && loCfg.triggers[0].for.minutes === 15
    && loCfg.conditions.length === 1
    && !!loCfg.actions[0].repeat
    && !!loCfg.actions[1].wait_for_trigger
    && autoSame(loCfg, 'auto_left_open', loSpec)
    && !autoSame(Object.assign({}, loCfg, { mode: 'single' }), 'auto_left_open', loSpec), loCfg);

  const mlSpec = cleanAutoRecipe('auto_motion_light', {
    sensors: ['binary_sensor.hall_motion'], lights: ['light.hall'], timeout: 5,
    onlyDark: true, luxEntity: 'sensor.hall_lux', luxBelow: 30, brightness: 80, overrideEntity: 'input_boolean.hall_hold',
  });
  const mlCfg = generateAutoRecipe('auto_motion_light', mlSpec, { alias: 'Hall motion light' });
  check('0.15.0 #12 Motion light recipe builds standard HA automation with dark/lux/override guards and idle off',
    mlCfg.triggers.length === 2 && mlCfg.triggers[1].for.minutes === 5
    && mlCfg.conditions[0].entity_id === 'input_boolean.hall_hold'
    && mlCfg.actions[0].choose[0].sequence[0].data.brightness_pct === 80
    && autoSame(mlCfg, 'auto_motion_light', mlSpec), mlCfg);

  // cleanLayout retains notify, template helper, and automation recipe builder specs and drops invalid entries
  const lay = cleanLayout({
    builders: {
      'sensor.doors_open': { kind: 'tpl_count', spec: { scope: 'entities', entities: ['binary_sensor.d1'], states: ['on'] } },
      'automation.hall_motion': { kind: 'auto_motion_light', spec: mlSpec },
      'light.bogus': { kind: 'tpl_count', spec: {} },
    },
  });
  check('0.15.0 cleanLayout keeps valid template helper and automation recipe specs and drops invalid domains',
    !!lay.builders['sensor.doors_open'] && !!lay.builders['automation.hall_motion'] && !lay.builders['light.bogus'], lay.builders);
}
