// The builders (0.11.3): the notification builder's script, made from a spec, and run in the sandbox engine.
// Run: node --test tests/builder.test.js. Templates go to a stand-in that knows the forms the builder writes;
// tests/e2e/builder.test.js has Home Assistant itself take the script and render them.

const lib = require('./lib/board-lib');
const { cleanNotify, notifyScript, nbSame, nbDesc, notifyTargets, slugify, cleanLayout, Sandbox, localAt, T } = lib;
const { check } = require('./lib/check');

const TZ = 'America/New_York';
const at = (hhmm) => localAt(Date.parse('2026-11-17T12:00:00Z'), hhmm.split(':').map(Number), TZ);
const S = (state, attributes) => ({ state, attributes: attributes || {}, last_changed: '2026-11-17T10:00:00Z', last_updated: '2026-11-17T10:00:00Z' });
const MIN = 60000;

// the template forms the builder writes, read from the run's variables and the sandbox's clock
function stub(sb) {
  const hm = () => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(sb.now));
  return async (t, v) => {
    v = v || {};
    let m;
    if ((m = /^\{\{ 'fb_' ~ context\.id \}\}$/.exec(t))) return v.context ? { ok: true, value: 'fb_' + v.context.id } : { ok: false, err: "'context' is undefined" };
    if ((m = /^\{\{ fb_id \}\}(_\d)?$/.exec(t))) return { ok: true, value: v.fb_id + (m[1] || '') };
    if ((m = /^\{\{ wait\.trigger is not none and wait\.trigger\.id == '(b\d)' \}\}$/.exec(t))) return { ok: true, value: !!(v.wait && v.wait.trigger && v.wait.trigger.id === m[1]) };
    if ((m = /^\{\{ now\(\) >= today_at\('(\d\d:\d\d)'\) or now\(\) < today_at\('(\d\d:\d\d)'\) \}\}$/.exec(t))) return { ok: true, value: hm() >= m[1] || hm() < m[2] };
    if ((m = /^\{\{ today_at\('(\d\d:\d\d)'\) <= now\(\) < today_at\('(\d\d:\d\d)'\) \}\}$/.exec(t))) return { ok: true, value: m[1] <= hm() && hm() < m[2] };
    if (t === '{{ not fb_quiet }}') return { ok: true, value: !v.fb_quiet };
    if ((m = /^\{\{ '([^']*)' if fb_quiet else '([^']*)' \}\}$/.exec(t))) return { ok: true, value: v.fb_quiet ? m[1] : m[2] };
    return { ok: false, err: 'unknown to the stub: ' + t };
  };
}
function make(states, cfg, now) {
  let sb;
  sb = new Sandbox({
    states, items: [{ id: 'script.n', cfg }], now: now || at('20:00'), tz: TZ,
    tpl: (t, v) => stub(sb)(t, v), ask: async () => true, name: (id) => id, condText: (c) => c.condition || 'condition',
  });
  return sb;
}
const calls = (sb) => sb.log.filter((e) => e.kind === 'call');
const errs = (sb) => sb.log.filter((e) => e.kind === 'run' && e.outcome === 'error');

const IOS = { svc: 'mobile_app_ann_iphone', os: 'ios', name: 'Ann iPhone' };
const PIX = { svc: 'mobile_app_bob_pixel', os: 'android', name: 'Bob Pixel' };
const base = {
  title: 'Garage', message: 'The garage is open',
  people: [{ id: 'person.ann', phones: [IOS] }, { id: 'person.bob', away: true, phones: [PIX] }],
  buttons: [{ title: 'Close it', then: [{ action: 'cover.close_cover', target: { entity_id: 'cover.garage' } }] }, { title: 'Leave it', then: [] }],
  timeout: [{ action: 'light.turn_on', target: { entity_id: 'light.porch' } }], wait: 15,
};
const home = { 'cover.garage': S('open'), 'light.porch': S('off'), 'person.ann': S('home'), 'person.bob': S('not_home'), 'zone.home': S('1'), 'script.n': S('off') };

