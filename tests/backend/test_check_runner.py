"""Self-running checks and Home Assistant Repairs integration (v0.16.0)."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er, issue_registry as ir, label_registry as lr
from homeassistant.setup import async_setup_component

from custom_components.functions_board.const import DOMAIN


async def _setup_with_automation(hass: HomeAssistant, light_target: str = "light.porch") -> str:
    hass.states.async_set("binary_sensor.door", "off")
    hass.states.async_set("light.porch", "off")
    hass.states.async_set("light.other", "off")
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                {
                    "id": "door_turns_on_light",
                    "alias": "Door turns on light",
                    "triggers": [{"trigger": "state", "entity_id": "binary_sensor.door", "to": "on"}],
                    "actions": [{"action": "light.turn_on", "target": {"entity_id": light_target}}],
                }
            ]
        },
    )
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    await hass.async_block_till_done()
    lab = lr.async_get(hass).async_create("Entryway")
    er.async_get(hass).async_update_entity("automation.door_turns_on_light", labels={lab.label_id})
    return lab.label_id


async def test_check_runner_passes_fails_and_syncs_repairs(hass: HomeAssistant, hass_ws_client) -> None:
    """Passing check creates no Repair; failing check raises a Repair; fixing it auto-clears the Repair."""
    label = await _setup_with_automation(hass, light_target="light.porch")
    ws = await hass_ws_client(hass)

    passing_check = {
        "id": "chk_pass",
        "name": "Door opens porch light",
        "at": 1700000000000,
        "start": {"binary_sensor.door": {"state": "off", "attributes": {}}, "light.porch": {"state": "off", "attributes": {}}},
        "items": ["automation.door_turns_on_light"],
        "steps": [{"op": "set", "id": "binary_sensor.door", "state": "on"}],
        "expect": [
            {"k": "state", "id": "light.porch", "state": "on"},
            {"k": "ran", "id": "automation.door_turns_on_light"},
        ],
    }
    failing_check = {
        "id": "chk_fail",
        "name": "Door opens other light",
        "at": 1700000000000,
        "start": {"binary_sensor.door": {"state": "off", "attributes": {}}, "light.other": {"state": "off", "attributes": {}}},
        "items": ["automation.door_turns_on_light"],
        "steps": [{"op": "set", "id": "binary_sensor.door", "state": "on"}],
        "expect": [{"k": "state", "id": "light.other", "state": "on"}],
    }
    board_only_check = {
        "id": "chk_board",
        "name": "Device press check",
        "at": 1700000000000,
        "start": {},
        "items": ["automation.door_turns_on_light"],
        "steps": [{"op": "press", "key": "{}"}],
        "expect": [{"k": "ran", "id": "automation.door_turns_on_light"}],
    }

    await ws.send_json_auto_id({"type": "functions_board/set_checks", "label": label, "checks": [passing_check, failing_check, board_only_check]})
    assert (await ws.receive_json())["success"]

    await ws.send_json_auto_id({"type": "functions_board/run_checks", "label": label})
    res = await ws.receive_json()
    assert res["success"], res
    got = res["result"]["results"][label]
    assert got["chk_pass"]["status"] == "pass" and got["chk_pass"]["ok"] is True
    assert got["chk_fail"]["status"] == "fail" and got["chk_fail"]["ok"] is False
    assert "light.other" in got["chk_fail"]["detail"]
    assert got["chk_board"]["status"] == "board_only" and got["chk_board"]["ok"] is True

    # Native Home Assistant Repair raised ONLY for chk_fail (never for pass or board_only)
    issues = ir.async_get(hass).issues
    fb_issues = [k for k in issues if k[0] == DOMAIN]
    assert len(fb_issues) == 1
    assert "chk_fail" in fb_issues[0][1]

    # functions_board/check_results returns cached results
    await ws.send_json_auto_id({"type": "functions_board/check_results", "label": label})
    cached = (await ws.receive_json())["result"]["results"]
    assert cached["chk_pass"]["status"] == "pass" and cached["chk_board"]["status"] == "board_only"

    # Removing the failing check and re-running clears the Repair issue automatically
    await ws.send_json_auto_id({"type": "functions_board/set_checks", "label": label, "checks": [passing_check, board_only_check]})
    assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/run_checks", "label": label})
    assert (await ws.receive_json())["success"]
    assert [k for k in ir.async_get(hass).issues if k[0] == DOMAIN] == []


async def test_check_runner_for_duration_and_template_condition(hass: HomeAssistant, hass_ws_client) -> None:
    """Backend runner evaluates `for:` duration + `advance` and Jinja template conditions on virtual state."""
    hass.states.async_set("binary_sensor.gate", "off")
    hass.states.async_set("input_boolean.armed", "on")
    hass.states.async_set("switch.siren", "off")
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                {
                    "id": "gate_left_open",
                    "alias": "Gate left open",
                    "triggers": [{"trigger": "state", "entity_id": "binary_sensor.gate", "to": "on", "for": {"minutes": 5}}],
                    "conditions": [{"condition": "template", "value_template": "{{ is_state('input_boolean.armed', 'on') }}"}],
                    "actions": [{"action": "switch.turn_on", "target": {"entity_id": "switch.siren"}}],
                }
            ]
        },
    )
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)

    chk = {
        "id": "chk_dur",
        "name": "Gate open 5 min triggers siren",
        "at": 1700000000000,
        "start": {
            "binary_sensor.gate": {"state": "off", "attributes": {}},
            "input_boolean.armed": {"state": "on", "attributes": {}},
            "switch.siren": {"state": "off", "attributes": {}},
        },
        "items": ["automation.gate_left_open"],
        "steps": [
            {"op": "set", "id": "binary_sensor.gate", "state": "on"},
            {"op": "advance", "ms": 300000},
        ],
        "expect": [{"k": "state", "id": "switch.siren", "state": "on"}],
    }
    await ws.send_json_auto_id({"type": "functions_board/set_checks", "label": "yard", "checks": [chk]})
    assert (await ws.receive_json())["success"]
    await ws.send_json_auto_id({"type": "functions_board/run_checks", "label": "yard"})
    res = (await ws.receive_json())["result"]["results"]["yard"]["chk_dur"]
    assert res["status"] == "pass" and res["ok"] is True


async def test_check_results_and_run_checks_admin_only(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token) -> None:
    """New check_results and run_checks commands require admin."""
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "functions_board", {})
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    for msg in ({"type": "functions_board/check_results"}, {"type": "functions_board/run_checks"}):
        await ws.send_json_auto_id(msg)
        res = await ws.receive_json()
        assert not res["success"] and res["error"]["code"] == "unauthorized", msg
