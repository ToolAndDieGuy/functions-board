#!/bin/sh
# The README's screenshots against the board as it is (weekly; layer 5): a fresh test Home Assistant (the README's
# pictures are of its Garage; FB_SHOTS_ON=demo for the demo instance), every picture taken again into
# tests/.results/shots/ (tests/e2e/screens.js), each compared with the one in docs/images (tests/e2e/shotcompare.js).
# Fails when one no longer matches: copy the new ones from tests/.results/shots/ into docs/images, and look at each. Results: tests/.results/e2e-shots.xml, the new pictures, and diff-<name>.png for each that differs.
cd "$(dirname "$0")/.."
R="${FB_OUT:-$PWD/tests/.results}"
mkdir -p "$R"
export FB_RESULTS="$R"
sh tests/start-ha.sh stop > /dev/null
FB_FRESH=1 sh tests/setup.sh ${FB_SHOTS_ON:-test} > "$R/shots-setup.log" 2>&1 || { cat "$R/shots-setup.log"; exit 1; }
sh tests/start-ha.sh ${FB_SHOTS_ON:-test} || exit 1
node tests/e2e/hasetup.js > "$R/shots-hasetup.log" 2>&1 || { cat "$R/shots-hasetup.log"; exit 1; }
rm -rf "$R/shots"; mkdir -p "$R/shots"
FB_SHOTS_OUT="$R/shots" node tests/e2e/screens.js > "$R/e2e-shots.log" 2>&1
echo $? > "$R/e2e-shots.exit"
node tests/e2e/shotcompare.js "$R/shots" >> "$R/e2e-shots.log" 2>&1
sh tests/start-ha.sh stop > /dev/null
node tests/lib/report.js "$R" e2e-shots || { echo "--- the end of tests/.results/e2e-shots.log:"; tail -40 "$R/e2e-shots.log"; exit 1; }
