#!/bin/sh
# Runs the tests and prints one line per suite.
#   sh tests/run-all.sh             the quick ones: no Home Assistant needed (and the backend unit tests if
#                                   venvtest is set up)
#   sh tests/run-all.sh --e2e       also every browser suite, against the test Home Assistant (started if it
#                                   isn't running), with apitest.py before each to reset it and renew the tokens
#   sh tests/run-all.sh --e2e ui    only the browser suites whose names match (a grep pattern)
#   --size                          also the size test (1,000 automations; slow)
# Exits 1 if anything failed. See tests/README.md and CLAUDE.md.
cd "$(dirname "$0")/.."
E2E=; SIZE=; PAT=
for a in "$@"; do
  case "$a" in --e2e) E2E=1 ;; --size) SIZE=1 ;; *) PAT="$a" ;; esac
done
FAILS=0; LOG=$(mktemp)
line() { printf '%-14s %s\n' "$1" "$2"; }
run() {
  name="$1"; shift
  if "$@" > "$LOG" 2>&1; then line "$name" "$(grep -E 'passed' "$LOG" | tail -1)"
  else FAILS=$((FAILS + 1)); line "$name" "FAILED"; grep -E '^FAIL|Error|error' "$LOG" | head -15 | sed 's/^/    /'; fi
}

run static node tests/static.test.js
run wiring node tests/wiring.test.js
run sandbox node tests/sandbox.test.js
[ -x venvtest/bin/python ] && run backend venvtest/bin/python -m pytest tests/backend -q

if [ -n "$E2E" ]; then
  export FB_HA_CONFIG="${FB_HA_CONFIG:-$PWD/ha/config}"
  curl -s -o /dev/null http://127.0.0.1:8123/api/ || sh tests/start-ha.sh || exit 1
  run apitest venv314/bin/python tests/e2e/apitest.py
  SUITES="ui regress tools sync sandbox layout"
  [ -n "$SIZE" ] && SUITES="$SUITES size"
  for s in $SUITES; do
    [ -n "$PAT" ] && ! echo "$s" | grep -qE "$PAT" && continue
    # each suite resets the board data; the tokens it uses last 30 minutes
    venv314/bin/python tests/e2e/apitest.py > /dev/null 2>&1
    run "e2e $s" node "tests/e2e/$s.test.js"
  done
fi
rm -f "$LOG"
[ "$FAILS" = 0 ] && echo "all passed" || { echo "$FAILS suite(s) failed"; exit 1; }
