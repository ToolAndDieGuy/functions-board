// What every view shows, on the fake Home Assistant (layer 3): the board's shadow DOM, written out as text and
// compared with the snapshot kept in tests/board/snapshots/<view>.txt. The snapshots were taken from 0.9.1, before
// the rebuild (0.10.0), so a rebuilt part that draws anything differently fails here; a change meant to show
// something new is recorded again on purpose:
//
//   FB_SNAP_UPDATE=1 sh tests/run.sh --only board-snapshots
//
// and the new snapshots go in the same commit, where the diff shows what changed on screen.
//
// What's kept: each element's tag, its classes (sorted), the attributes that say what it is or does (data-*, role,
// aria-*, title, tabindex, hidden, disabled, value, href, type, for, the SVG geometry), its inline style, and its
// own text. What's evened out: clock times and dates, ids made at random, the board's version, positions measured on the screen (menus
// and tips placed beside a button, the pan and zoom that fit the board to the window), and moments of animation. A <style> is written as a hash of its text.
//
//   S1  every view matches its snapshot (one check per view)
//   S2  each view settles: two looks 200 ms apart agree (the snapshot itself is steady)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fbq, board, until, suite, freshBoard, importAll, openFn, current } = require('./helpers');
const { test } = require('./fixtures');

const { check, done } = suite('board-snapshots');
const DIR = path.join(__dirname, 'snapshots');
const UPDATE = process.env.FB_SNAP_UPDATE === '1';
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
// every page's clock starts an hour after garage.json was recorded, so "ran 2 hours ago" reads the same next year;
// and the system asks for less motion, so a flow shows its last step at once rather than a moment of playing
const CLOCK = '2026-11-19T00:00:00Z';
const STILL = { viewport: { width: 1400, height: 880 }, clock: CLOCK, reducedMotion: 'reduce' };

// Runs in the page: the board's shadow root as lines of text, indented by depth.
function walk(b) {
  const KEEP = /^(data-[\w-]+|role|aria-[\w-]+|title|tabindex|hidden|disabled|checked|selected|value|href|type|for|name|placeholder|open|d|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|points|transform|viewBox|marker-end|marker-start|fill|stroke|stroke-width|stroke-dasharray|icon|label|draggable|contenteditable|spellcheck|colspan|min|max|step|maxlength)$/;
  // classes that are only a moment of an animation
  const PASSING = new Set(['pulse', 'wpulse', 'flash', 'blink', 'enter', 'leave', 'anim']);
  const out = [];
  // inside the drawn world, positions come from the layout; the world's own pan and zoom fit it to the screen
  const inWorld = (e) => !e.classList.contains('world') && !!e.closest('.world');
  const line = (e, depth) => {
    const tag = e.tagName.toLowerCase();
    const cls = (e.getAttribute('class') || '').split(/\s+/).filter((c) => c && !PASSING.has(c)).sort();
    const attrs = [];
    for (const a of [...e.attributes].sort((x, y) => (x.name < y.name ? -1 : 1))) {
      if (a.name === 'class') continue;
      if (a.name === 'style') {
        let s = a.value.trim();
        // outside the drawn world, a position is measured from the fonts on this machine: keep only what is set
        if (!inWorld(e)) s = s.replace(/-?\d+(\.\d+)?(px|%)?/g, '#');
        if (s) attrs.push(`style="${s}"`);
        continue;
      }
      if (KEEP.test(a.name)) attrs.push(a.value === '' ? a.name : `${a.name}="${a.value}"`);
    }
    // a form field's live value, which isn't an attribute
    if ((tag === 'input' || tag === 'select' || tag === 'textarea') && e.type !== 'file') attrs.push(`·value="${e.value}"`);
    if (tag === 'input' && (e.type === 'checkbox' || e.type === 'radio')) attrs.push(`·checked=${e.checked}`);
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
    let s = '  '.repeat(depth) + tag + (cls.length ? '.' + cls.join('.') : '') + (attrs.length ? ' ' + attrs.join(' ') : '');
    if (tag === 'style') return out.push(s + ' {' + e.textContent.length + ' chars, #' + hash(e.textContent) + '}');
    if (own) s += ' | ' + own;
    out.push(s);
    for (const c of e.children) line(c, depth + 1);
  };
  // a short hash, to see a style change without writing out the whole sheet
  const hash = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  for (const c of b.shadowRoot.children) line(c, 0);
  return out.join('\n');
}

