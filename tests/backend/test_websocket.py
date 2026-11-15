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
