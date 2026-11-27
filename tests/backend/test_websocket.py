"""The storage commands: admin gate, revisions, conflicts, validation, subscriptions, size limits."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component


async def _ready(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    await hass.async_block_till_done()


async def test_get_and_set_layout_with_revisions(hass: HomeAssistant, hass_ws_client) -> None:
    """A layout write carries the revision it was based on; a stale one gets the stored layout back."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/get"})
    res = await ws.receive_json()
    assert res["success"] and res["result"] == {"data": {}, "revs": {}, "mode": "organise"}
    lay = {"nodes": {"light.a": {"x": 1, "y": 2}}, "frames": [{"id": "f1", "title": "F"}], "notes": []}
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "garage", "layout": lay, "rev": 0, "client": "a"})
    res = await ws.receive_json()
    assert res["result"] == {"rev": 1}
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "garage", "layout": {"nodes": {}}, "rev": 0, "client": "b"})
    res = await ws.receive_json()
    assert res["result"] == {"conflict": True, "rev": 1, "layout": lay}
    await ws.send_json_auto_id({"type": "functions_board/set_functions", "functions": ["garage", "garage", "morning"]})
    assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/get"})
    res = await ws.receive_json()
    assert res["result"]["data"] == {"layouts": {"garage": lay}, "functions": ["garage", "morning"]}
    assert res["result"]["revs"] == {"garage": 1}
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "garage", "layout": None, "rev": 1})
    assert (await ws.receive_json())["result"] == {"rev": 2}
    await ws.send_json_auto_id({"type": "functions_board/get"})
    assert (await ws.receive_json())["result"]["data"]["layouts"] == {}


async def test_layout_validation(hass: HomeAssistant, hass_ws_client) -> None:
    """Positions must be numbers, ids plain, a layout under 200 KB, a label under 100 characters."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    bad = [
        {"nodes": {"a.b": {"x": "1", "y": 2}}},
        {"nodes": {"a.b": {"x": True, "y": 2}}},
        {"frames": [{"id": 'a"b'}]},
        {"notes": "x"},
        {"tools": [{"id": "a b", "type": "inject"}]},
        {"tools": {"id": "x"}},
    ]
    for layout in bad:
        await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "x", "layout": layout})
        res = await ws.receive_json()
        assert not res["success"] and res["error"]["code"] == "invalid_format", layout
    good = {"nodes": {"tool:t1": {"x": 1, "y": 2}}, "tools": [{"id": "t1", "type": "monitor", "what": "event", "topic": "my_event"}]}
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "x", "layout": good})
    assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "x", "layout": {"big": "y" * 210_000}})
    res = await ws.receive_json()
    assert res["error"]["code"] == "too_large"
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "x" * 101, "layout": {}})
    assert not (await ws.receive_json())["success"]


async def test_subscribers_hear_changes_and_the_bus_does_not(hass: HomeAssistant, hass_ws_client) -> None:
    """Changes go to subscribed boards with the sender's client id, never to the event bus (the recorder)."""
    await _ready(hass)
    bus = []
    hass.bus.async_listen("functions_board_updated", bus.append)
    sub = await hass_ws_client(hass)
    await sub.send_json_auto_id({"type": "functions_board/subscribe"})
    assert (await sub.receive_json())["success"]
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "garage", "layout": {"nodes": {}}, "client": "abc"})
    await ws.receive_json()
    msg = await sub.receive_json()
    assert msg["type"] == "event" and msg["event"] == {"what": "layout", "label": "garage", "rev": 1, "client": "abc"}
    await hass.async_block_till_done()
    assert bus == []


