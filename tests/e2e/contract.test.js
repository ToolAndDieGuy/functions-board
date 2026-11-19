// The fake Home Assistant's contract (tests/board/fake-ha.js), on the real one: the same questions, put to both,
// get answers of the same shape, and the same changes give the same results. When Home Assistant or the test
// config changes and this fails, the fake has drifted: rerun tests/board/capture.js, or teach the fake.
const { test } = require('./fixtures');
const ha = require('./ha-api');
const { suite } = require('./lib');
const { FakeHA, snapshot } = require('../board/fake-ha');
const { check, done } = suite('contract');

// the shape of a value: its type, and for an object the shapes of its keys (a list: the shape of its first item)
const shape = (v, depth = 3) => {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return depth && v.length ? [shape(v[0], depth - 1)] : 'array';
  if (typeof v === 'object') {
    if (!depth) return 'object';
    // keyed by IDs (config entry IDs and the like, new on every install): a map, compared by its values' shape
    const ks = Object.keys(v);
    if (ks.length && ks.every((k) => /^([0-9A-Z]{26}|[0-9a-f]{32})$/.test(k))) return { '*': shape(v[ks[0]], depth - 1) };
    return Object.fromEntries(ks.sort().map((k) => [k, shape(v[k], depth - 1)]));
  }
  return typeof v;
};
// every key the fake gives is one the real one gives, of the same type (null fits any type: unset)
function fits(fake, real, at = '') {
  const out = [];
  if (fake === 'null' || real === 'null') return out;
  if (Array.isArray(fake) || Array.isArray(real)) {
    if (!(Array.isArray(fake) && Array.isArray(real))) { if (!(fake === 'array' || real === 'array')) out.push(`${at}: ${JSON.stringify(fake)} vs ${JSON.stringify(real)}`); return out; }
    return fits(fake[0], real[0], at + '[0]');
  }
  if (typeof fake === 'object' && typeof real === 'object') {
    for (const k of Object.keys(fake)) {
      if (!(k in real)) out.push(`${at}.${k}: only the fake has it`);
      else out.push(...fits(fake[k], real[k], `${at}.${k}`));
    }
    return out;
  }
  if (fake !== real && !(typeof fake === 'object' || typeof real === 'object')) out.push(`${at}: ${fake} vs ${real}`);
  return out;
}

