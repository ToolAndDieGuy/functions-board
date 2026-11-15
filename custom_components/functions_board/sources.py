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
            out[entity_id] = found
    return out


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