async def test_whole_store_set_kept_for_migration(hass: HomeAssistant, hass_ws_client) -> None:
    """functions_board/set replaces everything (used once to move per-user data) and bumps every layout."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    data = {"v": 1, "functions": ["a"], "layouts": {"a": {"nodes": {}}, "b": {}}}
    await ws.send_json_auto_id({"type": "functions_board/set", "data": data})
    assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/get"})
    res = (await ws.receive_json())["result"]
    assert res["data"] == data and res["revs"] == {"a": 1, "b": 1}
    await ws.send_json_auto_id({"type": "functions_board/set", "data": {"x": "y" * 2_100_000}})
    assert (await ws.receive_json())["error"]["code"] == "too_large"


async def test_non_admin_refused(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token) -> None:
    """Every command is for administrators only."""
    await _ready(hass)
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    for msg in (
        {"type": "functions_board/get"},
        {"type": "functions_board/set", "data": {}},
        {"type": "functions_board/set_functions", "functions": []},
        {"type": "functions_board/set_layout", "label": "a", "layout": {}},
        {"type": "functions_board/subscribe"},
        {"type": "functions_board/sources", "entity_ids": []},
        {"type": "functions_board/checks"},
        {"type": "functions_board/set_checks", "label": "a", "checks": []},
    ):
        await ws.send_json_auto_id(msg)
        res = await ws.receive_json()
        assert not res["success"] and res["error"]["code"] == "unauthorized", msg


async def test_nodered_kept_for_every_board(hass: HomeAssistant, hass_ws_client) -> None:
    """A board's Node-RED read is kept (summary only, checked) and offered to every board."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/nodered"})
    assert (await ws.receive_json())["result"] == {"kept": None}
    await ws.send_json_auto_id({"type": "functions_board/subscribe"})
    sub = (await ws.receive_json())["id"]
    group = {"id": "t1:a1", "tab": "t1", "tabLabel": "Flows", "name": "Watcher", "size": 3,
             "trig": ["light.a"], "read": [], "change": ["light.b"], "calls": [], "events": [],
             "code": "msg.payload = secret"}
    await ws.send_json_auto_id({"type": "functions_board/nodered_keep", "slug": "x_nodered", "groups": [group], "client": "a"})
    got = [await ws.receive_json(), await ws.receive_json()]
    assert any(m.get("type") == "result" and m["success"] for m in got)
    ev = next(m for m in got if m.get("type") == "event")
    assert ev["id"] == sub and ev["event"] == {"what": "nodered", "client": "a"}
    await ws.send_json_auto_id({"type": "functions_board/nodered"})
    kept = (await ws.receive_json())["result"]["kept"]
    assert kept["slug"] == "x_nodered" and kept["at"] > 0
    # nothing but the summary; a board older than 0.11.0 doesn't say whether the tab is disabled: it isn't
    assert kept["groups"] == [{**{k: v for k, v in group.items() if k != "code"}, "off": False}]
    # 0.11.0: a disabled tab's group is kept marked off; "off" must be true or false
    await ws.send_json_auto_id({"type": "functions_board/nodered_keep", "slug": "x_nodered", "groups": [{**group, "off": True}]})
    assert any(m.get("type") == "result" and m["success"] for m in [await ws.receive_json(), await ws.receive_json()])
    await ws.send_json_auto_id({"type": "functions_board/nodered"})
    assert (await ws.receive_json())["result"]["kept"]["groups"][0]["off"] is True
    await ws.send_json_auto_id({"type": "functions_board/nodered_keep", "slug": "x", "groups": [{**group, "off": "yes"}]})
    assert (await ws.receive_json())["error"]["code"] == "invalid_format"
    await ws.send_json_auto_id({"type": "functions_board/nodered_keep", "slug": "x", "groups": [{"id": 5}]})
    assert (await ws.receive_json())["error"]["code"] == "invalid_format"
    await ws.send_json_auto_id({"type": "functions_board/nodered_keep", "slug": "x", "groups": [{**group, "trig": ["a" * 200]}] * 5000})
    assert (await ws.receive_json())["error"]["code"] == "too_large"


