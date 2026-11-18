// Accessibility, on the real Home Assistant: what a keyboard and a screen reader get from the board.
//
//   X1  axe-core (WCAG 2.2 A and AA rules) finds nothing on the board, the Key, a selected box, the debugger,
//       runs, versions, the sandbox, the save-a-check dialog, About, Diagnostics and the import manager,
//       in dark mode and in light mode
//   X2  no words on a box are faded with opacity (axe judges only what's on screen at the moment it looks)
//   K   the keyboard: one box in the tab order, arrow keys move between boxes, Space selects, Enter opens,
//       dialogs take focus, keep it and give it back, the drawer takes focus and gives it back, Escape closes
//   N   what's read out: a box says what it shows and its problems; the list's count says what it counts
//   M   less motion: with the system set to reduce motion, a flow shows its last step instead of playing
const fs = require('fs');
const { chromium, fbq, board, until, suite, freshBoard, importAll, openFn, ws, svc } = require('./lib');

const { check, done } = suite('a11y');
const PID = 'fba11y1', PKEY = 'automation.garage_a11y_points_at_gone';
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [process.cwd(), __dirname] }), 'utf8');
const el = (page, fn, arg) => board(page).evaluate(fn, arg);
const api = (page, method, p, body) => page.evaluate(([m, p, b]) => document.querySelector('home-assistant').hass.callApi(m, p, b).catch((e) => { throw new Error(m + ' ' + p + ': ' + JSON.stringify(e)); }), [method, p, body]);
// what has focus inside the board: its tag, classes, and the box or button it is
const focused = (page) => el(page, (b) => { const a = b.shadowRoot.activeElement; return a ? { tag: a.tagName.toLowerCase(), cls: a.className && a.className.baseVal !== undefined ? a.className.baseVal : a.className, key: a.dataset && a.dataset.key, act: a.dataset && a.dataset.act, inModal: b._$.modal.contains(a), inDrawer: b._$.drawer.contains(a) } : null; });