// ---- the spec as kept
{
  const c = cleanNotify({ title: 'x'.repeat(500), level: 'loud', tag: 'a b/c', buttons: [{ title: ' ' }, { title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }], wait: 99999,
    phones: [{ svc: 'mobile_app_x', os: 'ios' }, { svc: 'telegram' }], people: [{ id: 'light.x' }, { id: 'person.p', phones: [{ svc: 'mobile_app_y' }] }], speakers: ['media_player.k', 'media_player.k', 'switch.s'], tts: 'media_player.t', quiet: { from: '22:00', to: '22:00' } });
  check('0.11.3 builder: a kept spec is only what it can be (lengths, levels, a tag a word, three buttons, a phone the mobile app\'s)',
    c.title.length === 200 && c.level === 'normal' && c.tag === 'abc' && c.buttons.map((b) => b.title).join() === 'One,Two,Three' && c.wait === 1440
    && c.phones.length === 1 && c.phones[0].os === 'ios' && c.people.length === 1 && c.people[0].phones[0].os === 'android' && c.speakers.join() === 'media_player.k' && c.tts === null && c.quiet === null, c);
  const L = cleanLayout({ builders: { 'script.n': { kind: 'notify', spec: { message: 'm' } }, 'light.x': { kind: 'notify', spec: {} }, 'script.o': { kind: 'other' } } });
  check('0.11.3 builder: a layout keeps a script\'s builder, cleaned, and nothing else there', Object.keys(L.builders).join() === 'script.n' && L.builders['script.n'].spec.message === 'm' && L.builders['script.n'].spec.kind === 'notify', L.builders);
}

