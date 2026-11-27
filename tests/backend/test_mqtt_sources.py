"""MQTT entities' topics and rules from functions_board/sources (sources.py _mqtt, 0.11.3), on pytest-homeassistant's
mocked broker: entities from YAML and from discovery, what isn't followed, and an entity that isn't MQTT's."""

from __future__ import annotations

import json

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM
from pytest_homeassistant_custom_component.common import async_fire_mqtt_message

YAML = {
    "mqtt": {
        "sensor": [
            {"name": "Lvl", "state_topic": "h/lvl", "unit_of_measurement": "%", "value_template": "{{ value_json.l }}", "expire_after": 60},
            {"name": "Seen", "state_topic": "h/seen", "device_class": "timestamp"},
        ],
        "binary_sensor": [
            {"name": "Door", "state_topic": "h/door", "payload_on": "open", "payload_off": "closed", "availability_topic": "h/av", "off_delay": 30},
        ],
    }
}


@pytest.fixture
def expected_lingering_timers() -> bool:
    """MQTT's client keeps a periodic timer of its own while it's set up."""
    return True


async def _sources(hass: HomeAssistant, hass_ws_client, ids: list[str]) -> dict:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "functions_board/sources", "entity_ids": ids})
    msg = await ws.receive_json()
    assert msg["success"], msg
    return msg["result"]["sources"]


@pytest.mark.parametrize("hass_config", [YAML])
async def test_mqtt_entities_from_yaml(hass: HomeAssistant, mock_hass_config: None, mqtt_mock_entry, hass_ws_client) -> None:
    """A YAML sensor and binary sensor: their topics, templates, payloads, availability, off_delay and expire_after."""
    await mqtt_mock_entry()
    await hass.async_block_till_done()
    hass.states.async_set("input_boolean.a", "off")
    res = await _sources(hass, hass_ws_client, ["sensor.lvl", "binary_sensor.door", "sensor.seen", "input_boolean.a"])
    # these fail loudly if a Home Assistant release moves the private attributes the answer comes from
    assert res["sensor.lvl"] == {"entities": [], "domains": [], "all": False, "how": "mqtt", "topics": ["h/lvl"], "rule": {
        "kind": "mqtt", "domain": "sensor", "expire_after": 60.0,
        "state": {"topic": "h/lvl", "how": "sensor", "numeric": True, "options": [], "tpl": "{{ value_json.l }}"}}}
    assert res["binary_sensor.door"] == {"entities": [], "domains": [], "all": False, "how": "mqtt", "topics": ["h/av", "h/door"], "rule": {
        "kind": "mqtt", "domain": "binary_sensor", "off_delay": 30.0,
        "state": {"topic": "h/door", "how": "map", "map": {"open": "on", "closed": "off", "None": "unknown"}, "blank": "skip"},
        "avail": {"mode": "latest", "list": [{"topic": "h/av", "on": "online", "off": "offline", "tpl": None}]}}}
    # a timestamp sensor's state is a date the sandbox doesn't work out: its topic, no rule
    assert res["sensor.seen"] == {"entities": [], "domains": [], "all": False, "how": "mqtt", "topics": ["h/seen"]}
    # not MQTT's (and reading nothing): left out
    assert "input_boolean.a" not in res


async def _discover(hass: HomeAssistant, dom: str, obj: str, cfg: dict) -> None:
    async_fire_mqtt_message(hass, f"homeassistant/{dom}/{obj}/config", json.dumps(dict(cfg, name=obj, unique_id="fbt_" + obj, default_entity_id=f"{dom}.{obj}")))
    await hass.async_block_till_done()
    assert hass.states.get(f"{dom}.{obj}") is not None, f"discovery made no {dom}.{obj}"


