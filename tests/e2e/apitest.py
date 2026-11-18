"""End-to-end API test of the functions_board integration against a local HA."""
import asyncio, json, os, secrets, sys, time
import aiohttp

BASE = os.environ.get("FB_HA_URL") or "http://127.0.0.1:8123"
CID = BASE + "/"
HERE = os.path.dirname(os.path.abspath(__file__))
# Tokens and credentials go to the state folder; the store is checked in the test instance's config folder.
STATE = os.environ.get("FB_E2E_STATE") or os.path.join(HERE, ".state")
os.makedirs(STATE, exist_ok=True)
# each Home Assistant (the test one and the demo one, see tests/start-ha.sh) keeps its own login: onboarding one
# mustn't lose the other's password
try:
    INSTANCE = open(os.path.join(STATE, "instance")).read().strip()
except OSError:
    INSTANCE = "test"
CREDS = os.path.join(STATE, "creds.json" if INSTANCE == "test" else f"creds-{INSTANCE}.json")
# the running instance's config folder (run-all.sh sets FB_HA_CONFIG; by hand, it follows tests/start-ha.sh)
HA_CONFIG = os.environ.get("FB_HA_CONFIG") or os.path.join(HERE, "..", "..", "ha-demo" if INSTANCE == "demo" else "ha", "config")
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (("  -- " + str(detail)[:300]) if detail and not ok else ""))


async def token_from_code(s, code):
    async with s.post(BASE + "/auth/token", data={"grant_type": "authorization_code", "code": code, "client_id": CID}) as r:
        return await r.json()


async def login(s, username, password):
    async with s.post(BASE + "/auth/login_flow", json={"client_id": CID, "handler": ["homeassistant", None], "redirect_uri": CID}) as r:
        flow = await r.json()
    async with s.post(BASE + f"/auth/login_flow/{flow['flow_id']}", json={"username": username, "password": password, "client_id": CID}) as r:
        res = await r.json()
    return await token_from_code(s, res["result"])


class WS:
    def __init__(self, s, token):
        self.s, self.token, self.i, self.events = s, token, 0, []

    async def open(self):
        self.ws = await self.s.ws_connect(BASE + "/api/websocket")
        await self.ws.receive_json()
        await self.ws.send_json({"type": "auth", "access_token": self.token})
        m = await self.ws.receive_json()
        assert m["type"] == "auth_ok", m
        return self

    async def call(self, **msg):
        self.i += 1
        msg["id"] = self.i
        await self.ws.send_json(msg)
        while True:
            m = await self.ws.receive_json()
            if m.get("type") == "event":
                self.events.append(m)
                continue
            if m.get("id") == self.i:
                return m

    async def drain(self, secs=1.0):
        end = time.time() + secs
        while time.time() < end:
            try:
                m = await asyncio.wait_for(self.ws.receive_json(), timeout=max(0.05, end - time.time()))
                if m.get("type") == "event":
                    self.events.append(m)
            except asyncio.TimeoutError:
                break


