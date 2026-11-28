"""What a derived helper reads, so the board can draw arrows into it.

Home Assistant doesn't expose a template entity's config to the frontend, and search/related doesn't
link a helper to its sources, so the integration answers this from inside:

- Template entities (YAML or UI): the entities and domains the entity's templates listen to right now.
  That comes from a private attribute, read defensively: a Home Assistant release that moves it makes
  the answer empty, never an error.
- Trigger-based template entities (template: - triggers: ...): every existing entity ID named in their
  triggers, conditions, actions and their own templates (from the coordinator's config, also private).
- Helpers set up in the UI (min/max, threshold, derivative, utility meter, statistics, group and so on):
  every string in the config entry's options that is an existing entity ID.

Each answer may also carry `rule`, how the helper's state follows what it reads, so the board's sandbox can
recompute it (0.11.2): a template entity's state template; a min/max sensor's type, rounding and entities; a
threshold sensor's entity, limits and hysteresis; a binary sensor, light or switch group's members and whether
all must be on. Read from the live entity's private attributes as above: a release that moves them leaves the rule
out, and the sandbox keeps the helper as it is.

MQTT entities (0.11.3) read topics, not entities: their answer is the topics and a rule saying how each message
changes the entity, as Home Assistant's MQTT platforms do it (`_mqtt_rule`), so the sandbox's MQTT messages move them.
"""

from __future__ import annotations

from collections.abc import Iterable
import re
from typing import Any

from homeassistant.core import HomeAssistant, split_entity_id, valid_entity_id
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_component import DATA_INSTANCES
from homeassistant.loader import async_get_integrations


async def async_sources(
    hass: HomeAssistant,
    entity_ids: Iterable[str],
    *,
    include_templates: bool = False,
) -> dict[str, Any]:
    """Map each entity to what it reads; entities with nothing found are left out."""
    reg = er.async_get(hass)
    comps = hass.data.get(DATA_INSTANCES, {})
    ids = list(entity_ids)
    entries = {}
    for entity_id in ids:
        entry = reg.async_get(entity_id)
        if entry and entry.config_entry_id:
            if config_entry := hass.config_entries.async_get_entry(entry.config_entry_id):
                entries[entity_id] = config_entry
    helper_domains = await _helper_domains(hass, {e.domain for e in entries.values()})
    out: dict[str, Any] = {}
    for entity_id in ids:
        if (mqtt := _mqtt(comps, entity_id)) is not None:
            out[entity_id] = mqtt
            continue
        found = _template_listeners(comps, entity_id)
        if found is None:
            found = _trigger_template(hass, reg, comps, entity_id)
        if found is None and entity_id in entries and entries[entity_id].domain in helper_domains:
            found = _options_entities(hass, reg, entity_id, entries[entity_id].options)
        tpls = _template_sources(comps, entity_id, entries.get(entity_id)) if include_templates else None
        rule = _rule(comps, entity_id) if (found is not None or tpls is not None) else None
        if found and (found["entities"] or found["domains"] or found["all"] or (rule and rule.get("kind") == "template") or tpls):
            if rule:
                found["rule"] = rule
            if tpls:
                found["templates"] = tpls
            out[entity_id] = found
        elif tpls:
            item: dict[str, Any] = {"entities": [], "domains": [], "all": False, "how": "template", "templates": tpls}
            if rule:
                item["rule"] = rule
            out[entity_id] = item
    return out


def _template_sources(
    comps: dict[str, Any], entity_id: str, config_entry: Any | None = None
) -> dict[str, Any] | None:
    """Source Jinja templates on a template entity (for Template Studio inspection), read defensively."""
    domain = split_entity_id(entity_id)[0]
    comp = comps.get(domain)
    if comp is None:
        return None
    try:
        entity = comp.get_entity(entity_id)
        if entity is None:
            return None
        module = type(entity).__module__
        if not module.startswith("homeassistant.components.template."):
            return None
        option = getattr(entity, "_state_option", None)
        config = getattr(entity, "_config", None)
        if not isinstance(config, dict):
            return None
        tpls: dict[str, Any] = {}
        if option and (st_tpl := _tpl(config.get(option))):
            tpls["state"] = st_tpl
        if avail_tpl := _tpl(config.get("availability")):
            tpls["availability"] = avail_tpl
        if icon_tpl := _tpl(config.get("icon")):
            tpls["icon"] = icon_tpl
        attrs_raw = config.get("attributes")
        if isinstance(attrs_raw, dict):
            attrs = {str(k): t for k, v in attrs_raw.items() if (t := _tpl(v))}
            if attrs:
                tpls["attributes"] = attrs
        if not tpls:
            return None
        if getattr(entity, "coordinator", None) is not None:
            tpls["triggered"] = True
        if config_entry is not None and getattr(config_entry, "domain", None) == "template":
            tpls["ui"] = True
            tpls["entry_id"] = config_entry.entry_id
        return tpls
    except Exception:  # noqa: BLE001 - private attributes: empty beats a failed request
        return None


