# Final submission readiness audit

Audit date: **9 October 2026, Asia/Dhaka**. Application revision inspected: `d21e3070c50a934510ac129907979577210aad79`, plus the minimal configuration hygiene correction described below. No application modules were rewritten.

## Scope and status definitions

The reference is the complete assessment request supplied in `Pasted text.txt` and the user's final-audit instructions. The original CSI Smart Tech assessment PDF, separate marking rubric, required screenshot list and submission portal instructions were not supplied for this audit. Exact compliance with additional requirements in those unavailable documents is **UNVERIFIED**. No examiner grade or fabricated conversation record is asserted.

**PASS** means source and appropriate current execution evidence support the requirement. **PARTIAL** means implemented with a documented limitation or incomplete execution coverage. **FAIL** means an inspected delivery item is absent. **UNVERIFIED** means the necessary external evidence is unavailable. Test references T1–T16 below are actual test names, not invented scenarios.

## A. Requirement-by-requirement assessment

| Requirement                                                                      | Result     | Evidence and qualification                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, Node, Express, Zod, pg, MQTT.js, React/Vite, Vitest                  | PASS       | `package.json`, lockfile, successful current type checks, build and Vitest run.                                                                                                                                                                                                                                                              |
| One modular monolith and one production PostgreSQL database                      | PASS       | `backend/server.ts`, `backend/app.ts`, module directories, `shared/db/index.ts`; separate `_test` database is used only for verification.                                                                                                                                                                                                    |
| Thin REST handlers; SQL in repositories; shared REST/MQTT business service       | PASS       | `backend/app.ts` invokes `processEvents`; `mqtt/service.ts:handleChallenge` invokes the same function with its transaction client. SQL is in repositories and shared database/migration utilities.                                                                                                                                           |
| Four required tables, migrations and durable event/attempt/challenge fields      | PASS       | `001_initial.sql` creates production_sources, production_events, submission_attempts, mqtt_challenges and history. `002_response_outbox.sql` adds durable publication tracking. Both are recorded in production `schema_migrations`.                                                                                                         |
| Composite event uniqueness and prevention of double reversal                     | PASS       | Actual PostgreSQL constraints include `UNIQUE(source_id,event_id)` and unique partial index `one_void_per_count`; `events/repository.ts:lockSources`, `applyVoid`; T10.                                                                                                                                                                      |
| Valid COUNT/VOID schema and original event/receipt time                          | PASS       | `events/schema.ts:eventSchema`, `normalize`; original JSON retained, timestamp stored separately from received_at. COUNT positive integer; mutually exclusive quantity/target rules; timezone timestamp required. IDs are trimmed/max 200; quantity max 32-bit signed integer, documented.                                                   |
| COUNT increases total once                                                       | PASS       | T1, T2, T10; `state/repository.ts:summary` sums unreversed accepted COUNT rows.                                                                                                                                                                                                                                                              |
| Identical duplicate, stable normalized comparison and durable attempt            | PASS       | `canonical`, `processEvents`, `audit/repository.ts:recordAttempt`; T2 asserts reordered fields, optional null and equivalent timezone do not double count.                                                                                                                                                                                   |
| Changed scoped data gives CONFLICT and preserves original                        | PASS       | `processEvents` checks prior normalized payload without overwriting it; T7 and T11.                                                                                                                                                                                                                                                          |
| Same-source VOID reverses exactly one COUNT                                      | PASS       | `findEvent` includes source; `applyVoid` links both records; T3, T8, T9, T10. Cross-source matching cannot occur through this service.                                                                                                                                                                                                       |
| VOID-before-COUNT stored pending and resolved automatically                      | PASS       | `pendingVoids` ordered by internal ID; resolution inside `processEvents` transaction; T3.                                                                                                                                                                                                                                                    |
| Earliest competing pending VOID wins; already reversed COUNT rejected            | PASS       | T8 and T10; later waiting VOIDs gain REJECTED/failure_reason, unique target index provides another guard.                                                                                                                                                                                                                                    |
| Ordered batch outcomes; valid siblings commit; unexpected failures roll back     | PASS       | Input-order loop, per-item validation and one transaction; T6 and T13. A pending result describes that item's processing instant, even if a later item resolves it before commit.                                                                                                                                                            |
| Deterministic source locking, bounded deadlock/serialization retry               | PASS       | `lockSources` sorts distinct sources; `shared/db/index.ts:transaction` retries 40001/40P01 twice after the first attempt. Concurrent duplicate/reversal and challenge execution exercised by T10/T11. Forced retry exhaustion itself is not tested.                                                                                          |
| Persist every submitted item's attempt, including invalid records                | PASS       | `recordAttempt` executes for every item; duplicate/conflict/pending/rejected outcomes stored. Invalid records need not create event rows. T2/T6/T7/T14 and production attempt queries.                                                                                                                                                       |
| Completed VOID auto-ACK; COUNT correction allowed after ACK                      | PASS       | `applyVoid` writes factory-auto ACK; T3 and T4. Reversed COUNT remains eligible for supervisor ACK.                                                                                                                                                                                                                                          |
| POST /api/events: object/array, exact five statuses, ordered results             | PASS       | `backend/app.ts` and `Outcome` union; T1/T6/T7/T8. HTTP 200 for interpretable object/array including per-item rejection; scalar and malformed JSON tested as 400. Valid outcomes include extra source_id, without changing required fields.                                                                                                  |
| GET /api/state: exactly six PostgreSQL-backed summary indicators                 | PASS       | `state/repository.ts:summary` has six SQL aliases; T1 asserts the exact object. REST shape is `{summary:{...},mqtt:{...}}`; MQTT shape is `{state:{...}}`, documented. No memory production counters.                                                                                                                                        |
| Pending rows, exceptions, useful reasons and source filtering                    | PASS       | `pending` selects accepted/unacknowledged rows; `exceptions` includes unresolved/rejected events and rejected/conflict attempts. T6/T14/T15 and browser checks. Structurally valid rejected submissions may appear as an event and an attempt, distinguished by `kind`; they are not deduplicated display rows.                              |
| POST /api/ack: exactly four statuses and one result per requested ID             | PASS       | `ack/service.ts:acknowledge` returns ACKED, ALREADY_ACKED, NOT_READY, NOT_FOUND in request order. T4/T8/T9/T15. Repeated IDs in one request and later requests tested.                                                                                                                                                                       |
| ACK durable, safe for ambiguity; unresolved/rejected cannot ACK                  | PASS       | Event row locks and durable timestamp/actor; no deletes. Ambiguous unqualified IDs return NOT_READY; optional source_id qualifies them. T4/T8/T9/T15.                                                                                                                                                                                        |
| Candidate 18 comes from environment; correct broker/client/topic paths           | PASS       | Ignored `.env` has CANDIDATE_ID=18 and supplied broker URL; live API reports candidate 18 connected. Worker uses `fse01-${candidate}-${random suffix}` and `fse-01/18/challenge`, `/response`, `/status`. No assigned candidate constant in application source.                                                                              |
| MQTT 3.1.1, QoS1, retain false, response correlation                             | PASS       | `mqtt/worker.ts` protocolVersion 4; subscription/publication QoS1; will/publications retain false. `handleChallenge` echoes challenge ID. Local real-broker check passed; existing production response history proves the live empty-batch response and replay.                                                                              |
| Protocol/candidate/ID/command/array/expiry validation                            | PARTIAL    | Zod validates all listed fields; T12 executes unsupported protocol, candidate mismatch, expiration and invalid array. `expires_at` is optional because the supplied brief does not require its presence; compatibility with any other examiner expiry field is unverified. Individual event rejection yields COMPLETED, tested.              |
| FAILED error codes and durable failures                                          | PARTIAL    | T11/T12/T16 exercise CHALLENGE_CONFLICT, UNSUPPORTED_PROTOCOL, CANDIDATE_MISMATCH, CHALLENGE_EXPIRED, VALIDATION_ERROR and durable outbox failure retry. Worker implements INTERNAL_ERROR with rollback/history; that exact transport branch was not deliberately forced in this audit.                                                      |
| Original persisted replay; changed challenge conflict; response before publish   | PASS       | Challenge advisory lock, canonical body/digest, serialized original response and event effects commit together; T5/T11/T16. Real local process restart/outbox check passed.                                                                                                                                                                  |
| ONLINE, OFFLINE will, HEARTBEAT within 30 seconds                                | PASS       | ONLINE after SUBACK; OFFLINE will and graceful status; independent 25-second heartbeat. Existing real Mosquitto check rerun and passed all three statuses. Live packet cadence was not independently measured in this audit.                                                                                                                 |
| Reconnect/backoff/resubscribe and restart recovery                               | PARTIAL    | Source implements 1–30 second backoff, subscription on connect and outbox flush; local test proves process restart and committed outbox recovery. It does not force a network outage in a still-running MQTT worker; that precise reconnect path remains untested dynamically.                                                               |
| Successful live NONEMPTY PROCESS_EVENTS challenge                                | UNVERIFIED | **No successful live nonempty challenge is evidenced.** Production has one COMPLETED VERIFY challenge with events length 0, two published replay history rows and zero MQTT event attempts. Local Mosquitto processes real nonempty COUNTs; that is not examiner-broker evidence.                                                            |
| Honest disabled/disconnected MQTT behavior and persisted diagnostics             | PASS       | `startMqtt` allows blank candidate; T1 observes disabled metadata. Production API and screenshot show candidate, connection, persisted challenge ID/time/status/count and error fields. Connection state is runtime; challenge metadata is database-backed.                                                                                  |
| Responsive React UI uses actual API/database data                                | PASS       | `frontend/src/main.tsx:api`, `refresh`, `submit`, `ack`; no hardcoded metric totals. Existing Chrome tests passed desktop 1440px/mobile 390px, including page-width check, validation, submissions, metrics, exceptions and ACK.                                                                                                             |
| Select one/multiple COUNTs, refresh state, loading/success/empty/error flows     | PASS       | Existing browser checks verify single ACK; additional audit browser check verifies Select all/two real ACKs. Deliberately aborted state requests produce a visible network alert and recovery after restoration. No application code changed for these checks.                                                                               |
| At least five real PostgreSQL automated tests in separate database               | PASS       | Sixteen current Vitest tests pass; T1–T5 cover all five mandatory cases. `tests/setup.ts` rejects missing/non-test/same URL configuration; no in-memory database replacement.                                                                                                                                                                |
| Required root commands and production frontend serving                           | PASS       | package scripts plus fresh npm test, typecheck, build and repeat migration; existing dev startup evidence in VERIFICATION.md; current Express serves built frontend used by browser checks. Docker PostgreSQL is healthy.                                                                                                                    |
| README / TECHNICAL_EXPLANATION / AI_USAGE / configuration / demos                | PASS       | All present and inspected. Setup/REST/MQTT examples, module/entity ownership, locks, pending/replay behavior, future separation, contradictions and AI disclosure are covered. Current README now documents password placeholders and existing-volume caveat.                                                                                |
| Real AI conversation record attached                                             | FAIL       | No real conversation export is present. AI_USAGE.md gives attachment instructions. No fabricated transcript was created. This is a candidate handoff item.                                                                                                                                                                                   |
| At least three meaningful Git progress commits                                   | PASS       | 29be89d business/database layer; 6d3c4fc MQTT/tests; d21e307 dashboard/docs. Audit/config correction is saved separately.                                                                                                                                                                                                                    |
| Remote repository and actually pushed commits                                    | FAIL       | `git remote -v`, remote.origin.url and refs/remotes are empty; branch had no upstream. No remote URL was supplied and no push is claimed. Local source ZIP is available; a repository-link submission still requires remote setup and push.                                                                                                  |
| Screenshots and source ZIP                                                       | PARTIAL    | Three actual screenshots are packaged: desktop, mobile and two-ACK/MQTT diagnostics. Source ZIP contains tracked source/audit plus those screenshots. A specific examiner screenshot list is unavailable, so completeness against that list cannot be certified.                                                                             |
| No .env, dependencies, dumps, caches or personal assessment files in deliverable | PASS       | ZIP built from Git source allowlist plus three selected PNGs, not a recursive workspace ZIP. Entry check excludes .env (allows .env.example), .git, node_modules, dist, caches, database dumps and PDFs. init/migration SQL are source scripts, not dumps.                                                                                   |
| No working credentials in current source ZIP / all Git history                   | PARTIAL    | Fixed local password removed from current Compose/template; ignored .env preserves local operation. Earlier commits still contain the known disposable development credential. No token/private key/examiner account secret was found in inspected tracked files. History was not rewritten; do not claim it contains no credential strings. |

