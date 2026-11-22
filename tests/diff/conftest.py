"""Fixtures for the differential test: Home Assistant's own core, from pytest-homeassistant-custom-component."""

pytest_plugins = ["pytest_homeassistant_custom_component"]

import pytest


@pytest.fixture
def expected_lingering_timers() -> bool:
    """A scenario ends with its automations still armed (a time trigger's next time): that's expected here."""
    return True
