# Architecture and decisions

## Modules and data

One Express process owns HTTP, the MQTT worker and the production frontend. One PostgreSQL database owns all production state. The separate test database is used only for verification.

- `modules/events`: Zod validation, canonical normalization, COUNT/VOID orchestration, per-source locks and pending resolution. `processEvents` is shared by REST and MQTT; routes contain no SQL.
- `modules/ack`: durable ACK service and its repository.
- `modules/state`: repository queries for summary, pending and exceptions.
- `modules/mqtt`: challenge validation/replay service, durable response repository and transport worker.
- `modules/audit`: immutable submission attempt repository. A submitted item always gets an attempt, including invalid records without an event row.
- `shared/db`: connection pool, bounded transaction retry and ordered migrations with an advisory migration lock.
- `frontend`: React state, real API requests, source filters, six metric cards, review tables and MQTT metadata. No production total is hardcoded.

```mermaid
erDiagram
  production_sources ||--o{ production_events : owns
  production_events ||--o{ submission_attempts : records
  production_events o|--o| production_events : reverses
  mqtt_challenges ||--o{ mqtt_challenge_history : logical_identity
```

Sources have a string primary key. Events have an internal bigint key and UNIQUE(source_id,event_id); original JSON, normalized JSON, event time, receipt time, current status/failure, reversal links and ACK time/actor are retained. A VOID's applied_target_id links to its COUNT; the COUNT stores reversed_by. A partial unique index permits only one applied VOID per COUNT. Attempts retain recorded source, supplied identity, optional event link, transport, challenge ID, original/normalized payload and outcome. Challenges own `(candidate_id,challenge_id)`, canonical body, SHA256 digest and serialized original response. Additional history rows capture every challenge arrival/error/conflict/replay and form the publication outbox. The challenge/history relationship is logical, rather than a foreign key, because malformed challenges may have no valid identity.

## Transaction and identity strategy

For a batch, validation is performed per item, then all valid production sources are inserted/locked in sorted order. The entire event loop and attempt inserts execute in one PostgreSQL transaction. Row locks serialize changes within a source; composite uniqueness guards event identity, while a unique applied-target index guards reversals. Unexpected SQL errors roll back valid effects and audit writes together. Only PostgreSQL 40001/40P01 are retried, at most two retries after the first attempt. All value-bearing SQL is parameterized.

Canonical comparison sorts object keys and uses a fixed normalized schema: IDs trimmed; omitted optionals become null; event timestamps normalize to UTC milliseconds. Unknown event fields are preserved in original payload but ignored for normalized business identity. COUNT quantity is limited to PostgreSQL's positive 32-bit integer range. The same scoped ID and normalized data is DUPLICATE regardless of its current stored business status; changed data is CONFLICT and leaves the original intact.

ACK locks requested IDs in sorted order before processing them in caller order. Repeated IDs see the committed-in-transaction ACK and return ALREADY_ACKED. Missing IDs are NOT_FOUND; unresolved/rejected events are NOT_READY. Completed VOID records are eligible, though usually already auto-ACKED. Reversal never checks ACK, preserving correction eligibility.

The brief conflicts between global event identity and a composite database constraint. Composite identity is authoritative. An unqualified ACK with more than one matching source returns NOT_READY and explicitly requests `source_id`; the optional source-qualified extension and dashboard grouping remove ambiguity. Sources are filtered using stored events/attempt sources. Invalid source-less attempts are shown only without a source filter.

## Pending VOID resolution

A VOID without a target is stored PENDING_REFERENCE, excluded from totals and ACK eligibility. Arrival of a COUNT queries waiting references in internal identity order while holding the source lock. The earliest stored pending VOID is applied and auto-ACKED; other waiting VOIDs are marked REJECTED with reasons. The original pending submission attempts remain immutable, while event rows expose final resolution status. Future VOIDs targeting a reversed COUNT are REJECTED. References to an ID that later proves to be a VOID are rejected. Self-reference is rejected immediately.

`net_total` sums accepted COUNT quantities whose reversed_by is null. `processed_events` counts completed events, including reversed COUNTs and their applied VOIDs. `pending_ack` counts completed rows lacking ACK; `unresolved` counts pending rows; duplicates/conflicts count attempts. A reversed COUNT remains eligible for supervisor review and ACK. Summary uses one SQL statement and a single PostgreSQL statement snapshot; no memory counters are used.

