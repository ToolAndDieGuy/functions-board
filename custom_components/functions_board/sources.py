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
"""

from __future__ import annotations

from collections.abc import Iterable
import re
from typing import Any

from homeassistant.core import HomeAssistant, split_entity_id, valid_entity_id
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_component import DATA_INSTANCES
from homeassistant.loader import async_get_integrations


async def async_sources(hass: HomeAssistant, entity_ids: Iterable[str]) -> dict[str, Any]:
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
        found = _template_listeners(comps, entity_id)
        if found is None:
            found = _trigger_template(hass, reg, comps, entity_id)
        if found is None and entity_id in entries and entries[entity_id].domain in helper_domains:
            found = _options_entities(hass, reg, entity_id, entries[entity_id].options)
        if found and (found["entities"] or found["domains"] or found["all"]):
            if rule := _rule(comps, entity_id):
                found["rule"] = rule
            out[entity_id] = found
    return out


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
