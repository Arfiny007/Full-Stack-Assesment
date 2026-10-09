import "dotenv/config";
import mqtt from "mqtt";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const candidate = process.env.CANDIDATE_ID;
if (!candidate)
  throw new Error(
    "Set the examiner-assigned CANDIDATE_ID; start the backend first",
  );
const challenge_id =
  "VERIFY-" + Date.now() + "-" + randomBytes(3).toString("hex");
const body = {
  protocol_version: "1.0",
  candidate_id: candidate,
  challenge_id,
  command: "PROCESS_EVENTS",
  expires_at: new Date(Date.now() + 60000).toISOString(),
  events: [],
};
const client = mqtt.connect(
  process.env.MQTT_URL ?? "mqtt://152.42.238.142:1883",
  {
    clientId: `fse01-${candidate}-${randomBytes(4).toString("hex")}`,
    protocolVersion: 4,
    reconnectPeriod: 0,
    connectTimeout: 10000,
  },
);
const responses: string[] = [];
client.on("message", (_topic, payload, packet) => {
  const response = JSON.parse(payload.toString());
  if (response.challenge_id === challenge_id) {
    assert.equal(packet.retain, false);
    responses.push(payload.toString());
  }
});
client.on("error", (e) => console.error(e.message));
async function waitFor(condition: () => boolean, label: string) {
  const end = Date.now() + 20000;
  while (!condition()) {
    if (Date.now() > end) throw new Error(label + " timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function send() {
  await new Promise<void>((resolve, reject) =>
    client.publish(
      `fse-01/${candidate}/challenge`,
      JSON.stringify(body),
      { qos: 1, retain: false },
      (e) => (e ? reject(e) : resolve()),
    ),
  );
}
try {
  await waitFor(() => client.connected, "Connection");
  await new Promise<void>((resolve, reject) =>
    client.subscribe(`fse-01/${candidate}/response`, { qos: 1 }, (e, g) =>
      e || g?.some((x) => x.qos === 128)
        ? reject(e ?? new Error("SUBACK rejected"))
        : resolve(),
    ),
  );
  await send();
  await waitFor(() => responses.length >= 1, "Response");
  const response = JSON.parse(responses[0]);
  assert.equal(response.status, "COMPLETED");
  assert.deepEqual(response.results, []);
  assert.deepEqual(Object.keys(response.state).sort(), [
    "conflicts",
    "duplicates",
    "net_total",
    "pending_ack",
    "processed_events",
    "unresolved",
  ]);
  await send();
  await waitFor(() => responses.length >= 2, "Replay");
  assert.equal(responses[1], responses[0]);
  console.log(
    "PASS: live broker candidate " +
      candidate +
      " QoS1 COMPLETED response and exact replay, challenge " +
      challenge_id +
      " (self-generated empty batch, no production event effects).",
  );
} finally {
  await new Promise<void>((r) => client.end(true, {}, () => r()));
}
