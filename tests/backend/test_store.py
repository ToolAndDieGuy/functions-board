"""The store: version 1.1 data (no revisions) loads and migrates; 1.2 keeps revisions inside the data."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component


async def test_migrates_from_1_1(hass: HomeAssistant, hass_storage: dict[str, Any], hass_ws_client) -> None:
    """A v0.3 store loads; its layouts start at revision 0."""
    hass_storage["functions_board"] = {"version": 1, "minor_version": 1, "key": "functions_board",
        "data": {"v": 1, "functions": ["garage"], "layouts": {"garage": {"nodes": {"a.b": {"x": 1, "y": 2}}}}}}
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/get"})
    res = (await ws.receive_json())["result"]
    assert res["data"]["functions"] == ["garage"] and res["revs"] == {}


async def test_revisions_saved_inside_the_data(hass: HomeAssistant, hass_storage: dict[str, Any], hass_ws_client, freezer) -> None:
    """Saved as 1.2 with the revisions under "revs", which v0.3 boards ignore, so a downgrade still loads."""
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "garage", "layout": {"nodes": {}}})
    await ws.receive_json()
    freezer.tick(5)
    from pytest_homeassistant_custom_component.common import async_fire_time_changed  # noqa: PLC0415

    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    stored = hass_storage["functions_board"]
    assert stored["version"] == 1 and stored["minor_version"] == 2
    assert stored["data"]["revs"] == {"garage": 1}
    assert stored["data"]["layouts"] == {"garage": {"nodes": {}}}