## B. Specific source and test evidence

Key source locations:

- [Event schema](backend/modules/events/schema.ts): `eventSchema`, `normalize`, `canonical`.
- [Event service](backend/modules/events/service.ts): `processEvents` starts at line 10; source locks precede input-order processing; audit insert occurs before each result is appended.
- [Event repository](backend/modules/events/repository.ts): `lockSources` line 11, `applyVoid` line 61, `pendingVoids` line 77.
- [Database transactions](backend/shared/db/index.ts): `transaction` line 11; BEGIN/COMMIT/ROLLBACK and bounded retry.
- [ACK service](backend/modules/ack/service.ts): `acknowledge` line 3; sorted lock acquisition and requested result order.
- [State repository](backend/modules/state/repository.ts): `summary` line 2, `pending`, `exceptions` line 35.
- [MQTT service](backend/modules/mqtt/service.ts): `handleChallenge` line 24, shared processing line 82, `recordChallengeFailure` line 103.
- [MQTT repository](backend/modules/mqtt/repository.ts): `lockChallenge`, `saveChallenge`, `history`, `markPublished`, `unpublished`, `metadata`.
- [MQTT worker](backend/modules/mqtt/worker.ts): `mqttMetadata` line 9, `startMqtt` line 18; publish callbacks, serial response queue, reconnect and independent heartbeat.
- [REST handlers](backend/app.ts), [migrations](backend/shared/db/migrations/001_initial.sql), [outbox migration](backend/shared/db/migrations/002_response_outbox.sql).
- [Dashboard](frontend/src/main.tsx): `api` line 35, `submit` line 121, `ack` line 142, fetched metric values line 245.

