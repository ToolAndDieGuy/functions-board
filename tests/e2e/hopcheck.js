// Every place a level run of one arrow crosses an upright run of another (not of the same shared line) should
// have a hop drawn over it. Runs in the page: board(page).evaluate(hopCheck).
function hopCheck(el) {
  const R = el._ortho;
  if (!R || !R.hops) return { error: 'no square-cornered routes drawn' };
  const ups = [], miss = [];
  let crossings = 0;
  R.routes.forEach((p, ri) => { for (let i = 1; i < p.length; i++) if (Math.abs(p[i - 1][0] - p[i][0]) < 0.5) ups.push({ ri, x: p[i][0], lo: Math.min(p[i - 1][1], p[i][1]), hi: Math.max(p[i - 1][1], p[i][1]) }); });
  R.routes.forEach((p, ri) => {
    const mine = R.owners[ri] || [], hops = new Map(R.hops[ri]);
    for (let i = 1; i < p.length; i++) {
      const u = p[i - 1], v = p[i];
      if (Math.abs(u[1] - v[1]) > 0.5) continue;
      const a = Math.min(u[0], v[0]), b = Math.max(u[0], v[0]);
      ups.forEach((w) => {
        if (w.ri === ri || w.x <= a + 0.5 || w.x >= b - 0.5 || u[1] <= w.lo + 0.5 || u[1] >= w.hi - 0.5) return;
        if ((R.owners[w.ri] || []).some((o) => o && mine.includes(o))) return;
        crossings++;
        if (!(hops.get(i) || []).some(([x0, x1]) => w.x >= Math.min(x0, x1) - 1 && w.x <= Math.max(x0, x1) + 1)) miss.push({ a: R.ids[ri], b: R.ids[w.ri], x: Math.round(w.x), y: Math.round(u[1]), fromEnd: Math.round(Math.min(w.x - a, b - w.x)) });
      });
    }
  });
  return { crossings, missed: miss.length, sample: miss.slice(0, 5) };
}
module.exports = { hopCheck };
