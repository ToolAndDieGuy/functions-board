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
    assert kept["groups"] == [{k: v for k, v in group.items() if k != "code"}]  # nothing but the summary
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


async def test_versions_admin_only(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token) -> None:
    """0.8.0: versions are for administrators only."""
    await _ready(hass)
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json_auto_id({"type": "functions_board/versions", "label": "garage"})
    assert (await ws.receive_json())["error"]["code"] == "unauthorized"
