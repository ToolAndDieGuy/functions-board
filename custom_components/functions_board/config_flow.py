"""Config flow for Functions Board: one click adds the page to the sidebar; options set what it may change."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import CONF_CARD, CONF_MODE, DOMAIN, MODE_FULL, MODE_ORGANISE


class FunctionsBoardConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up Functions Board."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm and add the Functions page."""
        if user_input is not None:
            return self.async_create_entry(title="Functions Board", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """What the board may change, and the dashboard card."""
        return FunctionsBoardOptionsFlow()


class FunctionsBoardOptionsFlow(OptionsFlow):
    """Organise only or Full manager, and whether dashboards can use the card."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """One form with both options."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        options = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_MODE, default=options.get(CONF_MODE, MODE_ORGANISE)
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=[MODE_ORGANISE, MODE_FULL],
                        translation_key=CONF_MODE,
                        mode=SelectSelectorMode.LIST,
                    )
                ),
                vol.Required(
                    CONF_CARD, default=options.get(CONF_CARD, False)
                ): BooleanSelector(),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
