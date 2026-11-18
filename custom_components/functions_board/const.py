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
# saved versions of functions (versions.py): one snapshot, how many per function, all of them together
MAX_VERSION_BYTES: Final = 1_000_000
MAX_VERSIONS: Final = 50
MAX_VERSIONS_BYTES: Final = 20_000_000
MAX_VERSION_TEXT: Final = 2000

# options
CONF_MODE: Final = "mode"
MODE_ORGANISE: Final = "organise"
MODE_FULL: Final = "full"
CONF_CARD: Final = "card"