// colours are judged at rest: a box pulsing for a run in progress is caught halfway otherwise (the pulses stop
// for less motion; what's left on screen is the same)
async function audit(page, name, found) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(150);
  await page.addScriptTag({ content: AXE }).catch(() => {});
  const v = await board(page).evaluate(async (b) => {
    const res = await window.axe.run(b, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return res.violations.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes.slice(0, 3).map((n) => n.target.join(' > ').slice(-70) + ' ' + ((n.any[0] || {}).message || '').replace(/^Element has /, '').slice(0, 110) + ' ' + n.html.slice(0, 60)).join(' | ')}`);
  });
  v.forEach((x) => found.push(`${name}: ${x}`));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

(async () => {
  const browser = await chromium.launch();

  // X1: axe across every view, both colour schemes
  for (const light of [false, true]) {
    const { page, ctx } = await freshBoard(browser, { viewport: { width: 1400, height: 880 }, light });
    page.allowFail = [/^trace\/get$/, /^supervisor\/api$/];
    const found = [];
    await importAll(page);
    const lid = await openFn(page, /garage/i);
    // with a problem on it, so the marks, the count and the Problems drawer are looked at too
    await api(page, 'POST', `config/automation/config/${PID}`, { alias: 'Garage a11y points at gone', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door_gone', to: 'open' }], actions: [{ action: 'cover.close_cover', target: { entity_id: 'cover.garage_door' } }] });
    await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], PKEY), 10000);
    await svc(page, 'automation', 'turn_off', {}, { entity_id: PKEY });
    await ws(page, { type: 'config/entity_registry/update', entity_id: PKEY, labels: [lid] });
    await until(() => el(page, (b) => (b._model && (b._model.problems || []).length >= 2) || null), 15000);
    await page.waitForTimeout(600);
    await audit(page, 'board', found);
    await fbq(page, '.pchip').click(); await fbq(page, '.drawer .probs .prow').first().waitFor({ timeout: 5000 });
    await audit(page, 'problems', found);
    await el(page, (b) => b._closeDrawer());
    await fbq(page, '[data-act="legend"]').first().click(); await page.waitForTimeout(400);
    await audit(page, 'key', found);
    await fbq(page, '[data-act="legend"]').first().click();
    await el(page, (b) => b._select('cover.garage_door')); await page.waitForTimeout(400);
    await audit(page, 'selected box', found);
    for (const act of ['debug', 'runs', 'versions']) {
      await fbq(page, `[data-act="${act}"]`).first().click();
      await fbq(page, '.drawer .dhead').waitFor({ timeout: 5000 }); await page.waitForTimeout(1200);
      await audit(page, act, found);
      await el(page, (b) => b._closeDrawer());
    }
    await fbq(page, '.tools [data-act="sandbox"]').click();
    await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
    await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
    await fbq(page, '.drawer .sbent').selectOption('cover.garage_door');
    await fbq(page, '.drawer .sbval-sel').selectOption('open');
    await fbq(page, '.drawer [data-act="sbx-set"]').click();
    await until(() => el(page, (b) => (b._sbx && !b._sbx.busy) || null), 15000); await page.waitForTimeout(800);
    await audit(page, 'sandbox', found);
    // axe sees only what's on screen at that moment; this looks at every box: no words faded with opacity
    const faded = await el(page, (b) => {
      const out = [], root = b.shadowRoot.querySelector('.nodes'), w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (!t.textContent.trim()) continue;
        let o = 1;
        for (let e = t.parentElement; e && e !== root; e = e.parentElement) o *= +getComputedStyle(e).opacity;
        if (o < 0.99) out.push(`${t.parentElement.className} "${t.textContent.trim().slice(0, 20)}" ${o.toFixed(2)}`);
      }
      return { out, dim: root.querySelectorAll('.node.dim').length };
    });
    check(`X2 no words on a box are faded with opacity, the sandbox's faded boxes included (${light ? 'light' : 'dark'})`, faded.dim > 0 && faded.out.length === 0, faded);
    await fbq(page, '.drawer [data-act="chk-save"]').click(); await fbq(page, '.modal .ckdlg').waitFor();
    await audit(page, 'save a check', found);
    await fbq(page, '.modal [data-act="modal-cancel"]').click(); await el(page, (b) => b._closeDrawer());
    await fbq(page, '[data-act="about"]').first().click(); await page.waitForTimeout(500);
    await audit(page, 'about', found);
    await fbq(page, '.modal [data-act="diag"]').click(); await page.waitForTimeout(800);
    await audit(page, 'diagnostics', found);
    await fbq(page, '.modal [data-act="modal-cancel"]').click();
    await fbq(page, '.lhead [data-act="import"]').click(); await page.waitForTimeout(1500);
    await audit(page, 'import', found);
    await fbq(page, '.modal [data-act="modal-cancel"]').first().click().catch(() => {});
    page.allowFail.push(/^automation\/config$/);
    await api(page, 'DELETE', `config/automation/config/${PID}`).catch(() => {});
    check(`X1 axe finds nothing in any view, ${light ? 'light' : 'dark'} mode`, found.length === 0, found);
    check(`X1 no errors (${light ? 'light' : 'dark'})`, page.logs.length === 0, page.logs);
    await ctx.close();
  }

  // K: the keyboard
  const { page, ctx } = await freshBoard(browser, { viewport: { width: 1400, height: 880 } });
  page.allowFail = [/^trace\/get$/, /^supervisor\/api$/, /^automation\/config$/];
  await importAll(page);
  const lid = await openFn(page, /garage/i);
  const tabbable = await el(page, (b) => [...b.shadowRoot.querySelectorAll('.nodes .node')].map((n) => n.getAttribute('tabindex')));
  check('K1 exactly one box is in the tab order (the rest are reached with the arrow keys)', tabbable.filter((t) => t === '0').length === 1 && tabbable.every((t) => t === '0' || t === '-1'), tabbable);
  await el(page, (b) => b.shadowRoot.querySelector('.nodes .node[tabindex="0"]').focus());
  const first = await focused(page);
  const moves = [];
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) { await page.keyboard.press(k); await page.waitForTimeout(120); const f = await focused(page); moves.push(f && f.key); }
  check('K2 the arrow keys move focus from box to box', !!first && first.key && moves.filter(Boolean).length === moves.length && new Set([first.key, ...moves]).size >= 2, { first, moves });
  const now = await focused(page);
  check('K2 ... and the box that has focus is the one the tab order starts from next time', await el(page, (b, k) => b.shadowRoot.querySelector(`.node[data-key="${k}"]`).getAttribute('tabindex') === '0', now.key));
  check('K3 the box the arrow keys reach is selected', (await el(page, (b) => b._sel)) === now.key);
  await page.keyboard.press('Escape');
  check('K3 Escape lets it go', !(await el(page, (b) => b._sel)));
  await page.keyboard.press(' ');
  check('K3 ... and Space selects it again', (await el(page, (b) => b._sel)) === now.key);
  await page.keyboard.press('Escape');
  // Enter on a box that opens its editor in the drawer: the drawer takes focus, and gives it back
  const auto = await el(page, (b) => [...b._model.nodes.keys()].find((k) => /^automation\./.test(k)));
  await el(page, (b, k) => { b._rove(k); b.shadowRoot.querySelector(`.node[data-key="${k}"]`).focus(); }, auto);
  await page.keyboard.press('Enter');
  await fbq(page, '.drawer .dhead').waitFor({ timeout: 8000 }); await page.waitForTimeout(300);
  const dr = await el(page, (b) => ({ role: b._$.drawer.getAttribute('role'), label: b._$.drawer.getAttribute('aria-label') }));
  const inDr = await focused(page);
  check('K4 Enter opens the box; the drawer is a named region', dr.role === 'complementary' && !!dr.label, dr);
  check('K4 ... and focus moves into it', !!inDr && inDr.inDrawer, inDr);
  await fbq(page, '.drawer [data-act="close"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const back = await focused(page);
  check('K4 closing the drawer gives focus back to the box', !!back && back.key === auto, back);
  // a dialog: focus goes in, stays in, Escape closes it and focus goes back to what opened it
  await fbq(page, '[data-act="about"]').first().focus();
  await page.keyboard.press('Enter');
  await fbq(page, '.modal .dlg').waitFor({ timeout: 5000 }); await page.waitForTimeout(200);
  const dlg = await el(page, (b) => { const d = b._$.modal.querySelector('.dlg'); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), named: !!(d.getAttribute('aria-labelledby') || d.getAttribute('aria-label')) }; });
  check('K5 a dialog is a named modal dialog', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.named, dlg);
  const trapped = [];
  for (let i = 0; i < 25; i++) { await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab'); const f = await focused(page); trapped.push(!!f && f.inModal); }
  check('K5 ... focus moves into it and Tab keeps it there', trapped.every(Boolean), trapped);
  await page.keyboard.press('Escape');
  const after = await until(async () => { const f = await focused(page); return f && f.act ? f : null; }, 2000);
  check('K5 Escape closes it and focus goes back to the button that opened it', (await el(page, (b) => b._$.modal.hidden)) && !!after && after.act === 'about', after);
  // a drawer opened from the toolbar: focus back to that button
  await fbq(page, '[data-act="runs"]').first().focus();
  await page.keyboard.press('Enter');
  await fbq(page, '.drawer .runs').waitFor({ timeout: 5000 }); await page.waitForTimeout(300);
  const inRuns = await focused(page);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const fromRuns = await focused(page);
  check('K6 a drawer opened from the toolbar takes focus, and Escape gives it back to that button', !!inRuns && inRuns.inDrawer && !!fromRuns && fromRuns.act === 'runs', { inRuns, fromRuns });

  // N: what's read out
  const names = await el(page, (b) => [...b.shadowRoot.querySelectorAll('.nodes .node')].map((n) => ({ label: n.getAttribute('aria-label') || '', name: (n.querySelector('.name') || {}).textContent || '' })));
  check('N1 every box has a name that starts with what it shows', names.length > 0 && names.every((n) => n.name && n.label.includes(n.name.trim())), names.filter((n) => !n.label.includes(n.name.trim())));
  const ID = PID, KEY = PKEY;
  await api(page, 'POST', `config/automation/config/${ID}`, { alias: 'Garage a11y points at gone', triggers: [{ trigger: 'state', entity_id: 'cover.garage_door_gone', to: 'open' }], actions: [{ action: 'cover.close_cover', target: { entity_id: 'cover.garage_door' } }] });
  await until(() => page.evaluate((k) => !!document.querySelector('home-assistant').hass.states[k], KEY), 10000);
  await svc(page, 'automation', 'turn_on', {}, { entity_id: KEY });
  await ws(page, { type: 'config/entity_registry/update', entity_id: KEY, labels: [lid] });
  const said = await until(() => el(page, (b, l) => {
    const r = b.shadowRoot, box = r.querySelector('.node[data-key="cover.garage_door_gone"]'), badge = r.querySelector(`.fn[data-fn="${l}"] .pbadge`);
    return box && badge && /doesn.t exist/.test(box.getAttribute('aria-label') || '') ? { box: box.getAttribute('aria-label'), badge: badge.querySelector('.srt') && badge.querySelector('.srt').textContent, shown: badge.querySelector('[aria-hidden="true"]') && badge.querySelector('[aria-hidden="true"]').textContent } : null;
  }, lid), 15000);
  check('N2 a box with a problem says what the problem is', !!said && /doesn.t exist/.test(said.box), said);
  check('N3 the list\'s problem count is read as "1 problem", not a bare number', !!said && said.shown === '1' && /^1 problem\b/.test(said.badge || '') && !/^\d+$/.test(said.badge || ''), said);
  await api(page, 'DELETE', `config/automation/config/${ID}`).catch(() => {});

  // M: less motion
  const flowAt = async () => {
    await fbq(page, '.tools [data-act="sandbox"]').click();
    await fbq(page, '.modal [data-act="sbx-start"]').click({ timeout: 3000 }).catch(() => {});
    await fbq(page, '.drawer .sbctl .sbent').waitFor({ timeout: 10000 });
    await fbq(page, '.drawer .sbent').selectOption('cover.garage_door');
    await fbq(page, '.drawer .sbval-sel').selectOption('open');
    await fbq(page, '.drawer [data-act="sbx-set"]').click();
    const f = await until(() => el(page, (b) => (b._flow && b._flow.steps.length > 1 && b._sbx && !b._sbx.busy) || null), 15000);
    const r = f && await el(page, (b) => { b._flowPlay(); return { at: b._flow.at, last: b._flow.steps.length - 1 }; });
    await el(page, (b) => b._closeDrawer()); await page.waitForTimeout(300);
    return r;
  };
  const moving = await flowAt();
  check('M1 normally a flow plays from its first step', !!moving && moving.at === 0 && moving.last > 0, moving);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await flowAt();
  check('M1 with less motion asked for, it shows the last step at once', !!still && still.at === still.last && still.last > 0, still);
  const dots = await el(page, (b) => getComputedStyle(b.shadowRoot.querySelector('.fdot') || b.shadowRoot.host).display);
  check('M1 ... and no dots run along the arrows', dots === 'none' || !(await el(page, (b) => !!b.shadowRoot.querySelector('.fdot'))), dots);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  check('no errors', page.logs.length === 0, page.logs);
  await ctx.close();
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
