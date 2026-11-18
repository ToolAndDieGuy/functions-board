// Privacy, on the real Home Assistant: the board talks to this Home Assistant and nothing else, its data stays
// in Home Assistant's own storage, and diagnostics are anonymised or not as the person chooses, every time.
//
//   C1  every request the board's page makes during a tour of everything it does goes to this Home Assistant
//   C2  Home Assistant's process: no outgoing connection or name lookup came from the integration's files
//       (tests/netguard logs them, with the code behind each; start-ha.sh turns it on)
//   C3  the marker text the tour gives the board is stored only in the integration's own files, nowhere else
//       on disk (not in www/, which Home Assistant serves without a login, nor in the database or the log)
//   C4  nothing of it can be read without logging in, or by someone who isn't an administrator
//   and the Diagnostics dialog: a forced choice between anonymised and real names; the files it makes
const fs = require('fs');
const path = require('path');
const { chromium, BASE, session, ws, fbq, board, until, suite, freshBoard, importAll, openFn } = require('./lib');

const { check, done } = suite('privacy');
const CONFIG = path.resolve(__dirname, '../../ha/config');
const GUARD = path.resolve(__dirname, '../../ha/netguard.log');
const MARK = 'Bramblewood';
const NOTE = 'Bramblewood note: spare key under the pot, gate code 4321-alarm';
const ORIGIN = new URL(BASE).origin;

const el = (page, fn, arg) => board(page).evaluate(fn, arg);

// every file under the config folder: path → [size, modified]
function files(dir, out = {}, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(deps|tts|\.cache|__pycache__)$/.test(e.name)) files(p, out, base); } else if (e.isFile()) { const s = fs.statSync(p); out[path.relative(base, p)] = [s.size, s.mtimeMs]; }
  }
  return out;
}