test('the fake answers like the real Home Assistant', async () => {
  await ha.reset();
  const fake = new FakeHA({ mode: (await ha.ws({ type: 'functions_board/get' })).mode });
  const both = async (msg) => [await fake.ws(Object.assign({}, msg)), await ha.ws(msg)];

  // the snapshot is of this Home Assistant and this test config
  const real = await ha.rest('GET', 'states');
  const snap = snapshot();
  const ids = (xs) => xs.map((s) => s.entity_id).filter((id) => !/^(sun|update|weather|geo_location|sensor\.(date|time)|automation\.bulk_|event)\b/.test(id)).sort();
  const missing = ids(real).filter((x) => !ids(snap.states).includes(x)), extra = ids(snap.states).filter((x) => !ids(real).includes(x));
  check('contract: the fake\'s snapshot has this test config\'s entities (else: node tests/board/capture.js)', !missing.length && !extra.length, { missing, extra });
  // (the weekly beta run, FB_HA=beta, is on a newer one by design: there the answers' shapes are what count)
  const haNow = (await ha.ws({ type: 'get_config' })).version;
  check('contract: ... and is of this Home Assistant version (any, on the weekly beta run)', snap.ha === haNow || process.env.FB_HA === 'beta', { snapshot: snap.ha, running: haNow });

  // reads: the same shapes
  for (const msg of [
    { type: 'config/entity_registry/list' }, { type: 'config/device_registry/list' }, { type: 'config/area_registry/list' },
    { type: 'config/floor_registry/list' }, { type: 'config/label_registry/list' }, { type: 'config/category_registry/list', scope: 'automation' },
    { type: 'config_entries/get', domain: 'functions_board' }, { type: 'manifest/list' }, { type: 'config/auth/list' },
    { type: 'functions_board/get' }, { type: 'functions_board/nodered' }, { type: 'frontend/get_user_data', key: 'functions_board_contract' },
    { type: 'automation/config', entity_id: 'automation.garage_left_open' }, { type: 'trace/list', domain: 'automation' },
    { type: 'config/entity_registry/get', entity_id: 'cover.garage_door' },
  ]) {
    const [f, r] = await both(msg);
    const d = fits(shape(f), shape(r));
    check(`contract: ${msg.type} answers in the same shape`, !d.length, d.slice(0, 6));
  }

  // changes: the same results
  const [l1f, l1r] = await both({ type: 'config/label_registry/create', name: 'Contract label' });
  check('contract: creating a label answers in the same shape, with the same ID', !fits(shape(l1f), shape(l1r)).length && l1f.label_id === l1r.label_id, [l1f, l1r]);
  const [u1f, u1r] = await both({ type: 'config/entity_registry/update', entity_id: 'cover.garage_door', labels: [l1r.label_id] });
  check('contract: labelling an entity answers in the same shape', !fits(shape(u1f), shape(u1r)).length, fits(shape(u1f), shape(u1r)));
  const lay = { nodes: { 'cover.garage_door': { x: 1, y: 2 } }, frames: [], notes: [] };
  const [s1f, s1r] = await both({ type: 'functions_board/set_layout', label: 'contract_fn', layout: lay, rev: 0, client: 'c1' });
  const [s2f, s2r] = await both({ type: 'functions_board/set_layout', label: 'contract_fn', layout: lay, rev: 0, client: 'c2' });
  check('contract: a layout saved at its revision, then one saved at a stale revision: the same answers', JSON.stringify([s1f, s2f]) === JSON.stringify([s1r, s2r]), { fake: [s1f, s2f], real: [s1r, s2r] });
  const [gf, gr] = await both({ type: 'functions_board/get' });
  check('contract: ... and the same store after it', JSON.stringify(gf.data.layouts.contract_fn) === JSON.stringify(gr.data.layouts.contract_fn) && gf.revs.contract_fn === gr.revs.contract_fn, { fake: gf.revs, real: gr.revs });
  const [vf, vr] = await both({ type: 'functions_board/version_save', label: 'contract_fn', name: 'Contract v1', desc: 'd', snapshot: { items: {} } });
  check('contract: saving a version answers in the same shape', !fits(shape(vf), shape(vr)).length, fits(shape(vf), shape(vr)));
  const [lf, lr] = await both({ type: 'functions_board/versions', label: 'contract_fn' });
  check('contract: ... and the list of versions too', !fits(shape(lf), shape(lr)).length && lf.versions.length === lr.versions.length, [lf, lr]);
  await both({ type: 'functions_board/version_delete', label: 'contract_fn' });
  const [nf, nr] = await both({ type: 'functions_board/set_layout', label: 'contract_fn', layout: null });
  check('contract: deleting a layout: the same answer', JSON.stringify(nf) === JSON.stringify(nr), [nf, nr]);
  // an automation saved and read back through the REST API
  const cfg = { alias: 'Contract automation', triggers: [{ trigger: 'event', event_type: 'contract' }], actions: [] };
  await fake.api('POST', 'config/automation/config/fbcontract1', cfg); await ha.rest('POST', 'config/automation/config/fbcontract1', cfg);
  await new Promise((r) => setTimeout(r, 1500));
  const rf = await fake.api('GET', 'config/automation/config/fbcontract1'), rr = await ha.rest('GET', 'config/automation/config/fbcontract1');
  check('contract: an automation saved and read back: the same config', JSON.stringify(rf) === JSON.stringify(rr), { fake: rf, real: rr });
  const ef = [...fake.states.keys()].find((k) => fake.states.get(k).attributes.id === 'fbcontract1'), er = (await ha.rest('GET', 'states')).find((s) => s.attributes.id === 'fbcontract1');
  check('contract: ... and the same entity for it', !!er && ef === er.entity_id, { fake: ef, real: er && er.entity_id });
  const sf = fake.states.get(ef), sr = er;
  check('contract: ... whose state has the same shape', !fits(shape(sf), shape(sr)).length, fits(shape(sf), shape(sr)));
});
test.afterAll(() => done());
