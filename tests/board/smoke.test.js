// The board starts on the fake Home Assistant, imports the test config's functions and draws the garage.
const { test } = require('./fixtures');
const { session, fbq, board, until, importAll, openFn, suite } = require('./helpers');
const { check, done } = suite('board-smoke');

test('the board starts, imports and draws the garage', async ({ browser, fake }) => {
  const { page } = await session(browser);
  await fbq(page, '.empty.wel').waitFor({ timeout: 15000 });
  check('smoke: the first-run welcome shows', true);
  await importAll(page);
  const fns = await board(page).evaluate((b) => b._data.functions.length);
  check('smoke: import makes functions (labels in the fake)', fns >= 3 && fake.labels.length >= 3, { fns, labels: fake.labels.map((l) => l.name) });
  await openFn(page, /garage/i);
  const n = await until(() => board(page).evaluate((b) => b.shadowRoot.querySelectorAll('.nodes .node').length), 10000);
  check('smoke: the garage is drawn', n >= 6, n);
  check('smoke: no errors', page.logs.length === 0, page.logs);
});

// The fake's jitter mode (FB_JITTER, fake-ha.js) does what it says: with it, an event sent while answering a call
// reaches the page sometimes before the answer and sometimes after, and events keep their order; without it, the
// event always comes first (as the fake has always done). A jitter that changed nothing would let every board test
// pass under it without having tried anything.
test('the fake\'s jitter puts events before and after answers', async ({ browser }) => {
  const { FakeHA } = require('./fake-ha');
  const probe = async (jitter) => {
    const f = new FakeHA({ jitter });
    const { ctx, page } = await f.open(browser, {});
    const r = await page.evaluate(async () => {
      const conn = document.querySelector('home-assistant').hass.connection, got = [], order = [];
      await conn.subscribeMessage((ev) => got.push(ev.data.n), { type: 'subscribe_events', event_type: 'fb_probe' });
      for (let n = 0; n < 40; n++) {
        await conn.sendMessagePromise({ type: 'fire_event', event_type: 'fb_probe', event_data: { n } });
        order.push(got.includes(n) ? 'before' : 'after');
      }
      for (let i = 0; i < 50 && got.length < 40; i++) await new Promise((x) => setTimeout(x, 100));
      return { order, got };
    });
    await ctx.close();
    return { before: r.order.filter((x) => x === 'before').length, after: r.order.filter((x) => x === 'after').length, inOrder: r.got.join() === [...Array(40).keys()].join() };
  };
  const plain = await probe(''), shaken = await probe('smoke');
  check('J1 without jitter, an event always comes before the answer it goes with', plain.before === 40 && plain.inOrder, plain);
  check('J2 with jitter, events come both before and after their answers, and in order', shaken.before >= 3 && shaken.after >= 3 && shaken.inOrder, shaken);
});
// A call the board reports as failed is an error in a board test (tests/board/fake-ha.js), as a failed answer is in
// the real-HA suites, unless the test says it expects that call to fail (page.allowFail). Without it, a failure the
// board reports when nothing has gone wrong (an expected one not marked optional) would pass every test.
test('a failure the board reports is an error in the test, unless it is expected', async ({ browser, fake }) => {
  const { page } = await session(browser);
  await fbq(page, '.empty.wel').waitFor({ timeout: 15000 });
  fake.answers = { 'config/category_registry/list': () => { throw Object.assign(new Error('planted'), { code: 'planted_failure' }); } };
  await board(page).evaluate((b) => b._ws({ type: 'config/category_registry/list', scope: 'automation' }, { fallback: [] }));
  await until(() => page.logs.length || null, 3000);
  check('J3 a reported failure is in the page\'s errors', page.logs.some((l) => /^reported: .*config\/category_registry\/list failed \(planted_failure\)/.test(l)), page.logs);
  page.logs = []; page.allowFail = [/^config\/category_registry\/list$/];
  await board(page).evaluate((b) => b._ws({ type: 'config/category_registry/list', scope: 'automation' }, { fallback: [] }));
  await page.waitForTimeout(300);
  check('J3 ... and not when the test expects that call to fail', page.logs.length === 0, page.logs);
  fake.answers = null;
});

