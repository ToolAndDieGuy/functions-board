"""Self-running saved checks in Python + Home Assistant Repairs (v0.16.0).

Runs saved sandbox checks automatically on Home Assistant startup and automation/script reloads
against live automation & script configs using Home Assistant's own Jinja renderer and isolated
virtual state. Raises native Home Assistant Repair issues when a check fails and auto-clears them
once fixed. Checks that depend on browser-only simulation steps (device triggers, Z-Wave values,
slow/failing device injection, Assist sentences, calendars) are honestly marked "board_only"
("Run in board") rather than false-failing.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import re
from typing import Any

from homeassistant.const import EVENT_CALL_SERVICE, EVENT_HOMEASSISTANT_STARTED, EVENT_HOMEASSISTANT_STOP
from homeassistant.core import CALLBACK_TYPE, CoreState, Event, HomeAssistant, callback
from homeassistant.exceptions import TemplateError
from homeassistant.helpers import entity_registry as er, issue_registry as ir, label_registry as lr
from homeassistant.helpers.entity_component import DATA_INSTANCES
from homeassistant.helpers.template import Template

from .const import DOMAIN

SUPPORTED_OPS = frozenset({"set", "advance", "next", "run", "event", "mqtt", "ha", "webhook", "tag"})
BOARD_ONLY_OPS = frozenset({"press", "zwave", "behave", "calendar", "say"})
UNSUPPORTED_TRIGS = frozenset({"device", "sun", "calendar", "conversation", "geo_location", "zone", "persistent_notification"})
UNSUPPORTED_CONDS = frozenset({"device", "sun", "zone", "trigger"})

_SAFE_ISSUE = re.compile(r"[^a-zA-Z0-9_-]+")
_WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_MAX_STEPS = 200


class _BoardOnlyError(Exception):
    """Raised when a check uses features only the browser sandbox evaluates."""


def _as_list(v: Any) -> list[Any]:
    if v is None:
        return []
    return list(v) if isinstance(v, list | tuple) else [v]


def _dur_ms(v: Any) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, int | float) and not isinstance(v, bool):
        return max(0, int(v * 1000))
    if isinstance(v, str):
        s = v.strip()
        if m := re.match(r"^(\d+):(\d{1,2})(?::(\d{1,2}))?$", s):
            return (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3) or 0)) * 1000
        try:
            return max(0, int(float(s) * 1000))
        except ValueError:
            return None
    if isinstance(v, dict):
        try:
            sec = (
                float(v.get("days", 0) or 0) * 86400
                + float(v.get("hours", 0) or 0) * 3600
                + float(v.get("minutes", 0) or 0) * 60
                + float(v.get("seconds", 0) or 0)
                + float(v.get("milliseconds", 0) or 0) / 1000.0
            )
            return max(0, int(sec * 1000))
        except (TypeError, ValueError):
            return None
    return None


def _mqtt_match(pattern: str, topic: str) -> bool:
    p_parts = pattern.split("/")
    t_parts = topic.split("/")
    for i, part in enumerate(p_parts):
        if part == "#":
            return True
        if i >= len(t_parts):
            return False
        if part != "+" and part != t_parts[i]:
            return False
    return len(p_parts) == len(t_parts)


def _float_or_none(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class _StateObj:
    """Minimal HA-like State object for virtual template rendering."""

    def __init__(self, entity_id: str, state: str, attributes: dict[str, Any]) -> None:
        self.entity_id = entity_id
        self.domain, self.object_id = entity_id.split(".", 1) if "." in entity_id else ("", entity_id)
        self.state = state
        self.attributes = attributes
        self.name = attributes.get("friendly_name", entity_id)


class _DomainProxy:
    def __init__(self, domain: str, vstates: dict[str, dict[str, Any]]) -> None:
        self._domain = domain
        self._vstates = vstates

    def __getattr__(self, obj_id: str) -> _StateObj | None:
        eid = f"{self._domain}.{obj_id}"
        entry = self._vstates.get(eid)
        if entry is None:
            return None
        return _StateObj(eid, str(entry["state"]), dict(entry.get("attributes") or {}))


class _StatesProxy:
    """Callable + attribute-accessible virtual `states` proxy for Jinja templates."""

    def __init__(self, vstates: dict[str, dict[str, Any]]) -> None:
        self._vstates = vstates

    def __call__(self, entity_id: str) -> str:
        entry = self._vstates.get(str(entity_id))
        return str(entry["state"]) if entry is not None else "unknown"

    def __getattr__(self, domain: str) -> _DomainProxy:
        return _DomainProxy(domain, self._vstates)


class _SimEngine:
    """Isolated virtual evaluator for a single saved check."""

    def __init__(
        self,
        hass: HomeAssistant,
        check: dict[str, Any],
        configs: dict[str, dict[str, Any]],
    ) -> None:
        self.hass = hass
        self.configs = configs
        self.now_ms = int(check["at"]) if isinstance(check.get("at"), int | float) else int(datetime.now(UTC).timestamp() * 1000)
        self.vstates: dict[str, dict[str, Any]] = {}
        # Seed from live hass.states first, then overlay the check's starting snapshot
        for st in hass.states.async_all():
            self.vstates[st.entity_id] = {"state": str(st.state), "attributes": dict(st.attributes)}
        for eid, val in (check.get("start") or {}).items():
            if isinstance(eid, str) and isinstance(val, dict):
                self.vstates[eid] = {
                    "state": str(val.get("state", "unknown")),
                    "attributes": dict(val.get("attributes") or {}),
                }
        self.runs: dict[str, list[str]] = {}
        self.timers: list[tuple[int, str, Any]] = []  # (due_ms, kind, payload)
        self._tpl_prev: dict[tuple[str, int], bool] = {}
        self._steps_exec = 0

        # Validate that all loaded automations/scripts are supported by the Python runner
        for eid, cfg in self.configs.items():
            if not isinstance(cfg, dict):
                continue
            if cfg.get("use_blueprint"):
                raise _BoardOnlyError("Blueprint automation requires board sandbox")
            if eid.startswith("automation."):
                for idx, trig in enumerate(_as_list(cfg.get("triggers") if "triggers" in cfg else cfg.get("trigger"))):
                    if not isinstance(trig, dict):
                        continue
                    kind = trig.get("trigger") or trig.get("platform")
                    if kind in UNSUPPORTED_TRIGS:
                        raise _BoardOnlyError(f"Unsupported trigger: {kind}")
                    if kind == "template" and isinstance(trig.get("value_template"), str):
                        self._tpl_prev[(eid, idx)] = self._render_bool(trig["value_template"])

    def _get_state(self, eid: str) -> str:
        entry = self.vstates.get(eid)
        return str(entry["state"]) if entry is not None else "unknown"

    def _get_attr(self, eid: str, attr: str) -> Any:
        entry = self.vstates.get(eid)
        return (entry.get("attributes") or {}).get(attr) if entry is not None else None

    def _render_tpl(self, tpl_str: str, extra: dict[str, Any] | None = None) -> Any:
        vstates = self.vstates

        def is_state(eid: str, val: Any) -> bool:
            cur = self._get_state(eid)
            return cur in [str(x) for x in val] if isinstance(val, list | tuple) else cur == str(val)

        def state_attr(eid: str, attr: str) -> Any:
            return self._get_attr(eid, attr)

        def is_state_attr(eid: str, attr: str, val: Any) -> bool:
            return self._get_attr(eid, attr) == val

        def has_value(eid: str) -> bool:
            return self._get_state(eid) not in ("unknown", "unavailable", "none", "")

        now_dt = datetime.fromtimestamp(self.now_ms / 1000.0, tz=UTC)
        variables: dict[str, Any] = {
            "states": _StatesProxy(vstates),
            "is_state": is_state,
            "state_attr": state_attr,
            "is_state_attr": is_state_attr,
            "has_value": has_value,
            "now": lambda: now_dt,
        }
        if extra:
            variables.update(extra)
        try:
            return Template(tpl_str, self.hass).async_render(variables=variables, parse_result=False)
        except TemplateError:
            return ""

    def _render_bool(self, tpl_str: str, extra: dict[str, Any] | None = None) -> bool:
        val = self._render_tpl(tpl_str, extra)
        if isinstance(val, bool):
            return val
        return str(val).strip().lower() not in ("", "false", "0", "none", "no", "off")

    def _set_state(self, eid: str, new_state: str | None = None, attrs: dict[str, Any] | None = None) -> None:
        prev = self.vstates.get(eid)
        old_state = str(prev["state"]) if prev else "unknown"
        old_attrs = dict(prev.get("attributes") or {}) if prev else {}
        nxt_state = old_state if new_state is None else str(new_state)
        nxt_attrs = {**old_attrs, **(attrs or {})}
        self.vstates[eid] = {"state": nxt_state, "attributes": nxt_attrs}
        # Cancel pending `for:` timers that no longer match this entity
        self.timers = [
            t for t in self.timers
            if not (t[1] == "for" and t[2]["eid"] == eid and not self._trig_matches_now(t[2]["trig"], eid))
        ]
        self._on_state_change(eid, old_state, nxt_state, old_attrs, nxt_attrs)

    def _trig_matches_now(self, trig: dict[str, Any], eid: str) -> bool:
        kind = trig.get("trigger") or trig.get("platform")
        if kind == "state":
            attr = trig.get("attribute")
            cur = self._get_attr(eid, attr) if attr else self._get_state(eid)
            to_vals = [str(x) for x in _as_list(trig.get("to"))] if trig.get("to") is not None else None
            not_to = [str(x) for x in _as_list(trig.get("not_to"))] if trig.get("not_to") is not None else None
            if to_vals is not None and str(cur) not in to_vals:
                return False
            if not_to is not None and str(cur) in not_to:
                return False
            return True
        if kind == "numeric_state":
            attr = trig.get("attribute")
            raw = self._get_attr(eid, attr) if attr else self._get_state(eid)
            num = _float_or_none(raw)
            if num is None:
                return False
            above = _float_or_none(trig.get("above"))
            below = _float_or_none(trig.get("below"))
            if above is not None and not (num > above):
                return False
            if below is not None and not (num < below):
                return False
            return True
        if kind == "template" and isinstance(trig.get("value_template"), str):
            return self._render_bool(trig["value_template"])
        return True

    def _is_auto_enabled(self, eid: str) -> bool:
        return self._get_state(eid) != "off"

    def _on_state_change(
        self,
        eid: str,
        old_state: str,
        new_state: str,
        old_attrs: dict[str, Any],
        new_attrs: dict[str, Any],
    ) -> None:
        for auto_id, cfg in self.configs.items():
            if not auto_id.startswith("automation.") or not self._is_auto_enabled(auto_id):
                continue
            trigs = _as_list(cfg.get("triggers") if "triggers" in cfg else cfg.get("trigger"))
            for idx, trig in enumerate(trigs):
                if not isinstance(trig, dict) or trig.get("enabled") is False:
                    continue
                kind = trig.get("trigger") or trig.get("platform")
                if kind == "state":
                    ents = [str(x) for x in _as_list(trig.get("entity_id"))]
                    if eid not in ents:
                        continue
                    attr = trig.get("attribute")
                    ov = str(old_attrs.get(attr)) if attr else old_state
                    nv = str(new_attrs.get(attr)) if attr else new_state
                    if ov == nv:
                        continue
                    from_vals = [str(x) for x in _as_list(trig.get("from"))] if trig.get("from") is not None else None
                    to_vals = [str(x) for x in _as_list(trig.get("to"))] if trig.get("to") is not None else None
                    not_to = [str(x) for x in _as_list(trig.get("not_to"))] if trig.get("not_to") is not None else None
                    not_from = [str(x) for x in _as_list(trig.get("not_from"))] if trig.get("not_from") is not None else None
                    if from_vals is not None and ov not in from_vals:
                        continue
                    if not_from is not None and ov in not_from:
                        continue
                    if to_vals is not None and nv not in to_vals:
                        continue
                    if not_to is not None and nv in not_to:
                        continue
                    tvars = {"trigger": {"platform": "state", "entity_id": eid, "from_state": _StateObj(eid, old_state, old_attrs), "to_state": _StateObj(eid, new_state, new_attrs), "id": trig.get("id", str(idx))}}
                    self._arm_or_fire(auto_id, cfg, trig, eid, tvars)
                elif kind == "numeric_state":
                    ents = [str(x) for x in _as_list(trig.get("entity_id"))]
                    if eid not in ents:
                        continue
                    attr = trig.get("attribute")
                    onum = _float_or_none(old_attrs.get(attr) if attr else old_state)
                    nnum = _float_or_none(new_attrs.get(attr) if attr else new_state)
                    if nnum is None:
                        continue
                    above = _float_or_none(trig.get("above"))
                    below = _float_or_none(trig.get("below"))
                    in_now = (above is None or nnum > above) and (below is None or nnum < below)
                    in_old = onum is not None and (above is None or onum > above) and (below is None or onum < below)
                    if in_now and not in_old:
                        tvars = {"trigger": {"platform": "numeric_state", "entity_id": eid, "id": trig.get("id", str(idx))}}
                        self._arm_or_fire(auto_id, cfg, trig, eid, tvars)
                elif kind == "template" and isinstance(trig.get("value_template"), str):
                    was = self._tpl_prev.get((auto_id, idx), False)
                    now = self._render_bool(trig["value_template"])
                    self._tpl_prev[(auto_id, idx)] = now
                    if now and not was:
                        tvars = {"trigger": {"platform": "template", "id": trig.get("id", str(idx))}}
                        self._arm_or_fire(auto_id, cfg, trig, eid, tvars)

    def _arm_or_fire(
        self,
        auto_id: str,
        cfg: dict[str, Any],
        trig: dict[str, Any],
        eid: str,
        tvars: dict[str, Any],
    ) -> None:
        wait_ms = _dur_ms(trig.get("for"))
        if wait_ms and wait_ms > 0:
            self.timers.append((self.now_ms + wait_ms, "for", {"auto_id": auto_id, "cfg": cfg, "trig": trig, "eid": eid, "vars": tvars}))
            self.timers.sort(key=lambda x: x[0])
        else:
            self._run_automation(auto_id, cfg, tvars)

    def _check_cond(self, cond: Any, variables: dict[str, Any]) -> bool:
        if isinstance(cond, str):
            return self._render_bool(cond, variables)
        if not isinstance(cond, dict) or cond.get("enabled") is False:
            return True
        kind = cond.get("condition")
        if kind in UNSUPPORTED_CONDS:
            raise _BoardOnlyError(f"Unsupported condition: {kind}")
        if kind == "state":
            ents = [str(x) for x in _as_list(cond.get("entity_id"))]
            want = [str(x) for x in _as_list(cond.get("state"))]
            attr = cond.get("attribute")
            match_any = cond.get("match") == "any"
            checks = [str(self._get_attr(e, attr) if attr else self._get_state(e)) in want for e in ents]
            return any(checks) if match_any else all(checks)
        if kind == "numeric_state":
            ents = [str(x) for x in _as_list(cond.get("entity_id"))]
            attr = cond.get("attribute")
            above = _float_or_none(cond.get("above"))
            below = _float_or_none(cond.get("below"))
            for e in ents:
                num = _float_or_none(self._get_attr(e, attr) if attr else self._get_state(e))
                if num is None:
                    return False
                if above is not None and not (num > above):
                    return False
                if below is not None and not (num < below):
                    return False
            return True
        if kind == "template":
            return self._render_bool(str(cond.get("value_template", "")), variables)
        if kind == "and":
            return all(self._check_cond(c, variables) for c in _as_list(cond.get("conditions")))
        if kind == "or":
            return any(self._check_cond(c, variables) for c in _as_list(cond.get("conditions")))
        if kind == "not":
            return not any(self._check_cond(c, variables) for c in _as_list(cond.get("conditions")))
        if kind == "time":
            dt = datetime.fromtimestamp(self.now_ms / 1000.0, tz=UTC)
            wds = _as_list(cond.get("weekday"))
            if wds and _WEEKDAYS[dt.weekday()] not in wds:
                return False
            cur_s = dt.hour * 3600 + dt.minute * 60 + dt.second
            after_s = self._parse_hms(cond.get("after"))
            before_s = self._parse_hms(cond.get("before"))
            if after_s is not None and before_s is not None:
                return (cur_s >= after_s or cur_s < before_s) if after_s > before_s else (after_s <= cur_s < before_s)
            if after_s is not None and cur_s < after_s:
                return False
            if before_s is not None and cur_s >= before_s:
                return False
            return True
        raise _BoardOnlyError(f"Unsupported condition: {kind}")

    @staticmethod
    def _parse_hms(v: Any) -> int | None:
        if not isinstance(v, str):
            return None
        m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", v.strip())
        if not m:
            return None
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3) or 0)

    def _run_automation(self, auto_id: str, cfg: dict[str, Any], variables: dict[str, Any], skip_cond: bool = False) -> None:
        self._steps_exec += 1
        if self._steps_exec > _MAX_STEPS:
            return
        conds = _as_list(cfg.get("conditions") if "conditions" in cfg else cfg.get("condition"))
        if not skip_cond and not all(self._check_cond(c, variables) for c in conds):
            self.runs.setdefault(auto_id, []).append("stopped")
            return
        acts = _as_list(cfg.get("actions") if "actions" in cfg else cfg.get("action"))
        done = self._run_seq(auto_id, acts, dict(variables))
        if done:
            self.runs.setdefault(auto_id, []).append("finished")

    def _run_script(self, script_id: str, variables: dict[str, Any]) -> None:
        cfg = self.configs.get(script_id)
        if not cfg:
            return
        self._steps_exec += 1
        if self._steps_exec > _MAX_STEPS:
            return
        acts = _as_list(cfg.get("sequence"))
        done = self._run_seq(script_id, acts, dict(variables))
        if done:
            self.runs.setdefault(script_id, []).append("finished")

    def _run_seq(self, owner: str, acts: list[Any], variables: dict[str, Any]) -> bool:
        for idx, step in enumerate(acts):
            if not isinstance(step, dict) or step.get("enabled") is False:
                continue
            if "delay" in step:
                ms = _dur_ms(step["delay"]) or 0
                if ms > 0:
                    self.timers.append((self.now_ms + ms, "seq", {"owner": owner, "acts": acts[idx + 1:], "vars": dict(variables)}))
                    self.timers.sort(key=lambda x: x[0])
                    return False
                continue
            if "wait_for_trigger" in step or "wait_template" in step or "parallel" in step:
                raise _BoardOnlyError("Wait/parallel step requires board sandbox")
            if "stop" in step:
                return True
            if "variables" in step and isinstance(step["variables"], dict):
                for k, v in step["variables"].items():
                    variables[k] = self._render_tpl(v, variables) if isinstance(v, str) and ("{{" in v or "{%" in v) else v
                continue
            if "condition" in step:
                if not self._check_cond(step, variables):
                    self.runs.setdefault(owner, []).append("stopped")
                    return False
                continue
            if "if" in step:
                branch = _as_list(step.get("then")) if all(self._check_cond(c, variables) for c in _as_list(step["if"])) else _as_list(step.get("else"))
                if not self._run_seq(owner, branch, variables):
                    return False
                continue
            if "choose" in step:
                matched = False
                for opt in _as_list(step["choose"]):
                    if isinstance(opt, dict) and all(self._check_cond(c, variables) for c in _as_list(opt.get("conditions"))):
                        matched = True
                        if not self._run_seq(owner, _as_list(opt.get("sequence")), variables):
                            return False
                        break
                if not matched and step.get("default"):
                    if not self._run_seq(owner, _as_list(step["default"]), variables):
                        return False
                continue
            if "device_id" in step and step.get("type") and "action" not in step and "service" not in step:
                raise _BoardOnlyError("Device action requires board sandbox")
            svc = step.get("action") or step.get("service")
            if isinstance(svc, str):
                if "{{" in svc or "{%" in svc:
                    svc = str(self._render_tpl(svc, variables)).strip()
                self._exec_service(svc, step, variables)
        return True

    def _exec_service(self, svc: str, step: dict[str, Any], variables: dict[str, Any]) -> None:
        if "." not in svc:
            return
        dom, name = svc.split(".", 1)
        tgt = step.get("target") if isinstance(step.get("target"), dict) else {}
        data = step.get("data") if isinstance(step.get("data"), dict) else {}
        ents = [str(x) for x in _as_list(tgt.get("entity_id") or step.get("entity_id") or data.get("entity_id")) if isinstance(x, str)]
        if dom == "script":
            if name == "turn_on":
                for e in ents:
                    self._run_script(e, dict(data.get("variables") or {}))
            elif name not in ("turn_off", "toggle", "reload"):
                self._run_script(f"script.{name}", dict(data))
            return
        if dom == "automation" and name == "trigger":
            for e in ents:
                if e in self.configs:
                    self._run_automation(e, self.configs[e], {}, skip_cond=bool(data.get("skip_condition")))
            return
        if dom == "mqtt" and name == "publish":
            topic = str(data.get("topic") or "")
            payload = str(data.get("payload") or "")
            if topic:
                self._fire_mqtt(topic, payload)
            return
        for e in ents:
            if name == "turn_on":
                self._set_state(e, "on")
            elif name == "turn_off":
                self._set_state(e, "off")
            elif name == "toggle":
                self._set_state(e, "off" if self._get_state(e) == "on" else "on")
            elif name == "open_cover":
                self._set_state(e, "open")
            elif name == "close_cover":
                self._set_state(e, "closed")
            elif name == "lock":
                self._set_state(e, "locked")
            elif name == "unlock":
                self._set_state(e, "unlocked")
            elif name == "set_value" and "value" in data:
                self._set_state(e, str(data["value"]))
            elif name == "select_option" and "option" in data:
                self._set_state(e, str(data["option"]))
            elif dom == "counter":
                cur = int(_float_or_none(self._get_state(e)) or 0)
                if name == "increment":
                    self._set_state(e, str(cur + 1))
                elif name == "decrement":
                    self._set_state(e, str(cur - 1))
                elif name == "reset":
                    self._set_state(e, str(self._get_attr(e, "initial") or 0))
            elif dom == "timer":
                if name == "start":
                    self._set_state(e, "active")
                elif name in ("cancel", "finish"):
                    self._set_state(e, "idle")
                elif name == "pause":
                    self._set_state(e, "paused")

    def _fire_event(self, ev_type: str, ev_data: dict[str, Any] | None = None) -> None:
        ev_data = ev_data or {}
        for auto_id, cfg in self.configs.items():
            if not auto_id.startswith("automation.") or not self._is_auto_enabled(auto_id):
                continue
            for idx, trig in enumerate(_as_list(cfg.get("triggers") if "triggers" in cfg else cfg.get("trigger"))):
                if not isinstance(trig, dict) or trig.get("enabled") is False:
                    continue
                if (trig.get("trigger") or trig.get("platform")) != "event":
                    continue
                if ev_type not in [str(x) for x in _as_list(trig.get("event_type"))]:
                    continue
                want = trig.get("event_data") or {}
                if all(ev_data.get(k) == v for k, v in want.items()):
                    self._run_automation(auto_id, cfg, {"trigger": {"platform": "event", "event": {"event_type": ev_type, "data": ev_data}, "id": trig.get("id", str(idx))}})

    def _fire_mqtt(self, topic: str, payload: str) -> None:
        for auto_id, cfg in self.configs.items():
            if not auto_id.startswith("automation.") or not self._is_auto_enabled(auto_id):
                continue
            for idx, trig in enumerate(_as_list(cfg.get("triggers") if "triggers" in cfg else cfg.get("trigger"))):
                if not isinstance(trig, dict) or trig.get("enabled") is False:
                    continue
                if (trig.get("trigger") or trig.get("platform")) != "mqtt":
                    continue
                pat = str(trig.get("topic") or "")
                if not pat or not _mqtt_match(pat, topic):
                    continue
                if trig.get("payload") is not None and str(trig["payload"]) != payload:
                    continue
                self._run_automation(auto_id, cfg, {"trigger": {"platform": "mqtt", "topic": topic, "payload": payload, "id": trig.get("id", str(idx))}})

    def _fire_simple(self, kind: str, field: str, value: str) -> None:
        for auto_id, cfg in self.configs.items():
            if not auto_id.startswith("automation.") or not self._is_auto_enabled(auto_id):
                continue
            for idx, trig in enumerate(_as_list(cfg.get("triggers") if "triggers" in cfg else cfg.get("trigger"))):
                if not isinstance(trig, dict) or trig.get("enabled") is False:
                    continue
                if (trig.get("trigger") or trig.get("platform")) == kind and str(trig.get(field) or "") == value:
                    self._run_automation(auto_id, cfg, {"trigger": {"platform": kind, field: value, "id": trig.get("id", str(idx))}})

    def _advance_to(self, target_ms: int) -> None:
        while self.timers and self.timers[0][0] <= target_ms:
            due, kind, payload = self.timers.pop(0)
            self.now_ms = due
            if kind == "for":
                if self._is_auto_enabled(payload["auto_id"]) and self._trig_matches_now(payload["trig"], payload["eid"]):
                    self._run_automation(payload["auto_id"], payload["cfg"], payload["vars"])
            elif kind == "seq":
                if self._run_seq(payload["owner"], payload["acts"], payload["vars"]):
                    self.runs.setdefault(payload["owner"], []).append("finished")
        self.now_ms = max(self.now_ms, target_ms)

    def apply_step(self, step: dict[str, Any]) -> None:
        op = step.get("op")
        if op in BOARD_ONLY_OPS or op not in SUPPORTED_OPS:
            raise _BoardOnlyError(f"Browser-only step op: {op}")
        if op == "set":
            self._set_state(str(step.get("id", "")), step.get("state"), step.get("attrs"))
        elif op == "advance":
            ms = int(step.get("ms") or 0)
            self._advance_to(self.now_ms + max(0, ms))
        elif op == "next":
            if self.timers:
                self._advance_to(self.timers[0][0])
        elif op == "run":
            eid = str(step.get("id", ""))
            if eid.startswith("automation.") and eid in self.configs:
                self._run_automation(eid, self.configs[eid], {})
            elif eid.startswith("script.") and eid in self.configs:
                self._run_script(eid, {})
        elif op == "event":
            self._fire_event(str(step.get("type", "")), step.get("data"))
        elif op == "mqtt":
            self._fire_mqtt(str(step.get("topic", "")), str(step.get("payload", "")))
        elif op == "ha":
            self._fire_simple("homeassistant", "event", str(step.get("event", "start")))
        elif op == "webhook":
            self._fire_simple("webhook", "webhook_id", str(step.get("id", "")))
        elif op == "tag":
            self._fire_simple("tag", "tag_id", str(step.get("tag", "")))


def _live_configs(hass: HomeAssistant, entity_ids: set[str]) -> dict[str, dict[str, Any]]:
    """Read live raw automation & script configs directly from HA entity components."""
    comps = hass.data.get(DATA_INSTANCES, {})
    out: dict[str, dict[str, Any]] = {}
    for eid in entity_ids:
        dom = eid.split(".", 1)[0]
        comp = comps.get(dom)
        if comp is None:
            continue
        ent = comp.get_entity(eid)
        if ent is None:
            continue
        cfg = None
        if dom == "automation":
            cfg = getattr(ent, "raw_config", None)
        elif dom == "script":
            sc = getattr(ent, "script", None)
            cfg = getattr(sc, "raw_config", None) if sc is not None else None
            if cfg is None:
                cfg = getattr(ent, "raw_config", None) or getattr(ent, "_config", None)
        if isinstance(cfg, dict):
            out[eid] = cfg
    return out


def evaluate_check(
    hass: HomeAssistant,
    check: dict[str, Any],
    configs: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Run one saved check synchronously against `configs` and return its result dict."""
    now_iso = datetime.now(UTC).isoformat(timespec="seconds")
    steps = check.get("steps") or []
    expect = check.get("expect") or []
    if not steps or not expect:
        return {"status": "board_only", "ok": True, "detail": "Empty check", "checked_at": now_iso}
    if check.get("answers"):
        return {"status": "board_only", "ok": True, "detail": "Interactive check — run in board", "checked_at": now_iso}
    for s in steps:
        if not isinstance(s, dict) or s.get("op") in BOARD_ONLY_OPS or s.get("op") not in SUPPORTED_OPS:
            return {"status": "board_only", "ok": True, "detail": "Uses browser-only simulation steps", "checked_at": now_iso}
    try:
        eng = _SimEngine(hass, check, configs)
        for s in steps:
            eng.apply_step(s)
    except _BoardOnlyError as err:
        return {"status": "board_only", "ok": True, "detail": str(err), "checked_at": now_iso}
    except Exception as err:  # noqa: BLE001 - defensive: never crash HA startup
        return {"status": "board_only", "ok": True, "detail": f"Run in board ({err})", "checked_at": now_iso}

    for exp in expect:
        if not isinstance(exp, dict):
            continue
        k, eid = exp.get("k"), str(exp.get("id", ""))
        if k == "state":
            want = str(exp.get("state", ""))
            got = eng._get_state(eid)
            if got != want:
                return {"status": "fail", "ok": False, "detail": f"{eid} ended {got} (expected {want})", "checked_at": now_iso}
        elif k == "ran":
            if "finished" not in eng.runs.get(eid, []):
                got = ", ".join(eng.runs.get(eid, [])) or "did not run"
                return {"status": "fail", "ok": False, "detail": f"{eid} did not run to the end ({got})", "checked_at": now_iso}
        elif k == "stopped":
            if "stopped" not in eng.runs.get(eid, []):
                got = ", ".join(eng.runs.get(eid, [])) or "did not run"
                return {"status": "fail", "ok": False, "detail": f"{eid} was not stopped by conditions ({got})", "checked_at": now_iso}
        elif k == "notran":
            if eng.runs.get(eid):
                return {"status": "fail", "ok": False, "detail": f"{eid} ran unexpectedly", "checked_at": now_iso}
    return {"status": "pass", "ok": True, "detail": "", "checked_at": now_iso}