// ---- the script it makes
{
  const cfg = notifyScript(base, { alias: 'Garage open', description: 'Tells us' });
  const txt = JSON.stringify(cfg);
  check('0.11.3 builder: an ordinary script: its name, the description saying how it was made, parallel runs', cfg.alias === 'Garage open' && cfg.description === 'Tells us\n\n' + T('nb_mark') && cfg.mode === 'parallel' && cfg.max === 10 && Array.isArray(cfg.sequence));
  check('0.11.3 builder: each run gets button ids of its own, from its context, set by its first step (a script\'s own variables are rendered before it has one)', cfg.sequence[0].variables.fb_id === "{{ 'fb_' ~ context.id }}" && !cfg.variables && txt.includes('"action":"{{ fb_id }}_1"') && txt.includes('"action":"{{ fb_id }}_2"'));
  const ann = cfg.sequence[1], bob = cfg.sequence[2];
  check('0.11.3 builder: a person\'s phone is sent to; with buttons and a tag of the run\'s own', ann.action === 'notify.mobile_app_ann_iphone' && ann.data.title === 'Garage' && ann.data.data.tag === '{{ fb_id }}' && ann.data.data.actions.length === 2 && !ann.data.data.push, ann);
  check('0.11.3 builder: only when away: the phone is sent to only when the person isn\'t home', !!bob.if && bob.if[0].condition === 'not' && bob.if[0].conditions[0].entity_id === 'person.bob' && bob.then[0].action === 'notify.mobile_app_bob_pixel', bob);
  const w = cfg.sequence.find((a) => a.wait_for_trigger);
  check('0.11.3 builder: it waits for a button, the minutes asked, and goes on when nobody answers', !!w && w.timeout.minutes === 15 && w.continue_on_timeout === true && w.wait_for_trigger[0].event_type === 'mobile_app_notification_action' && w.wait_for_trigger[1].id === 'b2', w);
  const clears = cfg.sequence.filter((a) => a.data && a.data.message === 'clear_notification');
  check('0.11.3 builder: then clears it on every phone', clears.length === 2 && clears.every((a) => a.data.data.tag === '{{ fb_id }}'));
  const ch = cfg.sequence[cfg.sequence.length - 1];
  check('0.11.3 builder: and does what the button pressed does, or what\'s done when nobody answers', ch.choose.length === 2 && ch.choose[0].sequence[0].action === 'cover.close_cover' && ch.default[0].action === 'light.turn_on', ch);
  check('0.11.3 builder: the same spec makes the same script, every time', JSON.stringify(notifyScript(base, { alias: 'Garage open', description: 'Tells us' })) === txt);

  const crit = notifyScript(Object.assign({}, base, { level: 'critical', quiet: { from: '22:00', to: '07:00' }, buttons: [] }), {});
  const sendTo = (c, svc) => { for (const a of c.sequence) { if (a.action === 'notify.' + svc) return a; const t = a.then && a.then.find((x) => x.action === 'notify.' + svc); if (t) return t; } return { data: { data: {} } }; };
  const ci = sendTo(crit, 'mobile_app_ann_iphone').data.data, ca = sendTo(crit, 'mobile_app_bob_pixel').data.data;
  check('0.11.3 builder: critical on iOS: the critical level and sound (quiet hours don\'t hold it back)', (ci.push || {})['interruption-level'] === 'critical' && ((ci.push || {}).sound || {}).critical === 1 && !crit.variables, ci);
  check('0.11.3 builder: critical on Android: high priority, at once, on the alarm stream', ca.priority === 'high' && ca.ttl === 0 && ca.channel === 'alarm_stream', ca);
  check('0.11.3 builder: no buttons, no wait and no ids', !JSON.stringify(crit).includes('wait_for_trigger') && !JSON.stringify(crit).includes('fb_id'));

  const quiet = notifyScript(Object.assign({}, base, { level: 'time', quiet: { from: '22:00', to: '07:00' }, speakers: ['media_player.kitchen'], tts: 'tts.cloud' }), {});
  const qi = sendTo(quiet, 'mobile_app_ann_iphone').data.data, qa = sendTo(quiet, 'mobile_app_bob_pixel').data.data, say = quiet.sequence.find((a) => a.if && a.then[0].action === 'tts.speak');
  check('0.11.3 builder: quiet hours over midnight', quiet.variables.fb_quiet === "{{ now() >= today_at('22:00') or now() < today_at('07:00') }}");
  check('0.11.3 builder: time-sensitive on iOS, passive in quiet hours', (qi.push || {})['interruption-level'] === "{{ 'passive' if fb_quiet else 'time-sensitive' }}", qi);
  check('0.11.3 builder: on Android a quiet channel of low importance in quiet hours', qa.channel === "{{ 'Quiet' if fb_quiet else 'General' }}" && qa.importance === "{{ 'low' if fb_quiet else 'default' }}" && qa.priority === 'high', qa);
  check('0.11.3 builder: spoken when someone\'s home and it isn\'t quiet hours', !!say && say.if.length === 2 && say.if[0].entity_id === 'zone.home' && say.then[0].target.entity_id === 'tts.cloud' && say.then[0].data.media_player_entity_id === 'media_player.kitchen' && say.then[0].data.message === 'The garage is open', say);
  const day = notifyScript(Object.assign({}, base, { quiet: { from: '09:00', to: '17:00' } }), {});
  check('0.11.3 builder: quiet hours within a day', day.variables.fb_quiet === "{{ today_at('09:00') <= now() < today_at('17:00') }}");

  const both = notifyScript({ message: 'm', phones: [IOS], people: [{ id: 'person.ann', away: true, phones: [IOS] }] }, {});
  check('0.11.3 builder: a phone picked itself and a person\'s is sent to once', both.sequence.length === 1 && both.sequence[0].action === 'notify.mobile_app_ann_iphone', both.sequence);
}

// ---- the same, or edited by hand past what the builder understands
{
  const cfg = notifyScript(base, { alias: 'A', description: 'D' });
  const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(cfg))).reverse());
  check('0.11.3 builder: the script is still the builder\'s with another name, icon or description, or its keys in another order',
    nbSame(Object.assign({}, cfg, { alias: 'B', icon: 'mdi:x', description: 'other' }), base) && nbSame(reordered, base) && Object.keys(reordered)[0] === 'sequence');
  const edited = JSON.parse(JSON.stringify(cfg)); edited.sequence.push({ delay: 5 });
  const tweaked = JSON.parse(JSON.stringify(cfg)); tweaked.sequence[1].data.message = 'changed';
  check('0.11.3 builder: edited by hand, it isn\'t (it opens in Home Assistant\'s editor)', !nbSame(edited, base) && !nbSame(tweaked, base) && !nbSame(null, base));
  check('0.11.3 builder: the person\'s description, without the line saying how it was made', nbDesc(cfg.description) === 'D' && nbDesc(T('nb_mark')) === '');
}

