"""Diagnostics: a file a person downloads to attach to an issue or a forum post.

Nothing here sends anything anywhere. Home Assistant's own "Download diagnostics" and the board's
Diagnostics dialog both hand the person a file, and the person decides where it goes.

The board's dialog makes the person choose, every time, between anonymised and real names, and lets them
add a snapshot of a function as it is now and any of its saved versions. Home Assistant's own download can't
ask, so it is always anonymised and says where the choice is.

Anonymised means: entity, device, area, floor, label and user IDs and names are replaced with stand-ins that
stay the same throughout the file (so `light.kitchen` is `light.e3` everywhere it appears, keys and templates
included); free text (messages, titles, notes, descriptions) is replaced with its length; addresses, URLs,
e-mail addresses, phone numbers and anything that looks like a key or token are replaced too. What's left is
the shape the board and its functions have: layouts, arrows, trigger, condition and action types, timings,
modes and counts.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform, __version__ as HA_VERSION
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    floor_registry as fr,
    label_registry as lr,
)
from homeassistant.loader import async_get_integration

from .const import DOMAIN

# values under these keys are someone's words: anonymised, only their length is kept
FREE_TEXT_KEYS = frozenset({"message", "title", "text", "desc", "description", "note", "notes", "body", "content", "comment", "subtitle", "caption", "tts", "speech", "payload", "say", "tag"})
# values under these keys name something: a stand-in, the same one wherever that name appears
# "svc": a phone's mobile app action, kept by the notification builder (0.11.3: named after the phone)
NAME_KEYS = frozenset({"alias", "name", "friendly_name", "name_by_user", "original_name", "by", "user", "tab", "tabLabel", "svc"})
# service names many integrations share say nothing about a home (turn_on, set_value …); others may (notify.mobile_app_jamies_phone)
CORE_DOMAINS = frozenset({"homeassistant", "automation", "script", "scene", "logbook", "persistent_notification", "input_boolean", "input_number", "input_select", "input_text", "input_datetime", "input_button", "timer", "counter", "schedule", "system_log", "logger", "recorder"})

# domains with entities or services that aren't entity platforms
OTHER_DOMAINS = frozenset({"person", "zone", "group", "sun", "device_tracker", "notify", "tts", "rest_command", "shell_command", "mqtt", "plant", "proximity", "alert", "media_extractor", "conversation", "mobile_app"})

# service names Home Assistant's entity domains share; kept whether or not this home has the domain loaded
GENERIC_SERVICES = frozenset(
    "turn_on turn_off toggle reload set_value select_option select_first select_last select_next select_previous "
    "press open_cover close_cover stop_cover toggle_cover_tilt set_cover_position set_cover_tilt_position lock unlock "
    "open set_temperature set_hvac_mode set_preset_mode set_fan_mode set_humidity set_percentage set_direction "
    "oscillate media_play media_pause media_stop media_play_pause media_next_track media_previous_track volume_set "
    "volume_mute volume_up volume_down play_media select_source set_datetime increment decrement reset start pause "
    "cancel finish change trigger create dismiss dismiss_all log set_level set_options send_command return_to_base "
    "clean_spot locate set_operation_mode set_away_mode set_speed snapshot record speak apply".split()
)
# MQTT topic parts that are protocol, not someone's naming (zigbee2mqtt/<name>/set keeps zigbee2mqtt and set)
TOPIC_WORDS = frozenset(
    "zigbee2mqtt zwave zwavejs2mqtt homeassistant tasmota tele stat cmnd shellies shelly esphome frigate valetudo "
    "ring theengs rtl_433 openmqttgateway owntracks set get state status availability attributes config command "
    "cmd result sensor bridge event events device devices info lwt online power".split()
)
# Home Assistant's own event types with a dot in them, kept whether or not anything listens right now
KNOWN_EVENTS = frozenset({"timer.started", "timer.finished", "timer.cancelled", "timer.paused", "timer.restarted", "timer.changed"})

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
URL = re.compile(r"\b(?:https?|wss?|ftp|rtsp|mqtts?)://[^\s'\"<>]+", re.IGNORECASE)
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
IPV6 = re.compile(r"\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b", re.IGNORECASE)
MAC = re.compile(r"\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b", re.IGNORECASE)
# +44 20 7946 0958, (616) 555-0123, 616-555-0123; not dates (2026-11-18) or times
PHONE = re.compile(r"(?<![\w.:+-])(?:\+\d[\d .-]{7,}\d|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})(?![\w.:-])")
# long runs of letters and digits look like keys, tokens or hardware IDs
SECRET = re.compile(r"\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{24,}\b")
TOKEN = re.compile(r"\b([a-z_]+)\.([a-z0-9_]+)\b")
# the board's names for an area, floor, label or device ("area:garden_shed"), and the config keys that hold their
# IDs: replaced even when Home Assistant no longer knows them (a problem is often about one that's gone)
REF = re.compile(r"\b(area|floor|label|device):([A-Za-z0-9_\-]+)")
ID_KEYS = {"area_id": "area", "floor_id": "floor", "label_id": "label", "device_id": "device"}
# words the board's and Home Assistant's own structures use: never taken for someone's name, even if something is called that
STRUCTURE = frozenset(
    "mode state states trigger triggers condition conditions action actions sequence single restart queued parallel on off "
    "entity_id device_id area_id to from for data target service event time sun zone template delay wait choose default "
    "repeat if then else stop variables id alias description nodes frames notes tests layout layouts functions label labels "
    "name revs versions snapshot items helpers devices members cfg yaml dom kind auto print size open closed home away "
    "true false none unknown unavailable idle active paused above below value".split()
)


class Anonymiser:
    """Replaces what's personal in a value with stand-ins that stay the same within one file."""

    def __init__(self, hass: HomeAssistant, users: list[Any] | None = None, labels: set[str] | None = None) -> None:
        """Learn the names and IDs this Home Assistant has, so they can be found wherever they appear."""
        self._map: dict[str, str] = {}
        self._count: dict[str, int] = {}
        self._known_ci: dict[str, tuple[str, str]] = {}  # lowercase text → (canonical text, kind of stand-in)
        self._known_re: re.Pattern[str] | None = None
        self._re_built: bool = False
        # every domain an entity ID or service can start with, whether or not this home has it loaded right now
        self._domains: set[str] = (
            set(hass.services.async_services())
            | {s.split(".", 1)[0] for s in hass.states.async_entity_ids()}
            | {p.value for p in Platform}
            | CORE_DOMAINS
            | OTHER_DOMAINS
        )
        services = hass.services.async_services()
        shared: dict[str, int] = {}
        for svcs in services.values():
            for name in svcs:
                shared[name] = shared.get(name, 0) + 1
        self._generic = {f"{d}.{n}" for d, svcs in services.items() for n in svcs if d in CORE_DOMAINS or shared.get(n, 0) >= 2}
        # event types (timer.finished, …) say what happened, not whose
        self._generic |= set(hass.bus.async_listeners()) | KNOWN_EVENTS
        ents = er.async_get(hass)
        for e in ents.entities.values():
            self._domains.add(e.domain)
            self._learn(e.id, "entry")
            # a helper's or automation's own ID (bramblewood_test_switch, 1700000000001) and the entity's object ID;
            # only ones that can't be an ordinary word or a small number
            for ident in (e.unique_id, e.entity_id.split(".", 1)[1]):
                if isinstance(ident, str) and len(ident) >= 6 and ident.lower() not in STRUCTURE and ("_" in ident or (any(c.isalpha() for c in ident) and any(c.isdigit() for c in ident)) or ident.isdigit()):
                    self._learn(ident, "id")
            for n in (e.name, e.original_name):
                self._learn_name(n)
        for st in hass.states.async_all():
            self._learn_name(st.attributes.get("friendly_name"))
        for d in dr.async_get(hass).devices.values():
            self._learn(d.id, "device")
            for n in (d.name, d.name_by_user):
                self._learn_name(n)
            for _, ident in d.identifiers:
                self._learn(str(ident), "hw")
            for _, conn in d.connections:
                self._learn(str(conn), "hw")
        for a in ar.async_get(hass).async_list_areas():
            self._learn(a.id, "area")
            self._learn_name(a.name)
        for f in fr.async_get(hass).async_list_floors():
            self._learn(f.floor_id, "floor")
            self._learn_name(f.name)
        for lab in lr.async_get(hass).async_list_labels():
            self._learn_label(lab.label_id)
            self._learn_name(lab.name)
        # what the board keeps is keyed by label, including labels deleted since; structural/short labels are
        # still anonymised in structural label positions (layouts, revs, versions, checks, functions, label:…)
        for lab_id in labels or ():
            self._learn_label(lab_id)
        for u in users or []:
            self._learn(u.id, "user")
            self._learn_name(u.name)

    def _ensure_re(self) -> None:
        if self._re_built:
            return
        self._re_built = True
        # whole words only, longest first, case-insensitive, skipping structural words
        keys = sorted((k for k in self._known_ci if len(k) >= 3 and k not in STRUCTURE), key=len, reverse=True)
        self._known_re = re.compile(r"(?<![\w])(?:" + "|".join(re.escape(k) for k in keys) + r")(?![\w])", re.IGNORECASE) if keys else None

    def _learn(self, text: str | None, kind: str) -> None:
        if text and isinstance(text, str) and len(text) >= 3 and text.lower() not in STRUCTURE:
            self._known_ci.setdefault(text.lower(), (text, kind))

    def _learn_label(self, text: str | None) -> None:
        if text and isinstance(text, str) and len(text) >= 3 and text.lower() not in STRUCTURE:
            self._known_ci[text.lower()] = (text, "label")

    def _learn_name(self, text: str | None) -> None:
        if text and isinstance(text, str) and len(text.strip()) >= 3 and text.strip().lower() not in STRUCTURE:
            self._known_ci.setdefault(text.lower(), (text, "name"))

    def _stand_in(self, text: str, kind: str) -> str:
        if (found := self._map.get(text)) is not None:
            return found
        n = self._count[kind] = self._count.get(kind, 0) + 1
        self._map[text] = found = f"{kind}_{n}"
        return found

    def entity(self, domain: str, obj: str) -> str:
        """An entity ID's stand-in: its domain kept, the rest numbered."""
        key = f"{domain}.{obj}"
        if (found := self._map.get(key)) is not None:
            return found
        n = self._count["e." + domain] = self._count.get("e." + domain, 0) + 1
        self._map[key] = found = f"{domain}.e{n}"
        return found

    def text(self, s: str) -> str:
        """Every personal piece of a string replaced (templates and keys included)."""
        self._ensure_re()
        s = URL.sub("[url]", s)
        s = EMAIL.sub("[email]", s)
        s = MAC.sub("[mac]", s)
        s = IPV6.sub("[ip]", s)
        s = IPV4.sub("[ip]", s)
        s = PHONE.sub("[phone]", s)

        def token(m: re.Match[str]) -> str:
            dom, obj = m.group(1), m.group(2)
            if dom not in self._domains or m.group(0) in self._generic or obj in GENERIC_SERVICES:
                return m.group(0)
            return self.entity(dom, obj)

        s = TOKEN.sub(token, s)
        s = REF.sub(lambda m: f"{m.group(1)}:{self._stand_in(m.group(2), m.group(1))}", s)
        if self._known_re is not None:
            s = self._known_re.sub(lambda m: self._stand_in(*self._known_ci[m.group(0).lower()]), s)
        return SECRET.sub(lambda m: self._stand_in(m.group(0), "id"), s)

    def topic(self, t: str) -> str:
        """An MQTT topic: its shape and protocol words kept, the names in it replaced (the same one everywhere)."""
        return "/".join(p if p in ("+", "#", "") or p.lower() in TOPIC_WORDS or p.isdigit() else self._stand_in(p, "topic") for p in t.split("/"))

    def key(self, k: str) -> str:
        """A dict key: a board key for an MQTT topic (mqtt:…) is a topic; anything else is text."""
        return "mqtt:" + self.topic(k[5:]) if k.startswith("mqtt:") else self.text(k)

    def value(self, v: Any, key: str | None = None) -> Any:
        """A value with everything personal in it replaced; its shape stays."""
        if isinstance(v, dict):
            if key in ("layouts", "revs", "versions", "checks"):
                return {self._stand_in(k, "label") if isinstance(k, str) and k else k: self.value(x, None) for k, x in v.items()}
            return {self.key(k) if isinstance(k, str) else k: self.value(x, k if isinstance(k, str) else None) for k, x in v.items()}
        if isinstance(v, list):
            if key in ("functions", "labels"):
                return [self._stand_in(x, "label") if isinstance(x, str) and x else self.value(x, key) for x in v]
            child_key = None if key in ("layouts", "revs", "versions", "checks") else key
            return [self.value(x, child_key) for x in v]
        if isinstance(v, str):
            if key in ("function", "label", "label_id") and v:
                return self._stand_in(v, "label")
            if key == "topic" or v.startswith("mqtt:"):
                return self.key(v) if v.startswith("mqtt:") else self.topic(v)
            if key in FREE_TEXT_KEYS and v:
                return f"[text, {len(v)} characters]"
            if key in ID_KEYS and v:
                return self._stand_in(v, ID_KEYS[key])
            if key in NAME_KEYS and v:
                return self._stand_in(v, "name") if v.lower() not in self._known_ci else self.text(v)
            return self.text(v)
        return v

    def anonymise(self, v: Any) -> Any:
        """Compile regex and anonymise a diagnostics tree (safe to run in an executor thread)."""
        self._ensure_re()
        return self.value(v)


