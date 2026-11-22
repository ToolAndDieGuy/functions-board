// The test home's MQTT broker (aedes), on 127.0.0.1:$FB_MQTT_PORT (default 11883), no login (it answers only this
// machine). Before anyone connects it publishes, retained, what tests/home/mqtt-home.json holds: the discovery
// configs of the test home's MQTT devices and the first state of every state topic, so every start begins the same
// (aedes keeps nothing between starts). Every message published by anyone is logged as one JSON line to $FB_MQTT_LOG
// ({ t, topic, payload, retain, by }), so a test can say what was sent.
//   node tests/home/mqtt.mjs
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aedes } from 'aedes';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.FB_MQTT_PORT || 11883);
const log = process.env.FB_MQTT_LOG || null;
const home = JSON.parse(fs.readFileSync(path.join(here, 'mqtt-home.json'), 'utf8'));

const broker = await Aedes.createBroker({ id: 'fb-test-home' });
const text = (p) => (typeof p === 'string' ? p : JSON.stringify(p));
for (const m of home.retained) {
  await new Promise((res, rej) => broker.publish({ cmd: 'publish', topic: m.topic, payload: Buffer.from(text(m.payload)), qos: 0, retain: true, dup: false }, (e) => (e ? rej(e) : res())));
}
if (log) {
  broker.on('publish', (packet, client) => {
    if (packet.topic.startsWith('$SYS/')) return;
    fs.appendFileSync(log, JSON.stringify({ t: Date.now(), topic: packet.topic, payload: packet.payload.toString(), retain: !!packet.retain, by: client ? client.id : null }) + '\n');
  });
}
net.createServer(broker.handle).listen(port, '127.0.0.1', () => console.log(`MQTT broker on 127.0.0.1:${port}, ${home.retained.length} retained messages`));
const stop = () => broker.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