// the board's own version, which every release changes
const { BOARD } = require('./fake-ha');
const VERSION = (fs.readFileSync(BOARD, 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
// Times, dates, random ids and the version, evened out (the board shows the clock and how long ago things happened).
function steady(text) {
  return text
    .split('v' + VERSION).join('v<version>')
    .replace(/\b\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?\b/g, '<iso>')
    .replace(/\b\d{1,2}:\d\d(:\d\d)?(\.\d+)?(\s?[AP]M)?\b/gi, '<time>')
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(, \d{4})?\b/g, '<date>')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>')
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b/g, '<day>')
    .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|secs|seconds?|min|mins|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|months?|y|yrs?|years?)( ago)?\b/g, '<dur>')
    .replace(/\b(just now|a moment ago|a few seconds ago|yesterday|last week|last month|last year)\b/g, '<dur>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .replace(/\b[0-9A-Z]{26}\b/g, '<id>');
}

async function snap(page, name, extra = '') {
  // the mouse off the board and the drawer: where the last click left it, a box under it would be traced (and dim
  // the rest) or not, as the drawer's last redraw happened to fall
  await page.mouse.move(1, 1);
  await page.waitForTimeout(250);
  await current.fake.idle(300);
  // at rest: marks that last a moment (an arrow lit for 2.5 s after a run, a pulse, a toast) have run out
  await page.clock.runFor(4000);
  await current.fake.idle(300);
  // a view still moving (the board pans to what it shows) settles: two looks 200 ms apart that agree
  let a = steady(await el(page, walk)), b = null;
  for (const end = Date.now() + 4000; Date.now() < end; a = b) {
    await page.waitForTimeout(200);
    b = steady(await el(page, walk));
    if (a === b) break;
  }
  check(`S2 ${name}: the view settles`, a === b, firstDiff(a, b || ''));
  const file = path.join(DIR, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.txt');
  const text = (extra ? extra + '\n' : '') + a + '\n';
  if (UPDATE || !fs.existsSync(file)) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, text);
    check(`S1 ${name}: recorded`, UPDATE || !process.env.CI, 'no snapshot for this view: record it with FB_SNAP_UPDATE=1 and commit it');
    return;
  }
  const want = fs.readFileSync(file, 'utf8');
  check(`S1 ${name}: as in its snapshot`, want === text, firstDiff(want, text));
}
function firstDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `line ${i + 1} of ${x.length}/${y.length}\n- ${(x[i] || '').trim().slice(0, 220)}\n+ ${(y[i] || '').trim().slice(0, 220)}`;
  return '';
}

// a fresh board with the garage imported and open
async function garage(browser, opts = {}) {
  const { page, ctx } = await freshBoard(browser, Object.assign({}, STILL, opts));
  page.allowFail = [/^trace\/get$/, /^supervisor\/api$/];
  await importAll(page);
  await openFn(page, /garage/i);
  await el(page, (b) => { b._$.toast.hidden = true; });
  return { page, ctx };
}
const closeAll = (page) => el(page, (b) => { if (b._drawer) b._closeDrawer(); if (!b._$.modal.hidden) { const c = b._$.modal.querySelector('[data-act="modal-cancel"]'); if (c) c.click(); } });