def _rule(comps: dict[str, Any], entity_id: str) -> dict[str, Any] | None:
    """How the helper's state follows its inputs, when the sandbox can recompute it; else None."""
    domain = split_entity_id(entity_id)[0]
    comp = comps.get(domain)
    if comp is None:
        return None
    try:
        entity = comp.get_entity(entity_id)
        if entity is None:
            return None
        module = type(entity).__module__
        # a template entity (YAML or UI): the template its main state comes from
        option, config = getattr(entity, "_state_option", None), getattr(entity, "_config", None)
        # (not a trigger-based one: that changes when its trigger fires, not when what it reads does)
        if module.startswith("homeassistant.components.template.") and option and isinstance(config, dict) and getattr(entity, "coordinator", None) is None:
            template = getattr(config.get(option), "template", None)
            if isinstance(template, str) and domain in ("sensor", "binary_sensor"):
                rule: dict[str, Any] = {"kind": "template", "state": template}
                if avail := _tpl(config.get("availability")):
                    rule["availability"] = avail
                if any(config.get(k) for k in ("delay_on", "delay_off", "auto_off")):
                    rule["partly"] = True
                return rule
        if module == "homeassistant.components.min_max.sensor":
            return {
                "kind": "min_max",
                "type": str(entity._sensor_type),  # noqa: SLF001
                "round": int(entity._round_digits),  # noqa: SLF001
                "entities": list(entity._entity_ids),  # noqa: SLF001
            }
        if module == "homeassistant.components.threshold.binary_sensor":
            return {
                "kind": "threshold",
                "entity": str(entity._entity_id),  # noqa: SLF001
                "lower": getattr(entity, "_threshold_lower", None),
                "upper": getattr(entity, "_threshold_upper", None),
                "hysteresis": float(entity._hysteresis),  # noqa: SLF001
            }
        if module in ("homeassistant.components.group.binary_sensor", "homeassistant.components.group.light", "homeassistant.components.group.switch"):
            mode = getattr(entity, "mode", None)
            if mode in (any, all):
                return {"kind": "group", "entities": list(entity._entity_ids), "all": mode is all}  # noqa: SLF001
    except Exception:  # noqa: BLE001 - private attributes: no rule beats a failed request
        return None
    return None


