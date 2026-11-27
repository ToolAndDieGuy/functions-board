"""Functions Board.

A sidebar page with one whiteboard per "function": the automations, scripts,
helpers and devices that make one job work, grouped by a Home Assistant label
and wired together from their own configs.

The integration serves the page, adds it to the sidebar (administrators only)
and stores the functions list and layouts so every administrator sees the same
boards. What the page itself may change in Home Assistant depends on the mode
set in the integration's options: Organise only (labels, categories, Pause) or
Full manager (also creating, deleting, editing wiring and test injections),
always through Home Assistant's own APIs and always after showing what changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from pathlib import Path
from typing import Any

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration
from homeassistant.util.hass_dict import HassKey

from . import websocket
from .checks import Checks
from .nodered import NodeRedKept
from .versions import Versions
from .const import (
    BOARD_FILE,
    CARD_LOADER_FILE,
    CONF_CARD,
    CONF_MODE,
    DOMAIN,
    MODE_ORGANISE,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
    SIGNAL_UPDATED,
    STATIC_URL,
    STORAGE_KEY,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
    WEBCOMPONENT,
)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

FRONTEND_DIR = Path(__file__).parent / "frontend"


class BoardStore(Store[dict[str, Any]]):
    """The board's store. Version 1.2 adds a revision number per layout."""

    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Add the revisions; the rest of the data is unchanged."""
        data = dict(old_data or {})
        if old_minor_version < 2 and not isinstance(data.get("revs"), dict):
            data["revs"] = {}
        return data


@dataclass
class BoardData:
    """What the integration keeps in memory.

    data is exactly what the boards store (functions list, layouts); revs counts
    the saves of each layout so two boards can't silently overwrite each other.
    The revisions are saved inside the store under "revs", which v0.3 boards
    ignore and drop, so a downgrade keeps working (revisions restart at 0).
    """

    store: BoardStore
    data: dict[str, Any] = field(default_factory=dict)
    revs: dict[str, int] = field(default_factory=dict)
    mode: str = MODE_ORGANISE
    static: bool = False
    static_digest: str | None = None
    module_url: str | None = None
    card_loader_url: str | None = None
    extra_js: str | None = None
    nodered: NodeRedKept | None = None
    versions: Versions | None = None
    checks: Checks | None = None

    def stored(self) -> dict[str, Any]:
        """The store's contents."""
        return {**self.data, "revs": self.revs}

    def save(self) -> None:
        """Write to disk shortly, batching quick changes."""
        self.store.async_delay_save(self.stored, 1)

    def notify(self, hass: HomeAssistant, change: dict[str, Any]) -> None:
        """Tell open boards what changed (functions_board/subscribe)."""
        async_dispatcher_send(hass, SIGNAL_UPDATED, change)


DATA_KEY: HassKey[BoardData] = HassKey(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Load the shared board data and register the websocket commands."""
    store = BoardStore(
        hass, STORAGE_VERSION, STORAGE_KEY, minor_version=STORAGE_MINOR_VERSION
    )
    raw = await store.async_load() or {}
    if not isinstance(raw, dict):
        raw = {}
    revs = raw.pop("revs", None)
    hass.data[DATA_KEY] = BoardData(
        store=store,
        data=raw,
        revs={
            k: v
            for k, v in (revs if isinstance(revs, dict) else {}).items()
            if isinstance(k, str) and isinstance(v, int)
        },
    )
    hass.data[DATA_KEY].nodered = kept = NodeRedKept(hass)
    await kept.async_load()
    hass.data[DATA_KEY].versions = versions = Versions(hass)
    await versions.async_load()
    hass.data[DATA_KEY].checks = checks = Checks(hass)
    await checks.async_load()
    if checks.migrate_from_layouts(hass.data[DATA_KEY].data.get("layouts")):
        hass.data[DATA_KEY].save()
    websocket.async_register(hass)
    return True


def _frontend_hash() -> str:
    """First 8 hex digits of the combined SHA-256 of every .js file under frontend/.

    Serving all ES modules under /functions_board_static/<digest>/ ensures every relative
    import resolves under the same versioned prefix for atomic cache invalidation.
    """
    h = hashlib.sha256()
    for path in sorted(FRONTEND_DIR.rglob("*.js")):
        rel = path.relative_to(FRONTEND_DIR).as_posix()
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(path.read_bytes())
        h.update(b"\0")
    return h.hexdigest()[:8]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the page and add it to the sidebar."""
    board = hass.data[DATA_KEY]
    board.mode = entry.options.get(CONF_MODE, MODE_ORGANISE)
    version = str((await async_get_integration(hass, DOMAIN)).version)
    digest = await hass.async_add_executor_job(_frontend_hash)
    if board.static_digest != digest:
        # versioned prefix carries the combined content hash: browsers may cache every module indefinitely
        await hass.http.async_register_static_paths(
            [StaticPathConfig(f"{STATIC_URL}/{digest}", str(FRONTEND_DIR), True)]
        )
        board.static_digest = digest
    if not board.static:
        # backwards-compatible unversioned path for manual dashboard resources (no immutable caching)
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), False)]
        )
        board.static = True
    board.module_url = f"{STATIC_URL}/{digest}/{BOARD_FILE}"
    board.card_loader_url = f"{STATIC_URL}/{digest}/{CARD_LOADER_FILE}"
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=WEBCOMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=board.module_url,
        require_admin=True,
        config={"version": version},
    )
    _apply_card(hass, board, bool(entry.options.get(CONF_CARD)))
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


def _apply_card(hass: HomeAssistant, board: BoardData, on: bool) -> None:
    """Load the tiny lazy card loader on dashboards (custom:functions-board) without loading the full board for non-admins."""
    if on and not board.extra_js and board.card_loader_url:
        frontend.add_extra_js_url(hass, board.card_loader_url)
        board.extra_js = board.card_loader_url
    elif not on and board.extra_js:
        frontend.remove_extra_js_url(hass, board.extra_js)
        board.extra_js = None


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Apply new options in place (no reload, so open boards keep their state) and tell them the mode."""
    board = hass.data[DATA_KEY]
    board.mode = entry.options.get(CONF_MODE, MODE_ORGANISE)
    _apply_card(hass, board, bool(entry.options.get(CONF_CARD)))
    board.notify(hass, {"what": "mode", "mode": board.mode, "client": ""})


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Take the page out of the sidebar."""
    board = hass.data[DATA_KEY]
    frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)
    _apply_card(hass, board, False)
    return True
