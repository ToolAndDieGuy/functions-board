// Before a test build replaces the board on a real Home Assistant: the board as installed and the test build side
// by side, on a page of Home Assistant that isn't the board. Each is defined under its own name, started with this
// page's hass off the page, and every function is built by both. For each: boxes, members, outside items,
// suggestions, arrows, loops and problems must match. Only looks: both boards' saving and routing are switched off.
// Use (in the browser's console, or by a test): put the test build's text in localStorage under '__fb_rc1', load
// this file, then `await __fbCompare()` (or `__fbCompare(url)` to take the installed board from another address).
// Remove '__fb_rc1' afterwards. Run in 0.10.0's release against a real home before the swap (tests/README.md).
window.__fbCompare = async (oldUrl) => {
  const hass = document.querySelector('home-assistant').hass;
  const define = async (src, tag) => {
    const t = src
      .replace("customElements.define('functions-board', FunctionsBoard);", `customElements.define('${tag}', FunctionsBoard);`)
      .replace('window.customCards.push({', 'void ({');
    if (customElements.get(tag)) return;
    const url = URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
    await import(url);
  };
  const old = await (await fetch(oldUrl || '/functions_board_static/functions-board.js?cmp=' + Date.now())).text();
  const rc = localStorage.getItem('__fb_rc1');
  if (!rc) throw new Error('no test build in localStorage');
  await define(old, 'fb-cmp-old');
  await define(rc, 'fb-cmp-rc');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-5000px;top:0;width:1400px;height:900px;overflow:hidden';
  document.body.appendChild(host);
  const start = async (tag) => {
    const b = document.createElement(tag);
    // looked at only: nothing saved, no route pushed (as a card, off the page)
    b._save = () => {}; b._flushSave = () => {}; b._writeNow = async () => {}; b._doSave = () => {}; b._pushRoute = () => {};
    host.appendChild(b);
    b.hass = hass;
    for (let i = 0; i < 300 && !(b._data && b._labelMap && !b._booting); i++) await new Promise((r) => setTimeout(r, 100));
    return b;
  };
  const a = await start('fb-cmp-old'), b = await start('fb-cmp-rc');
  const count = (m) => {
    const n = [...m.nodes.values()];
    return {
      boxes: n.length, members: n.filter((x) => x.kind === 'member').length, outside: n.filter((x) => x.kind === 'outside').length,
      suggest: n.filter((x) => x.kind === 'suggest').length, arrows: m.edges.length, loops: m.edges.filter((e) => e.loop).length,
      problems: (m.problems || []).map((p) => p.kind + ' ' + p.ref).sort().join(', '),
    };
  };
  const out = [];
  for (const label of a._data.functions) {
    let x, y;
    try { x = count(await a._buildModel(label)); } catch (e) { x = { error: String(e) }; }
    try { y = count(await b._buildModel(label)); } catch (e) { y = { error: String(e) }; }
    out.push({ label, same: JSON.stringify(x) === JSON.stringify(y), old: x, rc: y });
  }
  a.remove(); b.remove(); host.remove();
  return { functions: out.length, same: out.filter((r) => r.same).length, differ: out.filter((r) => !r.same), all: out.map((r) => ({ label: r.label, counts: r.rc })), versions: [customElements.get('fb-cmp-old').VERSION, customElements.get('fb-cmp-rc').VERSION] };
};