All T references are in [tests/integration.test.ts](tests/integration.test.ts), and all sixteen passed in this audit:

1. T1 — `new COUNT increases real database total and exposes exactly six indicators`
2. T2 — `identical COUNT with reordered keys/optional nulls/timezone never double counts`
3. T3 — `VOID before COUNT resolves automatically; VOID auto ACK and COUNT pending supervisor`
4. T4 — `repeated ACK including repeated IDs is durable and idempotent`
5. T5 — `replayed MQTT challenge returns persisted ORIGINAL response and no repeated attempts`
6. T6 — `mixed invalid batch commits valid siblings in order and audits invalid records`
7. T7 — `changed payload conflicts and original data remains`
8. T8 — `earliest competing pending VOID wins and later VOID is rejected`
9. T9 — `composite IDs allow different sources; ambiguous ACK refuses to choose`
10. T10 — `concurrent duplicates and reversals apply one effect only`
11. T11 — `concurrent MQTT replay serializes on challenge and rejects changed body`
12. T12 — `challenge validation failures are durable and individual invalid events still COMPLETE`
13. T13 — `unexpected enclosing transaction failure rolls back event and audit together`
14. T14 — `invalid source-less attempts are excluded from source filters`
15. T15 — `missing references cannot ACK and references to VOID are rejected on arrival`
16. T16 — `FAILED responses and conflicts are durable outbox entries, retryable after publish error`

