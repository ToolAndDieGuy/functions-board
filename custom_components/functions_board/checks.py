"""Saved sandbox checks per function, stored separately from board layouts.

Saved checks carry starting entity state snapshots, steps and expectations, which can grow
large for history-replay checks. Keeping them in their own store frees the 200 KB layout
budget and avoids re-serialising every check whenever boxes are moved on the whiteboard.
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.storage import Store

from .const import DOMAIN, MAX_CHECKS_BYTES, MAX_CHECKS_FN_BYTES, MAX_CHECKS_PER_FN

STORAGE_KEY = f"{DOMAIN}.checks"
STORAGE_VERSION = 1

CHECK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def clean_checks(raw: Any) -> list[dict[str, Any]] | None:
    """Validate a function's saved checks list, or return None if malformed."""
    if not isinstance(raw, list) or len(raw) > MAX_CHECKS_PER_FN:
        return None
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        cid = item.get("id")
        name = item.get("name")
        steps = item.get("steps")
        expect = item.get("expect")
        if not isinstance(cid, str) or not CHECK_ID.match(cid):
            return None
        if not isinstance(name, str) or not name or len(name) > 160:
            return None
        if not isinstance(steps, list) or not isinstance(expect, list):
            return None
        out.append(dict(item))
    return out


class Checks:
    """Saved sandbox checks per function label: {label: [check, ...]}."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Nothing loaded yet."""
        self.store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.by_label: dict[str, list[dict[str, Any]]] = {}

    async def async_load(self) -> None:
        """Read the store; anything malformed is dropped."""
        raw = await self.store.async_load()
        out: dict[str, list[dict[str, Any]]] = {}
        if isinstance(raw, dict) and isinstance(raw.get("functions"), dict):
            for label, checks in raw["functions"].items():
                if isinstance(label, str) and label and (cleaned := clean_checks(checks)) is not None and cleaned:
                    out[label] = cleaned
        self.by_label = out

    def _save(self) -> None:
        self.store.async_delay_save(lambda: {"functions": self.by_label}, 1)

    def _total(self) -> int:
        return sum(len(json_bytes(v)) for v in self.by_label.values())

    def get(self, label: str) -> list[dict[str, Any]]:
        """One function's saved checks."""
        return list(self.by_label.get(label, []))

    def set(self, label: str, checks: list[dict[str, Any]]) -> str | None:
        """Replace one function's saved checks; returns error code or None."""
        cleaned = clean_checks(checks)
        if cleaned is None:
            return "invalid_format"
        if not cleaned:
            if label in self.by_label:
                del self.by_label[label]
                self._save()
            return None
        size = len(json_bytes(cleaned))
        if size > MAX_CHECKS_FN_BYTES:
            return "too_large"
        old_size = len(json_bytes(self.by_label[label])) if label in self.by_label else 0
        if self._total() - old_size + size > MAX_CHECKS_BYTES:
            return "full"
        self.by_label[label] = cleaned
        self._save()
        return None

    def migrate_from_layouts(self, layouts: Any) -> bool:
        """Move any legacy layout.checks into this store and strip them from layouts."""
        if not isinstance(layouts, dict):
            return False
        changed = False
        for label, layout in layouts.items():
            if not isinstance(label, str) or not label or not isinstance(layout, dict) or "checks" not in layout:
                continue
            raw = layout.pop("checks", None)
            changed = True
            if label not in self.by_label and isinstance(raw, list) and raw:
                cleaned = clean_checks(raw)
                if cleaned:
                    self.set(label, cleaned)
        return changed
