"""Diagnostics for Functions Board: sizes only, no names or entity IDs."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes
from homeassistant.loader import async_get_integration

from . import DATA_KEY
from .const import DOMAIN


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Version, mode, and how big each layout is."""
    board = hass.data[DATA_KEY]
    data = board.data
    layouts = data.get("layouts") if isinstance(data.get("layouts"), dict) else {}
    functions = data.get("functions") if isinstance(data.get("functions"), list) else []

    def size(layout: Any, key: str) -> int:
        part = layout.get(key) if isinstance(layout, dict) else None
        return len(part) if isinstance(part, dict | list) else 0

    return {
        "version": str((await async_get_integration(hass, DOMAIN)).version),
        "mode": board.mode,
        "card": bool(board.extra_js),
        "functions": len(functions),
        "store_bytes": len(json_bytes(board.stored())),
        "versions": board.versions.counts() if board.versions else None,
        "layouts": [
            {
                "on_board": label in functions,
                "boxes": size(layout, "nodes"),
                "frames": size(layout, "frames"),
                "notes": size(layout, "notes"),
                "paused": bool(isinstance(layout, dict) and layout.get("paused")),
                "revision": board.revs.get(label, 0),
            }
            for label, layout in layouts.items()
        ],
    }