async def test_mqtt_entities_from_discovery(hass: HomeAssistant, mock_hass_config: None, mqtt_mock_entry, hass_ws_client) -> None:
    """Discovered entities: a cover with a position, a lock, a select with JSON attributes, a JSON light, and
    availability on two topics where all must be up."""
    await mqtt_mock_entry()
    await _discover(hass, "cover", "gate", {"state_topic": "h/gate", "command_topic": "h/gate/set", "position_topic": "h/gate/pos", "position_template": "{{ value_json.p }}", "position_closed": 0, "position_open": 255})
    await _discover(hass, "lock", "front", {"state_topic": "h/lock", "command_topic": "h/lock/set", "state_jammed": "STUCK",
        "availability": [{"topic": "h/av1"}, {"topic": "h/av2", "payload_available": "up", "payload_not_available": "down"}], "availability_mode": "all"})
    await _discover(hass, "select", "mode", {"state_topic": "h/mode", "command_topic": "h/mode/set", "options": ["Off", "Eco"], "json_attributes_topic": "h/mode/attr"})
    await _discover(hass, "light", "strip", {"schema": "json", "state_topic": "h/strip", "command_topic": "h/strip/set"})
    res = await _sources(hass, hass_ws_client, ["cover.gate", "lock.front", "select.mode", "light.strip"])
    assert res["cover.gate"]["topics"] == ["h/gate", "h/gate/pos"]
    assert res["cover.gate"]["rule"]["position"] == {"topic": "h/gate/pos", "tpl": "{{ value_json.p }}", "closed": 0, "open": 255, "state": True}
    assert res["cover.gate"]["rule"]["state"]["how"] == "cover" and res["cover.gate"]["rule"]["state"]["position"] is True
    lock = res["lock.front"]["rule"]
    assert lock["state"]["map"]["STUCK"] == "jammed" and "JAMMED" not in lock["state"]["map"] and lock["state"]["map"]["None"] == "unknown"
    assert lock["avail"] == {"mode": "all", "list": [{"topic": "h/av1", "on": "online", "off": "offline", "tpl": None}, {"topic": "h/av2", "on": "up", "off": "down", "tpl": None}]}
    assert res["lock.front"]["topics"] == ["h/av1", "h/av2", "h/lock"]
    assert res["select.mode"]["rule"]["state"] == {"topic": "h/mode", "how": "select", "options": ["Off", "Eco"]}
    assert res["select.mode"]["rule"]["attrs"] == {"topic": "h/mode/attr", "tpl": None}
    assert res["light.strip"]["rule"]["state"] == {"topic": "h/strip", "how": "json_light"}


async def test_mqtt_sensor_whose_unit_is_converted(hass: HomeAssistant, mock_hass_config: None, mqtt_mock_entry, hass_ws_client) -> None:
    """A temperature in °C that Home Assistant shows in °F: the sandbox can't follow the conversion, so no state
    rule; its availability is still followed."""
    hass.config.units = US_CUSTOMARY_SYSTEM
    await mqtt_mock_entry()
    await _discover(hass, "sensor", "temp", {"state_topic": "h/t", "unit_of_measurement": "°C", "device_class": "temperature", "availability_topic": "h/t/av"})
    await _discover(hass, "sensor", "bare", {"state_topic": "h/b", "unit_of_measurement": "°C", "device_class": "temperature"})
    res = await _sources(hass, hass_ws_client, ["sensor.temp", "sensor.bare"])
    assert res["sensor.temp"]["topics"] == ["h/t", "h/t/av"]
    assert res["sensor.temp"]["rule"] == {"kind": "mqtt", "domain": "sensor", "avail": {"mode": "latest", "list": [{"topic": "h/t/av", "on": "online", "off": "offline", "tpl": None}]}}
    assert res["sensor.bare"] == {"entities": [], "domains": [], "all": False, "how": "mqtt", "topics": ["h/b"]}


def test_mqtt_switch_falsy_state_on_off() -> None:
    """_mqtt_map keeps falsy state_on / state_off values instead of falling back to payload_on/off (0.13.2)."""
    from custom_components.functions_board.sources import _mqtt_map

    rule = _mqtt_map("switch", "homeassistant.components.mqtt.switch", {"state_on": "", "payload_on": "ON", "state_off": 0, "payload_off": "OFF"})
    assert rule is not None and rule["map"][""] == "on" and rule["map"][0] == "off", rule
