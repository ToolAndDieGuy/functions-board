#!/bin/sh
# Sets up what the tests need, once; safe to run again (it skips what's there).
#
#   sh tests/setup.sh            Home Assistant for the browser tests (venv314, ha/config), Playwright and Chromium
#   sh tests/setup.sh demo       also the demo Home Assistant (ha-demo/config: the test config plus "Away mode"),
#                                which the README screenshots and the demo video are taken from
#   sh tests/setup.sh backend    also the venv for the backend unit tests (venvtest)
#   sh tests/setup.sh all        all of it
#
# FB_FRESH=1 rebuilds the Home Assistant config folders (their stored data and onboarding go with them).
# FB_HA=beta installs Home Assistant's newest release, betas included, instead of the pinned one (the weekly
# beta run in .github/workflows/weekly.yml); FB_HA=2026.12.0 installs that version.
# Needs: uv (https://docs.astral.sh/uv/; installed with pip if missing), Node 22, and the system TurboJPEG library
# (libturbojpeg on Debian and Ubuntu) for the demo integration's camera entities. What the test Home Assistant talks
# to (an MQTT broker, Z-Wave JS on a mock controller, Node-RED: tests/home) is installed from tests/home/package.json.
set -e
cd "$(dirname "$0")/.."

# keep these in step with .github/workflows/validate.yml
PY=3.14
HA=${FB_HA:-2026.11.1}
PHCC=0.13.375

want() { [ "$1" = "all" ] || [ "$1" = "$2" ]; }
MODE="${1:-test}"

command -v uv >/dev/null 2>&1 || python3 -m pip install --user uv
command -v uv >/dev/null 2>&1 || PATH="$HOME/.local/bin:$PATH"

# Home Assistant, the same version for the test and demo instances
if [ ! -x venv314/bin/hass ]; then
  echo "== Home Assistant $HA (Python $PY) in venv314"
  uv venv --python "$PY" venv314
  if [ "$HA" = "beta" ]; then
    uv pip install --python venv314/bin/python --prerelease allow homeassistant
  else
    uv pip install --python venv314/bin/python "homeassistant==$HA"
  fi
  venv314/bin/python -c 'from homeassistant.const import __version__ as v; print("== installed Home Assistant", v)'
fi
# The demo integration (the test garage door and the rest) sets up platforms whose requirements its manifest
# doesn't list, and imports numpy unlisted. Installed while Home Assistant starts, they race it (CI lost the test
# entities to numpy, then to turbojpeg). Install them all first, at the versions Home Assistant pins, with those of
# the integrations the test home adds (MQTT, Z-Wave JS, the mobile app).
if ! venv314/bin/python -c 'import numpy, turbojpeg, paho.mqtt, zwave_js_server, nacl' 2>/dev/null; then
  venv314/bin/python scripts/demo_requirements.py > venv314/demo-requirements.txt
  uv pip install --python venv314/bin/python -r venv314/demo-requirements.txt -c "$(venv314/bin/python -c 'import homeassistant, os; print(os.path.join(os.path.dirname(homeassistant.__file__), "package_constraints.txt"))')"
fi

# a config folder: the test config, the integration linked in (so edits show on reload), Home Assistant's own
# blueprints (the demo config uses one), and for the demo instance the Away mode function on top
config() {
  dir="$1"; demo="$2"
  if [ -d "$dir/.storage" ] && [ -z "$FB_FRESH" ]; then echo "== $dir is there (FB_FRESH=1 to rebuild)"; return; fi
  echo "== $dir"
  rm -rf "$dir" "$(dirname "$dir")/home"
  mkdir -p "$dir/custom_components" "$dir/packages" "$dir/blueprints/automation/homeassistant"
  # copied, not linked: the tests rewrite automations.yaml and scripts.yaml through the config API
  cp tests/e2e/config/*.yaml "$dir/"
  cp tests/e2e/config/packages/* "$dir/packages/"
  if [ "$demo" = "demo" ]; then
    cat tests/e2e/demo/automations.yaml >> "$dir/automations.yaml"
    cat tests/e2e/demo/scripts.yaml >> "$dir/scripts.yaml"
    cp tests/e2e/demo/packages/*.yaml "$dir/packages/"
  fi
  ln -sfn "$PWD/custom_components/functions_board" "$dir/custom_components/functions_board"
  cp venv314/lib/python$PY/site-packages/homeassistant/components/automation/blueprints/*.yaml "$dir/blueprints/automation/homeassistant/"
}
config ha/config test
want "$MODE" demo && config ha-demo/config demo

# what the test Home Assistant talks to (tests/home): the MQTT broker, Z-Wave JS and its mock controller, Node-RED
if [ ! -d tests/home/node_modules/aedes ] || [ ! -d tests/home/node_modules/node-red ]; then echo "== the test home (tests/home)"; npm ci --prefix tests/home --no-audit --no-fund; fi

# Playwright for the browser tests (the version in package.json), and a Chromium for it unless one is there
if [ ! -d node_modules/playwright ] || [ ! -d node_modules/axe-core ]; then echo "== Playwright"; npm install --no-audit --no-fund; fi
node -e "require('fs').accessSync(require('playwright').chromium.executablePath())" 2>/dev/null || npx playwright install chromium

# the backend unit tests pin their own Home Assistant, so they get their own venv
if want "$MODE" backend && [ ! -x venvtest/bin/pytest ]; then
  echo "== backend tests (pytest-homeassistant-custom-component $PHCC) in venvtest"
  uv venv --python "$PY" venvtest
  uv pip install --python venvtest/bin/python "pytest-homeassistant-custom-component==$PHCC" home-assistant-frontend
fi

echo "== ready. Run the tests with: sh tests/run.sh   (and everything, on a fresh Home Assistant: sh tests/run.sh --ha)"