[browser-tests/dashboard.spec.ts](browser-tests/dashboard.spec.ts) ran `dashboard submits mixed JSON, reviews exceptions and ACKs a COUNT` in both configured viewports. [scripts/mqtt-local.ts](scripts/mqtt-local.ts) used real Mosquitto, real backend processes and the PostgreSQL test database. The additional ignored `.local/audit-ui.mjs` checked network alert/recovery and multiple ACKs against the actual application; it is audit tooling, not a new product feature.

## C. Critical blockers and minimal correction

**No unresolved application correctness blocker was reproduced.** All required core test cases pass. No optional features, refactors or architecture changes were made.

The confirmed distributable-source hygiene issue was the fixed local database password. The only implementation/configuration edits are:

1. Compose now reads POSTGRES_PASSWORD from ignored `.env` and fails clearly if missing.
2. `.env.example` contains password placeholders, not the working value.
3. README explains replacement/URL encoding and existing-volume password behavior.

`docker compose config --quiet`, `pg_isready` and repeated `npm run db:migrate` passed after that change. Application source, tests and migration SQL are unchanged. Old Git commits retain the disposable credential; this is disclosed rather than hidden by risky history rewriting.

Outstanding delivery/evidence items are the real AI conversation export, a remote/push if a repository URL is required, and successful live nonempty examiner-broker verification. The unavailable official screenshot/rubric requirements must also be checked by the candidate. If the examiner makes any of these a mandatory submission gate, that gate remains outstanding; local test success does not waive it.

