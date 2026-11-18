#!/bin/sh
# (Re)starts the throwaway Home Assistant the browser tests run against, on port 8123, and waits until it answers.
#   sh tests/start-ha.sh          the test instance (ha/config)
#   sh tests/start-ha.sh demo     the demo instance (ha-demo/config), for screens.js and demo-video.js
#   sh tests/start-ha.sh stop     stops whichever is running
# Its log goes to ha/hass.log or ha-demo/hass.log. A restart through Home Assistant's API makes hass exit (code
# 100); run this again. Only one runs at a time: they share the port.
cd "$(dirname "$0")/.."
pkill -f "venv314/bin/hass -c" 2>/dev/null && sleep 3
[ "$1" = "stop" ] && { echo "stopped"; exit 0; }
dir=ha/config
[ "$1" = "demo" ] && dir=ha-demo/config
[ -d "$dir" ] || { echo "$dir is missing: run sh tests/setup.sh${1:+ $1} first"; exit 1; }
# which one is running, for apitest.py (each keeps its own login)
mkdir -p tests/e2e/.state && { [ "$1" = "demo" ] && echo demo || echo test; } > tests/e2e/.state/instance
nohup venv314/bin/hass -c "$dir" > "$(dirname "$dir")/hass.log" 2>&1 &
for i in $(seq 1 90); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8123/api/ 2>/dev/null)
  [ "$code" = "401" ] || [ "$code" = "200" ] && break
done
[ "$code" = "401" ] || [ "$code" = "200" ] || { echo "Home Assistant didn't answer; see $(dirname "$dir")/hass.log"; exit 1; }
# the API answers before every integration is set up
sleep 12
echo "Home Assistant is up ($dir)"
