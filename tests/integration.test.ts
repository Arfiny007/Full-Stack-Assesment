import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import { app } from "../backend/app.js";
import { pool, transaction } from "../backend/shared/db/index.js";
import { migrate } from "../backend/shared/db/migrate.js";
import { processEvents } from "../backend/modules/events/service.js";
import { handleChallenge } from "../backend/modules/mqtt/service.js";
import { summary } from "../backend/modules/state/repository.js";
import { canonical } from "../backend/modules/events/schema.js";
import { saveChallenge } from "../backend/modules/mqtt/repository.js";
import {
  unpublished,
  markPublished,
} from "../backend/modules/mqtt/repository.js";
const count = (id = "C1", quantity = 12, source = "line-a") => ({
  source_id: source,
  event_id: id,
  type: "COUNT",
  quantity,
  event_time: "2026-10-09T08:00:00+06:00",
});

describe("official COUNT limit and rejected submission metrics", () => {
  const quantityMessage =
    "COUNT quantity must be an integer between 1 and 500.";
  it.each([
    [1, "ACCEPTED"],
    [450, "ACCEPTED"],
    [500, "ACCEPTED"],
    [501, "REJECTED"],
    [0, "REJECTED"],
    [-1, "REJECTED"],
    [1.5, "REJECTED"],
  ])(
    "COUNT quantity %s returns %s and persists its outcome without invalid effects",
    async (quantity, expected) => {
      const event = count("BOUNDARY", quantity as number, "LINE-01");
      const response = await request(app)
        .post("/api/events")
        .send(event)
        .expect(200);
      expect(response.body.results[0].status).toBe(expected);
      const accepted = expected === "ACCEPTED";
      if (!accepted)
        expect(response.body.results[0].message).toContain(quantityMessage);
      const state = (
        await request(app).get("/api/state?source_id=LINE-01").expect(200)
      ).body.summary;
      expect(state).toEqual({
        net_total: accepted ? quantity : 0,
        processed_events: accepted ? 1 : 0,
        pending_ack: accepted ? 1 : 0,
        unresolved: 0,
        duplicates: 0,
        conflicts: 0,
        rejected_submissions: accepted ? 0 : 1,
      });
      const attempts = (
        await pool.query(
          "SELECT source_id,status,original_payload,message FROM submission_attempts",
        )
      ).rows;
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        source_id: "LINE-01",
        status: expected,
        original_payload: event,
      });
      if (!accepted) {
        expect(attempts[0].message).toContain(quantityMessage);
        expect(
          (await pool.query("SELECT COUNT(*)::int AS n FROM production_events"))
            .rows[0].n,
        ).toBe(0);
        const exceptions = (
          await request(app).get("/api/state?view=exceptions&source_id=LINE-01")
        ).body.exceptions;
        expect(exceptions).toHaveLength(1);
        expect(exceptions[0]).toMatchObject({
          event_id: "BOUNDARY",
          source_id: "LINE-01",
          status: "REJECTED",
          kind: "attempt",
        });
      }
    },
  );

  it("mixed COUNT 450/501 batch preserves order, commits 450 and audits 501", async () => {
    const response = await request(app)
      .post("/api/events")
      .send([count("OK", 450), count("TOO-LARGE", 501)])
      .expect(200);
    expect(response.body.results.map((r: any) => r.status)).toEqual([
      "ACCEPTED",
      "REJECTED",
    ]);
    expect(await summary()).toMatchObject({
      net_total: 450,
      processed_events: 1,
      rejected_submissions: 1,
    });
    expect(
      (
        await pool.query("SELECT status FROM submission_attempts ORDER BY id")
      ).rows.map((r) => r.status),
    ).toEqual(["ACCEPTED", "REJECTED"]);
  });

  it("two source filters count repeated rejected attempts independently; sourceless attempts only unfiltered", async () => {
    await processEvents([
      count("OK", 450, "LINE-01"),
      count("BAD", 501, "LINE-01"),
      count("BAD", 501, "LINE-01"),
      count("BAD", 501, "LINE-02"),
      {
        event_id: "NO-SOURCE",
        type: "COUNT",
        quantity: 501,
        event_time: count().event_time,
      },
    ]);
    const get = async (source?: string) =>
      (
        await request(app)
          .get(
            "/api/state" +
              (source ? "?source_id=" + encodeURIComponent(source) : ""),
          )
          .expect(200)
      ).body.summary;
    expect(await get("LINE-01")).toMatchObject({
      net_total: 450,
      processed_events: 1,
      rejected_submissions: 2,
    });
    expect(await get("LINE-02")).toMatchObject({
      net_total: 0,
      processed_events: 0,
      rejected_submissions: 1,
    });
    expect((await get()).rejected_submissions).toBe(4);
    expect((await get("EMPTY")).rejected_submissions).toBe(0);
    const pending = (
      await request(app).get("/api/state?view=pending&source_id=LINE-01")
    ).body.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0].source_id).toBe("LINE-01");
    expect(
      (await request(app).get("/api/state?view=pending&source_id=LINE-02")).body
        .pending,
    ).toHaveLength(0);
    expect(
      (await request(app).get("/api/state?view=exceptions&source_id=LINE-01"))
        .body.exceptions,
    ).toHaveLength(2);
    expect(
      (await request(app).get("/api/state?view=exceptions&source_id=LINE-02"))
        .body.exceptions,
    ).toHaveLength(1);
  });

  it("rejected_submissions counts REJECTED attempts only, without double counting rejected event rows", async () => {
    await processEvents([
      count("C", 10),
      count("C", 10),
      count("C", 11),
      voidEvent("PENDING", "MISSING"),
      voidEvent("SELF", "SELF"),
      count("BAD", 501),
      count("BAD", 501),
    ]);
    expect(await summary()).toEqual({
      net_total: 10,
      processed_events: 1,
      pending_ack: 1,
      unresolved: 1,
      duplicates: 1,
      conflicts: 1,
      rejected_submissions: 3,
    });
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM production_events WHERE status='REJECTED'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM submission_attempts WHERE status='REJECTED'",
        )
      ).rows[0].n,
    ).toBe(3);
  });

  it("MQTT COUNT 501 remains COMPLETED with seven-field state, durable rejection and exact replay", async () => {
    const body = challenge("MQ-LIMIT", [count("MQ-BAD", 501, "LINE-MQ")]);
    const first = await handleChallenge(body, "integration-only");
    expect(first.status).toBe("COMPLETED");
    expect(first.results).toEqual([
      expect.objectContaining({
        event_id: "MQ-BAD",
        status: "REJECTED",
        message: expect.stringContaining(quantityMessage),
      }),
    ]);
    expect(first.state).toEqual({
      net_total: 0,
      processed_events: 0,
      pending_ack: 0,
      unresolved: 0,
      duplicates: 0,
      conflicts: 0,
      rejected_submissions: 1,
    });
    expect(
      (
        await pool.query(
          "SELECT source_id,transport,status FROM submission_attempts",
        )
      ).rows,
    ).toEqual([
      { source_id: "LINE-MQ", transport: "MQTT", status: "REJECTED" },
    ]);
    expect(await handleChallenge(body, "integration-only")).toEqual(first);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS n FROM submission_attempts"))
        .rows[0].n,
    ).toBe(1);
    const stored = (
      await pool.query("SELECT serialized_response FROM mqtt_challenges")
    ).rows[0].serialized_response;
    expect(stored).toBe(JSON.stringify(first));
  });

  it("MQTT mixed COUNT 450/501 uses the same rule and includes REST and MQTT rejections", async () => {
    await processEvents([count("REST-BAD", 501, "LINE-MQ")]);
    const response = await handleChallenge(
      challenge("MQ-MIXED", [
        count("MQ-OK", 450, "LINE-MQ"),
        count("MQ-BAD", 501, "LINE-MQ"),
      ]),
      "integration-only",
    );
    expect(response.status).toBe("COMPLETED");
    expect((response.results as any[]).map((r) => r.status)).toEqual([
      "ACCEPTED",
      "REJECTED",
    ]);
    expect(response.state).toMatchObject({
      net_total: 450,
      processed_events: 1,
      rejected_submissions: 2,
    });
    expect((await summary("LINE-MQ")).rejected_submissions).toBe(2);
  });

  it("historical six-field MQTT responses and COUNT above 500 stay intact during replay", async () => {
    const body = challenge("LEGACY", [count("OLD-C", 750, "LEGACY-LINE")]);
    const oldResponse = {
      protocol_version: "1.0",
      candidate_id: "integration-only",
      challenge_id: "LEGACY",
      status: "COMPLETED",
      processed_at: "2026-10-08T00:00:00Z",
      results: [
        {
          event_id: "OLD-C",
          source_id: "LEGACY-LINE",
          status: "ACCEPTED",
          message: "Event processed",
        },
      ],
      state: {
        net_total: 750,
        processed_events: 1,
        pending_ack: 1,
        unresolved: 0,
        duplicates: 0,
        conflicts: 0,
      },
    };
    // Fixture models data committed under the previous contract, not processing through today's validator.
    await transaction(async (db) => {
      await db.query("INSERT INTO production_sources(source_id) VALUES($1)", [
        "LEGACY-LINE",
      ]);
      await db.query(
        "INSERT INTO production_events(source_id,event_id,type,quantity,event_time,original_payload,normalized_payload,status) VALUES($1,$2,'COUNT',750,$3,$4,$5,'ACCEPTED')",
        [
          "LEGACY-LINE",
          "OLD-C",
          body.events[0] && count().event_time,
          JSON.stringify(body.events[0]),
          JSON.stringify({
            ...count("OLD-C", 750, "LEGACY-LINE"),
            target_event_id: null,
            event_time: "2026-10-09T02:00:00.000Z",
          }),
        ],
      );
      const canon = canonical(body);
      await saveChallenge(
        db,
        "integration-only",
        "LEGACY",
        canon,
        createHash("sha256").update(canon).digest("hex"),
        oldResponse,
      );
    });
    const original = (
      await pool.query(
        "SELECT serialized_response FROM mqtt_challenges WHERE challenge_id='LEGACY'",
      )
    ).rows[0].serialized_response;
    expect(await handleChallenge(body, "integration-only")).toEqual(
      oldResponse,
    );
    expect(
      (
        await pool.query(
          "SELECT serialized_response FROM mqtt_challenges WHERE challenge_id='LEGACY'",
        )
      ).rows[0].serialized_response,
    ).toBe(original);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS n FROM submission_attempts"))
        .rows[0].n,
    ).toBe(0);
    expect((await summary()).net_total).toBe(750);
    const fresh = await handleChallenge(
      challenge("AFTER-CHANGE", []),
      "integration-only",
    );
    expect(fresh.state).toEqual({
      ...oldResponse.state,
      rejected_submissions: 0,
    });
    expect(
      (
        await pool.query(
          "SELECT quantity,status FROM production_events WHERE event_id='OLD-C'",
        )
      ).rows[0],
    ).toEqual({ quantity: 750, status: "ACCEPTED" });
  });
});
const voidEvent = (id = "V1", target = "C1", source = "line-a") => ({
  source_id: source,
  event_id: id,
  type: "VOID",
  target_event_id: target,
  event_time: "2026-10-09T08:01:00+06:00",
});
const challenge = (id = "CH1", events: unknown[] = [count()]) => ({
  protocol_version: "1.0",
  candidate_id: "integration-only",
  challenge_id: id,
  command: "PROCESS_EVENTS",
  expires_at: "2099-01-01T00:00:00Z",
  events,
});
beforeAll(migrate);
beforeEach(async () => {
  await pool.query(
    "TRUNCATE production_events,production_sources,submission_attempts,mqtt_challenges,mqtt_challenge_history RESTART IDENTITY CASCADE",
  );
});
afterAll(() => pool.end());
describe("PostgreSQL REST and shared business service", () => {
  it("new COUNT increases real database total and exposes exactly seven indicators", async () => {
    const response = await request(app)
      .post("/api/events")
      .send(count())
      .expect(200);
    expect(response.body.results[0].status).toBe("ACCEPTED");
    const state = (await request(app).get("/api/state").expect(200)).body;
    expect(state.summary).toEqual({
      net_total: 12,
      processed_events: 1,
      pending_ack: 1,
      unresolved: 0,
      duplicates: 0,
      conflicts: 0,
      rejected_submissions: 0,
    });
    expect(state.mqtt.enabled).toBe(false);
  });
  it("identical COUNT with reordered keys/optional nulls/timezone never double counts", async () => {
    await processEvents([count()]);
    const results = await processEvents([
      {
        event_time: "2026-10-09T02:00:00Z",
        quantity: 12,
        type: "COUNT",
        event_id: "C1",
        source_id: "line-a",
        target_event_id: null,
      },
    ]);
    expect(results[0].status).toBe("DUPLICATE");
    expect((await summary()).net_total).toBe(12);
    expect((await summary()).duplicates).toBe(1);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS n FROM submission_attempts"))
        .rows[0].n,
    ).toBe(2);
  });
  it("VOID before COUNT resolves automatically; VOID auto ACK and COUNT pending supervisor", async () => {
    expect((await processEvents([voidEvent()]))[0].status).toBe(
      "PENDING_REFERENCE",
    );
    expect((await summary()).unresolved).toBe(1);
    await processEvents([count()]);
    expect(await summary()).toMatchObject({
      net_total: 0,
      processed_events: 2,
      pending_ack: 1,
      unresolved: 0,
    });
    const result = await request(app)
      .post("/api/ack")
      .send({ event_ids: ["V1"] })
      .expect(200);
    expect(result.body.results[0].status).toBe("ALREADY_ACKED");
  });
  it("repeated ACK including repeated IDs is durable and idempotent", async () => {
    await processEvents([count()]);
    const first = await request(app)
      .post("/api/ack")
      .send({ event_ids: ["C1", "C1", "missing"] })
      .expect(200);
    expect(first.body.results.map((r: any) => r.status)).toEqual([
      "ACKED",
      "ALREADY_ACKED",
      "NOT_FOUND",
    ]);
    expect(
      (
        await request(app)
          .post("/api/ack")
          .send({ event_ids: ["C1"] })
      ).body.results[0].status,
    ).toBe("ALREADY_ACKED");
    expect((await summary()).pending_ack).toBe(0);
    await processEvents([voidEvent()]);
    expect((await summary()).net_total).toBe(0);
  });
  it("replayed MQTT challenge returns persisted ORIGINAL response and no repeated attempts", async () => {
    const body = challenge();
    const first = await handleChallenge(body, "integration-only");
    await processEvents([count("other", 5)]);
    const repeated = await handleChallenge(
      { ...body, events: [{ ...count() }] },
      "integration-only",
    );
    expect(repeated).toEqual(first);
    expect(repeated.status).toBe("COMPLETED");
    expect(repeated.state).toMatchObject({ net_total: 12 });
    expect((await summary()).net_total).toBe(17);
    expect((await summary()).duplicates).toBe(0);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS n FROM submission_attempts"))
        .rows[0].n,
    ).toBe(2);
  });
  it("mixed invalid batch commits valid siblings in order and audits invalid records", async () => {
    const res = await request(app)
      .post("/api/events")
      .send([count(), { ...count("bad"), quantity: -1 }, null, voidEvent()])
      .expect(200);
    expect(res.body.results.map((r: any) => r.status)).toEqual([
      "ACCEPTED",
      "REJECTED",
      "REJECTED",
      "ACCEPTED",
    ]);
    expect((await summary()).net_total).toBe(0);
    expect(
      (await request(app).get("/api/state?view=exceptions")).body.exceptions,
    ).toHaveLength(2);
    await request(app)
      .post("/api/events")
      .send("42")
      .set("Content-Type", "application/json")
      .expect(400);
    await request(app)
      .post("/api/events")
      .send("{oops")
      .set("Content-Type", "application/json")
      .expect(400);
  });
  it("changed payload conflicts and original data remains", async () => {
    await processEvents([count()]);
    expect((await processEvents([count("C1", 99)]))[0].status).toBe("CONFLICT");
    expect(await summary()).toMatchObject({ net_total: 12, conflicts: 1 });
  });
  it("earliest competing pending VOID wins and later VOID is rejected", async () => {
    await processEvents([voidEvent("V1"), voidEvent("V2")]);
    await processEvents([count()]);
    const rows = (
      await pool.query(
        "SELECT event_id,status,acked_at FROM production_events WHERE type='VOID' ORDER BY id",
      )
    ).rows;
    expect(rows.map((r) => r.status)).toEqual(["ACCEPTED", "REJECTED"]);
    expect(rows[0].acked_at).toBeTruthy();
    expect((await processEvents([voidEvent("V3")]))[0].status).toBe("REJECTED");
    expect((await summary()).net_total).toBe(0);
    expect(
      (
        await request(app)
          .post("/api/ack")
          .send({ event_ids: ["V2"] })
      ).body.results[0].status,
    ).toBe("NOT_READY");
  });
  it("composite IDs allow different sources; ambiguous ACK refuses to choose", async () => {
    await processEvents([
      count("C1", 12, "a"),
      count("C1", 7, "b"),
      voidEvent("VB", "C1", "b"),
    ]);
    expect((await summary("a")).net_total).toBe(12);
    expect((await summary("b")).net_total).toBe(0);
    expect(
      (
        await request(app)
          .post("/api/ack")
          .send({ event_ids: ["C1"] })
      ).body.results[0].status,
    ).toBe("NOT_READY");
    expect(
      (
        await request(app)
          .post("/api/ack")
          .send({ event_ids: ["C1"], source_id: "a" })
      ).body.results[0].status,
    ).toBe("ACKED");
  });
  it("concurrent duplicates and reversals apply one effect only", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => processEvents([count()])),
    );
    expect(results.filter((r) => r[0].status === "ACCEPTED")).toHaveLength(1);
    expect((await summary()).net_total).toBe(12);
    const reversals = await Promise.all(
      Array.from({ length: 6 }, (_, i) => processEvents([voidEvent("V" + i)])),
    );
    expect(reversals.filter((r) => r[0].status === "ACCEPTED")).toHaveLength(1);
    expect((await summary()).net_total).toBe(0);
  });
  it("concurrent MQTT replay serializes on challenge and rejects changed body", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        handleChallenge(challenge(), "integration-only"),
      ),
    );
    expect(
      responses.every(
        (r) => JSON.stringify(r) === JSON.stringify(responses[0]),
      ),
    ).toBe(true);
    const conflict = await handleChallenge(
      challenge("CH1", [count("C1", 99)]),
      "integration-only",
    );
    expect(conflict.error_code).toBe("CHALLENGE_CONFLICT");
    expect((await summary()).duplicates).toBe(0);
    expect((await summary()).net_total).toBe(12);
  });
  it("challenge validation failures are durable and individual invalid events still COMPLETE", async () => {
    expect(
      (
        await handleChallenge(
          { ...challenge(), protocol_version: "2.0" },
          "integration-only",
        )
      ).error_code,
    ).toBe("UNSUPPORTED_PROTOCOL");
    expect(
      (
        await handleChallenge(
          { ...challenge("CH2"), candidate_id: "wrong" },
          "integration-only",
        )
      ).error_code,
    ).toBe("CANDIDATE_MISMATCH");
    expect(
      (
        await handleChallenge(
          { ...challenge("CH3"), expires_at: "2000-01-01T00:00:00Z" },
          "integration-only",
        )
      ).error_code,
    ).toBe("CHALLENGE_EXPIRED");
    expect(
      (
        await handleChallenge(
          { ...challenge("CH4"), events: "wrong" },
          "integration-only",
        )
      ).error_code,
    ).toBe("VALIDATION_ERROR");
    const mixed = await handleChallenge(
      challenge("CH5", [count(), { bad: true }]),
      "integration-only",
    );
    expect(mixed.status).toBe("COMPLETED");
    expect((mixed.results as any[])[1].status).toBe("REJECTED");
  });
  it("unexpected enclosing transaction failure rolls back event and audit together", async () => {
    await expect(
      transaction(async (db) => {
        await processEvents([count()], { transport: "REST" }, db);
        throw new Error("Injected failure");
      }),
    ).rejects.toThrow("Injected failure");
    expect((await summary()).processed_events).toBe(0);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS n FROM submission_attempts"))
        .rows[0].n,
    ).toBe(0);
  });
  it("invalid source-less attempts are excluded from source filters", async () => {
    await processEvents([
      { event_id: "bad" },
      { ...count("bad-a"), quantity: 0 },
    ]);
    expect(
      (await request(app).get("/api/state?view=exceptions")).body.exceptions,
    ).toHaveLength(2);
    expect(
      (await request(app).get("/api/state?view=exceptions&source_id=line-a"))
        .body.exceptions,
    ).toHaveLength(1);
  });
  it("missing references cannot ACK and references to VOID are rejected on arrival", async () => {
    await processEvents([voidEvent("V1", "V2")]);
    expect(
      (
        await request(app)
          .post("/api/ack")
          .send({ event_ids: ["V1"] })
      ).body.results[0].status,
    ).toBe("NOT_READY");
    await processEvents([voidEvent("V2", "C1")]);
    expect(
      (
        await pool.query(
          "SELECT status FROM production_events WHERE event_id='V1'",
        )
      ).rows[0].status,
    ).toBe("REJECTED");
  });
  it("FAILED responses and conflicts are durable outbox entries, retryable after publish error", async () => {
    await handleChallenge(challenge(), "integration-only");
    const failed = await handleChallenge(
      challenge("CH1", []),
      "integration-only",
    );
    expect(failed.error_code).toBe("CHALLENGE_CONFLICT");
    expect(await unpublished("integration-only")).toHaveLength(2);
    await markPublished(
      "integration-only",
      "CH1",
      JSON.stringify(failed),
      "simulated disconnect",
    );
    expect(await unpublished("integration-only")).toHaveLength(2);
    await markPublished("integration-only", "CH1", JSON.stringify(failed));
    expect(await unpublished("integration-only")).toHaveLength(1);
  });
});
