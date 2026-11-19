"""What derived helpers read (functions_board/sources) and the diagnostics download."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from pytest_homeassistant_custom_component.common import MockConfigEntry


async def test_template_sensor_inputs(hass: HomeAssistant, hass_ws_client) -> None:
    """A template sensor reports the entities its template listens to."""
    hass.states.async_set("input_boolean.a", "off")
    hass.states.async_set("counter.b", "3")
    assert await async_setup_component(hass, "template", {"template": {"sensor": [{"name": "T", "state": "{{ states('counter.b') }}{{ is_state('input_boolean.a', 'on') }}"}]}})
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/sources", "entity_ids": ["sensor.t", "input_boolean.a"]})
    res = (await ws.receive_json())["result"]["sources"]
    # this fails loudly if a Home Assistant release moves the private attribute the answer comes from
    assert res == {"sensor.t": {"entities": ["counter.b", "input_boolean.a"], "domains": [], "all": False, "how": "template"}}


async def test_trigger_based_template_inputs(hass: HomeAssistant, hass_ws_client) -> None:
    """A trigger-based template sensor reports what its triggers and templates name."""
    hass.states.async_set("input_boolean.a", "off")
    hass.states.async_set("counter.b", "3")
    assert await async_setup_component(hass, "template", {"template": [{"triggers": [{"trigger": "state", "entity_id": "input_boolean.a"}],
        "sensor": [{"name": "Alarms", "state": "{{ states('counter.b') | int + 1 }}"}]}]})
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/sources", "entity_ids": ["sensor.alarms"]})
    res = (await ws.receive_json())["result"]["sources"]
    assert res == {"sensor.alarms": {"entities": ["counter.b", "input_boolean.a"], "domains": [], "all": False, "how": "triggers"}}


async def test_min_max_helper_inputs(hass: HomeAssistant, hass_ws_client) -> None:
    """A helper set up in the UI reports the entities named in its options."""
    hass.states.async_set("sensor.one", "1")
    hass.states.async_set("sensor.two", "2")
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    entry = MockConfigEntry(domain="min_max", title="Max", options={"name": "Max", "entity_ids": ["sensor.one", "sensor.two"], "type": "max", "round_digits": 2})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/sources", "entity_ids": ["sensor.max"]})
    res = (await ws.receive_json())["result"]["sources"]
    assert res == {"sensor.max": {"entities": ["sensor.one", "sensor.two"], "domains": [], "all": False, "how": "options"}}


async def test_diagnostics_have_sizes_not_names(hass: HomeAssistant, hass_ws_client) -> None:
    """Home Assistant's own download: anonymised; the layout's shape, no labels or entity IDs (more in test_privacy)."""
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain="functions_board", title="Functions Board", data={}, options={"mode": "full"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/set_layout", "label": "secret_garage", "layout": {"nodes": {"light.secret": {"x": 0, "y": 0}}, "frames": [{"id": "f"}]}})
    await ws.receive_json()
    await ws.send_json_auto_id({"type": "functions_board/set_functions", "functions": ["secret_garage"]})
    await ws.receive_json()
    from custom_components.functions_board.diagnostics import async_get_config_entry_diagnostics  # noqa: PLC0415

    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert diag["about"]["mode"] == "full" and diag["about"]["anonymised"] is True
    assert diag["board"]["functions"] == ["label_1"]
    assert diag["board"]["layouts"] == {"label_1": {"nodes": {"light.e1": {"x": 0, "y": 0}}, "frames": [{"id": "f"}]}}
    assert "secret" not in str(diag)
