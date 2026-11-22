// The test home's Z-Wave network: a mock controller with five nodes, served as a serial port over TCP on
// 127.0.0.1:$FB_ZWAVE_MOCK_PORT (default 15555); the Z-Wave JS server talks to it as to a USB stick
// (tests/home/start.sh runs both). Nothing is a real device: the ids below belong to no product (0xFB7E is no
// manufacturer), so Z-Wave JS knows only what each node answers. The mock answers the interview for most command
// classes itself; Central Scene it doesn't, so its answers are here.
//   node tests/home/zwave-mock.cjs
// zwave-js has a mock server of its own (bin/mock-server.cjs); this is the same, with two differences: it hands the
// mock controller one frame at a time (TCP joins the driver's ACK and its next message, which the mock can't read),
// and it doesn't announce itself on the network (mDNS).
//
// While it runs, a small control page on 127.0.0.1:$FB_ZWAVE_CTL (default 15556) lets a test make a node report, as
// the device would when someone uses it (tests/home/home.js has helpers):
//   POST /scene   {"node": 3, "scene": 1, "key": "KeyPressed"}       a keypad button (Central Scene notification)
//   POST /notify  {"node": 2, "type": 6, "event": 22}                 a Notification CC event (6/22: door open)
//   POST /sensor  {"node": 5, "type": 1, "scale": 1, "value": 71.5}   a Multilevel Sensor report (1: air temperature)
//   POST /switch  {"node": 4, "on": true}                             a Binary Switch report (turned at the device)
const http = require('http');

function home() {
  const { CommandClasses } = require('@zwave-js/core');
  const cc = require('@zwave-js/cc');
  const { createMockZWaveRequestFrame } = require('@zwave-js/testing');
  const ids = (productId) => ({ manufacturerId: 0xfb7e, productType: 0x0001, productId, firmwareVersion: '1.0' });

  // Central Scene: how many scenes, and which key presses each has
  const scenes = { 3: { sceneCount: 3, keys: [0, 1, 2, 3, 4] } };
  const centralScene = {
    handleCC(controller, self, received) {
      const s = scenes[self.id];
      if (!s) return undefined;
      if (received instanceof cc.CentralSceneCCSupportedGet) {
        const supportedKeyAttributes = {};
        for (let n = 1; n <= s.sceneCount; n++) supportedKeyAttributes[n] = s.keys;
        return { action: 'sendCC', cc: new cc.CentralSceneCCSupportedReport({ nodeId: controller.ownNodeId, sceneCount: s.sceneCount, supportsSlowRefresh: false, supportedKeyAttributes }) };
      }
      if (received instanceof cc.CentralSceneCCConfigurationGet) {
        return { action: 'sendCC', cc: new cc.CentralSceneCCConfigurationReport({ nodeId: controller.ownNodeId, slowRefresh: false }) };
      }
      return undefined;
    },
  };

  const nodes = [
    { // a door lock: Door Lock (bolt, latch, door), its battery, access control notifications
      id: 2,
      capabilities: Object.assign(ids(0x0002), {
        genericDeviceClass: 0x40, specificDeviceClass: 0x03,
        commandClasses: [
          CommandClasses.Version, CommandClasses['Manufacturer Specific'],
          { ccId: CommandClasses['Node Naming and Location'], name: 'Front door lock', location: 'Entry' },
          { ccId: CommandClasses['Door Lock'], version: 4, supportedOperationTypes: [1], supportedDoorLockModes: [0, 255], doorSupported: true, boltSupported: true, latchSupported: true },
          CommandClasses.Battery,
          { ccId: CommandClasses.Notification, version: 8, supportsV1Alarm: false, notificationTypesAndEvents: { 6: [1, 2, 3, 4, 11, 22, 23] } },
        ],
      }),
    },
    { // a wall keypad with three buttons: Central Scene
      id: 3,
      capabilities: Object.assign(ids(0x0003), {
        genericDeviceClass: 0x18, specificDeviceClass: 0x01,
        commandClasses: [
          CommandClasses.Version, CommandClasses['Manufacturer Specific'],
          { ccId: CommandClasses['Node Naming and Location'], name: 'Scene keypad', location: 'Hall' },
          { ccId: CommandClasses['Central Scene'], version: 3 },
          CommandClasses.Battery,
        ],
      }),
      behaviors: [centralScene],
    },
    { // a plug-in outlet: Binary Switch and an energy meter
      id: 4,
      capabilities: Object.assign(ids(0x0004), {
        genericDeviceClass: 0x10, specificDeviceClass: 0x01,
        commandClasses: [
          CommandClasses.Version, CommandClasses['Manufacturer Specific'],
          { ccId: CommandClasses['Node Naming and Location'], name: 'Garden outlet', location: 'Garden' },
          { ccId: CommandClasses['Binary Switch'], defaultValue: false },
          { ccId: CommandClasses.Meter, version: 3, meterType: 1, supportedScales: [0, 2], supportedRateTypes: [1], supportsReset: true, getValue: (scale) => (scale === 2 ? 0 : 12.5) },
        ],
      }),
    },
    { // a battery multisensor: temperature, humidity, light, motion, and two settings
      id: 5,
      capabilities: Object.assign(ids(0x0005), {
        genericDeviceClass: 0x21, specificDeviceClass: 0x01,
        commandClasses: [
          CommandClasses.Version, CommandClasses['Manufacturer Specific'],
          { ccId: CommandClasses['Node Naming and Location'], name: 'Hall multisensor', location: 'Hall' },
          { ccId: CommandClasses['Multilevel Sensor'], version: 11, sensors: { 1: { supportedScales: [1] }, 5: { supportedScales: [0] }, 3: { supportedScales: [0] } }, getValue: (type) => ({ 1: 68.5, 5: 44, 3: 30 }[type]) },
          { ccId: CommandClasses.Notification, version: 8, supportsV1Alarm: false, notificationTypesAndEvents: { 7: [3, 8] } },
          CommandClasses.Battery,
          { ccId: CommandClasses.Configuration, version: 4, parameters: [
            { '#': 1, valueSize: 1, name: 'Motion sensitivity', minValue: 0, maxValue: 3, defaultValue: 2, format: 0 },
            { '#': 2, valueSize: 2, name: 'Motion clear delay (s)', minValue: 5, maxValue: 3600, defaultValue: 30, format: 0 },
          ] },
        ],
      }),
    },
    { // a dimmer: Multilevel Switch
      id: 6,
      capabilities: Object.assign(ids(0x0006), {
        genericDeviceClass: 0x11, specificDeviceClass: 0x01,
        commandClasses: [
          CommandClasses.Version, CommandClasses['Manufacturer Specific'],
          { ccId: CommandClasses['Node Naming and Location'], name: 'Kitchen dimmer', location: 'Kitchen' },
          { ccId: CommandClasses['Multilevel Switch'], version: 4, primarySwitchType: 2, defaultValue: 0 },
        ],
      }),
    },
  ];

  // what a node sends the controller unasked, when a test says so
  const onInit = (controller, mocks) => {
    const node = (id) => mocks.find((n) => n.id === Number(id));
    let seq = 0;
    const send = (n, report) => n.sendToController(createMockZWaveRequestFrame(report, { ackRequested: false }));
    const handlers = {
      scene: (n, b) => send(n, new cc.CentralSceneCCNotification({ nodeId: controller.ownNodeId, sequenceNumber: (seq = (seq + 1) % 256), sceneNumber: Number(b.scene), keyAttribute: typeof b.key === 'number' ? b.key : cc.CentralSceneKeys[b.key] })),
      notify: (n, b) => send(n, new cc.NotificationCCReport({ nodeId: controller.ownNodeId, notificationType: Number(b.type), notificationEvent: Number(b.event) })),
      sensor: (n, b) => send(n, new cc.MultilevelSensorCCReport({ nodeId: controller.ownNodeId, type: Number(b.type), scale: Number(b.scale || 0), value: Number(b.value) })),
      switch: (n, b) => send(n, new cc.BinarySwitchCCReport({ nodeId: controller.ownNodeId, currentValue: !!b.on })),
    };
    const port = Number(process.env.FB_ZWAVE_CTL || 15556);
    http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const what = handlers[req.url.replace(/^\//, '')], b = JSON.parse(body || '{}'), n = node(b.node);
          if (req.method !== 'POST' || !what || !n) { res.writeHead(404); res.end('unknown'); return; }
          await what(n, b);
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        } catch (e) { res.writeHead(500); res.end(String(e && e.message || e)); }
      });
    }).listen(port, '127.0.0.1');
  };

  return { controller: { homeId: 0xfb7e5eed, ownNodeId: 1 }, nodes, onInit };
}