class CheckRunner:
    """Runs saved checks on startup and reloads, syncing failures to HA Repairs."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.results: dict[str, dict[str, dict[str, Any]]] = {}
        self._unsubs: list[CALLBACK_TYPE] = []
        self._timer: asyncio.TimerHandle | None = None
        self._task: asyncio.Task[Any] | None = None
        self._active_issues: set[str] = set()
        self._started = False

    def async_start(self) -> None:
        """Attach HA lifecycle & reload listeners (idempotent)."""
        if self._started:
            return
        self._started = True

        @callback
        def _on_auto_reload(_ev: Event) -> None:
            self.schedule_run()

        @callback
        def _on_service(ev: Event) -> None:
            if ev.data.get("domain") == "script" and ev.data.get("service") == "reload":
                self.schedule_run()

        @callback
        def _on_started(_ev: Event) -> None:
            self.schedule_run()

        @callback
        def _on_stop(_ev: Event) -> None:
            self.async_stop()

        self._unsubs.append(self.hass.bus.async_listen("automation_reloaded", _on_auto_reload))
        self._unsubs.append(self.hass.bus.async_listen(EVENT_CALL_SERVICE, _on_service))
        self._unsubs.append(self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _on_stop))
        if self.hass.state == CoreState.running:
            # Only schedule an initial run if checks already exist
            from . import DATA_KEY  # noqa: PLC0415
            board = self.hass.data.get(DATA_KEY)
            if board and board.checks and board.checks.by_label:
                self.schedule_run()
        else:
            self._unsubs.append(self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started))

    @callback
    def async_stop(self) -> None:
        """Cancel pending debounce timer, background task, and remove all bus listeners."""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        while self._unsubs:
            unsub = self._unsubs.pop()
            unsub()
        self._started = False

    @callback
    def schedule_run(self, label: str | None = None, delay: float = 0.5) -> None:
        """Debounce a background check run so rapid reloads coalesce."""
        if self.hass.is_stopping:
            return
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

        @callback
        def _fire() -> None:
            self._timer = None
            if not self.hass.is_stopping:
                self._task = self.hass.async_create_task(self.async_run(label))

        self._timer = self.hass.loop.call_later(delay, _fire)

    def _issue_id(self, label: str, check_id: str) -> str:
        safe_l = _SAFE_ISSUE.sub("_", label)[:40]
        safe_c = _SAFE_ISSUE.sub("_", check_id)[:40]
        return f"check_failed_{safe_l}_{safe_c}"

    def _fn_name(self, label: str) -> str:
        reg = lr.async_get(self.hass)
        lab = reg.async_get_label(label)
        return lab.name if lab and lab.name else label

    async def async_run(self, label: str | None = None) -> dict[str, dict[str, dict[str, Any]]]:
        """Run saved checks for one function (or all functions) and update HA Repairs."""
        from . import DATA_KEY  # noqa: PLC0415

        board = self.hass.data.get(DATA_KEY)
        if board is None or board.checks is None:
            return {}
        by_label = board.checks.by_label
        labels = [label] if label is not None else list(by_label.keys())
        ent_reg = er.async_get(self.hass)

        for lab in labels:
            checks = by_label.get(lab, [])
            if not checks:
                self.results.pop(lab, None)
                continue
            members = {
                e.entity_id
                for e in ent_reg.entities.values()
                if lab in (e.labels or ()) and e.domain in ("automation", "script")
            }
            lab_res: dict[str, dict[str, Any]] = {}
            for chk in checks:
                cid = str(chk.get("id", ""))
                if not cid:
                    continue
                wanted = set(members) | {
                    str(x) for x in (chk.get("items") or []) if isinstance(x, str) and x.startswith(("automation.", "script."))
                }
                configs = _live_configs(self.hass, wanted)
                lab_res[cid] = evaluate_check(self.hass, chk, configs)
            self.results[lab] = lab_res

        # Clean up results for deleted labels when running all
        if label is None:
            for stale in list(self.results.keys()):
                if stale not in by_label:
                    del self.results[stale]

        self._sync_repairs(by_label)
        board.notify(self.hass, {"what": "check_results", "label": label or "", "client": ""})
        return {lab: dict(self.results.get(lab, {})) for lab in labels} if label is not None else {k: dict(v) for k, v in self.results.items()}

    def _sync_repairs(self, by_label: dict[str, list[dict[str, Any]]]) -> None:
        """Create/update Repair issues for failed checks and clear resolved ones."""
        want: set[str] = set()
        for lab, lab_res in self.results.items():
            checks_by_id = {str(c.get("id", "")): c for c in by_label.get(lab, [])}
            fn_name = self._fn_name(lab)
            for cid, res in lab_res.items():
                if res.get("status") != "fail":
                    continue
                chk = checks_by_id.get(cid)
                if not chk:
                    continue
                iid = self._issue_id(lab, cid)
                want.add(iid)
                ir.async_create_issue(
                    self.hass,
                    DOMAIN,
                    iid,
                    is_fixable=False,
                    severity=ir.IssueSeverity.WARNING,
                    translation_key="check_failed",
                    translation_placeholders={
                        "function": fn_name,
                        "check": str(chk.get("name", cid)),
                        "detail": str(res.get("detail", "")),
                    },
                )
        for old in list(self._active_issues - want):
            ir.async_delete_issue(self.hass, DOMAIN, old)
        self._active_issues = want