// ---- who and what it can go to
{
  const t = notifyTargets({
    states: { 'person.ann': S('home', { friendly_name: 'Ann', device_trackers: ['device_tracker.ann_iphone'] }), 'person.cy': S('home', { friendly_name: 'Cy' }), 'media_player.kitchen': S('idle', { friendly_name: 'Kitchen' }), 'tts.cloud': S('unknown', { friendly_name: 'Cloud' }), 'light.x': S('on') },
    entities: [{ entity_id: 'device_tracker.ann_iphone', device_id: 'd1' }],
    devices: [{ id: 'd1', name: 'Ann’s iPhone', manufacturer: 'Apple', identifiers: [['mobile_app', 'x']] }, { id: 'd2', name: 'Bob Pixel', manufacturer: 'Google', identifiers: [['mobile_app', 'y']] }, { id: 'd3', name: 'Lamp', identifiers: [['hue', 'z']] }],
    services: { mobile_app_ann_s_iphone: {}, mobile_app_bob_pixel: {}, mobile_app_old_tablet: {}, send_message: {} },
  });
  check('0.11.3 builder: the phones are the mobile app\'s, by the action it names after each, iOS when Apple made it', t.phones.map((p) => p.svc + '/' + p.os).join() === 'mobile_app_ann_s_iphone/ios,mobile_app_bob_pixel/android,mobile_app_old_tablet/android', t.phones);
  check('0.11.3 builder: a person with the phones they carry', t.people.length === 2 && t.people[0].id === 'person.ann' && t.people[0].phones.length === 1 && t.people[0].phones[0].svc === 'mobile_app_ann_s_iphone' && t.people[1].phones.length === 0, t.people);
  check('0.11.3 builder: speakers and TTS engines', t.speakers.length === 1 && t.speakers[0].name === 'Kitchen' && t.tts.length === 1 && t.tts[0].id === 'tts.cloud');
  check('0.11.3 builder: names slugified as Home Assistant does', slugify('Ann’s iPhone') === 'ann_s_iphone' && slugify('Café 12') === 'cafe_12');
  // 0.13.2 renamed iPhone matched by name_by_user or entity slug keeps os: 'ios'
  const renamed = notifyTargets({
    states: { 'person.sam': S('home', { friendly_name: 'Sam', device_trackers: ['device_tracker.sam_old_phone'] }) },
    entities: [{ entity_id: 'device_tracker.sam_old_phone', device_id: 'd_ios' }],
    devices: [
      { id: 'd_ios', name: 'Sam iPhone 16', name_by_user: 'Sam Work', manufacturer: 'Apple', identifiers: [['mobile_app', 'ios1']] },
      { id: 'd_ios2', name: 'Renamed Phone', name_by_user: 'Pat iPhone', manufacturer: 'Apple', identifiers: [['mobile_app', 'ios2']] },
    ],
    services: { mobile_app_sam_old_phone: {}, mobile_app_pat_iphone: {} },
  });
  check('0.13.2 builder: renamed iPhones matched by entity slug or name_by_user stay iOS',
    renamed.phones.every((p) => p.os === 'ios') && renamed.phones.length === 2
    && renamed.people[0].phones.length === 1 && renamed.people[0].phones[0].os === 'ios', renamed);
}