async def main():
    async with aiohttp.ClientSession() as s:
        # ---- onboarding (owner = admin) ----
        async with s.get(BASE + "/api/onboarding") as r:
            steps = await r.json() if r.status == 200 else [{"done": True}]
        if not steps[0]["done"]:
            pw = secrets.token_urlsafe(18)
            async with s.post(BASE + "/api/onboarding/users", json={"client_id": CID, "name": "Test Owner", "username": "owner", "password": pw, "language": "en"}) as r:
                code = (await r.json())["auth_code"]
            tok = await token_from_code(s, code)
            creds = {"owner": {"username": "owner", "password": pw}}
            H = {"Authorization": "Bearer " + tok["access_token"]}
            for step, body in (("core_config", {}), ("analytics", {}), ("integration", {"client_id": CID, "redirect_uri": CID})):
                async with s.post(BASE + f"/api/onboarding/{step}", json=body, headers=H) as r:
                    pass
            json.dump(creds, open(CREDS, "w"))
        creds = json.load(open(CREDS))
        tok = await login(s, "owner", creds["owner"]["password"])
        H = {"Authorization": "Bearer " + tok["access_token"]}
        json.dump({"access_token": tok["access_token"], "refresh_token": tok.get("refresh_token"), "expires_in": tok["expires_in"]}, open(os.path.join(STATE, "owner_token.json"), "w"))
        check("owner login", "access_token" in tok)

        ws = await WS(s, tok["access_token"]).open()

        # ---- start clean: remove an entry left by an earlier run ----
        async with s.get(BASE + "/api/config/config_entries/entry?domain=functions_board", headers=H) as r:
            for e in await r.json():
                async with s.delete(BASE + f"/api/config/config_entries/entry/{e['entry_id']}", headers=H):
                    pass
        await asyncio.sleep(0.5)

        # ---- before setup: no panel ----
        p = (await ws.call(type="get_panels"))["result"]
        check("panel absent before config entry", "functions" not in p)

        # ---- config flow ----
        async with s.post(BASE + "/api/config/config_entries/flow", json={"handler": "functions_board", "show_advanced_options": False}, headers=H) as r:
            f = await r.json()
        check("config flow shows form", f.get("type") == "form" and f.get("step_id") == "user", f)
        async with s.post(BASE + f"/api/config/config_entries/flow/{f['flow_id']}", json={}, headers=H) as r:
            f2 = await r.json()
        check("config flow creates entry", f2.get("type") == "create_entry", f2)
        entry_id = f2.get("result", {}).get("entry_id")
        await asyncio.sleep(1)

        async with s.post(BASE + "/api/config/config_entries/flow", json={"handler": "functions_board"}, headers=H) as r:
            f3 = await r.json()
        check("second flow aborts (single instance)", f3.get("type") == "abort" and f3.get("reason") == "single_instance_allowed", f3)

        # ---- panel ----
        p = (await ws.call(type="get_panels"))["result"]
        fp = p.get("functions")
        check("panel registered", fp is not None, list(p))
        if fp:
            cfg = fp.get("config") or {}
            cc = cfg.get("_panel_custom") or {}
            check("panel title/icon", fp.get("title") == "Functions" and fp.get("icon") == "mdi:sitemap-outline", fp)
            check("panel require_admin", fp.get("require_admin") is True, fp)
            check("panel module_url versioned", str(cc.get("module_url", "")).startswith("/functions_board_static/functions-board.js?v="), cc)
            check("panel element name", cc.get("name") == "functions-board", cc)
            murl = cc.get("module_url", "")
            async with s.get(BASE + murl) as r:
                body = await r.text()
                check("static js served 200", r.status == 200 and "customElements.define" in body, r.status)
                check("static js content-type", "javascript" in r.headers.get("Content-Type", ""), r.headers.get("Content-Type"))
                check("static js may be cached (its address changes with its content)", "max-age" in r.headers.get("Cache-Control", ""), r.headers.get("Cache-Control"))
            import re as _re
            check("module url carries the file's hash (5.3)", _re.fullmatch(r"/functions_board_static/functions-board\.js\?v=[0-9a-f]{8}", murl or "") is not None, murl)

        # ---- options: Full manager and the dashboard card (8.4, 5.3) ----
        if entry_id:
            async with s.post(BASE + "/api/config/config_entries/options/flow", json={"handler": entry_id}, headers=H) as r:
                of = await r.json()
            check("options flow shows the form", of.get("type") == "form" and {x["name"] for x in of.get("data_schema", [])} == {"mode", "card"}, of)
            async with s.post(BASE + f"/api/config/config_entries/options/flow/{of.get('flow_id')}", json={"mode": "full", "card": True}, headers=H) as r:
                of2 = await r.json()
            await asyncio.sleep(2)
            gm = await ws.call(type="functions_board/get")
            check("options: Full manager reaches the boards", of2.get("type") == "create_entry" and gm["result"].get("mode") == "full", [of2.get("type"), gm["result"].get("mode")])
            p2 = (await ws.call(type="get_panels"))["result"].get("functions") or {}
            check("panel untouched by an options change (open boards keep their state)", (p2.get("config", {}).get("_panel_custom") or {}).get("module_url") == murl, p2.get("config"))
            async with s.get(BASE + "/") as r:
                html = await r.text()
            check("card option loads the board on dashboards", (p2.get("config", {}).get("_panel_custom") or {}).get("module_url", "#") in html, html[-400:])
            async with s.get(BASE + f"/api/diagnostics/config_entry/{entry_id}", headers=H) as r:
                diag = await r.json() if r.status == 200 else {}
            dd = diag.get("data") or {}
            about = dd.get("about") or {}
            check("diagnostics (Home Assistant's own download): anonymised, with the board's shape and no label names", about.get("mode") == "full" and about.get("anonymised") is True and "layouts" in (dd.get("board") or {}) and "fn_test" not in json.dumps(dd), {"status": r.status, "about": about, "board": json.dumps(dd.get("board"))[:300], "fn_test": "fn_test" in json.dumps(dd)})
            async with s.post(BASE + "/api/config/config_entries/options/flow", json={"handler": entry_id}, headers=H) as r:
                of = await r.json()
            async with s.post(BASE + f"/api/config/config_entries/options/flow/{of.get('flow_id')}", json={"mode": "organise", "card": False}, headers=H) as r:
                await r.json()
            await asyncio.sleep(2)
            async with s.get(BASE + "/") as r:
                html = await r.text()
            check("card option off removes it again", "functions-board.js" not in html, "")

        # ---- storage round trip; changes reach subscribers, not the event bus (1.3) ----
        bus = await ws.call(type="subscribe_events", event_type="functions_board_updated")
        check("bus listener for the old event", bus.get("success"), bus)
        ws2 = await WS(s, tok["access_token"]).open()
        sub = await ws2.call(type="functions_board/subscribe")
        check("functions_board/subscribe", sub.get("success"), sub)
        data = {"v": 1, "functions": [{"id": "fn_test", "label": "test_label", "name": "Test"}], "layouts": {"fn_test": {"nodes": {"automation.x": {"x": 10, "y": 20}}}}}
        r1 = await ws.call(type="functions_board/set", data=data, client="clientA")
        check("set succeeds", r1.get("success"), r1)
        await ws.drain(1.0)
        await ws2.drain(1.0)
        got = [e["event"] for e in ws2.events if e.get("id") == sub["id"]]
        check("subscriber told, with the sender's client id", got and got[-1].get("what") == "all" and got[-1].get("client") == "clientA", ws2.events[-3:])
        check("nothing on the event bus (the recorder would store it)", not [e for e in ws.events if e["event"].get("event_type") == "functions_board_updated"], ws.events[-3:])
        r2 = await ws.call(type="functions_board/get")
        check("get returns saved data", r2.get("success") and r2["result"]["data"] == data, r2)
        check("get returns revisions and the mode", r2["result"].get("revs") == {"fn_test": 1} and r2["result"].get("mode") == "organise", r2["result"])

        # ---- one layout at a time, with revisions (1.4, 5.1) ----
        lay = {"nodes": {"light.y": {"x": 1, "y": 2}}, "frames": [{"id": "f1", "title": "F", "x": 0, "y": 0, "w": 300, "h": 200}], "notes": []}
        w1 = await ws.call(type="functions_board/set_layout", label="fn_test", layout=lay, rev=1, client="clientA")
        check("set_layout with the current revision", w1.get("success") and w1["result"].get("rev") == 2, w1)
        w2 = await ws.call(type="functions_board/set_layout", label="fn_test", layout={"nodes": {}}, rev=1, client="clientB")
        check("a stale revision gets the stored layout back", w2.get("success") and w2["result"].get("conflict") and w2["result"].get("rev") == 2 and w2["result"].get("layout") == lay, w2)
        w3 = await ws.call(type="functions_board/set_layout", label="other_fn", layout={"nodes": {"a.b": {"x": "1", "y": 2}}}, client="clientB")
        check("a position that isn't a number is refused", not w3.get("success") and w3["error"]["code"] == "invalid_format", w3)
        w4 = await ws.call(type="functions_board/set_layout", label="other_fn", layout={"frames": [{"id": "a\"b"}]}, client="clientB")
        check("a frame id with a quote is refused", not w4.get("success"), w4)
        w5 = await ws.call(type="functions_board/set_layout", label="x" * 101, layout={}, client="clientB")
        check("a label over 100 characters is refused", not w5.get("success"), w5)
        w6 = await ws.call(type="functions_board/set_layout", label="other_fn", layout={"nodes": {"k": {"x": 1, "y": 1}}, "big": "y" * 210_000})
        check("a layout over 200 KB is refused", not w6.get("success") and w6["error"]["code"] == "too_large", w6.get("error"))
        f1 = await ws.call(type="functions_board/set_functions", functions=["fn_test", "fn_two", "fn_test"], client="clientA")
        g1 = await ws.call(type="functions_board/get")
        check("set_functions stores the list once each, in order", f1.get("success") and g1["result"]["data"]["functions"] == ["fn_test", "fn_two"], g1)
        d1 = await ws.call(type="functions_board/set_layout", label="fn_test", layout=None, rev=2)
        g2 = await ws.call(type="functions_board/get")
        check("set_layout with null deletes the layout", d1.get("success") and "fn_test" not in g2["result"]["data"]["layouts"], g2["result"])
        await ws2.drain(0.5)
        kinds = [e["event"].get("what") for e in ws2.events if e.get("id") == sub["id"]]
        check("subscriber hears layout and functions changes", "layout" in kinds and "functions" in kinds, kinds)
        await ws2.ws.close()
        data = g2["result"]["data"]

        # ---- what derived helpers read (5.2) ----
        # a template sensor's inputs are known once the template integration has set it up (just after a first start)
        for _ in range(30):
            src = await ws.call(type="functions_board/sources", entity_ids=["sensor.furnace_filter_status", "input_boolean.filter_due"])
            tpl = (src.get("result") or {}).get("sources", {}).get("sensor.furnace_filter_status", {})
            if tpl.get("entities"):
                break
            await asyncio.sleep(0.5)
        check("sources: a template sensor's inputs", src.get("success") and tpl.get("entities") == ["counter.filter_countdown", "input_boolean.filter_due"] and tpl.get("how") == "template", src)
        check("sources: a plain helper reads nothing", "input_boolean.filter_due" not in (src.get("result") or {}).get("sources", {}), src)
        async with s.post(BASE + "/api/config/config_entries/flow", json={"handler": "min_max"}, headers=H) as r:
            mf = await r.json()
        async with s.post(BASE + f"/api/config/config_entries/flow/{mf.get('flow_id')}", json={"name": "Outside max", "entity_ids": ["sensor.outside_temperature", "sensor.outside_humidity"], "type": "max", "round_digits": 0}, headers=H) as r:
            mf2 = await r.json()
        await asyncio.sleep(1)
        mm = mf2.get("result", {}).get("entry_id")
        ents = (await ws.call(type="config/entity_registry/list"))["result"]
        mm_ent = next((e["entity_id"] for e in ents if mm and e.get("config_entry_id") == mm), None)
        src2 = await ws.call(type="functions_board/sources", entity_ids=[mm_ent] if mm_ent else [])
        got2 = ((src2.get("result") or {}).get("sources") or {}).get(mm_ent, {})
        check("sources: a min/max helper's inputs from its options", mm_ent and got2.get("entities") == ["sensor.outside_humidity", "sensor.outside_temperature"] and got2.get("how") == "options", [mf2.get("type"), mm_ent, src2])
        if mm:
            async with s.delete(BASE + f"/api/config/config_entries/entry/{mm}", headers=H):
                pass
        big_ids = [f"sensor.s{i}" for i in range(501)]
        src3 = await ws.call(type="functions_board/sources", entity_ids=big_ids)
        check("sources: at most 500 entities per call", not src3.get("success"), src3.get("error"))
        big = {"v": 1, "functions": [], "layouts": {"x": "y" * 2_100_000}}
        r3 = await ws.call(type="functions_board/set", data=big)
        check("oversize data rejected", not r3.get("success") and r3.get("error", {}).get("code") == "too_large", r3.get("error"))
        r4 = await ws.call(type="functions_board/set", data="notadict")
        check("non-dict data rejected", not r4.get("success"), r4.get("error"))
        await asyncio.sleep(3.5)
        sp = os.path.join(HA_CONFIG, ".storage", "functions_board")
        stored = json.load(open(sp)) if os.path.exists(sp) else {}
        body = {k: v for k, v in (stored.get("data") or {}).items() if k != "revs"}
        ok = body == data and stored.get("minor_version") == 2 and "revs" in (stored.get("data") or {})
        check("store persisted to .storage/functions_board (version 1.2, with revisions)", ok, json.dumps(stored)[:300])

        # ---- non-admin user ----
        if "user" not in creds:
            u = await ws.call(type="config/auth/create", name="Test User", group_ids=["system-users"], local_only=False)
            uid = u["result"]["user"]["id"]
            upw = secrets.token_urlsafe(18)
            cr = await ws.call(type="config/auth_provider/homeassistant/create", user_id=uid, username="plainuser", password=upw)
            check("create non-admin user", cr.get("success"), cr)
            creds["user"] = {"username": "plainuser", "password": upw}
            json.dump(creds, open(CREDS, "w"))
        utok = await login(s, "plainuser", creds["user"]["password"])
        json.dump({"access_token": utok["access_token"], "refresh_token": utok.get("refresh_token"), "expires_in": utok["expires_in"]}, open(os.path.join(STATE, "user_token.json"), "w"))
        uws = await WS(s, utok["access_token"]).open()
        up = (await uws.call(type="get_panels"))["result"]
        check("non-admin does not get panel", "functions" not in up)
        ug = await uws.call(type="functions_board/get")
        check("non-admin get refused", not ug.get("success") and ug.get("error", {}).get("code") == "unauthorized", ug)
        us = await uws.call(type="functions_board/set", data={"v": 1})
        check("non-admin set refused", not us.get("success"), us)
        await uws.ws.close()

        # ---- unload removes the panel, re-add restores ----
        if entry_id:
            async with s.post(BASE + f"/api/config/config_entries/entry/{entry_id}/reload", headers=H) as r:
                rr = await r.json()
            p = (await ws.call(type="get_panels"))["result"]
            check("reload keeps panel", "functions" in p, rr)
            async with s.delete(BASE + f"/api/config/config_entries/entry/{entry_id}", headers=H) as r:
                d = await r.json()
            await asyncio.sleep(0.5)
            p = (await ws.call(type="get_panels"))["result"]
            check("delete entry removes panel", "functions" not in p, d)
            g2 = await ws.call(type="functions_board/get")
            check("data survives entry removal (store kept)", g2.get("success") and g2["result"]["data"] == data, g2)
            async with s.post(BASE + "/api/config/config_entries/flow", json={"handler": "functions_board"}, headers=H) as r:
                f = await r.json()
            async with s.post(BASE + f"/api/config/config_entries/flow/{f['flow_id']}", json={}, headers=H) as r:
                f2 = await r.json()
            await asyncio.sleep(1)
            p = (await ws.call(type="get_panels"))["result"]
            check("re-add restores panel", "functions" in p and f2.get("type") == "create_entry", f2)
            # reset store for the UI test
            await ws.call(type="functions_board/set", data={"v": 1, "functions": [], "layouts": {}})
        await ws.ws.close()

    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed" + (": failed " + ", ".join(bad) if bad else ""))
    # JUnit for run.sh, like every other runner here
    out = os.environ.get("FB_RESULTS") or os.path.join(HERE, "..", ".results")
    os.makedirs(out, exist_ok=True)
    from xml.sax.saxutils import quoteattr  # noqa: PLC0415
    with open(os.path.join(out, "apitest.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="apitest" tests="%d" failures="%d">\n' % (len(results), len(bad)))
        for n, ok in results:
            f.write("<testcase classname=\"apitest\" name=%s>%s</testcase>\n" % (quoteattr(n), "" if ok else "<failure/>"))
        f.write("</testsuite></testsuites>\n")
    return 1 if bad else 0


raise SystemExit(asyncio.run(main()))
