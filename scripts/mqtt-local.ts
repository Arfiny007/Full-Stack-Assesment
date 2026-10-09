import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import mqtt from "mqtt";
const dbUrl = process.env.TEST_DATABASE_URL;
if (
  !dbUrl ||
  !new URL(dbUrl).pathname.endsWith("_test") ||
  dbUrl === process.env.DATABASE_URL
)
  throw new Error("Separate TEST_DATABASE_URL ending _test is required");
process.env.DATABASE_URL = dbUrl;
const { pool } = await import("../backend/shared/db/index.js");
const { migrate } = await import("../backend/shared/db/migrate.js");
await migrate();
const candidate = "local-" + randomBytes(4).toString("hex");
const broker = process.env.TEST_MQTT_URL ?? "mqtt://127.0.0.1:18884";
const monitor = mqtt.connect(broker, {
  clientId: `fse01-${candidate}-${randomBytes(4).toString("hex")}`,
  reconnectPeriod: 0,
  protocolVersion: 4,
  connectTimeout: 5000,
});
const responses: string[] = [];
const statuses: string[] = [];
let worker: ChildProcess | undefined;
let workerError = "";
monitor.on("message", (topic, payload, packet) => {
  assert.equal(packet.retain, false);
  if (topic.endsWith("/response")) responses.push(payload.toString());
  else statuses.push(JSON.parse(payload.toString()).status);
});
monitor.on("error", (e) => {
  workerError = e.message;
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, label: string, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error(label + " timeout; " + workerError);
}
function start() {
  worker = spawn(process.execPath, ["--import", "tsx", "backend/server.ts"], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      CANDIDATE_ID: candidate,
      MQTT_URL: broker,
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stderr?.on("data", (d) => {
    workerError = d.toString();
  });
}
async function stop() {
  if (worker && !worker.killed) {
    const current = worker;
    const exited = new Promise<void>((r) => current.once("exit", () => r()));
    current.kill();
    await exited;
  }
  worker = undefined;
}
async function publish(body: unknown) {
  await new Promise<void>((resolve, reject) =>
    monitor.publish(
      `fse-01/${candidate}/challenge`,
      JSON.stringify(body),
      { qos: 1, retain: false },
      (e) => (e ? reject(e) : resolve()),
    ),
  );
}
try {
  await waitFor(() => monitor.connected, "Broker connection");
  await new Promise<void>((resolve, reject) =>
    monitor.subscribe(
      [`fse-01/${candidate}/response`, `fse-01/${candidate}/status`],
      { qos: 1 },
      (e, g) =>
        e || g?.some((x) => x.qos === 128)
          ? reject(e ?? new Error("SUBACK rejected"))
          : resolve(),
    ),
  );
  start();
  await waitFor(() => statuses.includes("ONLINE"), "Worker ONLINE");
  const body = {
    protocol_version: "1.0",
    candidate_id: candidate,
    challenge_id: "LOCAL-CH1",
    command: "PROCESS_EVENTS",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    events: [
      {
        source_id: candidate,
        event_id: "LOCAL-C1",
        type: "COUNT",
        quantity: 31,
        event_time: new Date().toISOString(),
      },
    ],
  };
  await publish(body);
  await waitFor(() => responses.length >= 1, "First response");
  const original = responses[0];
  assert.equal(JSON.parse(original).status, "COMPLETED");
  assert.equal(JSON.parse(original).results[0].status, "ACCEPTED");
  await publish(body);
  await waitFor(() => responses.length >= 2, "Replay response");
  assert.equal(responses[1], original);
  await stop();
  start();
  await waitFor(
    () => statuses.filter((s) => s === "ONLINE").length >= 2,
    "Restart ONLINE",
  );
  await publish(body);
  await waitFor(() => responses.length >= 3, "Restart replay");
  assert.equal(responses.at(-1), original);
  await publish({ ...body, events: [] });
  await waitFor(
    () =>
      responses.some((s) => JSON.parse(s).error_code === "CHALLENGE_CONFLICT"),
    "Conflict response",
  );
  // Crash before transport publication: seed a durable response and verify restart flushes it.
  await stop();
  const { handleChallenge } =
    await import("../backend/modules/mqtt/service.js");
  const offlineBody = {
    ...body,
    challenge_id: "LOCAL-OFFLINE",
    events: [{ ...body.events[0], event_id: "LOCAL-C2", quantity: 4 }],
  };
  const stored = await handleChallenge(offlineBody, candidate);
  start();
  await waitFor(
    () => responses.some((s) => JSON.parse(s).challenge_id === "LOCAL-OFFLINE"),
    "Persisted outbox recovery",
  );
  assert.deepEqual(
    JSON.parse(
      responses.find((s) => JSON.parse(s).challenge_id === "LOCAL-OFFLINE")!,
    ),
    stored,
  );
  await waitFor(
    () => statuses.includes("HEARTBEAT"),
    "25-second HEARTBEAT",
    30000,
  );
  await waitFor(() => statuses.includes("OFFLINE"), "Last will OFFLINE");
  const totals = (
    await pool.query(
      "SELECT SUM(quantity)::int AS n FROM production_events WHERE source_id=$1 AND type='COUNT'",
      [candidate],
    )
  ).rows[0];
  assert.equal(totals.n, 35);
  assert.equal(
    (
      await pool.query(
        "SELECT COUNT(*)::int AS n FROM submission_attempts WHERE source_id=$1",
        [candidate],
      )
    ).rows[0].n,
    2,
  );
  await waitFor(() => responses.length >= 5, "All responses");
  const outbox = (
    await pool.query(
      "SELECT COUNT(*)::int AS n FROM mqtt_challenge_history WHERE candidate_id=$1 AND published_at IS NULL",
      [candidate],
    )
  ).rows[0];
  assert.equal(outbox.n, 0);
  console.log(
    "PASS: local real MQTT QoS1, ONLINE, HEARTBEAT, OFFLINE will, replay, restart, conflict and durable outbox; PostgreSQL effects applied once.",
  );
} finally {
  await stop();
  await new Promise<void>((r) => monitor.end(true, {}, () => r()));
  await pool.end();
}