async def async_build(
    hass: HomeAssistant,
    *,
    anonymise: bool,
    label: str | None = None,
    snapshot: dict[str, Any] | None = None,
    version_ids: list[str] | None = None,
    how: str = "board",
) -> dict[str, Any]:
    """The diagnostics file: what the board keeps, and what the person chose to add."""
    from . import DATA_KEY  # noqa: PLC0415 - avoids an import cycle

    board = hass.data[DATA_KEY]
    versions = board.versions
    checks = board.checks
    out: dict[str, Any] = {
        "about": {
            "integration": str((await async_get_integration(hass, DOMAIN)).version),
            "home_assistant": HA_VERSION,
            "mode": board.mode,
            "card": bool(board.extra_js),
            "made": datetime.now(UTC).isoformat(timespec="seconds"),
            "made_by": how,
            "anonymised": anonymise,
        },
        # the boards' own store: functions, layouts, notes, frames, tests (as the boards save them)
        # (the same shape before anything is saved: an empty list and no layouts)
        "board": {"functions": [], "layouts": {}, **(board.stored() or {})},
        # saved sandbox checks per function (checks.py)
        "checks": dict(checks.by_label) if checks else {},
        # the list of saved versions of every function, without their snapshots
        "versions": {lab: versions.list(lab) for lab in versions.by_label} if versions else {},
        "nodered": board.nodered.kept if board.nodered else None,
    }
    if label is not None:
        out["function"] = label
        if snapshot is not None:
            out["snapshot_now"] = snapshot
        if version_ids and versions:
            snaps: dict[str, Any] = {}
            for vid in version_ids:
                if (v := await versions.async_get(label, vid)) is not None:
                    snaps[vid] = v
            out["version_snapshots"] = snaps
    if how == "home_assistant":
        out["about"]["note"] = (
            "Home Assistant's own download is always anonymised. For real names, or to add a snapshot of a "
            "function or its saved versions, use Diagnostics in the board's About dialog."
        )
    if anonymise:
        about = out.pop("about")
        data = board.data
        # (whatever the store holds: functions_board/set takes any data, so only strings are labels)
        found: list[Any] = [*(data.get("layouts") or {}), *(data.get("functions") or []), *board.revs, *(versions.by_label if versions else ()), *(checks.by_label if checks else ()), label]
        labels = {x for x in found if isinstance(x, str) and x}
        anonymiser = Anonymiser(hass, await hass.auth.async_get_users(), labels)
        out = await hass.async_add_executor_job(anonymiser.anonymise, out)
        out = {"about": about, **out}
    return out


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    """Home Assistant's own download: it can't ask, so it's anonymised."""
    return await async_build(hass, anonymise=True, how="home_assistant")
