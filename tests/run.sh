#!/bin/sh
# The one way to run the tests, locally and in CI. Each runner writes JUnit into tests/.results/, and the
# result of the run comes from those reports (tests/lib/report.js), not from what the runners print.
#   sh tests/run.sh                  the self-test, the rules, the library and the Python units (seconds)
#   sh tests/run.sh --ha             also the API test and every browser suite, on a fresh test Home Assistant:
#                                    its config rebuilt from tests/e2e/config and started new, as in CI
#   --keep                           with --ha: use the test Home Assistant as it is (started if it isn't running)
#   sh tests/run.sh --only PATTERN   only the suites whose names match (a grep -E pattern), e.g. 'static|e2e-ui'
#   --size                           also the size test (1,000 automations; slow)
# Suites: selftest static wiring import problems sandbox clock link store backend diff | board-smoke board-a11y board-layout board-regress
# board-snapshots board-leak board-draw
# (the board on the fake Home Assistant) | with --ha: apitest e2e-isolation e2e-contract e2e-ui e2e-regress
# e2e-tools e2e-sync e2e-sandbox e2e-versions e2e-privacy (e2e-size). Exits 1 if anything failed.
cd "$(dirname "$0")/.."
HA=; KEEP=; SIZE=; ONLY=
while [ $# -gt 0 ]; do
  case "$1" in
    --ha|--e2e) HA=1 ;;
    --keep) KEEP=1 ;;
    --size) SIZE=1 ;;
    --only) shift; ONLY="$1" ;;
    *) ONLY="$1" ;;
  esac
  shift
done
# FB_OUT: another results folder (the mutants runner gives each mutant its own)
R="${FB_OUT:-$PWD/tests/.results}"
rm -rf "$R"; mkdir -p "$R"
export FB_RESULTS="$R"
WANT=""
want() { [ -z "$ONLY" ] || echo "$1" | grep -qE "$ONLY"; }
# run <suite> <command...>: its screen output goes to <suite>.log, its exit code to <suite>.exit
run() {
  name="$1"; shift
  WANT="$WANT $name"
  t0=$(date +%s)
  "$@" > "$R/$name.log" 2>&1
  echo $? > "$R/$name.exit"
  echo $(( $(date +%s) - t0 )) > "$R/$name.secs"
}
nodetest() { run "$1" node --test --test-reporter=junit --test-reporter-destination="$R/$1.xml" --test-reporter=spec --test-reporter-destination=stdout "tests/$1.test.js"; }

want selftest && run selftest node tests/selftest/run.js "$R"
for s in static wiring import problems sandbox builder studio clock link store; do want "$s" && nodetest "$s"; done
if want backend; then
  if [ -x venvtest/bin/python ]; then run backend venvtest/bin/python -m pytest tests/backend -q -p no:cacheprovider --junitxml="$R/backend.xml"
  else WANT="$WANT backend"; echo "venvtest is missing: sh tests/setup.sh backend" > "$R/backend.log"; fi
fi
# the sandbox against Home Assistant's own core, scenario by scenario (tests/diff; FB_DIFF_RANDOM=<n> FB_DIFF_SEED=<s>
# adds random ones)
if want diff; then
  if [ -x venvtest/bin/python ]; then run diff venvtest/bin/python -m pytest tests/diff -q -p no:cacheprovider -c tests/diff/pytest.ini --rootdir tests/diff --junitxml="$R/diff.xml"
  else WANT="$WANT diff"; echo "venvtest is missing: sh tests/setup.sh backend" > "$R/diff.log"; fi
fi

# the board on the fake Home Assistant (layer 3): every suite at once, one test per core
BOARD="smoke a11y layout regress snapshots leak draw"
BW=""
for b in $BOARD; do want "board-$b" && BW="$BW board-$b"; done
if [ -n "$BW" ]; then
  if [ "$(echo $BW | wc -w)" = "$(echo $BOARD | wc -w)" ]; then MATCH=""; else MATCH="$(echo $BW | sed 's/board-//g; s/ /|/g')"; fi
  t0=$(date +%s)
  FB_SUITE="${MATCH:+($MATCH)}" npx playwright test -c tests/board.config.js > "$R/board.log" 2>&1
  # one exit code for the whole layer (board.exit): report.js judges it with all of the layer's suites at once
  echo $? > "$R/board.exit"
  for b in $BW; do WANT="$WANT $b"; done
  # the board suites run together: their time is the whole layer's
  echo $(( $(date +%s) - t0 )) > "$R/board.secs"
fi

if [ -n "$HA" ]; then
  export FB_HA_CONFIG="${FB_HA_CONFIG:-$PWD/ha/config}"
  if [ -z "$KEEP" ]; then
    # the same start every time: a new config from tests/e2e/config, a new Home Assistant
    sh tests/start-ha.sh stop > /dev/null
    FB_FRESH=1 sh tests/setup.sh > "$R/setup.log" 2>&1 || { cat "$R/setup.log"; exit 1; }
    sh tests/start-ha.sh || exit 1
  elif ! curl -s -o /dev/null http://127.0.0.1:8123/api/; then sh tests/start-ha.sh || exit 1; fi
  # onboarding, the test users and their logins: setup, not a test (it used to be inside apitest.py)
  if ! node tests/e2e/hasetup.js > "$R/hasetup.log" 2>&1; then cat "$R/hasetup.log"; echo "Home Assistant isn't ready (tests/.results/hasetup.log)"; exit 1; fi
  want apitest && run apitest venv314/bin/python tests/e2e/apitest.py
  SUITES="isolation contract ui regress tools sync sandbox versions builder privacy"
  [ -n "$SIZE" ] && SUITES="$SUITES size"
  for s in $SUITES; do
    want "e2e-$s" || continue
    # Playwright Test, one suite at a time; each test starts from a snapshot and is put back after it
    run "e2e-$s" env FB_SUITE="$s" npx playwright test -c tests/playwright.config.js
  done
fi

node tests/lib/report.js "$R" $WANT
code=$?
if [ "$code" = 0 ]; then echo "all passed"; else echo "failed (logs: tests/.results/<suite>.log)"; fi
exit $code