## D. Actual current execution results

| Command/check executed during this audit                                   | Observed result                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                 | Exit 0; 1 test file, **16 passed**, duration 6.67s; real PostgreSQL `_test` database.                                                                                                                                              |
| `npm run typecheck`                                                        | Exit 0; backend and frontend TypeScript checks passed.                                                                                                                                                                             |
| `npm run build`                                                            | Exit 0; tsc and Vite 6.4.4; 28 modules transformed; Vite build 3.88s.                                                                                                                                                              |
| `npm audit`                                                                | Zero reported vulnerabilities. This is a dependency advisory check, not a full security proof.                                                                                                                                     |
| `npm run test:browser`                                                     | Exit 0; **2 passed**, desktop/mobile; duration 27.4s. Screenshots refreshed.                                                                                                                                                       |
| `npm run demo`                                                             | Passed pending VOID, resolution, duplicate, source-filtered summary and ordered repeated/auto ACK assertions.                                                                                                                      |
| `docker compose --profile mqtt-test up -d mqtt-test` + `npm run test:mqtt` | Passed real local QoS1, ONLINE, HEARTBEAT, OFFLINE will, repeated response, process restart, conflict and persisted outbox recovery. Temporary test broker stopped afterward.                                                      |
| `node .local/audit-ui.mjs`                                                 | Visible network-failure alert, recovery and two-event Select all/ACK passed; extra screenshot captured. Only state requests were intentionally aborted for the network-error check.                                                |
| `npm run db:migrate`                                                       | Repeated migrations succeeded; both expected migrations present in production.                                                                                                                                                     |
| `docker compose config --quiet`; PostgreSQL `pg_isready`                   | Passed after configuration hygiene correction; PostgreSQL accepting connections.                                                                                                                                                   |
| Actual PostgreSQL constraint/index query                                   | Composite unique, positive/type shape checks, ACK readiness check, foreign keys and one_void_per_count index present.                                                                                                              |
| Production live MQTT evidence query                                        | Candidate 18: one COMPLETED challenge `VERIFY-1791529985300-6d4700`, **events length 0**, published_at populated, publish_attempts 2; two published history responses. **Nonempty completed count 0; MQTT submission attempts 0.** |
| Git remote/upstream inspection                                             | No remote, no upstream, no remote-tracking refs; no evidence of any push.                                                                                                                                                          |
| Source ZIP entry check                                                     | Source allowlist plus three selected screenshots; excluded runtime/dependency/personal files; SHA256 companion generated.                                                                                                          |

