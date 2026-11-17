"""Constants for the Functions Board integration."""

from typing import Final

DOMAIN: Final = "functions_board"

PANEL_URL: Final = "functions"
PANEL_TITLE: Final = "Functions"
PANEL_ICON: Final = "mdi:sitemap-outline"
WEBCOMPONENT: Final = "functions-board"
STATIC_URL: Final = "/functions_board_static"
BOARD_FILE: Final = "functions-board.js"

STORAGE_KEY: Final = DOMAIN
STORAGE_VERSION: Final = 1
STORAGE_MINOR_VERSION: Final = 2

# dispatcher signal for functions_board/subscribe (v0.3 fired a bus event, which the recorder stored)
SIGNAL_UPDATED: Final = "functions_board_updated"

MAX_DATA_BYTES: Final = 2_000_000
MAX_LAYOUT_BYTES: Final = 200_000
MAX_LABEL_LEN: Final = 100
MAX_CLIENT_LEN: Final = 64
MAX_SOURCES: Final = 500
MAX_NODERED_BYTES: Final = 1_000_000

# options
CONF_MODE: Final = "mode"
MODE_ORGANISE: Final = "organise"
MODE_FULL: Final = "full"
CONF_CARD: Final = "card"
CONF_NR_URL: Final = "nodered_url"
CONF_NR_USER: Final = "nodered_username"
CONF_NR_PASS: Final = "nodered_password"