# what an MQTT entity's state message means, per platform: payload (after its value template) → state. A payload not
# here is ignored, as Home Assistant ignores it; "None" resets the state to unknown where the platform says so
def _mqtt_map(domain: str, module: str, c: dict[str, Any]) -> dict[str, Any] | None:
    get = c.get
    if domain == "sensor":
        return {"how": "sensor"}
    if domain == "binary_sensor":
        return {"how": "map", "map": {get("payload_on", "ON"): "on", get("payload_off", "OFF"): "off", "None": "unknown"}, "blank": "skip"}
    if domain == "switch":
        state_on = get("state_on") if get("state_on") is not None else get("payload_on", "ON")
        state_off = get("state_off") if get("state_off") is not None else get("payload_off", "OFF")
        return {"how": "map", "map": {state_on: "on", state_off: "off", "None": "unknown"}}
    if domain == "fan":
        return {"how": "map", "map": {get("payload_on", "ON"): "on", get("payload_off", "OFF"): "off", "None": "unknown"}, "blank": "skip", "tpl": "state_value_template"}
    if domain == "lock":
        states = {get("state_locked", "LOCKED"): "locked", get("state_locking", "LOCKING"): "locking", get("state_unlocked", "UNLOCKED"): "unlocked", get("state_unlocking", "UNLOCKING"): "unlocking", get("state_open", "OPEN"): "open", get("state_opening", "OPENING"): "opening", get("state_jammed", "JAMMED"): "jammed"}
        states[get("payload_reset", "None")] = "unknown"
        return {"how": "map", "map": states, "blank": "skip"}
    if domain == "cover":
        return {"how": "cover", "map": {get("state_opening", "opening"): "opening", get("state_closing", "closing"): "closing", get("state_open", "open"): "open", get("state_closed", "closed"): "closed", "None": "unknown"}, "stopped": get("state_stopped", "stopped"), "position": get("position_topic") is not None}
    if domain == "select":
        return {"how": "select", "options": list(get("options") or [])}
    if domain == "number":
        return {"how": "number", "min": float(get("min", 1)), "max": float(get("max", 100)), "reset": get("payload_reset", "None")}
    if domain == "text":
        return {"how": "text", "min": int(get("min", 0)), "max": int(get("max", 255))}
    if domain == "device_tracker":
        return {"how": "tracker", "map": {get("payload_home", "home"): "home", get("payload_not_home", "not_home"): "not_home", get("payload_reset", "None"): "unknown"}}
    if domain == "event":
        return {"how": "event", "types": list(get("event_types") or [])}
    if domain == "light" and module.endswith(".schema_basic"):
        return {"how": "map", "map": {get("payload_on", "ON"): "on", get("payload_off", "OFF"): "off", "None": "unknown"}, "blank": "skip", "tpl": "state_value_template"}
    if domain == "light" and module.endswith(".schema_json"):
        return {"how": "json_light"}
    return None


def _tpl(value: Any) -> str | None:
    text = getattr(value, "template", value)
    return text if isinstance(text, str) else None


def _mqtt(comps: dict[str, Any], entity_id: str) -> dict[str, Any] | None:
    """An MQTT entity's topics and the rule its state follows them by; None for an entity that isn't MQTT's."""
    domain = split_entity_id(entity_id)[0]
    comp = comps.get(domain)
    if comp is None:
        return None
    try:
        entity = comp.get_entity(entity_id)
        module = type(entity).__module__ if entity is not None else ""
        config = getattr(entity, "_config", None)
        if not module.startswith("homeassistant.components.mqtt.") or not isinstance(config, dict):
            return None
        how = _mqtt_map(domain, module, config)
        # a sensor whose unit Home Assistant converts (°C shown in °F) or whose state is a date: not followed
        if how and how["how"] == "sensor":
            if getattr(entity, "native_unit_of_measurement", None) != getattr(entity, "unit_of_measurement", None):
                how = None
            elif str(getattr(entity, "device_class", None) or "") in ("timestamp", "date"):
                how = None
            else:
                how.update({"numeric": bool(getattr(entity, "_numeric_state_expected", False)), "options": list(getattr(entity, "options", None) or [])})
        rule: dict[str, Any] = {"kind": "mqtt", "domain": domain}
        # what it reads, followed or not (the board draws an arrow from each topic's box)
        topics: list[str] = [str(config["state_topic"])] if config.get("state_topic") else []
        if how is not None and config.get("state_topic"):
            tpl_key = how.pop("tpl", "value_template")
            sub = {"topic": str(config["state_topic"]), **how}
            if (t := _tpl(config.get(tpl_key))) is not None:
                sub["tpl"] = t
            rule["state"] = sub
            if domain == "binary_sensor" and config.get("off_delay") is not None:
                rule["off_delay"] = float(config["off_delay"])
            if domain in ("sensor", "binary_sensor") and config.get("expire_after"):
                rule["expire_after"] = float(config["expire_after"])
        if domain == "cover" and config.get("position_topic"):
            rule["position"] = {"topic": str(config["position_topic"]), "tpl": _tpl(config.get("position_template")), "closed": int(config.get("position_closed", 0)), "open": int(config.get("position_open", 100)), "state": bool(config.get("state_topic"))}
            topics.append(rule["position"]["topic"])
        if config.get("json_attributes_topic"):
            rule["attrs"] = {"topic": str(config["json_attributes_topic"]), "tpl": _tpl(config.get("json_attributes_template"))}
            topics.append(rule["attrs"]["topic"])
        avail = []
        if config.get("availability_topic"):
            avail.append({"topic": str(config["availability_topic"]), "on": str(config.get("payload_available", "online")), "off": str(config.get("payload_not_available", "offline")), "tpl": _tpl(config.get("availability_template"))})
        for a in config.get("availability") or []:
            avail.append({"topic": str(a["topic"]), "on": str(a.get("payload_available", "online")), "off": str(a.get("payload_not_available", "offline")), "tpl": _tpl(a.get("value_template"))})
        if avail:
            rule["avail"] = {"mode": str(config.get("availability_mode", "latest")), "list": avail}
            topics += [a["topic"] for a in avail]
        if len(rule) == 2:
            return {"entities": [], "domains": [], "all": False, "how": "mqtt", "topics": sorted(set(topics))}
        return {"entities": [], "domains": [], "all": False, "how": "mqtt", "topics": sorted(set(topics)), "rule": rule}
    except Exception:  # noqa: BLE001 - private attributes: no rule beats a failed request
        return None