test('first run and the import manager', async ({ browser }) => {
  const { page, ctx } = await freshBoard(browser, STILL);
  await current.fake.idle(500);
  await snap(page, 'first run');
  await fbq(page, '.empty.wel [data-act="import"]').click();
  await fbq(page, '.modal [data-act="mgr-import-one"]').first().waitFor({ timeout: 20000 });
  await snap(page, 'import manager');
  check('S no errors (first run)', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('the garage, a box, the key and the menus', async ({ browser }) => {
  const { page, ctx } = await garage(browser);
  await snap(page, 'garage');
  await el(page, (b) => b._select('automation.garage_left_open')); await page.waitForTimeout(300);
  await snap(page, 'box selected');
  await el(page, (b) => b._select(null)); await page.waitForTimeout(200);
  await fbq(page, '[data-act="legend"]').first().click(); await page.waitForTimeout(300);
  await snap(page, 'key');
  await fbq(page, '[data-act="legend"]').first().click();
  for (const act of ['hl', 'fn-menu']) {
    const b = fbq(page, `[data-act="${act}"]`).first();
    if (!(await b.count())) { check(`S ${act}: the button is there`, false); continue; }
    await b.click(); await page.waitForTimeout(300);
    await snap(page, act === 'hl' ? 'arrows menu' : 'function menu');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }
  check('S no errors (garage)', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('the drawers', async ({ browser }) => {
  const { page, ctx } = await garage(browser);
  for (const act of ['runs', 'debug', 'versions']) {
    await fbq(page, `[data-act="${act}"]`).first().click();
    await fbq(page, '.drawer .dhead').waitFor({ timeout: 5000 }); await page.waitForTimeout(800);
    await snap(page, act + ' drawer');
    await closeAll(page); await page.waitForTimeout(200);
  }
  await fbq(page, '.tools [data-act="sandbox"]').click();
  await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
  await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
  await until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 15000);
  await snap(page, 'sandbox');
  await fbq(page, '.drawer .sbent').selectOption('cover.garage_door');
  await fbq(page, '.drawer .sbval-sel').selectOption('open');
  await fbq(page, '.drawer [data-act="sbx-set"]').click();
  await until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 15000); await page.waitForTimeout(600);
  // the sandbox log shows the sandbox's own clock: the steps, not when they ran
  await snap(page, 'sandbox after a change');
  await fbq(page, '.drawer [data-act="chk-save"]').click(); await fbq(page, '.modal .ckdlg').waitFor();
  await snap(page, 'save a check');
  await closeAll(page);
  check('S no errors (drawers)', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('problems', async ({ browser }) => {
  const { page, ctx } = await garage(browser);
  // a box that points at an entity that isn't there, in the garage function
  const lid = await el(page, (b) => b._data.ui.current);
  const f = current.fake;
  f.autos.fbsnap1 = { id: 'fbsnap1', alias: 'Garage snapshot points at gone', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door_gone', to: 'open' }], conditions: [], actions: [{ action: 'cover.close_cover', target: { entity_id: 'cover.garage_door' } }], mode: 'single' };
  await f._automationSaved('fbsnap1');
  const e = f.entities.get('automation.garage_snapshot_points_at_gone'); e.labels = [lid];
  await f.emit('entity_registry_updated', { action: 'update', entity_id: e.entity_id, changes: { labels: true } });
  await until(() => el(page, (b) => (b._model && (b._model.problems || []).length >= 1) || null), 15000);
  await snap(page, 'garage with a problem');
  await fbq(page, '.pchip').click(); await fbq(page, '.drawer .probs .prow').first().waitFor({ timeout: 5000 });
  await snap(page, 'problems drawer');
  check('S no errors (problems)', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('dialogs', async ({ browser }) => {
  const { page, ctx } = await garage(browser);
  await fbq(page, '[data-act="about"]').first().click(); await page.waitForTimeout(400);
  await snap(page, 'about');
  await fbq(page, '.modal [data-act="diag"]').click(); await page.waitForTimeout(600);
  await snap(page, 'diagnostics');
  await closeAll(page); await page.waitForTimeout(200);
  await fbq(page, '[data-act="fn-menu"]').first().click(); await page.waitForTimeout(200);
  await fbq(page, '[data-act="fn-edit"]').first().click(); await page.waitForTimeout(400);
  await snap(page, 'edit function'); await closeAll(page);
  check('S no errors (dialogs)', page.logs.length === 0, page.logs);
  await ctx.close();
});

test('light mode, a phone, and not an admin', async ({ browser }) => {
  let { page, ctx } = await garage(browser, { light: true });
  await snap(page, 'garage light');
  await ctx.close();
  ({ page, ctx } = await garage(browser, { mobile: true, viewport: undefined }));
  await snap(page, 'garage phone');
  await ctx.close();
  current.fake.admin = false;
  ({ page, ctx } = await freshBoard(browser, Object.assign({ reset: false }, STILL)));
  page.allowFail = [/^functions_board\//];
  await current.fake.idle(500);
  await snap(page, 'not an admin');
  await ctx.close();
});

test.afterAll(() => done());
