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
    SIGNAL_UPDATED,
)
from .sources import async_sources

if TYPE_CHECKING:
    from . import BoardData

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
    board = _board(hass)
    board.data = data
    layouts = data.get("layouts") if isinstance(data.get("layouts"), dict) else {}
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
