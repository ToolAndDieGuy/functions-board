# End-to-end tests

These run the board inside Home Assistant's real frontend, against a throwaway Home Assistant started with
the demo config in `config/`. They are what found most of the v0.3.0 bugs.

## Start a test Home Assistant

```sh
uv venv --python 3.14 venv314
uv pip install --python venv314/bin/python homeassistant==2026.11.1
mkdir -p ha/config/custom_components
cp tests/e2e/config/*.yaml ha/config/
ln -s "$PWD/custom_components/functions_board" ha/config/custom_components/functions_board
venv314/bin/hass -c ha/config        # keep it running; it listens on port 8123
```

A restart through the API makes `hass` exit with code 100; start it again. The tests create and delete
automations through the config API, which rewrites `automations.yaml` in that config folder, so copy the YAML
files rather than linking them.

## Run

```sh
export FB_HA_CONFIG="$PWD/ha/config"      # where apitest.py checks the stored board data
venv314/bin/python tests/e2e/apitest.py  # 26 backend checks; onboards a test owner and a non-admin, writes tokens
node tests/e2e/ui.test.js                 # first run, import, migration, live sync, dashboard modes, non-admin
node tests/e2e/regress.test.js [filter]   # one check per fixed bug and new behaviour
node tests/e2e/sync.test.js               # two boards editing at once
```

Tokens last 30 minutes: run `apitest.py` again before a long UI run. Tokens, credentials and screenshots go
to `tests/e2e/.state/` (ignored by git), or to `FB_E2E_STATE` if set. `FB_HA_URL` changes the address.

Playwright and its Chromium must be installed (`npm i playwright` and `npx playwright install chromium`).

Known noise: a `recorder/info` rejection and `lovelace/config` not-found come from Home Assistant's own
frontend, not the board; the tests ignore them.

## Size

`node tests/e2e/size.test.js` adds 1,000 automations and 200 helpers as a package (the demo config loads
`packages/`), checks that a full import scan stays under 2 s and opening a 40-piece function under 500 ms,
then removes them and their registry entries.

## Backend unit tests

```sh
pip install pytest-homeassistant-custom-component home-assistant-frontend
pytest tests/backend
```
