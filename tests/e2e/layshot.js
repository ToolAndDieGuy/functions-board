// Screenshots of a function's automatic layout, for comparing layout and arrow variants: the whole function, and a
// close-up, with the route check's numbers. Nothing is saved to the board.
// node tests/e2e/layshot.js <name> [labelRegex] [proto-json]   ->  tests/e2e/.state/shots/<name>*.png
// proto-json sets PROTO() switches through window.__fbStyle, e.g. '{"rad": 10}'. Usually against the demo
// Home Assistant (sh tests/start-ha.sh demo), whose "Away mode" is the largest function.
const path = require('path');
const fs = require('fs');
const { chromium, BASE, STATE, session, ws, ready, fbq, board } = require('./lib');
const { routeCheck } = require('./routecheck');
const [name, re = 'Away', proto = '{}'] = process.argv.slice(2);
fs.mkdirSync(path.join(STATE, 'shots'), { recursive: true });
(async () => {
  const b = await chromium.launch();
  const { ctx, page } = await session(b, 'owner', { viewport: { width: 1600, height: 900 }, scale: 1 });
  await ctx.addInitScript((p) => { window.__fbStyle = JSON.parse(p); localStorage.setItem('dockedSidebar', '"auto"'); }, proto);
  await page.goto(BASE + '/'); await ready(page);
  const labels = await ws(page, { type: 'config/label_registry/list' });
  const l = labels.find((x) => new RegExp(re).test(x.name));
  await page.goto(BASE + '/functions/' + l.label_id);
  await fbq(page, '.nodes .node').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  // the automatic layout, without saving it
  await board(page).evaluate((el) => { el._data.ui.list = false; el._data.ui.legend = false; el._renderList(); el._renderLegend && el._renderLegend(); const L = el._layout(el._model.label); el.__saved = L.nodes; L.nodes = {}; el._place(); el._render(); el._fit(); });
  await page.waitForTimeout(600);
  // fit the whole function, however small that makes it
  await board(page).evaluate((el) => {
    const ns = [...el._model.nodes.values()], x0 = Math.min(...ns.map((n) => n.x)), x1 = Math.max(...ns.map((n) => n.x + n.w)), y0 = Math.min(...ns.map((n) => n.y)), y1 = Math.max(...ns.map((n) => n.y + n.h));
    const vw = el._$.vp.clientWidth, vh = el._$.vp.clientHeight, k = Math.min(1.2, (vw - 60) / (x1 - x0), (vh - 60) / (y1 - y0));
    el._view = { k, x: (vw - (x1 - x0) * k) / 2 - x0 * k, y: (vh - (y1 - y0) * k) / 2 - y0 * k }; el._applyView();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(STATE, 'shots', name + '.png') });
  // and 1:1 on the left part, for the details
  await board(page).evaluate((el) => {
    const ns = [...el._model.nodes.values()], x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y)), y1 = Math.max(...ns.map((n) => n.y + n.h));
    const vh = el._$.vp.clientHeight; el._view = { k: 1, x: 30 - x0, y: Math.max(30 - y0, (vh - (y1 - y0)) / 2 - y0) }; el._applyView();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(STATE, 'shots', name + '-1to1.png') });
  const stats = await board(page).evaluate((el) => { const ns = [...el._model.nodes.values()]; const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y); return { boxes: ns.length, arrows: el._visEdges().length, w: Math.max(...ns.map((n) => n.x + n.w)) - Math.min(...xs), h: Math.max(...ns.map((n) => n.y + n.h)) - Math.min(...ys), k: el._view.k.toFixed(2) }; });
  stats.check = await board(page).evaluate(routeCheck, { min: +(process.env.FB_MIN || 14), pts: !!process.env.FB_PTS, n: +(process.env.FB_N || 6) }).catch((e) => String(e));
  console.log(name, JSON.stringify(stats));
  await b.close();
})();