(async () => {
  const guardFrom = fs.existsSync(GUARD) ? fs.statSync(GUARD).size : 0;
  const before = files(CONFIG);
  const browser = await chromium.launch();
  const { page, ctx } = await freshBoard(browser, { viewport: { width: 1500, height: 900 } });
  page.allowFail = [/^trace\/get$/, /^supervisor\/api$/];

  // C1: every request the page makes, and which script started it (the browser's developer tools say)
  const reqs = [];
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => {
    const frames = [];
    for (let s = e.initiator && e.initiator.stack; s; s = s.parent) frames.push(...s.callFrames.map((f) => f.url));
    if (e.initiator && e.initiator.url) frames.push(e.initiator.url);
    reqs.push({ url: e.request.url, method: e.request.method, body: e.request.postData || '', board: frames.some((u) => /functions-board\.js/.test(u)) });
  });

  // the tour: import, a function, its debugger and runs, the sandbox, versions, Node-RED, About, diagnostics
  await importAll(page);
  const label = await openFn(page, /garage/i);
  await ws(page, { type: 'functions_board/version_delete', label }).catch(() => {});
  const sw = await ws(page, { type: 'input_boolean/create', name: `${MARK} test switch` });
  await ws(page, { type: 'config/entity_registry/update', entity_id: `input_boolean.${sw.id}`, labels: [label] });
  await until(() => el(page, (b, k) => (b._model && b._model.nodes.has(k)) || null, `input_boolean.${sw.id}`), 15000);
  await el(page, (b, text) => { b._addNote(); const L = b._layout(b._model.label); L.notes[L.notes.length - 1].text = text; b._save(); b._renderNotes(); }, NOTE);
  await page.waitForTimeout(1500);
  for (const act of ['legend', 'debug']) { await fbq(page, `[data-act="${act}"]`).first().click().catch(() => {}); await page.waitForTimeout(700); }
  await el(page, (b) => b._closeDrawer());
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  await fbq(page, '.drawer .sbent').selectOption('cover.garage_door');
  await fbq(page, '.drawer .sbval-sel').selectOption('open');
  await fbq(page, '.drawer [data-act="sbx-set"]').click();
  await until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 15000);
  await fbq(page, '.drawer [data-act="sbx-fire"]').click();
  await until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 15000);
  await el(page, (b) => b._closeDrawer());
  await fbq(page, '.tools [data-act="versions"]').click();
  await fbq(page, '.drawer [data-act="ver-new"]').click();
  await fbq(page, '.modal input[name="vname"]').fill(`${MARK} before winter`);
  await fbq(page, '.modal textarea[name="vdesc"]').fill(NOTE);
  await fbq(page, '.modal [data-act="ver-save"]').click();
  await until(() => el(page, (b) => b._$.drawer.querySelectorAll('.vlist .vrow:not(.cur)').length || null), 10000);
  const vid = await el(page, (b) => b._$.drawer.querySelector('.vlist .vrow:not(.cur)').dataset.id);
  await fbq(page, `.drawer [data-act="ver-open"][data-id="${vid}"]`).click();
  await until(() => el(page, (b) => b._ver || null), 15000);
  await fbq(page, '.vtabs .vtab').first().click();
  await until(() => el(page, (b) => !b._ver || null), 10000);
  await el(page, (b) => { b._data.ui.nodered = true; b._nrCache = null; return b._nodered && b._nodered(); }).catch(() => {});
  await page.waitForTimeout(1500);
  await el(page, (b) => { b._data.ui.nodered = false; b._save(); });
  await fbq(page, '[data-act="about"]').first().click();
  await fbq(page, '.modal .dlg.about').waitFor({ timeout: 5000 });

  // the Diagnostics dialog: neither choice ticked to start with, and nothing can be made until one is
  await fbq(page, '.modal [data-act="diag"]').click();
  await fbq(page, '.modal .dlg.diag').waitFor({ timeout: 8000 });
  const st = () => el(page, (b) => { const m = b._$.modal, q = (s) => m.querySelector(s); return { anon: q('input[name="danon"]').checked, real: q('input[name="dreal"]').checked, go: !q('[data-act="diag-go"]').disabled, copy: !q('[data-act="diag-copy"]').disabled, warn: !q('.dwarn').hidden, snap: !!q('input[name="dsnap"]'), vers: m.querySelectorAll('input[name="dver"]').length }; });
  let s0 = await st();
  check('Diagnostics: neither anonymised nor real names is ticked to start with', !s0.anon && !s0.real, s0);
  check('... and nothing can be downloaded or copied until one is', !s0.go && !s0.copy, s0);
  check('... a snapshot of the open function and its saved versions can be added', s0.snap && s0.vers === 1, s0);
  await fbq(page, '.modal input[name="danon"]').check();
  let s1 = await st();
  check('ticking anonymised allows it', s1.anon && s1.go && s1.copy && !s1.warn, s1);
  await fbq(page, '.modal input[name="dreal"]').check();
  s1 = await st();
  check('ticking real names unticks anonymised (one or the other) and warns to look before posting', s1.real && !s1.anon && s1.go && s1.warn, s1);
  await fbq(page, '.modal input[name="dreal"]').uncheck();
  s1 = await st();
  check('unticking it leaves no choice, and nothing can be made again', !s1.anon && !s1.real && !s1.go, s1);
  const fetchFile = async (anon) => {
    await fbq(page, `.modal input[name="${anon ? 'danon' : 'dreal'}"]`).check();
    await fbq(page, '.modal input[name="dsnap"]').check();
    await fbq(page, '.modal input[name="dver"]').first().check();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), fbq(page, '.modal [data-act="diag-go"]').click()]);
    const text = fs.readFileSync(await dl.path(), 'utf8');
    return { name: dl.suggestedFilename(), text, json: JSON.parse(text) };
  };
  const anon = await fetchFile(true);
  check('anonymised file: saved here, named so', /^functions_board_diagnostics_\d{4}-\d\d-\d\d_anonymised\.json$/.test(anon.name), anon.name);
  check('... nothing of the marker, the note, the version\'s name or the garage\'s entity IDs in it', !/bramblewood|4321-alarm|garage_door|garage_left_open/i.test(anon.text), (anon.text.match(/.{0,40}(bramblewood|4321-alarm|garage_door).{0,20}/i) || [''])[0]);
  check('... but the shape is: the layout, the snapshot with its triggers and the version', anon.json.about.anonymised === true && Object.keys(anon.json.board.layouts).length > 0 && /"trigger": "state"/.test(anon.text) && Object.keys(anon.json.version_snapshots || {}).length === 1 && !!anon.json.snapshot_now, Object.keys(anon.json));
  await fbq(page, '[data-act="about"]').first().click();
  await fbq(page, '.modal [data-act="diag"]').click();
  await fbq(page, '.modal .dlg.diag').waitFor({ timeout: 8000 });
  const real = await fetchFile(false);
  check('real names: what was chosen, all there', real.json.about.anonymised === false && real.text.includes(NOTE) && /cover\.garage_door/.test(real.text) && /Bramblewood before winter/.test(real.text), real.name);
  check('the version\'s Download button opens the same dialog with that version ticked', await (async () => {
    if (!(await el(page, (b) => !!(b._drawer && b._drawer.mode === 'versions')))) await fbq(page, '.tools [data-act="versions"]').click();
    await fbq(page, `.drawer [data-act="diag"][data-ver="${vid}"]`).click();
    await fbq(page, '.modal .dlg.diag').waitFor({ timeout: 8000 });
    const r = await el(page, (b, v) => { const c = b._$.modal.querySelector(`input[name="dver"][value="${v}"]`); return !!c && c.checked && !b._$.modal.querySelector('input[name="danon"]').checked && !b._$.modal.querySelector('input[name="dreal"]').checked; }, vid);
    await fbq(page, '.modal [data-act="modal-cancel"]').click();
    return r;
  })());
  await page.waitForTimeout(2500);

  // C1: what the page asked for
  const ours = reqs.filter((r) => r.board), away = reqs.filter((r) => !r.url.startsWith(ORIGIN) && !/^(data|blob|chrome-extension):/.test(r.url));
  check('C1 the tour made requests the board started (so the attribution works)', ours.length > 0, reqs.length);
  check('C1 every request the board started went to this Home Assistant', ours.every((r) => r.url.startsWith(ORIGIN) || /^(data|blob):/.test(r.url)), ours.filter((r) => !r.url.startsWith(ORIGIN)).map((r) => r.url));
  check('C1 no request to anywhere else carried the board\'s data, whoever started it', away.every((r) => !/bramblewood|4321-alarm/i.test(r.url + r.body)), away.map((r) => r.url));
  if (away.length) console.log('   (Home Assistant\'s own requests elsewhere, not the board\'s: ' + [...new Set(away.map((r) => new URL(r.url).host))].join(', ') + ')');

  // C2: what Home Assistant's process connected to, and why
  const guard = fs.existsSync(GUARD) ? fs.readFileSync(GUARD, 'utf8').slice(guardFrom).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null;
  check('C2 the connection log is on (start-ha.sh starts Home Assistant with it)', guard !== null && fs.existsSync(GUARD), GUARD);
  // the code behind each: its own stack, plus whoever handed a worker thread the job (async_add_executor_job)
  const behind = (g) => g.stack.concat(g.via || []);
  const fromUs = (guard || []).filter((g) => behind(g).some((f) => /custom_components[\\/]functions_board/.test(f)));
  check('C2 no outgoing connection or name lookup came from the integration', fromUs.length === 0, fromUs.map((g) => `${g.kind} ${g.host}:${g.port}`));
  // and none during the tour that can't be traced to a part of Home Assistant at all
  const owner = (g) => behind(g).find((f) => /[\\/](homeassistant|custom_components)[\\/]components?[\\/]?|custom_components[\\/]/.test(f) && !/homeassistant[\\/](util|helpers|core|runner|bootstrap)/.test(f));
  const nobody = (guard || []).filter((g) => !owner(g));
  check('C2 ... nor any the log can\'t trace to a part of Home Assistant', nobody.length === 0, nobody.map((g) => `${g.kind} ${g.host}:${g.port} ${behind(g).slice(-3).join(' < ')}`));

  // C3: where the marker text is on disk after the tour
  await page.waitForTimeout(3000);
  const after = files(CONFIG), changed = Object.keys(after).filter((p) => !before[p] || before[p][1] !== after[p][1]);
  const holders = Object.keys(after).filter((p) => { try { const b = fs.readFileSync(path.join(CONFIG, p)); return b.includes(Buffer.from('4321-alarm')) || b.includes(Buffer.from('Bramblewood before winter')); } catch (e) { return false; } });
  check('C3 the note and the version\'s name are stored only in the integration\'s own files', holders.length > 0 && holders.every((p) => /^\.storage[\\/]functions_board(\.versions)?$/.test(p)), holders);
  check('C3 nothing written where Home Assistant serves files without a login (www/), or to media or share', !changed.some((p) => /^(www|media|share)[\\/]/.test(p)), changed.filter((p) => /^(www|media|share)/.test(p)));
  check('C3 the integration\'s files are only in .storage', Object.keys(after).filter((p) => /functions_board/.test(p) && !/^custom_components[\\/]/.test(p)).every((p) => /^\.storage[\\/]/.test(p)), Object.keys(after).filter((p) => /functions_board/.test(p)));

  // C4: without logging in, and as someone who isn't an administrator
  const anonCtx = await browser.newContext();
  const get = async (p) => { const r = await anonCtx.request.get(BASE + p, { maxRedirects: 0 }); return [r.status(), (await r.text()).slice(0, 200)]; };
  const js = await get('/functions_board_static/functions-board.js');
  check('C4 without logging in, the integration\'s file address serves only the board\'s code', js[0] === 200 && /^\/\*!\n \* Functions board v/.test(js[1]), js);
  const probes = await Promise.all(['/functions_board_static/', '/functions_board_static/../.storage/functions_board', '/functions_board_static/%2e%2e/%2e%2e/.storage/functions_board', '/functions_board_static/manifest.json', '/local/functions_board', '/api/functions_board'].map(async (p) => [p, ...(await get(p))]));
  check('C4 ... and nothing else: no folder listing, no way up to the store, nothing under /local or /api', probes.every(([, code, body]) => code !== 200 || !/bramblewood|4321|"layouts"/i.test(body)) && probes.every(([p, code]) => p === '/functions_board_static/manifest.json' || code >= 400 || code === 0), probes.map(([p, c]) => `${p} ${c}`));
  const wsAnon = await page.evaluate(async (base) => new Promise((res) => {
    const w = new WebSocket(base.replace(/^http/, 'ws') + '/api/websocket'), got = [];
    w.onmessage = (m) => { got.push(JSON.parse(m.data).type); if (got.length === 1) w.send(JSON.stringify({ id: 1, type: 'functions_board/get' })); };
    w.onclose = () => res(got);
    setTimeout(() => { try { w.close(); } catch (e) {} res(got); }, 4000);
  }), BASE);
  check('C4 the websocket asks for a login first and answers none of the board\'s commands without one', wsAnon[0] === 'auth_required' && !wsAnon.includes('result'), wsAnon);
  await anonCtx.close();
  const { page: up } = await session(browser, 'user');
  await up.goto(BASE + '/');
  await up.waitForFunction(() => document.querySelector('home-assistant') && document.querySelector('home-assistant').hass, null, { timeout: 30000 });
  const refused = [];
  for (const m of [{ type: 'functions_board/get' }, { type: 'functions_board/versions', label }, { type: 'functions_board/version_get', label, version_id: vid }, { type: 'functions_board/diagnostics', anonymise: true }, { type: 'functions_board/diagnostics', anonymise: false }]) {
    const r = await up.evaluate((m) => document.querySelector('home-assistant').hass.callWS(m).then(() => 'answered', (e) => e.code), m);
    refused.push(`${m.type}${m.anonymise === undefined ? '' : ' ' + m.anonymise}: ${r}`);
  }
  check('C4 someone who isn\'t an administrator gets none of it (board, versions, a snapshot, diagnostics)', refused.every((r) => /unauthorized$/.test(r)), refused);

  // put the test home back
  await ws(page, { type: 'input_boolean/delete', input_boolean_id: sw.id }).catch(() => {});
  await ws(page, { type: 'functions_board/version_delete', label }).catch(() => {});
  check('no errors', page.logs.length === 0, page.logs);
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
