"""The Node-RED flows last read, kept for every board.

A board reads Node-RED's flows only while its Node-RED switch is on, and only in the
browser, through the Node-RED page Home Assistant opens for the user (the integration
never creates an ingress session). What it read is summarised in the browser into
flow groups (group and tab names, and the entity IDs each group triggers on, reads,
changes and runs) and kept here, so every board and device shows the same flows,
marked with when they were read, until the next read. No flow code is kept.
"""

from __future__ import annotations

import time
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.storage import Store

from .const import DOMAIN, MAX_NODERED_BYTES

STORAGE_KEY = f"{DOMAIN}.nodered"
STORAGE_VERSION = 1

# what one flow group may hold, all strings or lists of strings
GROUP_TEXT = ("id", "tab", "tabLabel", "name")
GROUP_LISTS = ("trig", "read", "change", "calls", "events")


def clean_groups(groups: Any) -> list[dict[str, Any]] | None:
    """The groups as the board summarised them, or None when they aren't that shape."""
    if not isinstance(groups, list) or len(groups) > 5000:
        return None
    out = []
    for g in groups:
        if not isinstance(g, dict):
            return None
        item: dict[str, Any] = {}
        for key in GROUP_TEXT:
            val = g.get(key, "")
            if not isinstance(val, str) or len(val) > 300:
                return None
            item[key] = val
        size = g.get("size", 0)
        if isinstance(size, bool) or not isinstance(size, int):
            return None
        item["size"] = size
        for key in GROUP_LISTS:
            vals = g.get(key, [])
            if not isinstance(vals, list) or not all(isinstance(v, str) and len(v) <= 300 for v in vals):
                return None
            item[key] = vals
        out.append(item)
    return out


class NodeRedKept:
    """The last flows read, in their own store (kept out of the boards' 2 MB store)."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Nothing loaded yet."""
        self.store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.kept: dict[str, Any] | None = None

    async def async_load(self) -> None:
        """Read the store."""
        raw = await self.store.async_load()
        if isinstance(raw, dict) and (groups := clean_groups(raw.get("groups"))) is not None:
            self.kept = {"at": raw.get("at", 0), "slug": str(raw.get("slug", "")), "groups": groups}

    def keep(self, slug: str, groups: list[dict[str, Any]]) -> str | None:
        """Keep a new read; why it can't be kept, or None."""
        kept = {"at": int(time.time() * 1000), "slug": slug, "groups": groups}
        if len(json_bytes(kept)) > MAX_NODERED_BYTES:
            return "too_large"
        self.kept = kept
        self.store.async_delay_save(lambda: self.kept or {}, 1)
        return None