No new challenge was published to the live examiner broker during this audit. The live empty-batch evidence comes from existing persisted records and the earlier live smoke execution. The earlier implementation received an examiner-origin challenge before the SQL history fix and rolled its transaction back; successful processing of that scenario was not established.

## E. Precise demonstration steps

### 1. Start from a clean source checkout/ZIP

```powershell
npm install
Copy-Item .env.example .env
# Edit .env: set the same local password in POSTGRES_PASSWORD and both URLs.
# Set CANDIDATE_ID=18 only for the examiner-assigned live broker workflow.
docker compose up -d
docker compose ps
npm run db:migrate
npm test
npm run build
npm start
```

Open `http://127.0.0.1:3100`. For development use `npm run dev` instead of npm start and open port 5173. Stop an existing backend before starting another. Use a fresh source ID for each manual demonstration; global summaries include earlier demo/user records. Never truncate production to make a screenshot look clean.

### 2. Demonstrate all five event statuses, pending resolution and competing VOIDs

Save this JSON as `demo-batch.json`, replacing `audit-demo-NEW` with a source that has never been used:

```json
[
  {
    "source_id": "audit-demo-NEW",
    "event_id": "A",
    "type": "COUNT",
    "quantity": 12,
    "event_time": "2026-10-09T08:00:00+06:00"
  },
  {
    "source_id": "audit-demo-NEW",
    "event_id": "A",
    "type": "COUNT",
    "quantity": 12,
    "event_time": "2026-10-09T08:00:00+06:00"
  },
  {
    "source_id": "audit-demo-NEW",
    "event_id": "A",
    "type": "COUNT",
    "quantity": 13,
    "event_time": "2026-10-09T08:00:00+06:00"
  },
  {
    "source_id": "audit-demo-NEW",
    "event_id": "V1",
    "type": "VOID",
    "target_event_id": "B",
    "event_time": "2026-10-09T08:01:00+06:00"
  },
  {
    "source_id": "audit-demo-NEW",
    "event_id": "V2",
    "type": "VOID",
    "target_event_id": "B",
    "event_time": "2026-10-09T08:02:00+06:00"
  },
  {
    "source_id": "audit-demo-NEW",
    "event_id": "B",
    "type": "COUNT",
    "quantity": 7,
    "event_time": "2026-10-09T08:03:00+06:00"
  },
  {
    "source_id": "audit-demo-NEW",
    "event_id": "VA",
    "type": "VOID",
    "target_event_id": "A",
    "event_time": "2026-10-09T08:04:00+06:00"
  },
  {
    "source_id": "audit-demo-NEW",
    "event_id": "BAD",
    "type": "COUNT",
    "quantity": 0,
    "event_time": "2026-10-09T08:05:00+06:00"
  }
]
```

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/events -ContentType application/json -Body (Get-Content demo-batch.json -Raw)
Invoke-RestMethod 'http://127.0.0.1:3100/api/state?source_id=audit-demo-NEW'
Invoke-RestMethod 'http://127.0.0.1:3100/api/state?view=pending&source_id=audit-demo-NEW'
Invoke-RestMethod 'http://127.0.0.1:3100/api/state?view=exceptions&source_id=audit-demo-NEW'
```

Expected ordered statuses: ACCEPTED, DUPLICATE, CONFLICT, PENDING_REFERENCE, PENDING_REFERENCE, ACCEPTED, ACCEPTED, REJECTED. Final source summary: net_total 0, processed_events 4, pending_ack 2, unresolved 0, duplicates 1, conflicts 1. V1 wins and is auto-ACKED; V2 is finally REJECTED. Pending contains COUNT A and B; exceptions expose conflict A, losing V2 and invalid BAD with reasons. The batch's earlier pending results remain the original per-item outcomes.

### 3. Demonstrate the four ACK statuses

```powershell
$body = @{ source_id='audit-demo-NEW'; event_ids=@('A','A','V1','V2','missing') } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/ack -ContentType application/json -Body $body
```

Expected order: ACKED, ALREADY_ACKED, ALREADY_ACKED, NOT_READY, NOT_FOUND. B remains awaiting ACK. In the dashboard filter to the same source and ACK B. To demonstrate multiple selection, use another fresh source with the batch above and select both pending COUNTs before making the manual ACK request; Select all COUNTs → ACK selected (2). This exact two-event UI action was verified separately during the audit.

For an unresolved reference, submit a fresh VOID targeting a missing COUNT; state.unresolved increases and ACK returns NOT_READY. For correction-after-ACK, submit a fresh COUNT, ACK it, then submit a VOID targeting it; its contribution is removed. These are also covered by T3/T4/T15. `npm run demo` is the shortest reproducible script for pending/resolution/duplicate/ACK evidence.

### 4. Distinguish local MQTT tests from live verification

For independently reproducible local nonempty MQTT behavior:

```powershell
docker compose --profile mqtt-test up -d mqtt-test
npm run test:mqtt
docker compose --profile mqtt-test stop mqtt-test
```

For the assigned live broker, keep the backend running with environment candidate 18. Subscribe with QoS1 to `fse-01/18/response` and `fse-01/18/status`. The challenge topic is `fse-01/18/challenge`, broker `mqtt://152.42.238.142:1883`. ONLINE/HEARTBEAT/OFFLINE are status messages. A nonempty sample to publish with QoS1 and retain false is:

