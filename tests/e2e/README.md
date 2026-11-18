# End-to-end tests

These run the board inside Home Assistant's real frontend, against a throwaway Home Assistant started with
the demo config in `config/`. They are what found most of the v0.3.0 bugs.

## Start a test Home Assistant

`sh tests/setup.sh` and `sh tests/start-ha.sh` do all of this (see `tests/README.md`); by hand:

```sh
uv venv --python 3.14 venv314
uv pip install --python venv314/bin/python homeassistant==2026.11.1
mkdir -p ha/config/custom_components
cp tests/e2e/config/*.yaml ha/config/
ln -s "$PWD/custom_components/functions_board" ha/config/custom_components/functions_board
venv314/bin/hass -c ha/config        # keep it running; it listens on port 8123
```

The demo integration needs the system's TurboJPEG library (`libturbojpeg` on Debian and Ubuntu); without it the
demo entities are missing and the min/max check in `apitest.py` fails. If `ha/config/blueprints/automation/` is
missing after the first start, the blueprint automation in the demo config can't load and the UI suite reports
`blueprint/substitute` errors; copy Home Assistant's own blueprints in and start again:

```sh
mkdir -p ha/config/blueprints/automation/homeassistant
cp venv314/lib/python3.14/site-packages/homeassistant/components/automation/blueprints/*.yaml \
   ha/config/blueprints/automation/homeassistant/
```

A restart through the API makes `hass` exit with code 100; start it again. The tests create and delete
automations through the config API, which rewrites `automations.yaml` in that config folder, so copy the YAML
files rather than linking them.

## Run

`sh tests/run.sh --ha` starts a fresh one and runs every suite here (see `tests/README.md`);
`sh tests/run.sh --ha --keep --only e2e-tools` runs one on the Home Assistant as it is. By hand, with it running:

```sh
node tests/e2e/hasetup.js                              # onboard, the non-admin user, logins (writes tests/e2e/.state/)
FB_HA_CONFIG="$PWD/ha/config" venv314/bin/python tests/e2e/apitest.py
FB_SUITE=tools npx playwright test -c tests/playwright.config.js
```

Tokens, credentials and screenshots go to `tests/e2e/.state/` (ignored by git), or to `FB_E2E_STATE` if set.
`FB_HA_URL` changes the address. Known noise: a `recorder/info` rejection and `lovelace/config` not-found come
from Home Assistant's own frontend, not the board; the tests ignore them.

## Screenshots

`node tests/e2e/screens.js [name]` takes the README's images from the demo setup (`sh tests/setup.sh demo`,
`sh tests/start-ha.sh demo`, then `FB_HA_CONFIG=$PWD/ha-demo/config venv314/bin/python tests/e2e/apitest.py`) and writes them to
`docs/images/` (1440×820 at 2×). With `sharp` installed they are saved as palette PNGs; `FB_SHOTS_RAW=1` skips
that, and `FB_SHOTS_OUT` changes the folder. Retake them after visible changes and look at each one.

## Size

`node tests/e2e/size.test.js` adds 1,000 automations and 200 helpers as a package (the demo config loads
`packages/`), checks that a full import scan stays under 2 s and opening a 40-piece function under 500 ms,
then removes them and their registry entries.

## Backend unit tests

`sh tests/run.sh --only backend`. They run in their own venv (`venvtest`, made by `tests/setup.sh`):
`pytest-homeassistant-custom-component` pins its own Home Assistant version, and has no release for 2026.11 yet.