// the host's bytes as the frames they are: ACK, NAK and CAN alone, a message by its length byte
function framer(write) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length) {
      const b = buf[0];
      if (b === 0x06 || b === 0x15 || b === 0x18) { write(buf.subarray(0, 1)); buf = buf.subarray(1); continue; }
      if (b !== 0x01) { buf = buf.subarray(1); continue; }
      if (buf.length < 2 || buf.length < buf[1] + 2) return;
      write(buf.subarray(0, buf[1] + 2)); buf = buf.subarray(buf[1] + 2);
    }
  };
}

async function main() {
  const net = require('net');
  const { createAndOpenMockedZWaveSerialPort } = require('@zwave-js/serial/mock');
  const { Faucet, ZWaveSerialFrameType } = require('@zwave-js/serial');
  const { MockController, MockNode } = require('@zwave-js/testing');
  const { createDefaultMockControllerBehaviors, createDefaultMockNodeBehaviors } = require('zwave-js/Testing');
  const cfg = home();
  const { serial, port: mockPort } = await createAndOpenMockedZWaveSerialPort();
  const controller = await MockController.create(Object.assign({ mockPort, serial }, cfg.controller));
  controller.defineBehavior(...createDefaultMockControllerBehaviors());
  const mocks = [];
  for (const n of cfg.nodes) {
    const node = await MockNode.create({ id: n.id, capabilities: n.capabilities, controller });
    controller.addNode(node);
    node.defineBehavior(...createDefaultMockNodeBehaviors());
    if (n.behaviors) node.defineBehavior(...n.behaviors);
    mocks.push(node);
  }
  cfg.onInit(controller, mocks);
  const faucet = new Faucet(serial.readable);
  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    faucet.connect(new WritableStream({ write: (chunk) => { if (chunk.type === ZWaveSerialFrameType.SerialAPI) socket.write(typeof chunk.data === 'number' ? Uint8Array.from([chunk.data]) : chunk.data); } }));
    const feed = framer((frame) => { serial.writeAsync(frame).catch((e) => console.error('mock serial write:', e)); });
    socket.on('data', feed);
    socket.on('close', () => faucet.disconnect());
  });
  server.maxConnections = 1;
  const port = Number(process.env.FB_ZWAVE_MOCK_PORT || 15555);
  server.listen(port, '127.0.0.1', () => console.log(`Z-Wave mock controller on tcp://127.0.0.1:${port}, nodes ${cfg.nodes.map((n) => n.id).join(', ')}`));
  const stop = () => { server.close(); controller.destroy(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { home, framer };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
