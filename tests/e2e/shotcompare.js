// The README's screenshots against the board as it is now (weekly, layer 5): tests/shots.sh takes them afresh into
// a folder of their own; this compares each with the one in docs/images and writes JUnit (e2e-shots), so a change
// that alters what the README shows, without new pictures, is noticed.
//   node tests/e2e/shotcompare.js <new folder> [<old folder: docs/images>]
// Two pictures match when they are the same size and few of their pixels differ by more than a little (anti-aliasing
// and font hinting move a few). For each that doesn't, a picture of the difference goes to <new folder>/diff-<name>.png.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { write } = require('../lib/junit');

const [neu, old = path.join(__dirname, '..', '..', 'docs', 'images')] = process.argv.slice(2);
const R = process.env.FB_RESULTS || path.join(__dirname, '..', '.results');
// a pixel differs when any channel is more than TOL out of 255; a picture differs when more than SHARE of them do
const TOL = 24, SHARE = 0.01;
// pictures with a part Home Assistant doesn't hold still: the debugger lists events of the same instant in the order
// they arrive, which changes from run to run (two CI runs of the same code: 17% of debug.png differed), so for it only
// its size and a large change count
const LOOSE = { 'debug.png': 0.35 };

const raw = async (f) => { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };

(async () => {
  const cases = [];
  for (const f of fs.readdirSync(old).filter((x) => x.endsWith('.png')).sort()) {
    const name = `${f}: the README's picture still shows the board as it is`, nf = path.join(neu, f);
    if (!fs.existsSync(nf)) { cases.push({ name, ok: false, detail: 'not taken again (tests/e2e/screens.js no longer makes it?)' }); continue; }
    const a = await raw(path.join(old, f)), b = await raw(nf);
    if (a.w !== b.w || a.h !== b.h) { cases.push({ name, ok: false, detail: `size ${a.w}×${a.h} in the README, ${b.w}×${b.h} now: retake it (node tests/e2e/screens.js)` }); continue; }
    const diff = Buffer.alloc(a.data.length);
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d > TOL) { n++; diff[i] = 255; diff[i + 3] = 255; } else { diff[i] = diff[i + 1] = diff[i + 2] = b.data[i] >> 2; diff[i + 3] = 255; }
    }
    const share = n / (a.w * a.h), ok = share <= (LOOSE[f] || SHARE);
    if (!ok) await sharp(diff, { raw: { width: a.w, height: a.h, channels: 4 } }).png().toFile(path.join(neu, 'diff-' + f));
    cases.push({ name, ok, detail: ok ? '' : `${(share * 100).toFixed(1)}% of its pixels differ: retake it (node tests/e2e/screens.js), or look at diff-${f}` });
  }
  // and a picture screens.js makes that the README doesn't have yet: new, so it goes to docs/images like a changed one
  for (const f of fs.readdirSync(neu).filter((x) => x.endsWith('.png') && !x.startsWith('diff-') && x !== 'failed-here.png').sort()) {
    if (!fs.existsSync(path.join(old, f))) cases.push({ name: `${f}: a new picture, in docs/images`, ok: false, detail: 'new: not in docs/images yet' });
  }
  write(path.join(R, 'e2e-shots.xml'), 'shots', cases);
  cases.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok ? '' : '  -- ' + c.detail)));
  process.exit(cases.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
