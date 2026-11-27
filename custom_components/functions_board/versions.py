"""Saved versions of functions: snapshots a person names, and makes active.

A snapshot is made by the board from what Home Assistant's own APIs return (the configs of the function's
automations and scripts, its helpers' settings, which items are in it, its layout and the devices its steps
use). The integration only keeps them, in stores of their own: it never reads or writes a config itself.
Making one active is done by the board, through Home Assistant's own config APIs, in Full manager mode only.

Metadata and active pointers live in a small index store (.storage/functions_board.versions) while snapshot
payloads live in per-function blob stores (.storage/functions_board.versions.<hash>), loaded on demand.
Renaming a version or updating the active pointer rewrites only the lightweight index, never the blobs.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.storage import Store

from .const import DOMAIN, MAX_VERSION_BYTES, MAX_VERSIONS, MAX_VERSIONS_BYTES, VERSION_DOMAINS

STORAGE_KEY = f"{DOMAIN}.versions"
STORAGE_VERSION = 1

# what a version says about itself; the snapshot is kept in its function's blob store
META = ("id", "name", "desc", "at", "by", "size", "auto", "print")


def meta(version: dict[str, Any]) -> dict[str, Any]:
    """A version without its snapshot, for the list."""
    return {k: version.get(k) for k in META}


def snapshot_problem(snapshot: Any) -> str | None:
    """Validate that every item in a snapshot uses an allowlisted domain, or return why not."""
    if not isinstance(snapshot, dict):
        return "snapshot must be an object"
    items = snapshot.get("items")
    if items is None:
        return None
    if not isinstance(items, dict):
        return "snapshot items must be an object"
    for key, item in items.items():
        if not isinstance(key, str) or not isinstance(item, dict):
            return "bad snapshot item"
        dom = item.get("dom")
        if dom is not None:
            if not isinstance(dom, str) or dom not in VERSION_DOMAINS:
                return f"unsupported domain: {dom}"
            if "." in key and key.split(".", 1)[0] != dom:
                return f"mismatched domain for {key}"
    return None


def _blob_key(label: str) -> str:
    return hashlib.sha256(label.encode("utf-8")).hexdigest()[:16]


class Versions:
    """The versions of every function, by label: {label: [meta, …]}, newest last.

    Snapshot payloads are split into per-function blob stores and loaded on demand.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        """Nothing loaded yet."""
        self.hass = hass
        self.store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.by_label: dict[str, list[dict[str, Any]]] = {}
        # label → {"id": version id, "print": the function's fingerprint when it was made from that version}
        self.active: dict[str, dict[str, str]] = {}
        self._blob_stores: dict[str, Store[dict[str, Any]]] = {}
        self._blobs: dict[str, dict[str, dict[str, Any]]] = {}

    def _blob_store(self, label: str) -> Store[dict[str, Any]]:
        if (st := self._blob_stores.get(label)) is None:
            st = Store(self.hass, STORAGE_VERSION, f"{STORAGE_KEY}.{_blob_key(label)}")
            self._blob_stores[label] = st
        return st

    async def async_load(self) -> None:
        """Read the index store; transparently migrate legacy inline snapshots into blob stores."""
        raw = await self.store.async_load()
        out: dict[str, list[dict[str, Any]]] = {}
        migrated: dict[str, dict[str, dict[str, Any]]] = {}
        if isinstance(raw, dict):
            for label, vs in (raw.get("functions") or {}).items():
                if isinstance(label, str) and isinstance(vs, list):
                    keep: list[dict[str, Any]] = []
                    for v in vs:
                        if not isinstance(v, dict) or not isinstance(v.get("id"), str):
                            continue
                        if isinstance(v.get("snapshot"), dict):
                            migrated.setdefault(label, {})[v["id"]] = v["snapshot"]
                        keep.append(meta(v))
                    if keep:
                        out[label] = keep
        self.by_label = out
        act: dict[str, dict[str, str]] = {}
        if isinstance(raw, dict) and isinstance(raw.get("active"), dict):
            for label, a in raw["active"].items():
                if isinstance(a, dict) and isinstance(a.get("id"), str) and isinstance(a.get("print"), str) and self._meta(label, a["id"]):
                    act[label] = {"id": a["id"], "print": a["print"]}
        self.active = act
        if migrated:
            for label, snaps in migrated.items():
                self._blobs[label] = snaps
                await self._blob_store(label).async_save({"snapshots": snaps})
            await self.store.async_save({"functions": self.by_label, "active": self.active})

    async def async_ensure_blobs(self, label: str) -> dict[str, dict[str, Any]]:
        """Load one function's snapshot blobs into cache if not already loaded."""
        if (snaps := self._blobs.get(label)) is not None:
            return snaps
        raw = await self._blob_store(label).async_load()
        snaps = {}
        if isinstance(raw, dict) and isinstance(raw.get("snapshots"), dict):
            snaps = {k: v for k, v in raw["snapshots"].items() if isinstance(k, str) and isinstance(v, dict)}
        self._blobs[label] = snaps
        return snaps

    def _save(self) -> None:
        self.store.async_delay_save(lambda: {"functions": self.by_label, "active": self.active}, 1)

    def _save_blobs(self, label: str) -> None:
        snaps = self._blobs.get(label) or {}
        if snaps:
            self._blob_store(label).async_delay_save(lambda lab=label: {"snapshots": self._blobs.get(lab, {})}, 1)
        else:
            self._blobs.pop(label, None)
            if (st := self._blob_stores.pop(label, None)) is not None:
                self.hass.async_create_task(st.async_remove())

    def _total(self) -> int:
        return sum(v.get("size", 0) for vs in self.by_label.values() for v in vs)

    def _meta(self, label: str, vid: str) -> dict[str, Any] | None:
        return next((v for v in self.by_label.get(label, []) if v["id"] == vid), None)

    def list(self, label: str) -> list[dict[str, Any]]:
        """A function's versions, without their snapshots."""
        return [meta(v) for v in self.by_label.get(label, [])]

    def get(self, label: str, vid: str) -> dict[str, Any] | None:
        """One version with its snapshot if its blob store is cached."""
        m = self._meta(label, vid)
        if m is None:
            return None
        snap = (self._blobs.get(label) or {}).get(vid)
        return {**m, "snapshot": snap} if snap is not None else dict(m)

    async def async_get(self, label: str, vid: str) -> dict[str, Any] | None:
        """One version with its snapshot, loading the function's blob store on demand."""
        m = self._meta(label, vid)
        if m is None:
            return None
        snaps = await self.async_ensure_blobs(label)
        if (snap := snaps.get(vid)) is None:
            return None
        return {**m, "snapshot": snap}

    def add(self, label: str, name: str, desc: str, by: str, snapshot: dict[str, Any], auto: bool = False, print_: str = "") -> tuple[dict[str, Any] | None, str | None]:
        """Keep a new version; it, or why it can't be kept."""
        if snapshot_problem(snapshot):
            return None, "invalid_format"
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
        evicted = [v["id"] for v in self.by_label.get(label, []) if v["id"] not in kept]
        gone = sum(v.get("size", 0) for v in self.by_label.get(label, []) if v["id"] not in kept)
        if self._total() - gone + size > MAX_VERSIONS_BYTES:
            return None, "full"
        vid = uuid.uuid4().hex
        version = {"id": vid, "name": name, "desc": desc, "at": int(time.time() * 1000), "by": by, "size": size, "auto": auto, "print": print_}
        vs.append(version)
        self.by_label[label] = vs
        snaps = self._blobs.setdefault(label, {})
        for old_id in evicted:
            snaps.pop(old_id, None)
        snaps[vid] = snapshot
        self._save()
        self._save_blobs(label)
        return {**version, "snapshot": snapshot}, None

    def overwrite(self, label: str, vid: str, by: str, snapshot: dict[str, Any], print_: str) -> tuple[dict[str, Any] | None, str | None]:
        """Save over a version on purpose: its snapshot replaced, its name and description kept."""
        if snapshot_problem(snapshot):
            return None, "invalid_format"
        v = self._meta(label, vid)
        if v is None:
            return None, "not_found"
        size = len(json_bytes(snapshot))
        if size > MAX_VERSION_BYTES:
            return None, "too_large"
        if self._total() - v.get("size", 0) + size > MAX_VERSIONS_BYTES:
            return None, "full"
        v.update({"print": print_, "size": size, "at": int(time.time() * 1000), "by": by, "auto": False})
        self._blobs.setdefault(label, {})[vid] = snapshot
        self._save()
        self._save_blobs(label)
        return {**v, "snapshot": snapshot}, None

    def set_active(self, label: str, vid: str | None, print_: str = "") -> bool:
        """Note which version the function was last made from (None: none)."""
        if vid is None:
            self.active.pop(label, None)
        elif self._meta(label, vid) is None:
            return False
        else:
            self.active[label] = {"id": vid, "print": print_}
        self._save()
        return True

    def edit(self, label: str, vid: str, name: str | None, desc: str | None) -> dict[str, Any] | None:
        """Rename or describe a version (index store only; blobs untouched)."""
        v = self._meta(label, vid)
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
            self._blobs.pop(label, None)
        else:
            keep = [v for v in vs if v["id"] != vid]
            if len(keep) == len(vs):
                return False
            if keep:
                self.by_label[label] = keep
            else:
                del self.by_label[label]
            if (self.active.get(label) or {}).get("id") == vid:
                self.active.pop(label, None)
            if (snaps := self._blobs.get(label)) is not None:
                snaps.pop(vid, None)
        self._save()
        self._save_blobs(label)
        return True

    def counts(self) -> dict[str, Any]:
        """How many versions there are and how big, for diagnostics (no content)."""
        return {"functions": len(self.by_label), "versions": sum(len(vs) for vs in self.by_label.values()), "bytes": self._total()}
