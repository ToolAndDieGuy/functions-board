// Drawing (0.10.0): morph(), which puts a view's HTML on the page by updating what's there, on the fake Home
// Assistant's page (it needs a real DOM). The rebuild's board draws the list, the header, the boxes and the drawer
// with it; tests/board/snapshots.test.js holds that what's drawn is the same as before.
//
//   D1  the result is what innerHTML would make, for a run of HTML changes (added, removed, moved, changed)
//   D2  an element that's still there is the same element: matched by its data-key (and the like), even moved;
//       focus and a scrolled place stay with it, and so does a listener put on it
//   D3  a form field gets the value its HTML gives it, as innerHTML would, unless it has focus
//   D4  an <svg>'s content is put whole (its elements in the SVG namespace)
const { session, suite } = require('./helpers');
const { test } = require('./fixtures');
const { check, done } = suite('board-draw');

test('morph', async ({ browser }) => {
  const { page } = await session(browser);
  const r = await page.evaluate(() => {
    const morph = customElements.get('functions-board').morph, out = {};
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const box = document.createElement('div'); root.appendChild(box);
    const twin = document.createElement('div');
    const same = (html) => { morph(box, html); twin.innerHTML = html; return box.innerHTML === twin.innerHTML; };
    // D1: a run of changes, each compared with innerHTML
    const runs = [
      '<ul><li data-key="a">A</li><li data-key="b">B</li></ul><p>text <b>bold</b></p>',
      '<ul><li data-key="b" class="x">B2</li><li data-key="a">A</li><li data-key="c">C</li></ul>',
      '<ul><li data-key="c">C</li></ul><p>other</p><button data-act="go" title="t">Go</button>',
      '<button data-act="go">Go!</button><button data-act="fn-menu" data-label="garage">…</button><button data-act="fn-menu" data-label="morning">…</button>',
      '<button data-act="fn-menu" data-label="morning">…</button><span>plain</span><span>plain 2</span>',
      '',
      '<div class="a"><div class="b"><span hidden>x</span></div></div>  <!-- a comment --> tail',
      '<div class="a" style="color:red"><div class="c">y</div></div>',
    ];
    out.d1 = runs.map((h, i) => same(h) ? null : i).filter((x) => x !== null);
    // D2: the same element, moved; focus, scroll and a listener stay
    morph(box, '<div data-key="one" tabindex="0" style="height:40px;overflow:auto"><div style="height:400px">tall</div></div><div data-key="two" tabindex="0">2</div>');
    const one = box.querySelector('[data-key="one"]'), two = box.querySelector('[data-key="two"]');
    one.scrollTop = 120; let heard = 0; two.addEventListener('click', () => heard++);
    two.focus();
    morph(box, '<div data-key="two" tabindex="0" class="moved">2!</div><div data-key="zero">0</div><div data-key="one" tabindex="0" style="height:40px;overflow:auto"><div style="height:400px">tall</div></div>');
    box.querySelector('[data-key="two"]').click();
    out.d2 = { sameOne: box.querySelector('[data-key="one"]') === one, sameTwo: box.querySelector('[data-key="two"]') === two, focus: root.activeElement === two, scroll: one.scrollTop, heard, order: [...box.children].map((c) => c.dataset.key).join(), text: two.textContent, cls: two.className };
    // the buttons a list draws are told apart by what they're for, not where they are
    morph(box, '<button data-act="fn-menu" data-label="garage">g</button><button data-act="fn-menu" data-label="morning">m</button>');
    const m = box.querySelector('[data-label="morning"]');
    morph(box, '<button data-act="fn-menu" data-label="morning">m</button>');
    out.d2b = box.firstElementChild === m;
    // D3: form fields
    morph(box, '<input name="a" value="one"><input name="b" value="two"><input type="checkbox" name="c" checked><select name="s"><option value="x">x</option><option value="y" selected>y</option></select><textarea name="t">t1</textarea>');
    const a = box.querySelector('[name=a]'), b = box.querySelector('[name=b]'), c = box.querySelector('[name=c]'), sel = box.querySelector('select'), ta = box.querySelector('textarea');
    a.value = 'typed in a'; b.value = 'typed in b'; c.checked = false; sel.value = 'x'; ta.value = 'typed';
    b.focus();
    morph(box, '<input name="a" value="one"><input name="b" value="two"><input type="checkbox" name="c" checked><select name="s"><option value="x">x</option><option value="y" selected>y</option></select><textarea name="t">t1</textarea>');
    out.d3 = { a: a.value, b: b.value, c: c.checked, s: sel.value, t: ta.value, same: box.querySelector('[name=a]') === a };
    // D4: svg
    morph(box, '<svg viewBox="0 0 10 10"><path d="M0,0 L1,1"></path></svg>');
    morph(box, '<svg viewBox="0 0 10 10"><circle r="2"></circle></svg>');
    const circ = box.querySelector('circle');
    out.d4 = { ns: circ && circ.namespaceURI, shown: !!circ && !box.querySelector('path') };
    return out;
  });
  check('D1 morph makes what innerHTML would, through a run of changes', r.d1.length === 0, r.d1);
  check('D2 an element still there is the same element, though moved and changed', r.d2.sameOne && r.d2.sameTwo && r.d2.order === 'two,zero,one' && r.d2.text === '2!' && r.d2.cls === 'moved', r.d2);
  check('D2 ... it keeps focus, its scrolled place and a listener put on it', r.d2.focus && r.d2.scroll === 120 && r.d2.heard === 1, r.d2);
  check('D2 buttons alike but for what they\'re for (data-label) are told apart', r.d2b === true);
  check('D3 a form field without focus gets the value its HTML gives it (as innerHTML would)', r.d3.a === 'one' && r.d3.c === true && r.d3.s === 'y' && r.d3.t === 't1' && r.d3.same, r.d3);
  check('D3 ... the one with focus keeps what\'s being typed', r.d3.b === 'typed in b', r.d3);
  check('D4 an <svg>\'s content is put whole, in the SVG namespace', r.d4.shown && r.d4.ns === 'http://www.w3.org/2000/svg', r.d4);
});

test.afterAll(() => done());