```json
{
  "protocol_version": "1.0",
  "candidate_id": "18",
  "challenge_id": "CSI-DEMO-REPLACE-WITH-UNIQUE-ID",
  "command": "PROCESS_EVENTS",
  "expires_at": "2099-01-01T00:00:00Z",
  "events": [
    {
      "source_id": "mqtt-demo-NEW",
      "event_id": "MQ-C1",
      "type": "COUNT",
      "quantity": 5,
      "event_time": "2026-10-09T08:00:00+06:00"
    },
    {
      "source_id": "mqtt-demo-NEW",
      "event_id": "MQ-V1",
      "type": "VOID",
      "target_event_id": "MQ-C1",
      "event_time": "2026-10-09T08:01:00+06:00"
    }
  ]
}
```

Use a unique challenge/source and record the received COMPLETED response, matching challenge ID, two ordered ACCEPTED results and exact six state fields. Republish the identical JSON: timestamp/results/state must be the original persisted response, and event attempts must not increase. Changed body under the same challenge ID must give CHALLENGE_CONFLICT. This manual live demonstration is **a future action, not an audit result**; a self-published example is also not an examiner-issued scenario.

If Mosquitto CLI is not installed, the existing container image can publish the saved JSON from PowerShell:

```powershell
# Terminal 1: observe live response/status; stop with Ctrl+C.
docker compose --profile mqtt-test run --rm -T mqtt-test mosquitto_sub -h 152.42.238.142 -p 1883 -q 1 -i fse01-18-demosub1 -t fse-01/18/response -t fse-01/18/status -v
# Terminal 2: challenge-demo.json contains the nonempty sample above.
Get-Content challenge-demo.json -Raw | docker compose --profile mqtt-test run --rm -T mqtt-test mosquitto_pub -h 152.42.238.142 -p 1883 -q 1 -i fse01-18-demopub1 -t fse-01/18/challenge -s
```

