"""Websocket commands of the Functions Board. All of them are for administrators only."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.json import json_bytes

from .const import (
    MAX_CLIENT_LEN,
    MAX_DATA_BYTES,
    MAX_LABEL_LEN,
    MAX_LAYOUT_BYTES,
    MAX_SOURCES,
    MAX_VERSION_BYTES,
    MAX_VERSION_TEXT,
    SIGNAL_UPDATED,
)
from .diagnostics import async_build as async_build_diagnostics
from .nodered import clean_groups
from .sources import async_sources
from .versions import meta as version_meta
from .zwave import zwave_values

if TYPE_CHECKING:
    from . import BoardData
    from .checks import Checks
    from .versions import Versions

ITEM_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
CLIENT = vol.All(str, vol.Length(max=MAX_CLIENT_LEN))
LABEL = vol.All(str, vol.Length(min=1, max=MAX_LABEL_LEN))


def async_register(hass: HomeAssistant) -> None:
    """Register the commands."""
    for handler in (
        ws_get,
        ws_set,
        ws_set_functions,
        ws_set_layout,
        ws_subscribe,
        ws_sources,
        ws_zwave_values,
        ws_nodered,
        ws_nodered_keep,
        ws_checks,
        ws_set_checks,
        ws_versions,
        ws_version_get,
        ws_version_save,
        ws_version_edit,
        ws_version_overwrite,
        ws_version_active,
        ws_version_delete,
        ws_diagnostics,
    ):
        websocket_api.async_register_command(hass, handler)


def _board(hass: HomeAssistant) -> BoardData:
    from . import DATA_KEY  # noqa: PLC0415 - avoids an import cycle

    return hass.data[DATA_KEY]


def _layout_problem(layout: dict[str, Any]) -> str | None:
    """Why a layout can't be stored, or None. Positions must be numbers, ids short and plain."""
    if len(json_bytes(layout)) > MAX_LAYOUT_BYTES:
        return "too_large"
    nodes = layout.get("nodes", {})
    if not isinstance(nodes, dict):
        return "nodes must be an object"
    for key, pos in nodes.items():
        if len(key) > 300 or not isinstance(pos, dict):
            return "bad node"
        for axis in ("x", "y"):
            val = pos.get(axis)
            if isinstance(val, bool) or not isinstance(val, int | float):
                return f"node position {axis} must be a number"
    # frames, notes, and the test buttons and monitor boxes of v0.5 (tools)
    for kind in ("frames", "notes", "tools"):
        items = layout.get(kind, [])
        if not isinstance(items, list):
            return f"{kind} must be a list"
        for item in items:
            if not isinstance(item, dict) or not ITEM_ID.match(str(item.get("id", ""))):
                return f"bad {kind[:-1]} id"
    return None


