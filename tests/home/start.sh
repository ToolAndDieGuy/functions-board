#!/bin/sh
# Starts what the test Home Assistant talks to, or stops it: the MQTT broker, the Z-Wave mock controller and the
# Z-Wave JS server on it, and Node-RED (tests/home/README.md). tests/start-ha.sh runs it before Home Assistant.
#   sh tests/home/start.sh <dir>    start them, their state and logs in <dir> (ha/home, or ha-demo/home)
#   sh tests/home/start.sh stop     stop whichever are running
# Everything listens on 127.0.0.1 only, on ports no one else is likely to use (FB_MQTT_PORT 11883,
# FB_ZWAVE_MOCK_PORT 15555, FB_ZWAVE_CTL 15556, FB_ZWAVE_PORT 13000, FB_NODERED_PORT 11880). Each start begins the
# same: the broker's retained messages are published again, the Z-Wave cache and Node-RED's flows are kept.
# the state folder as given (from where this was run), before moving here
if [ -n "$1" ] && [ "$1" != "stop" ]; then mkdir -p "$1" && dir=$(cd "$1" && pwd); fi
cd "$(dirname "$0")"
here=$PWD

stop() {
  for f in "$here"/../../ha/home/*.pid "$here"/../../ha-demo/home/*.pid; do
    [ -f "$f" ] || continue
    kill "$(cat "$f")" 2>/dev/null
    rm -f "$f"
  done
  # anything of ours left from a start whose pid files are gone (Node-RED renames its process: only its pid file finds it)
  pkill -f "$here/(mqtt.mjs|zwave-mock.cjs)" 2>/dev/null
  pkill -f "$here/node_modules/@zwave-js/server/" 2>/dev/null
  sleep 1
}

if [ "$1" = "stop" ]; then stop; echo "test home stopped"; exit 0; fi
[ -n "$1" ] || { echo "usage: sh tests/home/start.sh <dir> | stop"; exit 2; }
[ -d node_modules/aedes ] || { echo "tests/home/node_modules is missing: run sh tests/setup.sh first"; exit 1; }
stop
export FB_HOME_DIR="$dir"
: "${FB_MQTT_PORT:=11883}" "${FB_ZWAVE_MOCK_PORT:=15555}" "${FB_ZWAVE_CTL:=15556}" "${FB_ZWAVE_PORT:=13000}" "${FB_NODERED_PORT:=11880}"
export FB_MQTT_PORT FB_ZWAVE_MOCK_PORT FB_ZWAVE_CTL FB_ZWAVE_PORT FB_NODERED_PORT

# wait for a port to answer (up to $2 seconds)
up() { node -e "const s=require('net').connect($1,'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1))" 2>/dev/null; }
wait_for() { i=0; while ! up "$1"; do i=$((i + 1)); [ "$i" -gt "$(($2 * 4))" ] && { echo "$3 didn't start; see $dir/$4"; return 1; }; sleep 0.25; done; }

for p in "$FB_MQTT_PORT" "$FB_ZWAVE_MOCK_PORT" "$FB_ZWAVE_CTL" "$FB_ZWAVE_PORT" "$FB_NODERED_PORT"; do
  up "$p" && { echo "port $p on 127.0.0.1 is in use: something else is listening there (set the FB_*_PORT it belongs to)"; exit 1; }
done
: > "$dir/mqtt-messages.log"
FB_MQTT_LOG="$dir/mqtt-messages.log" nohup node "$here/mqtt.mjs" > "$dir/mqtt.log" 2>&1 &
echo $! > "$dir/mqtt.pid"
nohup node "$here/zwave-mock.cjs" > "$dir/zwave-mock.log" 2>&1 &
echo $! > "$dir/zwave-mock.pid"
wait_for "$FB_MQTT_PORT" 20 "The MQTT broker" mqtt.log || exit 1
wait_for "$FB_ZWAVE_MOCK_PORT" 20 "The Z-Wave mock controller" zwave-mock.log || exit 1
nohup node "$here/node_modules/@zwave-js/server/dist-esm/bin/server.js" "tcp://127.0.0.1:$FB_ZWAVE_MOCK_PORT" \
  --config "$here/zwave-server.cjs" --port "$FB_ZWAVE_PORT" --host 127.0.0.1 --disable-dns-sd > "$dir/zwave-server.log" 2>&1 &
echo $! > "$dir/zwave-server.pid"
nohup node "$here/node_modules/node-red/red.js" --settings "$here/nodered-settings.js" > "$dir/nodered.log" 2>&1 &
echo $! > "$dir/nodered.pid"
wait_for "$FB_ZWAVE_PORT" 60 "The Z-Wave JS server" zwave-server.log || exit 1
wait_for "$FB_NODERED_PORT" 60 "Node-RED" nodered.log || exit 1
echo "test home up ($dir): MQTT :$FB_MQTT_PORT, Z-Wave JS :$FB_ZWAVE_PORT, Node-RED :$FB_NODERED_PORT"