## MQTT replay, retry and restart

The service takes a transaction advisory lock keyed by candidate/challenge identity before looking up the original response. Identical canonical challenge bodies return the stored original JSON; changed bodies produce durable conflict history. For a fresh valid challenge, shared event processing, the six-field summary, original response and history/outbox record commit together. Broker publication happens afterward. Therefore a crash before commit has no business effects; a crash after commit republishes committed response data on restart. A crash after PUBACK but before marking publication can cause duplicate responses, but never duplicate production effects. Exactly-once transport delivery is not claimed.

Every challenge response, including identity-less validation failures and conflict responses, has durable history/outbox tracking. The worker serializes its asynchronous transport work, awaits QoS1 PUBACK with a timeout, records publication failures, and flushes unpublished responses after reconnect and during heartbeats. It uses MQTT 3.1.1, clean sessions, 1–30 second exponential reconnect backoff and resubscription. The persisted last challenge survives process restart; live connection state honestly resets to disconnected/disabled. No candidate ID is embedded in application code.

The original response state is a database snapshot at processing time. A replay intentionally returns that same snapshot even when later production changes exist. Replay precedes expiration checks. Internal processing failures are rolled back and durable FAILED / INTERNAL_ERROR history is recorded in a separate transaction; they are not cached as successful original challenges, so a retry may process after the underlying failure is repaired. If PostgreSQL itself is unavailable, durable recording cannot succeed; reconnect/retry requires restored storage.

## Contradictions and assumptions

- Batch validation is per-record as required by the detailed contract: valid siblings commit, invalid siblings receive durable REJECTED attempts. Unexpected transaction errors roll back the batch. A top-level object with missing fields remains an interpretable event request and gets an individual rejection; scalar/null top levels are HTTP 400.
- Results reflect each item's processing instant, in input order. A pending VOID earlier in the same batch may return PENDING_REFERENCE even when a later COUNT resolves it before commit; `/api/state` reports its final status.
- Completed VOID counts as processed and automatically acknowledged. Reversed COUNT retains its ACK workflow. Thus one corrected COUNT can produce net zero, processed two, pending ACK one.
- The challenge expiration field is `expires_at`; it is optional in the supplied contract, validated/enforced when present. No unsigned issued_at/TTL convention was invented.
- The six domain indicators live under `summary` in REST and under `state` in MQTT. Extra MQTT metadata sits outside the six indicators.
- Event identity strings are trimmed and bounded to 200 characters; candidates are restricted to topic-safe letters/numbers/underscore/hyphen.
- Rejected structurally valid VOID events reserve their scoped event ID. Reusing it with different normalized data is CONFLICT. Structurally invalid submissions do not create/reserve event rows.

## Limits and future separation

This local assessment lacks auth, CSRF/session design, TLS termination, rate limits, pagination, retention and monitoring. The supplied plain MQTT broker carries synthetic assessment data. The HTTP listener binds to loopback. Browser fonts have system fallbacks if Google Fonts is unavailable. Large bigint aggregates are returned as JavaScript numbers; deployments exceeding Number.MAX_SAFE_INTEGER should switch to a string/decimal wire contract. Lists are unpaginated and JSON bodies are limited to 1 MB. Heartbeats publish independently of the processing queue at a 25-second interval; network outages can prevent delivery. Only one MQTT worker per candidate should run; multi-instance leader election/leased outbox claiming is future work. Cross-source summaries can include concurrent committed changes from other sources at the query's snapshot.

Modules have repository/service boundaries rather than independent databases. Future migration should first define versioned event/ACK/query contracts, move MQTT ingestion behind a durable queue, retain the transactional event owner, and add an outbox for emitted domain events. Then move audit/reporting into consumers with idempotent inboxes and explicit consistency guarantees. Do not split COUNT and VOID across independently updated stores: target resolution and reversal uniqueness need one authoritative transaction owner.

Reference API behavior was checked against the official [MQTT.js documentation](https://github.com/mqttjs/MQTT.js) and [Vitest guide](https://vitest.dev/guide/); installed versions are pinned by `package-lock.json`. Actual verification is recorded separately.
