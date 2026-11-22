"""Saved versions of functions: snapshots a person names, and makes active.

A snapshot is made by the board from what Home Assistant's own APIs return (the configs of the function's
automations and scripts, its helpers' settings, which items are in it, its layout and the devices its steps
use). The integration only keeps them, in a store of their own: it never reads or writes a config itself.
Making one active is done by the board, through Home Assistant's own config APIs, in Full manager mode only.

A version changes only when someone saves over it on purpose (overwrite). Beside the versions, each function keeps
which version it was last made from (0.11.3): that version's id and the fingerprint the function had right after
(Home Assistant may write a config back a little differently from how it was saved, and what was added since may
be turned off rather than deleted), so the board can say it's active even when the two don't match exactly.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.storage import Store

from .const import DOMAIN, MAX_VERSION_BYTES, MAX_VERSIONS, MAX_VERSIONS_BYTES

STORAGE_KEY = f"{DOMAIN}.versions"
STORAGE_VERSION = 1

# what a version says about itself; the snapshot is kept as the board made it
META = ("id", "name", "desc", "at", "by", "size", "auto", "print")


def meta(version: dict[str, Any]) -> dict[str, Any]:
    """A version without its snapshot, for the list."""
    return {k: version.get(k) for k in META}


class Versions:
    """The versions of every function, by label: {label: [version, …]}, newest last."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Nothing loaded yet."""
        self.store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.by_label: dict[str, list[dict[str, Any]]] = {}
        # label → {"id": version id, "print": the function's fingerprint when it was made from that version}
        self.active: dict[str, dict[str, str]] = {}

    async def async_load(self) -> None:
        """Read the store; anything not the shape it should be is dropped."""
        raw = await self.store.async_load()
        out: dict[str, list[dict[str, Any]]] = {}
        if isinstance(raw, dict):
            for label, vs in (raw.get("functions") or {}).items():
                if isinstance(label, str) and isinstance(vs, list):
                    out[label] = [v for v in vs if isinstance(v, dict) and isinstance(v.get("id"), str) and isinstance(v.get("snapshot"), dict)]
        self.by_label = out
        act: dict[str, dict[str, str]] = {}
        if isinstance(raw, dict) and isinstance(raw.get("active"), dict):
            for label, a in raw["active"].items():
                if isinstance(a, dict) and isinstance(a.get("id"), str) and isinstance(a.get("print"), str) and self.get(label, a["id"]):
                    act[label] = {"id": a["id"], "print": a["print"]}
        self.active = act

    def _save(self) -> None:
        self.store.async_delay_save(lambda: {"functions": self.by_label, "active": self.active}, 1)

    def _total(self) -> int:
        return sum(v.get("size", 0) for vs in self.by_label.values() for v in vs)

    def list(self, label: str) -> list[dict[str, Any]]:
        """A function's versions, without their snapshots."""
        return [meta(v) for v in self.by_label.get(label, [])]

    def get(self, label: str, vid: str) -> dict[str, Any] | None:
        """One version with its snapshot."""
        return next((v for v in self.by_label.get(label, []) if v["id"] == vid), None)

    def add(self, label: str, name: str, desc: str, by: str, snapshot: dict[str, Any], auto: bool = False, print_: str = "") -> tuple[dict[str, Any] | None, str | None]:
        """Keep a new version; it, or why it can't be kept."""
        size = len(json_bytes(snapshot))
        if size > MAX_VERSION_BYTES:
            return None, "too_large"
        vs = list(self.by_label.get(label, []))
        # versions saved by the board itself before a restore make room for themselves: the oldest of those go first
        # (decided on a copy: a version that can't be kept takes nothing with it)
        while auto and len(vs) >= MAX_VERSIONS and any(v.get("auto") for v in vs):
            vs.remove(next(v for v in vs if v.get("auto")))
        if len(vs) >= MAX_VERSIONS:
            return None, "too_many"
        kept = {v["id"] for v in vs}
        gone = sum(v.get("size", 0) for v in self.by_label.get(label, []) if v["id"] not in kept)
        if self._total() - gone + size > MAX_VERSIONS_BYTES:
            return None, "full"
        version = {"id": uuid.uuid4().hex, "name": name, "desc": desc, "at": int(time.time() * 1000), "by": by, "size": size, "auto": auto, "print": print_, "snapshot": snapshot}
        vs.append(version)
        self.by_label[label] = vs
        self._save()
        return version, None

    def overwrite(self, label: str, vid: str, by: str, snapshot: dict[str, Any], print_: str) -> tuple[dict[str, Any] | None, str | None]:
        """Save over a version on purpose: its snapshot replaced, its name and description kept."""
        v = self.get(label, vid)
        if v is None:
            return None, "not_found"
        size = len(json_bytes(snapshot))
        if size > MAX_VERSION_BYTES:
            return None, "too_large"
        if self._total() - v.get("size", 0) + size > MAX_VERSIONS_BYTES:
            return None, "full"
        v.update({"snapshot": snapshot, "print": print_, "size": size, "at": int(time.time() * 1000), "by": by, "auto": False})
        self._save()
        return v, None

    def set_active(self, label: str, vid: str | None, print_: str = "") -> bool:
        """Note which version the function was last made from (None: none)."""
        if vid is None:
            self.active.pop(label, None)
        elif self.get(label, vid) is None:
            return False
        else:
            self.active[label] = {"id": vid, "print": print_}
        self._save()
        return True

    def edit(self, label: str, vid: str, name: str | None, desc: str | None) -> dict[str, Any] | None:
        """Rename or describe a version."""
        v = self.get(label, vid)
        if v is None:
            return None
        if name is not None:
            v["name"] = name
        if desc is not None:
            v["desc"] = desc
        self._save()
        return v

    def remove(self, label: str, vid: str | None = None) -> bool:
        """Delete one version, or all of a function's (vid None)."""
        vs = self.by_label.get(label)
        if not vs:
            return False
        if vid is None:
            del self.by_label[label]
            self.active.pop(label, None)
        else:
            keep = [v for v in vs if v["id"] != vid]
            if len(keep) == len(vs):
                return False
            self.by_label[label] = keep
            if (self.active.get(label) or {}).get("id") == vid:
                self.active.pop(label, None)
        self._save()
        return True

    def counts(self) -> dict[str, Any]:
        """How many versions there are and how big, for diagnostics (no content)."""
        return {"functions": len(self.by_label), "versions": sum(len(vs) for vs in self.by_label.values()), "bytes": self._total()}