async def test_versions_saved_listed_edited_deleted(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    """0.8.0: a function's snapshots are kept by name, listed without their content, handed back whole, and limited."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/subscribe"})
    sub = (await ws.receive_json())["id"]
    snap = {"fmt": 1, "members": ["automation.a"], "items": {"automation.a": {"dom": "automation", "id": "1", "cfg": {"alias": "A", "triggers": []}}}}
    await ws.send_json_auto_id({"type": "functions_board/version_save", "label": "garage", "name": "Winter", "desc": "shorter timer", "snapshot": snap, "client": "a"})
    got = [await ws.receive_json(), await ws.receive_json()]
    res = next(m for m in got if m.get("type") == "result")
    ev = next(m for m in got if m.get("type") == "event")
    assert res["success"] and ev["id"] == sub and ev["event"] == {"what": "versions", "label": "garage", "client": "a"}
    v = res["result"]
    assert v["name"] == "Winter" and v["desc"] == "shorter timer" and len(v["id"]) == 32 and v["size"] > 0 and "snapshot" not in v
    await ws.send_json_auto_id({"type": "functions_board/versions", "label": "garage"})
    listed = (await ws.receive_json())["result"]["versions"]
    assert [x["id"] for x in listed] == [v["id"]] and "snapshot" not in listed[0]
    await ws.send_json_auto_id({"type": "functions_board/version_get", "label": "garage", "version_id": v["id"]})
    assert (await ws.receive_json())["result"]["snapshot"] == snap
    await ws.send_json_auto_id({"type": "functions_board/version_edit", "label": "garage", "version_id": v["id"], "name": "Winter 2"})
    got = [await ws.receive_json(), await ws.receive_json()]
    assert next(m for m in got if m.get("type") == "result")["result"]["name"] == "Winter 2"
    # too big, and a bad id
    await ws.send_json_auto_id({"type": "functions_board/version_save", "label": "garage", "name": "Big", "snapshot": {"x": "a" * 1_100_000}})
    assert (await ws.receive_json())["error"]["code"] == "too_large"
    await ws.send_json_auto_id({"type": "functions_board/version_get", "label": "garage", "version_id": "0" * 32})
    assert (await ws.receive_json())["error"]["code"] == "not_found"
    await ws.send_json_auto_id({"type": "functions_board/version_delete", "label": "garage", "version_id": v["id"]})
    got = [await ws.receive_json(), await ws.receive_json()]
    assert next(m for m in got if m.get("type") == "result")["success"]
    await ws.send_json_auto_id({"type": "functions_board/versions", "label": "garage"})
    assert (await ws.receive_json())["result"]["versions"] == []


async def test_versions_limit_and_automatic_ones_make_room(hass: HomeAssistant, hass_ws_client) -> None:
    """0.8.0: at most 50 per function; one the board saves before a restore pushes out the oldest automatic one."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    for i in range(50):
        await ws.send_json_auto_id({"type": "functions_board/version_save", "label": "f", "name": f"v{i}", "snapshot": {"i": i}, "auto": i < 2})
        assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/version_save", "label": "f", "name": "one more", "snapshot": {}})
    assert (await ws.receive_json())["error"]["code"] == "too_many"
    await ws.send_json_auto_id({"type": "functions_board/version_save", "label": "f", "name": "Before restoring", "snapshot": {}, "auto": True})
    assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/versions", "label": "f"})
    names = [x["name"] for x in (await ws.receive_json())["result"]["versions"]]
    assert len(names) == 50 and "v0" not in names and names[-1] == "Before restoring"


async def test_versions_save_over_and_the_active_one(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    """0.11.3: a version changes only when it's saved over on purpose; the one a function was last made from is kept."""
    await _ready(hass)
    ws = await hass_ws_client(hass)

    async def call(msg):
        await ws.send_json_auto_id(msg)
        return await ws.receive_json()

    good = (await call({"type": "functions_board/version_save", "label": "f", "name": "Good", "snapshot": {"n": 1}, "print": "p1"}))["result"]
    listed = (await call({"type": "functions_board/versions", "label": "f"}))["result"]
    assert listed["active"] == {"id": good["id"], "print": "p1"}, "a version saved from what's there is the active one"
    bad = (await call({"type": "functions_board/version_save", "label": "f", "name": "Throwaway", "snapshot": {"n": 2}, "print": "p2"}))["result"]
    # a backup taken on the way doesn't become the active one
    await call({"type": "functions_board/version_save", "label": "f", "name": "Before", "snapshot": {"n": 3}, "print": "p3", "auto": True})
    assert (await call({"type": "functions_board/versions", "label": "f"}))["result"]["active"]["id"] == bad["id"]
    # made active again, with the fingerprint the function has after
    assert (await call({"type": "functions_board/version_active", "label": "f", "version_id": good["id"], "print": "p1b"}))["success"]
    listed = (await call({"type": "functions_board/versions", "label": "f"}))["result"]
    assert listed["active"] == {"id": good["id"], "print": "p1b"}
    assert (await call({"type": "functions_board/version_get", "label": "f", "version_id": bad["id"]}))["result"]["snapshot"] == {"n": 2}, "the throwaway is as it was"
    # Save: over the good one, on purpose; name kept, content replaced, still active
    over = (await call({"type": "functions_board/version_overwrite", "label": "f", "version_id": good["id"], "snapshot": {"n": 4}, "print": "p4"}))["result"]
    assert over["id"] == good["id"] and over["name"] == "Good" and over["print"] == "p4"
    assert (await call({"type": "functions_board/version_get", "label": "f", "version_id": good["id"]}))["result"]["snapshot"] == {"n": 4}
    assert (await call({"type": "functions_board/versions", "label": "f"}))["result"]["active"] == {"id": good["id"], "print": "p4"}
    # unknown ids, and deleting the active one forgets it
    assert (await call({"type": "functions_board/version_overwrite", "label": "f", "version_id": "0" * 32, "snapshot": {}, "print": ""}))["error"]["code"] == "not_found"
    assert (await call({"type": "functions_board/version_active", "label": "f", "version_id": "0" * 32}))["error"]["code"] == "not_found"
    await call({"type": "functions_board/version_delete", "label": "f", "version_id": good["id"]})
    assert (await call({"type": "functions_board/versions", "label": "f"}))["result"]["active"] is None


async def test_versions_admin_only(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token) -> None:
    """0.8.0: versions are for administrators only."""
    await _ready(hass)
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json_auto_id({"type": "functions_board/versions", "label": "garage"})
    assert (await ws.receive_json())["error"]["code"] == "unauthorized"
    for msg in ({"type": "functions_board/version_overwrite", "label": "garage", "version_id": "0" * 32, "snapshot": {}, "print": ""}, {"type": "functions_board/version_active", "label": "garage", "version_id": None}):
        await ws.send_json_auto_id(msg)
        assert (await ws.receive_json())["error"]["code"] == "unauthorized", msg["type"]


async def test_a_version_that_cant_be_kept_takes_nothing_with_it(hass: HomeAssistant, monkeypatch) -> None:
    """0.10.0: an automatic version makes room by pushing out older automatic ones only if it's then kept.

    With versions full by size, it isn't kept ("full"), and the automatic ones it would have pushed out are still
    there (they were deleted in memory, and the next save of anything stored that).
    """
    from custom_components.functions_board import versions as vmod  # noqa: PLC0415 - the module, to set its limit

    store = vmod.Versions(hass)
    monkeypatch.setattr(vmod, "MAX_VERSIONS", 3)
    for i in range(3):
        v, problem = store.add("f", f"v{i}", "", "", {"i": i, "pad": "x" * 100}, auto=i == 0)
        assert v is not None and problem is None
    monkeypatch.setattr(vmod, "MAX_VERSIONS_BYTES", store._total() + 50)
    v, problem = store.add("f", "Before restoring", "", "", {"pad": "y" * 400}, auto=True)
    assert v is None and problem == "full"
    assert [x["name"] for x in store.list("f")] == ["v0", "v1", "v2"]
    # one that fits once the oldest automatic one has gone is kept, and that one goes
    v, problem = store.add("f", "Before restoring", "", "", {"pad": "y" * 100}, auto=True)
    assert problem is None and [x["name"] for x in store.list("f")] == ["v1", "v2", "Before restoring"]


async def test_versions_remove_last_cleans_label_key(hass: HomeAssistant) -> None:
    """Deleting the last saved version of a function removes its empty key from by_label (0.13.2)."""
    from custom_components.functions_board import versions as vmod

    store = vmod.Versions(hass)
    v, problem = store.add("only_one", "v1", "", "", {"items": {}})
    assert v is not None and problem is None
    assert store.counts()["functions"] == 1
    assert store.remove("only_one", v["id"]) is True
    assert "only_one" not in store.by_label
    assert store.counts()["functions"] == 0


async def test_ws_set_validates_layouts(hass: HomeAssistant, hass_ws_client) -> None:
    """functions_board/set rejects invalid layout shapes consistently with set_layout (0.13.2)."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({
        "type": "functions_board/set",
        "data": {"functions": ["garage"], "layouts": {"garage": {"nodes": {"light.a": {"x": "bad", "y": 0}}}}},
    })
    msg = await ws.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "invalid_format", msg


async def test_versions_domain_allowlist(hass: HomeAssistant, hass_ws_client) -> None:
    """Phase 2 (HACS review hardening): version_save and version_overwrite reject non-allowlisted domains."""
    await _ready(hass)
    ws = await hass_ws_client(hass)
    bad_snaps = [
        {"items": {"cloud.evil": {"dom": "cloud", "id": "1", "cfg": {}}}},
        {"items": {"config/auth.evil": {"dom": "config/auth", "id": "1", "cfg": {}}}},
        {"items": {"light.kitchen": {"dom": "automation", "id": "1", "cfg": {}}}},
    ]
    for snap in bad_snaps:
        await ws.send_json_auto_id({"type": "functions_board/version_save", "label": "garage", "name": "Bad", "snapshot": snap})
        res = await ws.receive_json()
        assert not res["success"] and res["error"]["code"] == "invalid_format", (snap, res)
    # Valid snapshot succeeds, then overwriting it with a rogue domain fails
    good = {"items": {"input_boolean.ok": {"dom": "input_boolean", "id": "ok", "cfg": {"name": "OK"}}}}
    await ws.send_json_auto_id({"type": "functions_board/version_save", "label": "garage", "name": "Good", "snapshot": good})
    saved = await ws.receive_json()
    assert saved["success"], saved
    vid = saved["result"]["id"]
    await ws.send_json_auto_id({"type": "functions_board/version_overwrite", "label": "garage", "version_id": vid, "snapshot": bad_snaps[0], "print": "p1"})
    over = await ws.receive_json()
    assert not over["success"] and over["error"]["code"] == "invalid_format", over


async def test_versions_split_metadata_and_lazy_blobs(hass: HomeAssistant, hass_storage) -> None:
    """Phase 2: legacy inline snapshots migrate to per-function blob stores; metadata stays lean and blobs load on demand."""
    from custom_components.functions_board import versions as vmod

    legacy_snap = {"items": {"automation.a": {"dom": "automation", "id": "1", "cfg": {"alias": "A"}}}}
    vid = "a" * 32
    hass_storage[vmod.STORAGE_KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": vmod.STORAGE_KEY,
        "data": {
            "functions": {"garage": [{"id": vid, "name": "Legacy", "desc": "", "at": 1, "by": "", "size": 50, "auto": False, "print": "p", "snapshot": legacy_snap}]},
            "active": {"garage": {"id": vid, "print": "p"}},
        },
    }
    store = vmod.Versions(hass)
    await store.async_load()
    # Index store on disk no longer embeds snapshot payloads
    stored_index = hass_storage[vmod.STORAGE_KEY]["data"]
    assert "snapshot" not in stored_index["functions"]["garage"][0]
    # Fresh instance loads only metadata (blobs not cached until async_get)
    fresh = vmod.Versions(hass)
    await fresh.async_load()
    assert fresh.list("garage")[0]["name"] == "Legacy"
    assert "garage" not in fresh._blobs
    assert fresh.edit("garage", vid, "Renamed", None) is not None
    assert "garage" not in fresh._blobs
    got = await fresh.async_get("garage", vid)
    assert got is not None and got["snapshot"] == legacy_snap


async def test_checks_store_and_layout_migration(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    """Phase 2: saved checks live in their own store, auto-migrating any legacy layout.checks on load."""
    from custom_components.functions_board.const import STORAGE_KEY

    legacy_chk = {"id": "k1", "name": "Migrated check", "at": 0, "steps": [{"op": "advance", "ms": 1000}], "expect": []}
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "minor_version": 2,
        "key": STORAGE_KEY,
        "data": {"functions": ["garage"], "layouts": {"garage": {"nodes": {}, "checks": [legacy_chk]}}, "revs": {"garage": 1}},
    }
    await _ready(hass)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/get"})
    board_data = (await ws.receive_json())["result"]["data"]
    assert "checks" not in board_data["layouts"]["garage"]
    await ws.send_json_auto_id({"type": "functions_board/checks", "label": "garage"})
    assert (await ws.receive_json())["result"]["checks"] == [legacy_chk]
    # Saving new checks works and notifies subscribers; malformed checks are rejected
    await ws.send_json_auto_id({"type": "functions_board/set_checks", "label": "garage", "checks": [{"id": "bad id!", "name": "x", "steps": [], "expect": []}]})
    assert (await ws.receive_json())["error"]["code"] == "invalid_format"
    new_chk = {"id": "k2", "name": "Fresh check", "at": 1, "steps": [], "expect": []}
    await ws.send_json_auto_id({"type": "functions_board/set_checks", "label": "garage", "checks": [new_chk]})
    assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/checks", "label": "garage"})
    assert (await ws.receive_json())["result"]["checks"] == [new_chk]