async def _helper_domains(hass: HomeAssistant, domains: set[str]) -> set[str]:
    """The domains among these whose integration is a helper."""
    if not domains:
        return set()
    integrations = await async_get_integrations(hass, domains)
    return {
        domain
        for domain, integration in integrations.items()
        if not isinstance(integration, Exception) and integration.integration_type == "helper"
    }


def _template_listeners(comps: dict[str, Any], entity_id: str) -> dict[str, Any] | None:
    comp = comps.get(split_entity_id(entity_id)[0])
    if comp is None:
        return None
    try:
        entity = comp.get_entity(entity_id)
        info = getattr(entity, "_template_result_info", None)
        if info is None:
            return None
        listeners = info.listeners
        return {
            "entities": sorted(e for e in listeners.get("entities", ()) if e != entity_id),
            "domains": sorted(listeners.get("domains", ())),
            "all": bool(listeners.get("all")),
            "how": "template",
        }
    except Exception:  # noqa: BLE001 - a private attribute: an empty answer beats a failed request
        return None


_ENTITY_IN_TEXT = re.compile(r"\b[a-z_][a-z0-9_]*\.[a-z0-9_]+\b")


def _named_entities(
    hass: HomeAssistant, reg: er.EntityRegistry, entity_id: str, value: Any, scan_text: bool
) -> set[str]:
    """Existing entity IDs in a config: plain strings, comma lists, and (scan_text) inside templates."""
    found: set[str] = set()

    def keep(part: str) -> None:
        part = part.strip()
        if (
            part != entity_id
            and valid_entity_id(part)
            and (hass.states.get(part) is not None or reg.async_get(part) is not None)
        ):
            found.add(part)

    def walk(item: Any, depth: int = 0) -> None:
        if depth > 12:
            return
        if hasattr(item, "template") and isinstance(getattr(item, "template", None), str):
            item = item.template  # a Template object: its source text
        if isinstance(item, str):
            for part in (item, *item.split(",")):
                keep(part)
            if scan_text:
                for match in _ENTITY_IN_TEXT.findall(item):
                    keep(match)
        elif isinstance(item, dict):
            for sub in item.values():
                walk(sub, depth + 1)
        elif isinstance(item, list | tuple | set):
            for sub in item:
                walk(sub, depth + 1)

    walk(value)
    return found


def _options_entities(
    hass: HomeAssistant, reg: er.EntityRegistry, entity_id: str, options: Any
) -> dict[str, Any]:
    found = _named_entities(hass, reg, entity_id, dict(options), False)
    return {"entities": sorted(found), "domains": [], "all": False, "how": "options"}


def _trigger_template(
    hass: HomeAssistant, reg: er.EntityRegistry, comps: dict[str, Any], entity_id: str
) -> dict[str, Any] | None:
    comp = comps.get(split_entity_id(entity_id)[0])
    if comp is None:
        return None
    try:
        entity = comp.get_entity(entity_id)
        coordinator = getattr(entity, "coordinator", None)
        config = getattr(coordinator, "config", None)
        if not isinstance(config, dict) or not (config.get("trigger") or config.get("triggers")):
            return None
        parts = [config.get(k) for k in ("trigger", "triggers", "condition", "conditions", "action", "actions")]
        parts.append(getattr(entity, "_config", None))
        found = _named_entities(hass, reg, entity_id, parts, True)
        return {"entities": sorted(found), "domains": [], "all": False, "how": "triggers"}
    except Exception:  # noqa: BLE001 - private attributes: an empty answer beats a failed request
        return None
