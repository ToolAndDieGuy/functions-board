"""A Z-Wave device's values from functions_board/zwave_values (zwave.py, 0.13.0): read from the node the loaded Z-Wave JS
integration holds (here a stand-in with the same attributes), with the entities that show each value; a device that
isn't Z-Wave's, a node it doesn't have and objects that moved answer None; admins only. The real nodes of the test
home are read in tests/e2e/apitest.py."""

from __future__ import annotations

from types import SimpleNamespace

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

HOME = 4219363053


def _value(node: int, cc: int, cc_name: str, prop, key=None, label="", states=None, value=None, stateful=True, ptype="number", spec=None):
    vid = f"{node}-{cc}-0-{prop}" + (f"-{key}" if key is not None else "")
    md = SimpleNamespace(label=label, type=ptype, states=states or {}, min=None, max=None, unit=None, readable=True, writeable=False, stateful=stateful, cc_specific=spec or {})
    return SimpleNamespace(value_id=vid, command_class=cc, command_class_name=cc_name, endpoint=0, property_=prop, property_name=str(prop),
                           property_key=key, property_key_name=None if key is None else str(key), metadata=md, value=value)


async def _setup(hass: HomeAssistant, extra=()):
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    entry = MockConfigEntry(domain="zwave_js", title="Z-Wave")
    entry.add_to_hass(hass)
    # extra values come first in the node's order, as a device's settings can
    values = [
        *extra,
        _value(2, 98, "Door Lock", "currentMode", label="Current lock mode", states={"0": "Unsecured", "255": "Secured"}, value=0),
        _value(2, 113, "Notification", "Access Control", "Lock state", "Lock state", {"0": "idle", "11": "Lock jammed"}, 0, spec={"notificationType": 6}),
        _value(2, 134, "Version", "firmwareVersions", label="Firmware"),
        _value(2, 91, "Central Scene", "scene", "001", "Scene 001", {"0": "KeyPressed"}, None, stateful=False),
    ]
    node = SimpleNamespace(node_id=2, values={v.value_id: v for v in values})
    entry.runtime_data = SimpleNamespace(client=SimpleNamespace(driver=SimpleNamespace(controller=SimpleNamespace(home_id=HOME, nodes={2: node}))))
    dev = dr.async_get(hass).async_get_or_create(config_entry_id=entry.entry_id, identifiers={("zwave_js", f"{HOME}-2"), ("zwave_js", f"{HOME}-2-1:2:3")}, name="Front door lock")
    reg = er.async_get(hass)
    reg.async_get_or_create("lock", "zwave_js", f"{HOME}.2-98-0-currentMode", device_id=dev.id, suggested_object_id="front_door")
    reg.async_get_or_create("binary_sensor", "zwave_js", f"{HOME}.2-113-0-Access Control-Lock state.11", device_id=dev.id, suggested_object_id="front_jammed")
    reg.async_get_or_create("binary_sensor", "zwave_js", f"{HOME}.2-113-0-Access Control-Lock state.12", device_id=dev.id, suggested_object_id="front_off", disabled_by=er.RegistryEntryDisabler.INTEGRATION)
    other = MockConfigEntry(domain="demo")
    other.add_to_hass(hass)
    plain = dr.async_get(hass).async_get_or_create(config_entry_id=other.entry_id, identifiers={("demo", "x")}, name="Not Z-Wave")
    missing = dr.async_get(hass).async_get_or_create(config_entry_id=entry.entry_id, identifiers={("zwave_js", f"{HOME}-9")}, name="Gone node")
    await hass.async_block_till_done()
    return entry, dev, plain, missing


async def _ask(ws, device_id: str):
    await ws.send_json_auto_id({"type": "functions_board/zwave_values", "device_id": device_id})
    return await ws.receive_json()


async def test_zwave_values(hass: HomeAssistant, hass_ws_client) -> None:
    """A node's values, Version and the like left out, each with its states and the entities that show it."""
    entry, dev, plain, missing = await _setup(hass)
    ws = await hass_ws_client(hass)
    msg = await _ask(ws, dev.id)
    assert msg["success"], msg
    res = msg["result"]
    assert res["node_id"] == 2 and res["home_id"] == HOME
    by = {v["id"]: v for v in res["values"]}
    assert sorted(by) == ["2-113-0-Access Control-Lock state", "2-91-0-scene-001", "2-98-0-currentMode"]
    mode = by["2-98-0-currentMode"]
    assert mode["states"] == [[0, "Unsecured"], [255, "Secured"]] and mode["value"] == 0 and mode["entities"] == [["lock.front_door", None]] and mode["stateful"] is True
    # a Notification value: its type, and its binary sensor with the state it's on at (a disabled one left out)
    lock = by["2-113-0-Access Control-Lock state"]
    assert lock["notification_type"] == 6 and lock["entities"] == [["binary_sensor.front_jammed", 11]] and lock["property_key"] == "Lock state"
    assert by["2-91-0-scene-001"]["stateful"] is False
    # none for a device that isn't Z-Wave's, a node the driver doesn't have, or a device that doesn't exist
    for d in (plain.id, missing.id, "nope"):
        m = await _ask(ws, d)
        assert m["success"] and m["result"] is None, (d, m)
    # objects that moved (a release of Z-Wave JS) give no answer, never an error
    entry.runtime_data = SimpleNamespace(client=SimpleNamespace(driver=SimpleNamespace(controller=None)))
    m = await _ask(ws, dev.id)
    assert m["success"] and m["result"] is None, m


async def test_zwave_values_settings_last(hass: HomeAssistant, hass_ws_client) -> None:
    """A device with more settings than the cap still lists every other value: its settings (Configuration) come last (0.13.0)."""
    from custom_components.functions_board.zwave import MAX_VALUES
    settings = [_value(2, 112, "Configuration", n, label=f"Parameter {n}") for n in range(1, MAX_VALUES + 50)]
    _entry, dev, _plain, _missing = await _setup(hass, extra=settings)
    ws = await hass_ws_client(hass)
    res = (await _ask(ws, dev.id))["result"]
    ccs = [v["cc"] for v in res["values"]]
    assert len(ccs) == MAX_VALUES, len(ccs)
    assert ccs[:3] == [98, 113, 91] and set(ccs[3:]) == {112}, ccs[:5]


async def test_zwave_values_needs_an_admin(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token) -> None:
    """Only an admin can read a node's values."""
    _, dev, _, _ = await _setup(hass)
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    m = await _ask(ws, dev.id)
    assert not m["success"] and m["error"]["code"] == "unauthorized", m


async def test_zwave_values_multi_endpoint_child(hass: HomeAssistant, hass_ws_client) -> None:
    """A multi-endpoint child device (<home>-<node>-<endpoint>) returns that endpoint's values (0.13.2)."""
    ep2 = _value(2, 37, "Binary Switch", "currentValue", label="Current value", value=False)
    ep2.endpoint = 2
    ep2.value_id = "2-37-2-currentValue"
    entry, _dev, _plain, _missing = await _setup(hass, extra=(ep2,))
    child = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("zwave_js", f"{HOME}-2-2")},
        name="Dual relay endpoint 2",
    )
    ws = await hass_ws_client(hass)
    msg = await _ask(ws, child.id)
    assert msg["success"], msg
    res = msg["result"]
    assert res is not None and res["node_id"] == 2
    assert [v["id"] for v in res["values"]] == ["2-37-2-currentValue"]
    assert res["values"][0]["endpoint"] == 2
