# The test home

What the test Home Assistant talks to, so the board can be tested against real integrations rather than
recordings of them. `sh tests/setup.sh` installs it (`tests/home/package.json`, its own lockfile), and
`sh tests/start-ha.sh` starts it before Home Assistant, its state and logs in `ha/home/` (`ha-demo/home/` for the demo
instance); `sh tests/start-ha.sh stop` stops it. `tests/e2e/hasetup.js` sets each one up in Home Assistant the way a
person would, through its config flow. Everything listens on 127.0.0.1 only, and nothing in it is a real device.

| What | Listens on | In Home Assistant |
|---|---|---|
| MQTT broker (`mqtt.mjs`, aedes) | 11883 (`FB_MQTT_PORT`) | the MQTT integration (MQTT 3.1.1: aedes doesn't speak 5) |
| Z-Wave mock controller (`zwave-mock.cjs`) | 15555 (`FB_ZWAVE_MOCK_PORT`), its control page 15556 (`FB_ZWAVE_CTL`) | through the Z-Wave JS server |
| Z-Wave JS server (`@zwave-js/server`, `zwave-server.cjs`) | 13000 (`FB_ZWAVE_PORT`) | the Z-Wave JS integration |
| Node-RED with the Home Assistant nodes (`nodered-settings.js`) | 11880 (`FB_NODERED_PORT`) | its own token and server node (`fb_ha_server`) |
| A phone | — | the mobile app integration (pushes over its websocket only) |

**MQTT.** `mqtt-home.json` is published, retained, before anyone connects: the discovery configs of three devices
(Workshop climate: temperature, humidity and occupancy from one JSON topic; Hall remote: four buttons as device
triggers and an event entity, a battery; Pond pump: a switch with command and state topics, its power) and the first
state of every state topic, including those of the MQTT entities set up in YAML in `tests/e2e/config/configuration.yaml`
(Rain gauge, Mailbox, Porch light (JSON schema), Shed lock, Sprinkler program, Coop door, Feeder portion). Every
message anyone publishes is logged to `ha/home/mqtt-messages.log`; `home.mqtt.sent()` reads it, so a test can say
that nothing was published.

**Z-Wave.** Five nodes on a mock controller (zwave-js's own mock, run by `zwave-mock.cjs` because its server joins
TCP frames it then can't read and announces itself by mDNS): a door lock (Door Lock, access control notifications,
battery), a three-button scene keypad (Central Scene), a plug-in outlet (Binary Switch, an energy meter), a
multisensor (temperature, humidity, light, motion, two settings) and a dimmer. Each answers its interview as the
device would. `home.zwave.scene(3, 1, 'KeyPressed')`, `.notify()`, `.sensor()` and `.switch()` make a node report as
if someone used it.

**Node-RED.** Starts with one tab, the server node every test flow uses. A test adds a tab of its own with
`home.nodered.addFlow({ label, nodes })` and removes it with `home.nodered.removeFlow(id)` (`home.nodered.clear()`
removes any a failed test left). Its flows act on the test Home Assistant for real.

The base test config has no automations that use any of this: tests that need one add it (the fixtures put
everything back afterwards), so the garage function and the import's groups are what they were.
