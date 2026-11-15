"""Config flow, options, panel, static file and unload."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from pytest_homeassistant_custom_component.common import MockConfigEntry

DOMAIN = "functions_board"


async def _setup(hass: HomeAssistant, options: dict | None = None) -> MockConfigEntry:
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Functions Board", data={}, options=options or {})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_config_flow_creates_one_entry(hass: HomeAssistant) -> None:
    """One click creates the entry; a second flow aborts."""
    assert await async_setup_component(hass, "http", {})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    again = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert again["type"] is FlowResultType.ABORT
    assert again["reason"] == "single_instance_allowed"


async def test_panel_registered_with_hashed_url_and_removed_on_unload(hass: HomeAssistant) -> None:
    """The sidebar page is admin-only, its file address carries a content hash, and unload removes it."""
    entry = await _setup(hass)
    panels = hass.data["frontend_panels"]
    assert "functions" in panels
    panel = panels["functions"]
    assert panel.require_admin is True
    url = panel.config["_panel_custom"]["module_url"]
    assert url.startswith("/functions_board_static/functions-board.js?v=")
    assert len(url.rsplit("=", 1)[1]) == 8
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED
    assert "functions" not in hass.data.get("frontend_panels", {})


async def test_options_set_mode_and_card_in_place(hass: HomeAssistant) -> None:
    """Options switch Organise only / Full manager and the dashboard card without reloading the page."""
    entry = await _setup(hass)
    from custom_components.functions_board import DATA_KEY  # noqa: PLC0415

    board = hass.data[DATA_KEY]
    assert board.mode == "organise"
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"mode": "full", "card": True})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert board.mode == "full"
    assert board.extra_js == board.module_url
    assert entry.state is ConfigEntryState.LOADED
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(result["flow_id"], {"mode": "organise", "card": False})
    await hass.async_block_till_done()
    assert board.mode == "organise"
    assert board.extra_js is None


async def test_static_file_served(hass: HomeAssistant, hass_client) -> None:
    """The board file is served, as JavaScript, cacheable."""
    await _setup(hass)
    panel = hass.data["frontend_panels"]["functions"]
    client = await hass_client()
    resp = await client.get(panel.config["_panel_custom"]["module_url"])
    assert resp.status == 200
    assert "javascript" in resp.headers["Content-Type"]
    assert "max-age" in resp.headers.get("Cache-Control", "")
    assert "customElements.define" in await resp.text()
