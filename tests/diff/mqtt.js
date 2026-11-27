// The differential test's MQTT entities (0.11.3), for the corpus and the random scenarios.
// An MQTT entity: its discovery config, the rule functions_board/sources gives for it (as sources.py makes it, which
// test_diff.py checks) and the state Home Assistant gives it before any message
function mq(id, cfg) {
  const dom = id.split('.')[0], get = (k, d) => (cfg[k] != null ? cfg[k] : d);
  const map = (m, more) => Object.assign({ how: 'map', map: m }, more);
  const how = {
    sensor: () => ({ how: 'sensor', numeric: !!(cfg.unit_of_measurement || cfg.state_class || (cfg.device_class && !['enum', 'timestamp', 'date'].includes(cfg.device_class))), options: [] }),
    binary_sensor: () => map({ [get('payload_on', 'ON')]: 'on', [get('payload_off', 'OFF')]: 'off', None: 'unknown' }, { blank: 'skip' }),
    switch: () => map({ [get('state_on', get('payload_on', 'ON'))]: 'on', [get('state_off', get('payload_off', 'OFF'))]: 'off', None: 'unknown' }),
    lock: () => map({ [get('state_locked', 'LOCKED')]: 'locked', [get('state_locking', 'LOCKING')]: 'locking', [get('state_unlocked', 'UNLOCKED')]: 'unlocked', [get('state_unlocking', 'UNLOCKING')]: 'unlocking', [get('state_open', 'OPEN')]: 'open', [get('state_opening', 'OPENING')]: 'opening', [get('state_jammed', 'JAMMED')]: 'jammed', [get('payload_reset', 'None')]: 'unknown' }, { blank: 'skip' }),
    cover: () => ({ how: 'cover', map: { [get('state_opening', 'opening')]: 'opening', [get('state_closing', 'closing')]: 'closing', [get('state_open', 'open')]: 'open', [get('state_closed', 'closed')]: 'closed', None: 'unknown' }, stopped: get('state_stopped', 'stopped'), position: cfg.position_topic != null }),
    select: () => ({ how: 'select', options: cfg.options || [] }),
    number: () => ({ how: 'number', min: get('min', 1), max: get('max', 100), reset: get('payload_reset', 'None') }),
    device_tracker: () => ({ how: 'tracker', map: { [get('payload_home', 'home')]: 'home', [get('payload_not_home', 'not_home')]: 'not_home', [get('payload_reset', 'None')]: 'unknown' } }),
    event: () => ({ how: 'event', types: cfg.event_types || [] }),
    light: () => ({ how: 'json_light' }),
  }[dom]();
  const rule = { kind: 'mqtt', domain: dom };
  const topics = [];
  if (cfg.state_topic) {
    rule.state = Object.assign({ topic: cfg.state_topic }, how);
    if (cfg.value_template) rule.state.tpl = cfg.value_template;
    topics.push(cfg.state_topic);
    if (dom === 'binary_sensor' && cfg.off_delay != null) rule.off_delay = cfg.off_delay;
    if ((dom === 'sensor' || dom === 'binary_sensor') && cfg.expire_after) rule.expire_after = cfg.expire_after;
  }
  if (dom === 'cover' && cfg.position_topic) {
    rule.position = { topic: cfg.position_topic, tpl: cfg.position_template || null, closed: get('position_closed', 0), open: get('position_open', 100), state: !!cfg.state_topic };
    topics.push(cfg.position_topic);
  }
  if (cfg.json_attributes_topic) { rule.attrs = { topic: cfg.json_attributes_topic, tpl: cfg.json_attributes_template || null }; topics.push(cfg.json_attributes_topic); }
  const avail = [];
  if (cfg.availability_topic) avail.push({ topic: cfg.availability_topic, on: get('payload_available', 'online'), off: get('payload_not_available', 'offline'), tpl: cfg.availability_template || null });
  (cfg.availability || []).forEach((a) => avail.push({ topic: a.topic, on: a.payload_available || 'online', off: a.payload_not_available || 'offline', tpl: a.value_template || null }));
  if (avail.length) { rule.avail = { mode: get('availability_mode', 'latest'), list: avail }; avail.forEach((a) => topics.push(a.topic)); }
  const first = avail.length || cfg.expire_after ? 'unavailable' : 'unknown';
  return { [id]: { config: cfg, rule, state: first } };
}

module.exports = { mq };
