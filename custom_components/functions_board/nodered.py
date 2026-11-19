"""The Node-RED flows last read, kept for every board.

A board reads Node-RED's flows only while its Node-RED switch is on, and only in the
browser, through the Node-RED page Home Assistant opens for the user (the integration
never creates an ingress session). What it read is summarised in the browser into
flow groups (group and tab names, and the entity IDs each group triggers on, reads,
changes and runs) and kept here, so every board and device shows the same flows,
marked with when they were read, until the next read. No flow code is kept.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp
import yarl

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
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


# ---------- Reading the flows from Home Assistant itself (option, off unless set up) ----------
#
# With a Node-RED address and a login set in the integration's options, the integration reads the flows
# itself, without ingress, when a board with Node-RED switched on asks. Two kinds of Node-RED are covered:
#  - the Node-RED app: its direct-access port (1880 by default, on the host network, so http://127.0.0.1:1880
#    from Home Assistant) asks for a Home Assistant user's login (HTTP Basic, checked by the Supervisor) and has
#    no Node-RED login of its own;
#  - any other Node-RED with a login of its own (adminAuth): a token from /auth/token, as node-red-admin gets.
# The flows are kept in memory for 30 seconds and never written to disk.

READ_TTL = 30
TIMEOUT = 10


class NodeRedError(Exception):
    """Why the flows couldn't be read: cannot_connect, invalid_auth or unexpected."""

    def __init__(self, code: str, detail: str = "") -> None:
        """A code the board and the options form show in words."""
        super().__init__(code)
        self.code, self.detail = code, detail


class NodeRedReader:
    """Reads one Node-RED's flows with the login set in the options."""

    def __init__(self, hass: HomeAssistant, url: str, username: str, password: str) -> None:
        """Nothing read yet."""
        self.hass, self.url = hass, url.rstrip("/")
        self.username, self.password = username, password
        self.token: str | None = None
        self.flows: list[Any] | None = None
        self.at = 0
        self.lock = asyncio.Lock()

    def _session(self) -> aiohttp.ClientSession:
        # a Node-RED on this machine may use its own certificate for its address, which can't match 127.0.0.1
        host = yarl.URL(self.url).host or ""
        local = host in ("127.0.0.1", "localhost", "::1")
        return async_get_clientsession(self.hass, verify_ssl=not local)

    async def _get_flows(self, headers: dict[str, str], auth: aiohttp.BasicAuth | None) -> aiohttp.ClientResponse:
        return await self._session().get(
            f"{self.url}/flows",
            headers={"Node-RED-API-Version": "v2", **headers},
            auth=auth,
            timeout=aiohttp.ClientTimeout(total=TIMEOUT),
        )

    async def _login(self) -> str | None:
        """A Node-RED token, when that Node-RED has a login of its own; None when it has none."""
        s = self._session()
        timeout = aiohttp.ClientTimeout(total=TIMEOUT)
        async with s.get(f"{self.url}/auth/login", timeout=timeout) as r:
            if r.status != 200:
                return None
            kind = (await r.json(content_type=None) or {}).get("type")
        if kind != "credentials":
            return None
        form = {"client_id": "node-red-admin", "grant_type": "password", "scope": "read",
                "username": self.username, "password": self.password}
        async with s.post(f"{self.url}/auth/token", data=form, timeout=timeout) as r:
            if r.status in (401, 403):
                raise NodeRedError("invalid_auth")
            if r.status != 200:
                raise NodeRedError("unexpected", f"HTTP {r.status} from /auth/token")
            return (await r.json(content_type=None) or {}).get("access_token")

    async def async_read(self, fresh: bool = False) -> list[Any]:
        """The flows, read at most every 30 seconds."""
        async with self.lock:
            if not fresh and self.flows is not None and time.monotonic() - self.at < READ_TTL:
                return self.flows
            try:
                body = await self._read_once()
            except (aiohttp.ClientError, TimeoutError) as err:
                raise NodeRedError("cannot_connect", str(err) or type(err).__name__) from err
            except ValueError as err:
                raise NodeRedError("unexpected", "the answer isn't JSON") from err
            flows = body.get("flows") if isinstance(body, dict) else body
            if not isinstance(flows, list):
                raise NodeRedError("unexpected", "no flows in the answer")
            self.flows, self.at = flows, time.monotonic()
            return flows

    async def _read_once(self) -> Any:
        """GET /flows: with the Home Assistant login (Basic), or a Node-RED token, logging in once if refused."""
        basic = aiohttp.BasicAuth(self.username, self.password) if self.username else None
        logged_in = False
        while True:
            headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
            async with await self._get_flows(headers, None if self.token else basic) as r:
                if r.status == 200:
                    return await r.json(content_type=None)
                if r.status not in (401, 403):
                    raise NodeRedError("unexpected", f"HTTP {r.status} from /flows")
            if logged_in:
                raise NodeRedError("invalid_auth")
            logged_in = True
            self.token = await self._login()
            if not self.token:
                raise NodeRedError("invalid_auth")
