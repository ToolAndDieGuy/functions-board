// Two boards open at once: an idle board writes nothing, a change reaches the other board, and two
// changes to different functions made at the same moment both survive. node sync.test.js
const { chromium, BASE, session, fbq, board, ws, ready, until, suite, reset, importAll } = require('./lib');
const { check, done } = suite('sync');

const writes = (page) => page.sent.filter((m) => /^functions_board\/(set|set_layout|set_functions)$/.test(m.type)).length;

(async () => {
  const browser = await chromium.launch();
  {
    const s = await session(browser, 'owner');
    await s.page.goto(BASE + '/');
    await ready(s.page);
    await reset(s.page);
    await importAll(s.page);
    await s.ctx.close();
  }
  const A = await session(browser, 'owner'), B = await session(browser, 'owner');
  await A.page.goto(BASE + '/functions'); await B.page.goto(BASE + '/functions');
  await fbq(A.page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await fbq(B.page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await A.page.waitForTimeout(3000);
  check('an idle board writes nothing', writes(A.page) === 0 && writes(B.page) === 0, [writes(A.page), writes(B.page)]);

  const b0 = await fbq(B.page, '.notes .note').count();
  await fbq(A.page, '[data-act="note"]').click();
  await fbq(A.page, '.notes textarea').last().fill('hello from A');
  await fbq(A.page, '.vp').click({ position: { x: 50, y: 50 } });
  const ok = await until(async () => (await fbq(B.page, '.notes .note').count()) === b0 + 1, 6000);
  check('a note added on A shows on B', ok);
  check('with its text', (await fbq(B.page, '.notes textarea').last().inputValue().catch(() => '')) === 'hello from A');

  // A edits one function while B edits another, at the same moment
  const fns = await board(A.page).evaluate((el) => el._data.functions);
  await board(A.page).evaluate((el, l) => el._open(l), fns[0]);
  await board(B.page).evaluate((el, l) => el._open(l), fns[1]);
  await A.page.waitForTimeout(1500);
  await Promise.all([
    board(A.page).evaluate((el) => { el._layout(el._data.ui.current).notes.push({ id: 'na', text: 'A', x: 0, y: 0, w: 200 }); el._save(); }),
    board(B.page).evaluate((el) => { el._layout(el._data.ui.current).notes.push({ id: 'nb', text: 'B', x: 0, y: 0, w: 200 }); el._save(); }),
  ]);
  await A.page.waitForTimeout(3500);
  const data = (await ws(A.page, { type: 'functions_board/get' })).data;
  const hasA = (data.layouts[fns[0]] || { notes: [] }).notes.some((n) => n.id === 'na');
  const hasB = (data.layouts[fns[1]] || { notes: [] }).notes.some((n) => n.id === 'nb');
  check('simultaneous edits to two functions both survive', hasA && hasB, { hasA, hasB });
  check('no errors on A or B', !A.page.logs.length && !B.page.logs.length, A.page.logs.concat(B.page.logs));
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
