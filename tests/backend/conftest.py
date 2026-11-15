"""Fixtures for the backend tests (pytest-homeassistant-custom-component). Run from the repo root:

    pip install pytest-homeassistant-custom-component home-assistant-frontend
    pytest tests/backend
"""

from __future__ import annotations

import pytest

# import this repo's custom_components first, before the plugin's own testing_config shadows it
import custom_components  # noqa: F401

pytest_plugins = ["pytest_homeassistant_custom_component"]


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Load the integration from custom_components/ in this repo."""
    return