// ---- run in the sandbox: sent, a button pressed, nobody answering
(async () => {
  {
    // as in Home Assistant: a script's own variables are rendered before the run has a context; its actions have one
    const seen = [];
    let sb;
    sb = new Sandbox({ states: { 'script.p': S('off') }, items: [{ id: 'script.p', cfg: { variables: { a: '{{ probe }}' }, sequence: [{ variables: { b: '{{ probe }}' } }] } }], now: at('20:00'), tz: TZ,
      tpl: async (t, v) => { seen.push(!!(v && v.context && v.context.id)); return { ok: true, value: 1 }; }, ask: async () => true, name: (id) => id, condText: () => '' });
    await sb.start(); await sb.userRun('script.p', true);
    check('0.11.3 sandbox: a script\'s own variables don\'t see the run\'s context; its actions do', seen.join() === 'false,true', seen);
  }
  const cfg = notifyScript(base, { alias: 'Garage open' });
  {
    const sb = make(home, cfg);
    await sb.start();
    await sb.userRun('script.n', true);
    const sent = calls(sb).filter((c) => c.svc.startsWith('notify.') && c.data && c.data.message !== 'clear_notification');
    check('0.11.3 builder sandbox: sent to Ann; not to Bob, away (only when away? he is away, so he gets it)', sent.map((c) => c.svc).sort().join() === 'notify.mobile_app_ann_iphone,notify.mobile_app_bob_pixel' && !errs(sb).length, { sent: sent.map((c) => c.svc), errs: errs(sb) });
    const ids = sent.length ? sent[0].data.data.actions.map((x) => x.action) : [];
    check('0.11.3 builder sandbox: the buttons have the run\'s own ids, rendered', /^fb_SBX0+\d+_1$/.test(ids[0]) && ids[1] === ids[0].replace(/_1$/, '_2'), ids);
    await sb.userEvent('mobile_app_notification_action', { action: ids[0] || 'none' });
    check('0.11.3 builder sandbox: pressing Close it closes the garage and clears the notification', sb.get('cover.garage').state === 'closed' && calls(sb).filter((c) => c.data && c.data.message === 'clear_notification').length === 2 && sb.get('light.porch').state === 'off');
  }
  {
    const sb = make(home, cfg);
    await sb.start();
    await sb.userRun('script.n', true);
    await sb.userEvent('mobile_app_notification_action', { action: 'fb_somebody_else_1' });
    check('0.11.3 builder sandbox: another run\'s button doesn\'t answer this one', sb.get('cover.garage').state === 'open' && !calls(sb).some((c) => c.data && c.data.message === 'clear_notification'));
    await sb.advance(15 * MIN);
    check('0.11.3 builder sandbox: nobody answers in 15 minutes: what\'s done then is done', sb.get('light.porch').state === 'on' && sb.get('cover.garage').state === 'open' && !errs(sb).length, errs(sb));
  }
  {
    const sb = make(Object.assign({}, home, { 'person.bob': S('home') }), cfg);
    await sb.start();
    await sb.userRun('script.n', true);
    check('0.11.3 builder sandbox: Bob home: only Ann\'s phone', calls(sb).filter((c) => c.svc.startsWith('notify.')).map((c) => c.svc).join() === 'notify.mobile_app_ann_iphone');
  }
  {
    const q = notifyScript(Object.assign({}, base, { buttons: [], level: 'time', quiet: { from: '22:00', to: '07:00' }, speakers: ['media_player.kitchen'], tts: 'tts.cloud' }), {});
    const night = make(home, q, at('23:30')), day = make(home, q, at('20:00'));
    for (const sb of [night, day]) { await sb.start(); await sb.userRun('script.n', true); }
    const lvl = (sb) => calls(sb).find((c) => c.svc === 'notify.mobile_app_ann_iphone').data.data.push['interruption-level'];
    check('0.11.3 builder sandbox: in quiet hours passive and not spoken; at eight in the evening time-sensitive and spoken',
      lvl(night) === 'passive' && !calls(night).some((c) => c.svc === 'tts.speak') && lvl(day) === 'time-sensitive' && calls(day).some((c) => c.svc === 'tts.speak'), { n: calls(night).map((c) => c.svc), d: calls(day).map((c) => c.svc), e: errs(night).concat(errs(day)) });
  }
})();
