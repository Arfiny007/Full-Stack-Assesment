import assert from "node:assert/strict";
const base = process.env.DEMO_URL ?? "http://127.0.0.1:3100";
const source = "demo-" + Date.now();
const count = {
  source_id: source,
  event_id: "C1",
  type: "COUNT",
  quantity: 12,
  event_time: new Date().toISOString(),
};
const correction = {
  source_id: source,
  event_id: "V1",
  type: "VOID",
  target_event_id: "C1",
  event_time: new Date().toISOString(),
};
async function call(route: string, body?: unknown) {
  const response = await fetch(base + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as any;
  assert.equal(response.status, 200);
  console.log(route, JSON.stringify(data));
  return data;
}
assert.equal(
  (await call("/api/events", correction)).results[0].status,
  "PENDING_REFERENCE",
);
assert.equal((await call("/api/events", count)).results[0].status, "ACCEPTED");
assert.equal((await call("/api/events", count)).results[0].status, "DUPLICATE");
assert.equal(
  (await call("/api/state?source_id=" + source)).summary.net_total,
  0,
);
assert.deepEqual(
  (
    await call("/api/ack", { source_id: source, event_ids: ["C1", "C1", "V1"] })
  ).results.map((r: any) => r.status),
  ["ACKED", "ALREADY_ACKED", "ALREADY_ACKED"],
);
console.log("Demo passed; durable history remains under source " + source);