@websocket_api.websocket_command({vol.Required("type"): "functions_board/get"})
@websocket_api.require_admin
@callback
def ws_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The shared functions list and layouts, each layout's revision, and the mode."""
    board = _board(hass)
    connection.send_result(
        msg["id"], {"data": board.data, "revs": board.revs, "mode": board.mode}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/set",
        vol.Required("data"): dict,
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@callback
def ws_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Replace the whole store. Used once, to move per-user data from the dashboard-card version."""
    data = dict(msg["data"])
    data.pop("revs", None)
    if len(json_bytes(data)) > MAX_DATA_BYTES:
        connection.send_error(msg["id"], "too_large", "Board data is larger than 2 MB")
        return
    raw_layouts = data.get("layouts")
    if raw_layouts is not None:
        if not isinstance(raw_layouts, dict):
            connection.send_error(msg["id"], "invalid_format", "Layouts must be an object")
            return
        for label, layout in raw_layouts.items():
            if not isinstance(label, str) or not label or len(label) > MAX_LABEL_LEN or not isinstance(layout, dict):
                connection.send_error(msg["id"], "invalid_format", "Layout not stored: bad layout entry")
                return
            if problem := _layout_problem(layout):
                code = "too_large" if problem == "too_large" else "invalid_format"
                connection.send_error(msg["id"], code, f"Layout not stored: {problem}")
                return
    board = _board(hass)
    if board.checks is not None and isinstance(raw_layouts, dict):
        board.checks.migrate_from_layouts(raw_layouts)
    board.data = data
    layouts = raw_layouts if isinstance(raw_layouts, dict) else {}
    board.revs = {label: board.revs.get(label, 0) + 1 for label in layouts}
    board.save()
    board.notify(hass, {"what": "all", "client": msg.get("client", "")})
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/set_functions",
        vol.Required("functions"): vol.All(cv.ensure_list, [LABEL]),
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@callback
def ws_set_functions(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Store which labels are functions, in list order."""
    board = _board(hass)
    functions = list(dict.fromkeys(msg["functions"]))
    trial = {**board.data, "functions": functions}
    if len(json_bytes(trial)) > MAX_DATA_BYTES:
        connection.send_error(msg["id"], "too_large", "Board data is larger than 2 MB")
        return
    board.data = trial
    board.save()
    board.notify(hass, {"what": "functions", "client": msg.get("client", "")})
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/set_layout",
        vol.Required("label"): LABEL,
        vol.Required("layout"): vol.Any(None, dict),
        vol.Optional("rev"): vol.Any(None, vol.All(int, vol.Range(min=0))),
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@callback
def ws_set_layout(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Store one function's layout (None deletes it).

    With rev, the write only lands if nobody saved this layout since that revision;
    otherwise the reply is {"conflict": true} with the stored layout and revision.
    """
    board = _board(hass)
    label, layout = msg["label"], msg["layout"]
    layouts = board.data.get("layouts")
    if not isinstance(layouts, dict):
        layouts = {}
    current = board.revs.get(label, 0)
    if msg.get("rev") is not None and msg["rev"] != current:
        connection.send_result(
            msg["id"],
            {"conflict": True, "rev": current, "layout": layouts.get(label)},
        )
        return
    if layout is not None:
        if problem := _layout_problem(layout):
            code = "too_large" if problem == "too_large" else "invalid_format"
            connection.send_error(msg["id"], code, f"Layout not stored: {problem}")
            return
        layouts = {**layouts, label: layout}
    else:
        layouts = {k: v for k, v in layouts.items() if k != label}
    trial = {**board.data, "layouts": layouts}
    if len(json_bytes(trial)) > MAX_DATA_BYTES:
        connection.send_error(msg["id"], "too_large", "Board data is larger than 2 MB")
        return
    board.data = trial
    board.revs = {**board.revs, label: current + 1}
    board.save()
    board.notify(
        hass,
        {"what": "layout", "label": label, "rev": current + 1, "client": msg.get("client", "")},
    )
    connection.send_result(msg["id"], {"rev": current + 1})


@websocket_api.websocket_command({vol.Required("type"): "functions_board/subscribe"})
@websocket_api.require_admin
@callback
def ws_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send a message per change: what changed, which label, and the sending board's client id."""

    @callback
    def forward(change: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], change))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_UPDATED, forward
    )
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/sources",
        vol.Required("entity_ids"): vol.All(
            cv.ensure_list, [cv.entity_id], vol.Length(max=MAX_SOURCES)
        ),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sources(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """What each derived helper reads: template entities and helpers set up in the UI."""
    connection.send_result(
        msg["id"], {"sources": await async_sources(hass, msg["entity_ids"])}
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "functions_board/zwave_values", vol.Required("device_id"): vol.All(str, vol.Length(max=64))}
)
@websocket_api.require_admin
@callback
def ws_zwave_values(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A Z-Wave device's values (0.13.0): {node_id, home_id, values}, or None when it isn't a loaded Z-Wave device."""
    connection.send_result(msg["id"], zwave_values(hass, msg["device_id"]))


@websocket_api.websocket_command({vol.Required("type"): "functions_board/nodered"})
@websocket_api.require_admin
@callback
def ws_nodered(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The Node-RED flow groups last read by any board, with when ({at, slug, groups}), or None."""
    board = _board(hass)
    connection.send_result(msg["id"], {"kept": board.nodered.kept if board.nodered else None})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/nodered_keep",
        vol.Required("slug"): vol.All(str, vol.Length(max=100)),
        vol.Required("groups"): list,
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@callback
def ws_nodered_keep(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Keep the flow groups a board just read, for every board."""
    board = _board(hass)
    groups = clean_groups(msg["groups"])
    if groups is None or board.nodered is None:
        connection.send_error(msg["id"], "invalid_format", "Not flow groups")
        return
    if problem := board.nodered.keep(msg["slug"], groups):
        connection.send_error(msg["id"], problem, "Flow groups larger than 1 MB")
        return
    board.notify(hass, {"what": "nodered", "client": msg.get("client", "")})
    connection.send_result(msg["id"])


# ---- saved sandbox checks (checks.py): kept out of the 200 KB layout store
def _checks_or_error(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg_id: int) -> Checks | None:
    board = _board(hass)
    if board.checks is None:
        connection.send_error(msg_id, "not_ready", "Checks aren't loaded")
    return board.checks


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/checks",
        vol.Optional("label"): LABEL,
    }
)
@websocket_api.require_admin
@callback
def ws_checks(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Saved sandbox checks: one function's list (with label) or every function's map."""
    if (ch := _checks_or_error(hass, connection, msg["id"])) is None:
        return
    if "label" in msg:
        connection.send_result(msg["id"], {"checks": ch.get(msg["label"])})
    else:
        connection.send_result(msg["id"], {"checks": dict(ch.by_label)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/set_checks",
        vol.Required("label"): LABEL,
        vol.Required("checks"): list,
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@callback
def ws_set_checks(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Replace one function's saved sandbox checks."""
    if (ch := _checks_or_error(hass, connection, msg["id"])) is None:
        return
    if problem := ch.set(msg["label"], msg["checks"]):
        text = {
            "invalid_format": "Checks not stored: malformed check entry",
            "too_large": "A function's saved checks can be at most 1 MB",
            "full": "Saved checks can take at most 10 MB in all",
        }
        connection.send_error(msg["id"], problem, text.get(problem, "Checks not stored"))
        return
    _board(hass).notify(hass, {"what": "checks", "label": msg["label"], "client": msg.get("client", "")})
    connection.send_result(msg["id"])


# ---- saved versions of a function (versions.py). The board makes the snapshot from Home Assistant's own APIs and
# restores through them; these commands only keep, list and hand back what it saved.
VTEXT = vol.All(str, vol.Length(max=MAX_VERSION_TEXT))
VID = vol.All(str, vol.Match(r"^[0-9a-f]{32}$"))


def _versions_or_error(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg_id: int) -> Versions | None:
    board = _board(hass)
    if board.versions is None:
        connection.send_error(msg_id, "not_ready", "Versions aren't loaded")
    return board.versions


def _user_name(connection: websocket_api.ActiveConnection) -> str:
    user = connection.user
    return user.name if user and user.name else ""


@websocket_api.websocket_command({vol.Required("type"): "functions_board/versions", vol.Required("label"): LABEL})
@websocket_api.require_admin
@callback
def ws_versions(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A function's saved versions, oldest first, without their snapshots, and the one it was last made from."""
    if (vs := _versions_or_error(hass, connection, msg["id"])) is None:
        return
    connection.send_result(msg["id"], {"versions": vs.list(msg["label"]), "active": vs.active.get(msg["label"])})


@websocket_api.websocket_command({vol.Required("type"): "functions_board/version_get", vol.Required("label"): LABEL, vol.Required("version_id"): VID})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_version_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """One saved version, with its snapshot (loaded on demand from its function's blob store)."""
    if (vs := _versions_or_error(hass, connection, msg["id"])) is None:
        return
    if (v := await vs.async_get(msg["label"], msg["version_id"])) is None:
        connection.send_error(msg["id"], "not_found", "No such version")
        return
    connection.send_result(msg["id"], v)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/version_save",
        vol.Required("label"): LABEL,
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=100)),
        vol.Optional("desc", default=""): VTEXT,
        vol.Required("snapshot"): dict,
        vol.Optional("auto", default=False): bool,
        vol.Optional("print", default=""): vol.All(str, vol.Length(max=64)),
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_version_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Keep a snapshot the board made as a new version."""
    if (vs := _versions_or_error(hass, connection, msg["id"])) is None:
        return
    await vs.async_ensure_blobs(msg["label"])
    version, problem = vs.add(msg["label"], msg["name"], msg["desc"], _user_name(connection), msg["snapshot"], msg["auto"], msg["print"])
    if problem or version is None:
        text = {
            "invalid_format": "Unsupported item domain in snapshot",
            "too_large": "A snapshot can be at most 1 MB",
            "too_many": "A function can keep at most 50 versions",
            "full": "Versions can take at most 20 MB in all",
        }
        connection.send_error(msg["id"], problem or "failed", text.get(problem or "", "Not saved"))
        return
    # a version saved from what's there now is what the function is made from now (not a backup taken on the way)
    if not msg["auto"]:
        vs.set_active(msg["label"], version["id"], msg["print"])
    _board(hass).notify(hass, {"what": "versions", "label": msg["label"], "client": msg.get("client", "")})
    connection.send_result(msg["id"], version_meta(version))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/version_edit",
        vol.Required("label"): LABEL,
        vol.Required("version_id"): VID,
        vol.Optional("name"): vol.All(str, vol.Length(min=1, max=100)),
        vol.Optional("desc"): VTEXT,
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@callback
def ws_version_edit(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Rename a version or change its description."""
    if (vs := _versions_or_error(hass, connection, msg["id"])) is None:
        return
    if (v := vs.edit(msg["label"], msg["version_id"], msg.get("name"), msg.get("desc"))) is None:
        connection.send_error(msg["id"], "not_found", "No such version")
        return
    _board(hass).notify(hass, {"what": "versions", "label": msg["label"], "client": msg.get("client", "")})
    connection.send_result(msg["id"], version_meta(v))


PRINT = vol.All(str, vol.Length(max=64))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/version_overwrite",
        vol.Required("label"): LABEL,
        vol.Required("version_id"): VID,
        vol.Required("snapshot"): dict,
        vol.Required("print"): PRINT,
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_version_overwrite(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Save over a version on purpose (Save, 0.11.3): its snapshot replaced, its name kept; it's then the active one."""
    if (vs := _versions_or_error(hass, connection, msg["id"])) is None:
        return
    await vs.async_ensure_blobs(msg["label"])
    v, problem = vs.overwrite(msg["label"], msg["version_id"], _user_name(connection), msg["snapshot"], msg["print"])
    if problem or v is None:
        text = {
            "invalid_format": "Unsupported item domain in snapshot",
            "not_found": "No such version",
            "too_large": "A snapshot can be at most 1 MB",
            "full": "Versions can take at most 20 MB in all",
        }
        connection.send_error(msg["id"], problem or "failed", text.get(problem or "", "Not saved"))
        return
    vs.set_active(msg["label"], msg["version_id"], msg["print"])
    _board(hass).notify(hass, {"what": "versions", "label": msg["label"], "client": msg.get("client", "")})
    connection.send_result(msg["id"], version_meta(v))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/version_active",
        vol.Required("label"): LABEL,
        vol.Required("version_id"): vol.Any(None, VID),
        vol.Optional("print", default=""): PRINT,
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@callback
def ws_version_active(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Note which version the function was just made from, with its fingerprint then (0.11.3)."""
    if (vs := _versions_or_error(hass, connection, msg["id"])) is None:
        return
    if not vs.set_active(msg["label"], msg["version_id"], msg["print"]):
        connection.send_error(msg["id"], "not_found", "No such version")
        return
    _board(hass).notify(hass, {"what": "versions", "label": msg["label"], "client": msg.get("client", "")})
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/version_delete",
        vol.Required("label"): LABEL,
        vol.Optional("version_id"): VID,
        vol.Optional("client"): CLIENT,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_version_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Delete one saved version, or (no version_id) every version of a function."""
    if (vs := _versions_or_error(hass, connection, msg["id"])) is None:
        return
    await vs.async_ensure_blobs(msg["label"])
    if not vs.remove(msg["label"], msg.get("version_id")) and msg.get("version_id"):
        connection.send_error(msg["id"], "not_found", "No such version")
        return
    _board(hass).notify(hass, {"what": "versions", "label": msg["label"], "client": msg.get("client", "")})
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "functions_board/diagnostics",
        # no default: the person chooses anonymised or real names every time
        vol.Required("anonymise"): bool,
        vol.Optional("label"): LABEL,
        vol.Optional("snapshot"): dict,
        vol.Optional("version_ids"): vol.All([VID], vol.Length(max=50)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_diagnostics(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The diagnostics file the board's dialog downloads; it goes to the person, nowhere else."""
    if ("snapshot" in msg or "version_ids" in msg) and "label" not in msg:
        connection.send_error(msg["id"], "invalid_format", "A snapshot or versions need the function's label")
        return
    if "snapshot" in msg and len(json_bytes(msg["snapshot"])) > MAX_VERSION_BYTES:
        connection.send_error(msg["id"], "too_large", "A snapshot can be at most 1 MB")
        return
    connection.send_result(
        msg["id"],
        await async_build_diagnostics(
            hass,
            anonymise=msg["anonymise"],
            label=msg.get("label"),
            snapshot=msg.get("snapshot"),
            version_ids=msg.get("version_ids"),
        ),
    )
