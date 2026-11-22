"""Privacy: what the integration's data can become, and where it can go.

Canary data: every field the board keeps, and every name and ID in Home Assistant, carries a marker word
("bramblewood") or a marker value (an address, a phone number, a key). Then:

- B1 diagnostics: anonymised, none of it is left, but the shape is (layouts, types, modes, the same stand-in for
  the same thing everywhere); with real names, it's all there; there is no third choice.
- B2 logs: the integration never writes what it keeps (layouts, notes, snapshots) into the log.
- B3 network: these tests run with the network off, so any connection the integration's code tried would fail
  them; the first test proves the switch is on.
"""

from __future__ import annotations

import json
import logging
import socket

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er, label_registry as lr
from homeassistant.setup import async_setup_component

from pytest_homeassistant_custom_component.common import MockConfigEntry

MARK = "bramblewood"
SECRET_BITS = ["192.0.2.47", "616-555-0123", "sam@example.com", "https://bramble.example.org/hook", "Zx9Kq2LmP4vR7tY1wE5uI8oA3sD6fG0h", "AA:BB:CC:11:22:33", "4321-alarm"]
NOTE = "Spare key is under the bramblewood pot, alarm code 4321-alarm, call 616-555-0123"


def test_network_is_off_in_these_tests() -> None:
    """B3: the backend suite runs with sockets blocked: any test whose code opens one fails (the test plugin
    checks after every test), so no test can pass by reaching out. Trying one here would fail this test, so it
    checks the guard is in place instead."""
    import pytest_socket  # noqa: PLC0415

    assert socket.socket is not pytest_socket._true_socket  # noqa: SLF001


