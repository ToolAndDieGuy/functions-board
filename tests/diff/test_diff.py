"""The differential test (0.11.2): the board's sandbox against Home Assistant's own core.

Every scenario in tests/diff/corpus.js (and, weekly, random ones from tests/diff/random.js) runs twice: in the
sandbox (tests/diff/sandbox.js, run by this file through node) and here, in a real Home Assistant core with its
real helpers and automations and a frozen clock moved a second at a time. After every step the two must agree on
the calls made (service and entities) and the state of every entity in the scenario.

MQTT entities (0.11.3) are set up here by MQTT discovery on pytest-homeassistant's mocked broker, which hands what's
published straight back; before the steps, the rule functions_board/sources gives for each must be the one the
sandbox was given.

    venvtest/bin/python -m pytest tests/diff -q            # the corpus
    FB_DIFF_RANDOM=200 FB_DIFF_SEED=7 ... pytest tests/diff  # plus 200 random scenarios (weekly)
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
import subprocess
import time

import pytest
from homeassistant.const import EVENT_CALL_SERVICE
from homeassistant.util import dt as dt_util
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import async_fire_mqtt_message, async_fire_time_changed

from custom_components.functions_board.sources import async_sources

ROOT = pathlib.Path(__file__).resolve().parents[2]
HELPERS = ("input_boolean", "counter", "input_number", "input_select", "timer")


def _load() -> dict:
    out = os.environ.get("FB_DIFF_TRACE")
    if not out:
        res = pathlib.Path(os.environ.get("FB_RESULTS") or ROOT / "tests" / ".results")
        res.mkdir(parents=True, exist_ok=True)
        out = str(res / "diff-sandbox.json")
        args = ["node", str(ROOT / "tests" / "diff" / "sandbox.js"), out]
        if os.environ.get("FB_DIFF_RANDOM"):
            args += ["--random", os.environ["FB_DIFF_RANDOM"], "--seed", os.environ.get("FB_DIFF_SEED", "1")]
        subprocess.run(args, check=True, cwd=ROOT)
    with open(out, encoding="utf-8") as f:
        return json.load(f)


DATA = _load()


def _same(a, b) -> bool:
    """States agree: the same text, the same number ('10' and '10.0'), or the same moment (an event entity's)."""
    if a == b:
        return True
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        pass
    x, y = (dt_util.parse_datetime(str(v)) if v else None for v in (a, b))
    return x is not None and y is not None and x == y


def _helpers(states: dict) -> dict:
    conf: dict = {d: {} for d in HELPERS}
    for eid, (state, *rest) in states.items():
        attrs = rest[0] if rest else {}
        dom, obj = eid.split(".", 1)
        if dom == "input_boolean":
            conf[dom][obj] = {"initial": state == "on"}
        elif dom == "counter":
            conf[dom][obj] = {"initial": int(state), "step": attrs.get("step", 1)}
            conf[dom][obj].update({k: attrs[k] for k in ("minimum", "maximum") if k in attrs})
        elif dom == "input_number":
            conf[dom][obj] = {"min": attrs.get("min", 0), "max": attrs.get("max", 100), "step": attrs.get("step", 1), "initial": float(state), "mode": "box"}
        elif dom == "input_select":
            conf[dom][obj] = {"options": attrs["options"], "initial": state}
        elif dom == "timer":
            conf[dom][obj] = {}
    return conf


def _derived(derived: dict) -> dict:
    """Helpers that follow what they read, as Home Assistant's own platforms (from the rule the sandbox gets)."""
    conf: dict = {}
    for eid, rule in derived.items():
        dom, obj = eid.split(".", 1)
        if rule["kind"] == "min_max":
            item = {"platform": "min_max", "name": obj, "type": rule["type"], "round_digits": rule.get("round", 2), "entity_ids": rule["entities"]}
        elif rule["kind"] == "threshold":
            item = {"platform": "threshold", "name": obj, "entity_id": rule["entity"], "hysteresis": rule.get("hysteresis", 0)}
            item.update({k: rule[k] for k in ("lower", "upper") if rule.get(k) is not None})
        elif rule["kind"] == "group":
            item = {"platform": "group", "name": obj, "entities": rule["entities"], "all": rule.get("all", False)}
        else:
            raise AssertionError(f"no Home Assistant platform here for {rule['kind']}")
        conf.setdefault(dom, []).append(item)
    return conf


# a command topic for the MQTT platforms that must have one (the sandbox's rule doesn't read it)
_COMMAND = ("switch", "lock", "select", "number", "light")


async def _mqtt(hass: HomeAssistant, mqtt_mock_entry, ents: dict) -> None:
    """The scenario's MQTT entities, by discovery, in its order; then their rules, as functions_board/sources says."""
    await mqtt_mock_entry()
    for eid, x in ents.items():
        dom, obj = eid.split(".", 1)
        cfg = dict(x["config"], name=obj, unique_id="fbdiff_" + obj, default_entity_id=eid)
        if dom in _COMMAND and "command_topic" not in cfg:
            cfg["command_topic"] = cfg["state_topic"] + "/set"
        async_fire_mqtt_message(hass, f"homeassistant/{dom}/{obj}/config", json.dumps(cfg))
        # each made before the next is announced: they subscribe in the corpus's order, as the sandbox has them (a
        # platform set up for the first of its kind can take a while)
        for _ in range(200):
            await _done(hass)
            if hass.states.get(eid) is not None:
                break
            await asyncio.sleep(0.01)
    got = (await async_sources(hass, list(ents)))
    for eid, x in ents.items():
        assert hass.states.get(eid) is not None, f"MQTT discovery made no {eid}"
        rule = (got.get(eid) or {}).get("rule")
        assert rule == x["rule"], f"{eid}: functions_board/sources says\n{json.dumps(rule)}\nthe corpus gave the sandbox\n{json.dumps(x['rule'])}"


async def _run_core(hass: HomeAssistant, freezer, mqtt_mock_entry, sc: dict, start: str, tz: str) -> list:
    _count_threads(hass)
    await hass.config.async_set_time_zone(tz)
    freezer.move_to(start)
    derived = sc.get("derived") or {}
    mqtt_ents = sc.get("mqtt") or {}
    plain = {k: v for k, v in sc["states"].items() if k not in derived and k not in mqtt_ents}
    for dom, items in _helpers(plain).items():
        if items:
            assert await async_setup_component(hass, dom, {dom: items})
    for eid, (state, *rest) in plain.items():
        if eid.split(".", 1)[0] not in HELPERS:
            hass.states.async_set(eid, state, rest[0] if rest else {})
    await hass.async_block_till_done()
    # the helpers that follow what they read, set up after their inputs and before the automations
    for dom, items in _derived(derived).items():
        assert await async_setup_component(hass, dom, {dom: items})
    await hass.async_block_till_done()
    if mqtt_ents:
        await _mqtt(hass, mqtt_mock_entry, mqtt_ents)
        for eid, x in mqtt_ents.items():
            assert hass.states.get(eid).state == x["state"], f"{eid} starts {hass.states.get(eid).state}, the corpus says {x['state']}"
    autos = [dict(cfg, id="fb_" + name, alias=name) for name, cfg in sc["automations"].items()]
    assert await async_setup_component(hass, "automation", {"automation": autos})
    await hass.async_block_till_done()
    calls: list = []

    def heard(ev):
        d = ev.data
        ents = d.get("service_data", {}).get("entity_id") or []
        ents = [ents] if isinstance(ents, str) else list(ents)
        calls.append(f"{d['domain']}.{d['service']} {','.join(sorted(ents))}")

    hass.bus.async_listen(EVENT_CALL_SERVICE, heard)
    trace = []
    for step in sc["steps"]:
        calls.clear()
        if "set" in step:
            old = hass.states.get(step["set"])
            attrs = dict(old.attributes) if old else {}
            attrs.update(step.get("attrs") or {})
            # from a plain loop callback, as a device's integration writes its state (not from inside this test's task,
            # which would put every run it starts inside the test's own task)
            hass.loop.call_soon(hass.states.async_set, step["set"], step["to"], attrs)
            await _done(hass)
        elif "wait" in step:
            for _ in range(int(step["wait"])):
                freezer.tick(1)
                async_fire_time_changed(hass)
                await _done(hass)
        elif "event" in step:
            hass.loop.call_soon(hass.bus.async_fire, step["event"], step.get("data") or {})
            await _done(hass)
        elif "mqtt" in step:
            # as the broker hands a message to Home Assistant's client
            hass.loop.call_soon(async_fire_mqtt_message, hass, step["mqtt"], step["payload"])
            await _done(hass)
        st = {}
        for eid in sorted(sc["states"]):
            s = hass.states.get(eid)
            st[eid] = s.state if s else None
        trace.append({"calls": sorted(calls), "states": st})
    return trace


def _count_threads(hass: HomeAssistant) -> None:
    """Count the jobs Home Assistant hands to its threads (a first import, a file read), so _done waits for them."""
    loop = hass.loop
    if getattr(loop, "fb_inflight", None) is not None:
        return
    loop.fb_inflight = 0
    run = loop.run_in_executor

    def counted(executor, func, *args):
        fut = run(executor, func, *args)
        loop.fb_inflight += 1

        def gone(_):
            loop.fb_inflight -= 1

        fut.add_done_callback(gone)
        return fut

    loop.run_in_executor = counted


async def _done(hass: HomeAssistant) -> None:
    """Let everything due now run. Not block_till_done: a run waiting in a delay is a task that isn't done, and with
    the clock frozen block_till_done would wait for it for ever. Instead the loop turns until nothing is ready to
    run and no thread is working for it (everything left waits for the clock, which only the steps move)."""
    loop = hass.loop
    for _ in range(200000):
        await asyncio.sleep(0)
        if loop._ready:  # noqa: SLF001
            continue
        if getattr(loop, "fb_inflight", 0):
            time.sleep(0.001)  # a thread is working: let it
            continue
        await asyncio.sleep(0)
        if not loop._ready and not getattr(loop, "fb_inflight", 0):  # noqa: SLF001
            return
    raise AssertionError("Home Assistant never came to rest (a loop?)")


def _say(step: dict) -> str:
    if "set" in step:
        return f"{step['set']} → {step['to']}" + (f" {step['attrs']}" if step.get("attrs") else "")
    if "wait" in step:
        return f"{step['wait']} s pass"
    if "mqtt" in step:
        return f"MQTT {step['mqtt']}: {step['payload']!r}"
    return f"event {step['event']} {step.get('data') or {}}"


@pytest.mark.parametrize("sc", DATA["scenarios"], ids=[s["name"].replace(" ", "_") for s in DATA["scenarios"]])
async def test_scenario(hass: HomeAssistant, freezer, mock_hass_config: None, mqtt_mock_entry, sc: dict) -> None:
    """The sandbox does what Home Assistant does, step by step."""
    assert not sc.get("error"), sc.get("error")
    core = await _run_core(hass, freezer, mqtt_mock_entry, sc, DATA["start"], DATA["tz"])
    diffs = []
    for i, (step, a, b) in enumerate(zip(sc["steps"], sc["sandbox"], core)):
        if a["calls"] != b["calls"]:
            diffs.append(f"step {i + 1} ({_say(step)}): calls: sandbox {a['calls']}, Home Assistant {b['calls']}")
        bad = [k for k in b["states"] if not _same(a["states"].get(k), b["states"][k])]
        if bad:
            diffs.append(f"step {i + 1} ({_say(step)}): " + "; ".join(f"{k}: sandbox {a['states'].get(k)!r}, Home Assistant {b['states'][k]!r}" for k in bad))
        if diffs:
            break
    assert not diffs, "\n".join(diffs) + "\n" + json.dumps({"automations": sc["automations"], "steps": sc["steps"]})
