#!/bin/sh
# Kept so older notes and CI steps still work: the tests run through tests/run.sh (see there).
exec sh "$(dirname "$0")/run.sh" "$@"
