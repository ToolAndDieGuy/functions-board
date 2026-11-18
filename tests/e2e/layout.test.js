// Layout and arrows on large functions, in both directions, without needing them in Home Assistant: synthetic
// functions shaped like real ones that broke the layout before (one automation reading 28 helpers, a script
// driving 30 things, parallel chains with loops, a random 55-box tangle) are put straight into the board's model,
// laid out left to right and top to bottom, and checked: no two boxes overlap, no two arrows run within 16 px,
// no arrow through a box, every crossing hops, and top to bottom no row runs away sideways.
// Run apitest.py first.  node tests/e2e/layout.test.js [filter]   FB_SHOTS=1 also saves a screenshot of each
const path = require('path');
const { chromium, BASE, STATE, session, ready, fbq, board, suite } = require('./lib');
const { routeCheck } = require('./routecheck');
const { hopCheck } = require('./hopcheck');
const { check, done } = suite('layout');
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;

// the same "random" every run
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// a function: boxes [key, kind, name] and arrows [from, to, role]
function shapes() {
  const out = [];
  { // one automation reading 28 helpers (the shape that made a 10,000 px row top to bottom), triggered by three sensors
    const N = [['automation.recirc', 'member', 'Recirculation control']], E = [];
    for (let i = 1; i <= 3; i++) { N.push([`sensor.flow_${i}`, 'outside', `Flow ${i}`]); E.push([`sensor.flow_${i}`, 'automation.recirc', 'trigger']); }
    for (let i = 1; i <= 28; i++) { N.push([`input_number.limit_${i}`, 'member', `Limit ${i}`]); E.push([`input_number.limit_${i}`, 'automation.recirc', 'condition']); }
    N.push(['script.recirc_on', 'member', 'Recirc on'], ['script.recirc_off', 'member', 'Recirc off']);
    E.push(['automation.recirc', 'script.recirc_on', 'call'], ['automation.recirc', 'script.recirc_off', 'call']);
    for (let i = 1; i <= 4; i++) { N.push([`switch.pump_${i}`, 'outside', `Pump ${i}`]); E.push(['script.recirc_on', `switch.pump_${i}`, 'action'], ['script.recirc_off', `switch.pump_${i}`, 'action']); }
    for (let i = 1; i <= 3; i++) N.push([`input_datetime.alone_${i}`, 'member', `Alone ${i}`]);
    out.push({ name: 'fan-in', N, E });
  }
  { // a script driving 30 things, set off by two automations
    const N = [['script.all_off', 'member', 'All off'], ['automation.bedtime', 'member', 'Bedtime'], ['automation.leave', 'member', 'Leaving']], E = [];
    N.push(['input_boolean.night', 'member', 'Night'], ['binary_sensor.anyone_home', 'outside', 'Anyone home']);
    E.push(['input_boolean.night', 'automation.bedtime', 'trigger'], ['binary_sensor.anyone_home', 'automation.leave', 'trigger'], ['automation.bedtime', 'script.all_off', 'call'], ['automation.leave', 'script.all_off', 'call']);
    for (let i = 1; i <= 30; i++) { const d = ['light', 'switch', 'media_player'][i % 3]; N.push([`${d}.thing_${i}`, 'outside', `Thing ${i}`]); E.push(['script.all_off', `${d}.thing_${i}`, 'action']); }
    out.push({ name: 'fan-out', N, E });
  }
  { // six chains of five, cross-wired, with two loops back
    const N = [], E = [];
    for (let c = 1; c <= 6; c++) {
      for (let i = 1; i <= 5; i++) {
        const k = i % 2 ? `automation.c${c}_${i}` : `input_boolean.c${c}_${i}`;
        N.push([k, 'member', `Chain ${c} step ${i}`]);
        if (i > 1) { const p = (i - 1) % 2 ? `automation.c${c}_${i - 1}` : `input_boolean.c${c}_${i - 1}`; E.push(i % 2 ? [p, k, 'trigger'] : [p, k, 'action']); }
      }
    }
    E.push(['automation.c1_3', 'input_boolean.c2_4', 'action'], ['automation.c3_3', 'input_boolean.c5_2', 'action'], ['automation.c4_5', 'input_boolean.c6_2', 'action'],
      ['input_boolean.c2_2', 'automation.c3_5', 'condition'], ['automation.c5_5', 'input_boolean.c1_2', 'action'], ['automation.c6_3', 'input_boolean.c6_2', 'action']);
    out.push({ name: 'chains', N, E });
  }
  { // 55 boxes, 75 arrows, some running back
    const r = rng(7), N = [], E = [], seen = new Set();
    const doms = ['automation', 'script', 'input_boolean', 'input_number', 'sensor', 'light', 'timer'];
    for (let i = 0; i < 55; i++) { const d = doms[Math.floor(r() * doms.length)]; N.push([`${d}.n${i}`, r() < 0.2 ? 'outside' : 'member', `Box ${i}`]); }
    while (E.length < 75) {
      let a = Math.floor(r() * 55), b = Math.floor(r() * 55);
      if (a === b) continue;
      if (r() < 0.85 && a > b) [a, b] = [b, a];
      const id = a + '>' + b;
      if (seen.has(id)) continue;
      seen.add(id);
      E.push([N[a][0], N[b][0], ['trigger', 'condition', 'action', 'call', 'source'][Math.floor(r() * 5)]]);
    }
    out.push({ name: 'tangle', N, E });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await session(browser, 'owner', { viewport: { width: 1600, height: 900 }, scale: 1 });
  await page.goto(BASE + '/functions');
  await ready(page);
  await fbq(page, '.nodes .node, .welcome, .empty').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  for (const fn of shapes()) {
    for (const dir of ['right', 'down']) {
      const name = `${fn.name} ${dir === 'down' ? 'top to bottom' : 'left to right'}`;
      if (only && !only.test(name)) continue;
      const s = await board(page).evaluate((el, [fn, dir]) => {
        const nodes = new Map();
        fn.N.forEach(([key, kind, name]) => {
          const small = kind === 'outside', domain = key.split('.')[0];
          nodes.set(key, { key, kind, domain, name, icon: 'mdi:circle-outline', badges: new Set(), writers: 0, unref: false, w: small ? 204 : 240, h: small ? 40 : 62, x: 0, y: 0, tag: '' });
        });
        const edges = fn.E.map(([from, to, role]) => ({ id: from + '>' + to, from, to, role, loop: false, svcs: new Set(), tfs: [], anyTrig: true }));
        el._status = () => ({ text: '' });
        el._refreshStates = () => {};
        el._data.ui.list = false; el._data.ui.legend = false; el._renderList(); el._renderLegend();
        el._model = { label: 'layout-test-' + fn.name, nodes, edges };
        const L = el._layout(el._model.label);
        L.nodes = {};
        if (dir === 'down') L.dir = 'down'; else delete L.dir;
        el._place(); el._render(); el._fit();
        const ns = [...el._visibleKeys()].map((k) => nodes.get(k));
        let overlap = 0;
        for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
        }
        const x0 = Math.min(...ns.map((n) => n.x)), x1 = Math.max(...ns.map((n) => n.x + n.w)), y0 = Math.min(...ns.map((n) => n.y)), y1 = Math.max(...ns.map((n) => n.y + n.h));
        // top to bottom, the widest row of boxes sharing a top edge
        const rows = new Map();
        ns.forEach((n) => { const r = Math.round(n.y / 10); rows.set(r, (rows.get(r) || 0) + n.w + 30); });
        return { boxes: ns.length, overlap, w: Math.round(x1 - x0), h: Math.round(y1 - y0), widestRow: Math.max(...rows.values()), vert: el._vert(), flipped: !!el.shadowRoot.querySelector('.edges g[transform^="matrix"]') };
      }, [fn, dir]);
      const r = await board(page).evaluate(routeCheck, { min: 16 });
      const h = await board(page).evaluate(hopCheck);
      check(`${name}: ${s.boxes} boxes, none overlapping`, s.boxes === fn.N.length && s.overlap === 0, s);
      check(`${name}: arrows at least 16 px apart, none through a box`, !r.error && r.close === 0 && r.through === 0, r);
      check(`${name}: every crossing hops`, !h.error && h.missed === 0, h);
      check(`${name}: laid out ${dir === 'down' ? 'turned (arrows drawn in the reflected group)' : 'left to right'}`, s.vert === (dir === 'down') && s.flipped === (dir === 'down'), s);
      if (dir === 'down') check(`${name}: no row wider than about 2,000 px of boxes (rows wrap)`, s.widestRow <= 2400, s);
      if (process.env.FB_SHOTS) await page.screenshot({ path: path.join(STATE, 'shots', `layout-${fn.name}-${dir}.png`) });
    }
  }
  check('no errors', page.logs.length === 0, page.logs);
  await ctx.close();
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