async def _home(hass: HomeAssistant) -> dict[str, str]:
    """A home whose every name and ID carries the marker; the board's store and a version full of it."""
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain="functions_board", title="Functions Board", data={}, options={"mode": "full"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    other = MockConfigEntry(domain="demo", title="Bramblewood hub")
    other.add_to_hass(hass)
    area = ar.async_get(hass).async_create("Bramblewood Kitchen")
    label = lr.async_get(hass).async_create("Bramblewood garage")
    dev = dr.async_get(hass).async_get_or_create(
        config_entry_id=other.entry_id, identifiers={("demo", "bramblewood-opener-0042")}, connections={(dr.CONNECTION_NETWORK_MAC, "aa:bb:cc:11:22:33")},
        name="Bramblewood opener", manufacturer="Acme", model="GD-1",
    )
    ent = er.async_get(hass).async_get_or_create("cover", "demo", "bramblewood_door_1", suggested_object_id="bramblewood_door", device_id=dev.id, original_name="Bramblewood door")
    er.async_get(hass).async_update_entity(ent.entity_id, area_id=area.id, labels={label.label_id})
    hass.states.async_set(ent.entity_id, "closed", {"friendly_name": "Bramblewood door"})
    hass.states.async_set("light.bramblewood_lamp", "on", {"friendly_name": "Bramblewood lamp"})
    await hass.async_block_till_done()
    return {"label": label.label_id, "door": ent.entity_id, "device": dev.id, "area": area.id}


def _snapshot(home: dict[str, str]) -> dict:
    """A version's snapshot, as the board makes one."""
    return {
        "members": [home["door"], "automation.bramblewood_left_open"],
        "items": {
            "automation.bramblewood_left_open": {
                "dom": "automation", "id": "1700000000001", "name": "Bramblewood: left open",
                "cfg": {
                    "id": "1700000000001", "alias": "Bramblewood: left open", "description": "Tells Sam when the bramblewood door is open",
                    "mode": "single",
                    "triggers": [{"trigger": "state", "entity_id": home["door"], "to": "open", "for": {"minutes": 15}}, {"trigger": "event", "event_type": "timer.finished"}],
                    "conditions": [{"condition": "template", "value_template": "{{ is_state('light.bramblewood_lamp', 'on') }}"}],
                    "actions": [
                        {"action": "notify.mobile_app_bramblewood_phone", "data": {"title": "Bramblewood", "message": NOTE}},
                        {"action": "rest_command.bramblewood_hook", "data": {"url": "https://bramble.example.org/hook", "token": "Zx9Kq2LmP4vR7tY1wE5uI8oA3sD6fG0h", "host": "192.0.2.47", "to": "sam@example.com"}},
                        {"action": "light.turn_on", "target": {"entity_id": "light.bramblewood_lamp", "area_id": home["area"]}},
                        {"device_id": home["device"], "domain": "cover", "entity_id": home["door"], "type": "close"},
                        # an area that's gone since (its ID is all that's left, and it names a place)
                        {"action": "light.turn_off", "target": {"area_id": ["bramblewood_old_shed"]}},
                    ],
                },
            }
        },
        "devices": {home["device"]: {"name": "Bramblewood opener", "model": "GD-1", "manufacturer": "Acme"}},
        "layout": {"nodes": {home["door"]: {"x": 0, "y": 0}}},
    }


async def _fill(hass: HomeAssistant, ws, home: dict[str, str]) -> str:
    """The board's store and versions, as boards fill them."""
    layout = {
        "nodes": {home["door"]: {"x": 10, "y": 20}, "automation.bramblewood_left_open": {"x": 300, "y": 20}, "event:timer.finished": {"x": 150, "y": 90}},
        "frames": [{"id": "f1", "title": "Bramblewood corner", "x": 0, "y": 0, "w": 500, "h": 300}],
        "notes": [{"id": "n1", "text": NOTE, "x": 0, "y": 400}],
        "tests": [{"id": "t1", "name": "Bramblewood open test", "kind": "state", "target": home["door"], "state": "open"}],
        # a saved check (0.9.0): its name, starting states, steps (an MQTT payload) and the answers it was given
        "checks": [{"id": "k1", "name": "Bramblewood closes itself", "at": 0, "start": {home["door"]: {"state": "closed", "attributes": {"friendly_name": "Bramblewood door"}}},
                    "items": ["automation.bramblewood_left_open"], "steps": [{"op": "mqtt", "topic": "home/bramblewood/door", "payload": NOTE}],
                    "answers": [{"key": "automation.bramblewood_left_open", "text": "Is the bramblewood gate shut?", "value": True}],
                    "expect": [{"k": "state", "id": home["door"], "state": "closed"}]}],
        # dismissed problems (0.9.0): what's wrong and with what, an entity, an action, an area by name
        "dismissed": [{"k": f"e_unavail|{home['door']}", "at": 1}, {"k": "s_missing|notify.mobile_app_bramblewood_phone", "at": 2},
                      {"k": "t_missing|area:bramblewood_shed", "at": 3, "gone": 4}],
        "dir": "right",
        # the notification builder's spec (0.11.3): what it says, who gets it, a phone by its mobile app action, a tag
        "builders": {"script.bramblewood_notify": {"kind": "notify", "spec": {
            "title": "Bramblewood", "message": NOTE, "say": "Sam, the bramblewood door is open", "tag": "bramblewood",
            "phones": [{"svc": "mobile_app_bramblewood_phone", "os": "ios", "name": "Bramblewood phone"}],
            "people": [{"id": "person.bramblewood_sam", "away": True, "phones": [{"svc": "mobile_app_bramblewood_pixel", "os": "android", "name": "Bramblewood pixel"}]}],
            "speakers": ["media_player.bramblewood_kitchen"], "tts": "tts.bramblewood_voice",
            "buttons": [{"title": "Close the bramblewood door", "then": [{"action": "script.bramblewood_close"}]}], "timeout": [], "wait": 30, "clear": True,
            "level": "time", "quiet": {"from": "22:00", "to": "07:00"}, "speakAlways": False}}},
    }
    for msg in (
        {"type": "functions_board/set_layout", "label": home["label"], "layout": layout},
        {"type": "functions_board/set_functions", "functions": [home["label"]]},
    ):
        await ws.send_json_auto_id(msg)
        assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/version_save", "label": home["label"], "name": "Bramblewood before winter", "desc": NOTE, "snapshot": _snapshot(home)})
    res = await ws.receive_json()
    assert res["success"], res
    return res["result"]["id"]


def _leaks(dump: str) -> list[str]:
    low = dump.lower()
    return [m for m in [MARK, *SECRET_BITS] if m.lower() in low]


async def test_anonymised_diagnostics_keep_shape_not_names(hass: HomeAssistant, hass_ws_client) -> None:
    """B1: anonymised, nothing personal is left; the layout, types and modes are, with one stand-in per thing."""
    home = await _home(hass)
    ws = await hass_ws_client(hass)
    vid = await _fill(hass, ws, home)
    await ws.send_json_auto_id({"type": "functions_board/diagnostics", "anonymise": True, "label": home["label"], "snapshot": _snapshot(home), "version_ids": [vid]})
    res = await ws.receive_json()
    assert res["success"], res
    d = res["result"]
    dump = json.dumps(d)
    import re as _re  # noqa: PLC0415
    assert _leaks(dump) == [], [m.group(0) for m in _re.finditer(r".{0,60}bramblewood.{0,30}", dump, _re.I)][:8]
    assert home["device"] not in dump and home["area"] not in dump and home["label"] not in dump
    assert d["about"]["anonymised"] is True
    # the shape stays: layout geometry, types, modes, generic services and event types
    layout = next(iter(d["board"]["layouts"].values()))
    assert sorted(v["x"] for v in layout["nodes"].values()) == [10, 150, 300]
    assert "event:timer.finished" in layout["nodes"]
    cfg = next(iter(d["snapshot_now"]["items"].values()))["cfg"]
    assert cfg["mode"] == "single" and cfg["triggers"][0]["trigger"] == "state" and cfg["triggers"][0]["for"] == {"minutes": 15}
    assert [a.get("action") for a in cfg["actions"]][2] == "light.turn_on"
    assert cfg["actions"][0]["action"].startswith("notify.") and "bramblewood" not in cfg["actions"][0]["action"]
    assert cfg["actions"][0]["data"]["message"] == f"[text, {len(NOTE)} characters]"
    # one stand-in per thing: the door is the same in the layout keys, the trigger and the device step
    door = cfg["triggers"][0]["entity_id"]
    assert door.startswith("cover.e") and door in layout["nodes"] and cfg["actions"][3]["entity_id"] == door
    lamp = cfg["actions"][2]["target"]["entity_id"]
    assert lamp in cfg["conditions"][0]["value_template"]
    assert len(d["version_snapshots"]) == 1
    # an area Home Assistant no longer knows is replaced too, in a config and in the board's own names for it
    assert cfg["actions"][4]["target"]["area_id"][0].startswith("area_"), cfg["actions"][4]
    # a dismissed problem keeps what kind it is, with the same stand-in for the thing as everywhere else
    dis = layout["dismissed"]
    assert [x["k"].split("|")[0] for x in dis] == ["e_unavail", "s_missing", "t_missing"] and dis[0]["k"] == f"e_unavail|{door}" and dis[2]["gone"] == 4 and dis[2]["k"].startswith("t_missing|area:area_"), dis
    # an MQTT topic keeps its shape and protocol words, not the names in it
    step = d["board"]["layouts"]["label_1"]["checks"][0]["steps"][0]
    assert step["topic"] == "home/topic_1/door" or step["topic"].split("/")[1].startswith("topic_"), step


async def test_home_assistants_own_download_is_anonymised(hass: HomeAssistant, hass_ws_client) -> None:
    """B1: Home Assistant's own Download diagnostics can't ask, so it's always anonymised, and says where the choice is."""
    home = await _home(hass)
    ws = await hass_ws_client(hass)
    await _fill(hass, ws, home)
    from custom_components.functions_board.diagnostics import async_get_config_entry_diagnostics  # noqa: PLC0415

    entry = hass.config_entries.async_entries("functions_board")[0]
    d = await async_get_config_entry_diagnostics(hass, entry)
    dump = json.dumps(d)
    assert _leaks(dump) == [], _leaks(dump)
    assert d["about"]["anonymised"] is True and "About dialog" in d["about"]["note"]
    assert "snapshot_now" not in d and "version_snapshots" not in d


async def test_real_names_are_a_choice_and_there_is_no_default(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token) -> None:
    """B1: with real names everything is there; leaving the choice out is refused; non-admins are refused."""
    home = await _home(hass)
    ws = await hass_ws_client(hass)
    vid = await _fill(hass, ws, home)
    await ws.send_json_auto_id({"type": "functions_board/diagnostics", "anonymise": False, "label": home["label"], "version_ids": [vid]})
    res = await ws.receive_json()
    dump = json.dumps(res["result"])
    assert MARK in dump.lower() and NOTE in dump and res["result"]["about"]["anonymised"] is False
    await ws.send_json_auto_id({"type": "functions_board/diagnostics"})
    res = await ws.receive_json()
    assert not res["success"] and res["error"]["code"] == "invalid_format"
    ro = await hass_ws_client(hass, hass_read_only_access_token)
    await ro.send_json_auto_id({"type": "functions_board/diagnostics", "anonymise": True})
    res = await ro.receive_json()
    assert not res["success"] and res["error"]["code"] == "unauthorized"


async def test_the_log_never_holds_what_the_board_keeps(hass: HomeAssistant, hass_ws_client, caplog: pytest.LogCaptureFixture) -> None:
    """B2: every command run at debug level; the board's notes, layouts and snapshots never reach the log."""
    caplog.set_level(logging.DEBUG)
    home = await _home(hass)
    ws = await hass_ws_client(hass)
    vid = await _fill(hass, ws, home)
    for msg in (
        {"type": "functions_board/get"},
        {"type": "functions_board/versions", "label": home["label"]},
        {"type": "functions_board/version_get", "label": home["label"], "version_id": vid},
        {"type": "functions_board/version_edit", "label": home["label"], "version_id": vid, "desc": NOTE + " again"},
        {"type": "functions_board/diagnostics", "anonymise": False, "label": home["label"], "snapshot": _snapshot(home)},
        {"type": "functions_board/nodered_keep", "slug": "a0d7b954_nodered", "groups": [{"id": "g", "tab": "t", "tabLabel": "Bramblewood flows", "name": NOTE, "size": 1, "trig": [home["door"]], "read": [], "change": [], "calls": [], "events": []}]},
        {"type": "functions_board/version_delete", "label": home["label"], "version_id": vid},
    ):
        await ws.send_json_auto_id(msg)
        await ws.receive_json()
    ours = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("custom_components.functions_board"))
    assert NOTE not in ours and "Bramblewood before winter" not in ours and "bramble.example.org" not in ours, ours[:500]