// Phase 2/3: CONF_CARD=true loads card-loader.js on every page before panel_custom opens /functions.
// Verify the custom-element shell constructs cleanly without setting host attributes, lazy-loads the full board
// for admins in both load orders, and never downloads functions-board.js for non-admin users.
test('card-loader mounts the panel for admins and blocks full-board download for non-admins', async ({ browser }) => {
  const fs = require('fs');
  const path = require('path');
  const { FakeHA } = require('./fake-ha');
  const FRONT = path.join(__dirname, '..', '..', 'custom_components', 'functions_board', 'frontend');

  const runLoader = async ({ admin, preloadBoard }) => {
    const f = new FakeHA({ mode: 'full', admin });
    f.dark = new WeakMap();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    f.dark.set(page, true);
    const errors = [];
    const requested = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await ctx.route('**/*', (r) => {
      const url = r.request().url();
      if (url.startsWith('http://fake.ha/functions')) {
        return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"><home-assistant></home-assistant></body></html>' });
      }
      if (url.startsWith('http://fake.ha/fb/')) {
        const rel = url.slice('http://fake.ha/fb/'.length).split('?')[0];
        requested.push(rel);
        const full = path.resolve(FRONT, rel);
        if (full.startsWith(FRONT + path.sep) && full.endsWith('.js') && fs.existsSync(full)) {
          return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(full, 'utf8') });
        }
      }
      return r.fulfill({ status: 204, body: '' });
    });
    await page.exposeBinding('__fbHA', async (src, req) => {
      try { return { ok: true, result: await f._handle(page, req) }; } catch (e) { return { ok: false, error: { code: e.code || 'err', message: e.message } }; }
    });
    await page.goto('http://fake.ha/functions');
    const out = await page.evaluate(async (preload) => {
      const call = (kind, m) => window.__fbHA({ kind, m }).then((r) => (r.ok ? r.result : Promise.reject(r.error)));
      const v = (await window.__fbHA({ kind: 'view' })).result;
      const conn = { subscribeMessage: async () => async () => {}, subscribeEvents: async () => async () => {}, sendMessagePromise: (m) => call('ws', m), addEventListener() {}, removeEventListener() {} };
      const hass = { states: v.states, user: v.user, themes: { darkMode: true, themes: {} }, language: 'en', locale: { language: 'en' }, config: v.config, services: v.services, panels: { functions: v.panel }, connected: true, auth: { data: { hassUrl: location.origin } }, callWS: (m) => call('ws', m), callApi: (method, p, body) => call('api', { method, path: p, body }), callService: (d, s, data, t) => call('svc', { domain: d, service: s, data, target: t }), connection: conn };
      document.querySelector('home-assistant').hass = hass;
      await import('/fb/card-loader.js');
      if (preload) await import('/fb/functions-board.js');
      const el = document.createElement('functions-board');
      const ctor = customElements.get('functions-board');
      const stub = typeof ctor.getStubConfig === 'function' ? ctor.getStubConfig() : null;
      el.panel = v.panel;
      el.narrow = false;
      el.route = { prefix: '/functions', path: '' };
      el.isPanel = false;
      el.layout = 'panel';
      el.hass = hass;
      document.body.appendChild(el);
      if (v.user.is_admin) {
        const end = Date.now() + 8000;
        while (Date.now() < end) {
          const inner = el.shadowRoot && el.shadowRoot.querySelector('functions-board-app');
          if (inner && inner.shadowRoot && inner.shadowRoot.querySelector('.board')) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }
      const inner = el.shadowRoot && el.shadowRoot.querySelector('functions-board-app');
      const board = inner && inner.shadowRoot && inner.shadowRoot.querySelector('.board');
      const rect = board ? board.getBoundingClientRect() : null;
      return {
        hasInner: !!inner,
        hasBoard: !!board,
        width: rect ? rect.width : 0,
        height: rect ? rect.height : 0,
        version: ctor && ctor.VERSION || null,
        cardSize: typeof el.getCardSize === 'function' ? el.getCardSize() : null,
        gridCols: typeof el.getGridOptions === 'function' && el.getGridOptions() ? el.getGridOptions().columns : null,
        hasStub: !!stub && typeof stub === 'object',
        panelOk: el.panel === v.panel,
        deniedText: el.shadowRoot ? el.shadowRoot.textContent.trim() : '',
      };
    }, preloadBoard);
    await ctx.close();
    return { out, errors, requested };
  };

  const lazy = await runLoader({ admin: true, preloadBoard: false });
  check('card-loader (lazy): admin panel mounts full board with zero errors',
    lazy.errors.length === 0 && lazy.out.hasInner && lazy.out.hasBoard && lazy.out.width > 800 && lazy.out.height > 400
    && !!lazy.out.version && lazy.out.cardSize === 12 && lazy.out.gridCols === 'full' && lazy.out.hasStub && lazy.out.panelOk,
    lazy);

  const pre = await runLoader({ admin: true, preloadBoard: true });
  check('card-loader (panel_custom preload): admin panel mounts immediately with zero errors',
    pre.errors.length === 0 && pre.out.hasInner && pre.out.hasBoard && pre.out.width > 800 && pre.out.height > 400 && !!pre.out.version,
    pre);

  const nonAdmin = await runLoader({ admin: false, preloadBoard: false });
  check('card-loader (non-admin): shows admin-only notice and never downloads functions-board.js',
    nonAdmin.errors.length === 0 && !nonAdmin.out.hasInner && !nonAdmin.requested.includes('functions-board.js')
    && /administrators only/i.test(nonAdmin.out.deniedText),
    nonAdmin);
});
test.afterAll(() => done());
