"""A Z-Wave device's values, so the sandbox can offer what its Z-Wave triggers listen for (0.13.0).

Home Assistant has no websocket command that lists a node's values (its own panels ask Z-Wave JS for them one by one),
so the integration reads them from the node the loaded Z-Wave JS integration already holds for the device: each
value's command class, endpoint, property and key, its label, the states it can take (a scene button's KeyPressed,
KeyHeldDown …), its current value, and the entities that show it. Nothing is sent to the node and no Z-Wave JS module is
imported: the objects are read defensively, so a release that moves them makes the answer empty, never an error.
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er

# a node's device identifier is "<home id>-<node id>" (an endpoint's child device adds "-<endpoint>" and more)
NODE_IDENT = re.compile(r"^(\d+)-(\d+)$")
# what no automation listens for: who made it, its name and location, its firmware versions
SKIP_CC = {114, 119, 134}
MAX_VALUES = 400


def _plain(v: Any) -> Any:
    """A value as JSON can carry it, or None (a buffer, a dict of statistics …)."""
    return v if v is None or isinstance(v, (bool, int, float, str)) else None


def _key(v: Any) -> Any:
    """A state's key as the node uses it: a number when it reads as one."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


def zwave_values(hass: HomeAssistant, device_id: str) -> dict[str, Any] | None:
    """The node's values for a Z-Wave device, or None when it isn't one (or Z-Wave JS isn't loaded)."""
    dev = dr.async_get(hass).async_get(device_id)
    if dev is None:
        return None
    node_id = next((int(m.group(2)) for dom, ident in dev.identifiers if dom == "zwave_js" and (m := NODE_IDENT.match(str(ident)))), None)
    if node_id is None:
        return None
    try:
        for entry_id in dev.config_entries:
            entry = hass.config_entries.async_get_entry(entry_id)
            if entry is None or entry.domain != "zwave_js":
                continue
            driver = getattr(getattr(getattr(entry, "runtime_data", None), "client", None), "driver", None)
            node = driver.controller.nodes.get(node_id) if driver is not None else None
            if node is None:
                continue
            home = driver.controller.home_id
            # the entities that show a value: their unique id is "<home id>.<value id>", and a state key after it for
            # one that is on at that state only (a Notification value's binary sensors)
            ents: dict[str, list[list[Any]]] = {}
            prefix = f"{home}.{node_id}-"
            for e in er.async_get(hass).entities.values():
                if e.platform == "zwave_js" and e.disabled_by is None and str(e.unique_id).startswith(prefix):
                    parts = str(e.unique_id).split(".")
                    ents.setdefault(parts[1], []).append([e.entity_id, _key(parts[2]) if len(parts) > 2 else None])
            values = []
            for v in list(node.values.values()):
                if v.command_class in SKIP_CC:
                    continue
                md = v.metadata
                spec = getattr(md, "cc_specific", None) or {}
                values.append({
                    "id": v.value_id,
                    "cc": v.command_class,
                    "cc_name": v.command_class_name,
                    "endpoint": v.endpoint or 0,
                    "property": _plain(v.property_),
                    "property_name": _plain(v.property_name),
                    "property_key": _plain(v.property_key),
                    "property_key_name": _plain(v.property_key_name),
                    "label": _plain(md.label),
                    "type": _plain(md.type),
                    "states": [[_key(k), str(s)] for k, s in (md.states or {}).items()],
                    "min": _plain(md.min),
                    "max": _plain(md.max),
                    "unit": _plain(md.unit),
                    "readable": md.readable is not False,
                    "writeable": bool(md.writeable),
                    # a stateless value (a scene button) is only ever a notification
                    "stateful": getattr(md, "stateful", None) is not False,
                    "value": _plain(v.value),
                    "notification_type": _plain(spec.get("notificationType")) if isinstance(spec, dict) else None,
                    "entities": sorted(ents.get(v.value_id, []), key=lambda x: x[0]),
                })
                if len(values) >= MAX_VALUES:
                    break
            return {"node_id": node_id, "home_id": _plain(home), "values": values}
    except Exception:  # noqa: BLE001 - objects Z-Wave JS keeps for itself: no answer beats a failed request
        return None
    return None