# ---------- A5: the Python side has no way to reach the network ----------
import ast  # noqa: E402
from pathlib import Path  # noqa: E402

INTEGRATION = Path(__file__).resolve().parents[2] / "custom_components" / "functions_board"
BANNED_MODULES = (
    "aiohttp", "requests", "httpx", "urllib", "urllib3", "http.client", "socket", "ssl", "smtplib", "ftplib",
    "telnetlib", "websockets", "paho", "zeroconf", "dns", "aiodns",
    "homeassistant.helpers.aiohttp_client", "homeassistant.helpers.httpx_client", "homeassistant.components.cloud",
    "homeassistant.components.network", "homeassistant.components.webhook", "homeassistant.components.mqtt",
)
BANNED_CALLS = ("open_connection", "create_connection", "start_server", "async_get_clientsession", "get_async_client", "async_create_clientsession")


def _imports_and_calls() -> tuple[list[str], list[str]]:
    mods, calls = [], []
    for py in sorted(INTEGRATION.rglob("*.py")):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                mods += [f"{py.name}: {a.name}" for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = "." * node.level + (node.module or "")
                mods.append(f"{py.name}: {base}")
                mods += [f"{py.name}: {base}.{a.name}" for a in node.names]
            elif isinstance(node, ast.Attribute) and node.attr in BANNED_CALLS:
                calls.append(f"{py.name}: .{node.attr}")
            elif isinstance(node, ast.Name) and node.id in BANNED_CALLS:
                calls.append(f"{py.name}: {node.id}")
    return mods, calls


def test_python_imports_nothing_that_reaches_the_network() -> None:
    """A5: no HTTP client, socket, mail, DNS or cloud module, and none of Home Assistant's web sessions."""
    mods, calls = _imports_and_calls()
    assert len(mods) > 20  # the walk found the imports
    bad = [m for m in mods if any(m.split(": ", 1)[1] == b or m.split(": ", 1)[1].startswith(b + ".") for b in BANNED_MODULES)]
    assert bad == [] and calls == [], (bad, calls)


def test_manifest_keeps_it_local() -> None:
    """A5: no Python packages to install, only the four parts of Home Assistant it needs, nothing it discovers."""
    m = json.loads((INTEGRATION / "manifest.json").read_text(encoding="utf-8"))
    assert m["requirements"] == []
    assert sorted(m["dependencies"]) == ["frontend", "http", "panel_custom", "websocket_api"]
    assert m.get("after_dependencies", []) == []
    assert m["iot_class"] == "calculated"
    assert not {"zeroconf", "ssdp", "dhcp", "usb", "bluetooth", "mqtt", "homekit", "cloud"} & set(m)
