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
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import (
    CONF_CARD,
    CONF_MODE,
    CONF_NR_PASS,
    CONF_NR_URL,
    CONF_NR_USER,
    DOMAIN,
    MODE_FULL,
    MODE_ORGANISE,
)
from .nodered import NodeRedError, NodeRedReader


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
    """Organise only or Full manager, whether dashboards can use the card, and reading Node-RED."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """One form with all the options."""
        errors: dict[str, str] = {}
        options = self.config_entry.options
        if user_input is not None:
            data = dict(user_input)
            url = str(data.get(CONF_NR_URL) or "").strip().rstrip("/")
            if not url:
                # no Node-RED address: reading from Home Assistant is off, and the login goes
                for key in (CONF_NR_URL, CONF_NR_USER, CONF_NR_PASS):
                    data.pop(key, None)
                return self.async_create_entry(data=data)
            data[CONF_NR_URL] = url
            # an empty password keeps the one already set
            if not data.get(CONF_NR_PASS) and options.get(CONF_NR_PASS):
                data[CONF_NR_PASS] = options[CONF_NR_PASS]
            if not url.startswith(("http://", "https://")):
                errors[CONF_NR_URL] = "invalid_url"
            else:
                reader = NodeRedReader(
                    self.hass, url, data.get(CONF_NR_USER, ""), data.get(CONF_NR_PASS, "")
                )
                try:
                    await reader.async_read(fresh=True)
                except NodeRedError as err:
                    errors["base"] = f"nodered_{err.code}"
            if not errors:
                return self.async_create_entry(data=data)
            options = {**options, **data}
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
                vol.Optional(
                    CONF_NR_URL,
                    description={"suggested_value": options.get(CONF_NR_URL, "")},
                ): TextSelector(TextSelectorConfig(type=TextSelectorType.URL)),
                vol.Optional(
                    CONF_NR_USER,
                    description={"suggested_value": options.get(CONF_NR_USER, "")},
                ): TextSelector(TextSelectorConfig(autocomplete="username")),
                vol.Optional(CONF_NR_PASS): TextSelector(
                    TextSelectorConfig(type=TextSelectorType.PASSWORD, autocomplete="current-password")
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