Use a different short suffix if those demonstration client IDs are in use. Omitting mosquitto_pub's retain flag means retain false. The commands above were not executed against the examiner broker during this audit. `npm run mqtt:probe` checks connectivity/subscriptions only; `npm run test:mqtt:live` checks only a self-generated empty challenge, not nonempty production effects.

Verify durable live evidence without confusing it with local tests:

```powershell
docker compose exec -T postgres psql -U assessment -d production -c "SELECT candidate_id,challenge_id,status,jsonb_array_length(canonical_body::jsonb->'events') AS event_count,published_at FROM mqtt_challenges WHERE candidate_id='18';"
```

## F. Documentation and submission checklist

- [x] README, TECHNICAL_EXPLANATION, AI_USAGE, VERIFICATION and this final audit are present.
- [x] `.env.example`, `.gitignore`, Docker Compose, migration/init SQL, root scripts, source, lockfile, runnable tests and demos are present.
- [x] Three meaningful implementation commits exist locally; audit/hygiene changes are committed separately.
- [x] Current source ZIP uses password placeholders/environment references; `.env` is excluded.
- [x] Source ZIP prepared at `.local/submission/production-event-dashboard-source.zip`; companion `SHA256SUMS.txt` records its hash. ZIP is ignored and not committed.
- [x] Actual screenshots included in ZIP under `evidence/`: `dashboard-desktop.png`, `dashboard-mobile.png`, `dashboard-multi-ack-mqtt.png`. They show real database-backed data, validation/exception/ACK behavior, and connected candidate 18 with persisted COMPLETED empty-smoke diagnostics. They do not prove a live nonempty examiner challenge.
- [x] No dependency folder, builds, database data/dumps, logs, private environment, Git metadata or photographed assessment PDF in the ZIP. Source SQL scripts are intentionally included.
- [ ] Export/review/attach the **real** conversation record, as explained in AI_USAGE.md. It is not included or fabricated.
- [ ] If repository-link delivery is required, obtain the intended remote URL, add the remote and push the commits. No remote or push currently exists; do not claim otherwise.
- [ ] If required by the examiner, complete and retain evidence for a live **nonempty examiner-issued** challenge.
- [ ] Compare the packaged screenshots and artifacts to the original CSI submission checklist/portal, which was unavailable for this audit.

ZIP creation uses `git archive` from the audit commit and adds only the three verified evidence PNGs. It is not a ZIP of the entire workspace. Git history is omitted from the ZIP; if Git progress evidence is requested separately, provide the repository after the remote/push handoff and disclose its old disposable development credential. Do not include `.env` or Docker volumes to prove persistence.

## G. Final risk assessment and verdict

Confirmed: the application builds and runs; the required business rules and exact status sets are supported by real PostgreSQL tests; the dashboard uses actual API state, supports single/multiple ACK and error recovery; local real MQTT proves nonempty processing, response persistence and restart/outbox recovery; the live broker has evidence for an empty-batch response and original replay.

Unverified: successful nonempty processing on the examiner broker, examiner grading, exact additional PDF/rubric/screenshot requirements, pushed repository availability, and the specific running-worker network reconnect path. The AI conversation export is absent. These gaps are not silently upgraded to PASS by local test results.

Known implementation limits remain documented: one active MQTT worker per candidate, unpaginated tables, JavaScript aggregate precision above Number.MAX_SAFE_INTEGER, optional expires_at assumption, and no authentication/TLS termination/rate limiting for a public deployment. Validation alerts can be cleared by a later successful periodic refresh, and the UI retains prior state with an error banner during network failure. Neither is a core assessment blocker. Current working credentials are excluded from the source artifact; earlier local Git history still contains the disposable original default.

No optional improvement should delay the available source submission. Complete the explicit candidate handoff items according to the actual examiner delivery rules.

**READY WITH KNOWN LIMITATIONS**
