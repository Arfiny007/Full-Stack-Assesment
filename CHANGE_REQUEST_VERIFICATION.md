# Official FSE-01 change request verification

Date: **9 October 2026, Asia/Dhaka**. Implemented in the existing repository and modular monolith; the project was not replaced. The submitted official change-request text is the reference for this report.

Feature commit: **`e0ea7a9088012055ae2d4375a14734d4eaa46122`**

Commit message: **`feat: enforce COUNT limit and add rejected submission metrics`**

This report is saved in a separate documentation commit so it can record the already-created feature commit hash. Both commits remain local. Existing user modifications to AI_USAGE.md and TECHNICAL_EXPLANATION.md were retained and their contract statements updated; unrelated files were not staged.

## Requirement assessment

| Requirement                                                                               | Result  | Actual evidence                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COUNT integer range 1–500 in shared Zod schema                                            | PASS    | eventSchema uses number/int/min(1)/max(500) with the COUNT-specific message. Seven boundary cases passed for 1, 450, 500, 501, 0, -1 and 1.5.                                                                                                                           |
| Clear rejection message, durable attempt/source, no accepted event effect                 | PASS    | Boundary tests assert REJECTED, recorded source/original JSON/reason, zero invalid production rows, zero net_total/processed_events, and an Exceptions attempt row.                                                                                                     |
| Mixed [COUNT 450, COUNT 501] preserves order and commits valid sibling                    | PASS    | Integration test and executed REST demo returned [ACCEPTED, REJECTED]. Demo source total 450 and rejected_submissions 1.                                                                                                                                                |
| Reuse existing structures without invalidating historical data                            | PASS    | No migration/constraint change; no production truncation, reset or deletion. Dedicated test fixture preserves an accepted historical COUNT 750.                                                                                                                         |
| Seventh PostgreSQL summary field with source filtering                                    | PASS    | summary adds a direct COUNT over submission_attempts.status='REJECTED' with the existing $1 source filter. No join or memory counter. Exact seven-field object assertions passed.                                                                                       |
| Count attempts, excluding DUPLICATE/CONFLICT/PENDING_REFERENCE                            | PASS    | Status-isolation test observes rejected_submissions 3 while one rejected event row exists and duplicate/conflict/pending each exist. Repeated invalid IDs count as separate attempts.                                                                                   |
| Include REST and MQTT rejected attempts                                                   | PASS    | Mixed MQTT test observes two rejections after one REST rejection and one MQTT rejection. Real local MQTT test queries persisted transport='MQTT'/status='REJECTED'.                                                                                                     |
| New valid challenges return seven-field state; invalid quantity remains overall COMPLETED | PASS    | Shared summary is called by unchanged handleChallenge. MQTT COUNT 501 test asserts COMPLETED, individual REJECTED, net_total/processed_events 0 and rejected_submissions 1; real local broker execution passed.                                                         |
| Historical responses replay exactly, including original six-field state                   | PASS    | Legacy replay fixture returns original accepted result/six-field response for COUNT 750, leaves serialized_response unchanged and creates no new attempts. Fresh challenge state has seven fields. Production historical responses still have six fields after restart. |
| Existing source filter reused across all metrics/Pending/Exceptions                       | PASS    | Browser checks compare all seven cards with actual source-filtered API values for two sources, including one containing reserved URL characters. Pending/Exceptions contain only the chosen source.                                                                     |
| Clear filter, active source, loading/empty/error handling, no stale ACK selection         | PASS    | Clear filter restores all-source data. applySource invalidates earlier responses and clears previous data/selections. Browser tests check source switching, disabled zero-selection ACK, empty results, transport error, recovery and stale-data protection.            |
| Seventh card uses backend numbers, distinct style, desktop/mobile readable                | PASS    | Rejected Submissions binds summary.rejected_submissions; numeric zero and changes asserted. Seven cards, distinct rejection styling, manual/10-second periodic refresh and no page horizontal overflow passed at 1440px/390px.                                          |
| Existing COUNT/VOID/duplicate/conflict/pending/concurrency/ACK behavior                   | PASS    | All original 16 PostgreSQL tests still pass, plus the existing browser submission/ACK cases. MQTT status, replay, conflict, restart and outbox check passed with the extension.                                                                                         |
| Required commands and local MQTT verification executed                                    | PASS    | Typecheck, 29 PostgreSQL tests, build, 4 browser tests, expanded demo and actual local Mosquitto tests completed successfully; results below.                                                                                                                           |
| Mandatory documentation and AI disclosure                                                 | PASS    | README, technical explanation, AI usage and verification updated; genuine records and independent human/examiner verification are not fabricated. Earlier audit is retained as a historical snapshot.                                                                   |
| Exact required Git commit in existing repository                                          | PASS    | Feature commit e0ea7a9088012055ae2d4375a14734d4eaa46122; explicit intended-file staging; no new repository initialized.                                                                                                                                                 |
| Public push / credential-history resolution                                               | PARTIAL | Remote exists, but this feature/report are not pushed. Historical disposable credential concern remains; no history rewrite was authorized or performed.                                                                                                                |
| New live examiner seven-field scenario                                                    | PARTIAL | New feature was tested via shared PostgreSQL service and real local Mosquitto, not a newly issued examiner challenge. A prior published production nonempty challenge exists, but it predates this change; origin is not independently proven by its database row.      |

## Exact modified files and owners

| File                                  | Change                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/modules/events/schema.ts`    | eventSchema COUNT quantity validator and shared quantityMessage. Both transports still use processEvents/normalize.                                                                                                   |
| `backend/modules/state/repository.ts` | summary SQL and result type add rejected_submissions; six existing SQL definitions untouched.                                                                                                                         |
| `frontend/src/main.tsx`               | Summary type, labels, metric rendering/data attributes and rejection description; applySource/reset safeguards; existing filter Apply and added Clear filter control.                                                 |
| `frontend/src/style.css`              | Seven-column desktop metric grid and distinct .metric.rejections styling; existing mobile breakpoints retained.                                                                                                       |
| `tests/integration.test.ts`           | Exact summary assertion updated to seven fields; 13 new executed cases for boundaries, persistence, batching, filtering/status isolation, MQTT and legacy replay.                                                     |
| `browser-tests/dashboard.spec.ts`     | Existing scenario now asserts seven cards/rejection count; new two-source/clear/selection/refresh/error scenario in both viewports. Delayed/aborted requests simulate transport behavior, never fake database values. |
| `playwright.config.ts`                | Default isolated test URL 3101 and managed test webServer; reuseExistingServer false. BROWSER_BASE_URL remains an explicit override.                                                                                  |
| `scripts/browser-server.ts`           | New test-only startup helper reuses tests/setup.ts dedicated-database guard, migrates the test database and starts the existing backend with MQTT disabled on 3101.                                                   |
| `scripts/demo.ts`                     | Existing demo gains mixed 450/501 and seven-field/rejected-count assertions.                                                                                                                                          |
| `scripts/mqtt-local.ts`               | Exact seven-field assertion and real broker COUNT 501 rejection/state/database assertions; previous status/replay/restart/outbox checks retained.                                                                     |
| `scripts/mqtt-live-smoke.ts`          | New unique empty-smoke challenge expects seven state keys. Script updated but not executed against the live broker for this change.                                                                                   |
| `README.md`                           | Current rule, seven-field contracts, filtered attempt semantics, historical replay, guarded browser/demo instructions and change-report reference.                                                                    |
| `TECHNICAL_EXPLANATION.md`            | Contract statements and change-request ownership/count/replay/filter explanation updated, preserving current user text. Clarifies missing target field versus pending missing COUNT.                                  |
| `AI_USAGE.md`                         | Appended actual Codex change/test/debug assistance, verification limits and genuine record attachment instructions, preserving the user's assistance description.                                                     |
| `VERIFICATION.md`                     | Original results retained; current change-request outputs and actual test environment appended.                                                                                                                       |
| `CHANGE_REQUEST_VERIFICATION.md`      | This final evidence/commit/limitations report.                                                                                                                                                                        |

**Unchanged application owners:** events/service.ts:processEvents, audit/repository.ts:recordAttempt, mqtt/service.ts:handleChallenge, backend/app.ts routes, ACK service/repository, MQTT worker/outbox and migration SQL. No duplicate MQTT quantity validator or new API was added.

## Test execution results

| Executed command                                                          | Observed result                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                       | Exit 0, backend/frontend TypeScript checks passed.                                                                                                                                                           |
| `npm test`                                                                | Exit 0, **29/29 PostgreSQL tests passed**, one file, duration 6.43s. Original 16 regressions plus 13 new cases.                                                                                              |
| `npm run build`                                                           | Exit 0, tsc and Vite 6.4.4 passed; 28 modules transformed; Vite build 2.77s.                                                                                                                                 |
| `npm run test:browser`                                                    | Exit 0 on corrected run, **4/4 Chrome tests passed**, desktop 1440px and mobile 390px; total 1.2m. Managed test server/database only.                                                                        |
| `npm run demo` with DEMO_URL=http://127.0.0.1:3101                        | Exit 0; original pending/correction/duplicate/ACK assertions and new 450/501/state assertions passed.                                                                                                        |
| `docker compose --profile mqtt-test up -d mqtt-test`; `npm run test:mqtt` | Exit 0; real local Mosquitto QoS1, ONLINE, HEARTBEAT, OFFLINE will, original replay, conflict, process restart, outbox recovery and new COUNT rejection/seven-field checks passed. Broker stopped afterward. |
| Production restart/read-only GET /api/state                               | Verified build serves on loopback 3100; API returns seven numeric summary fields; candidate 18 connected. No production event was submitted as a feature test.                                               |
| SQL queries in production_test                                            | Actual source/status/original quantity and separate source rejection counts observed; actual local MQTT response state has seven fields.                                                                     |
| `git diff --check` / intended diff review                                 | Passed; staged only the named feature/test/documentation files.                                                                                                                                              |

The first expanded browser run had 2 passes and 2 failures because the test removed a delayed request handler while it was still executing (`Route is already handled`). Waiting for handlers during unroute teardown fixed the test; the full rerun passed 4/4. This was a test-driver race, not an application regression hidden by changing expected values.

Vitest uses the existing production_test guard and truncates only dedicated test tables between cases. Browser testing defaults to the same dedicated database, port 3101 and blank candidate. The demo was explicitly pointed there. Local MQTT uses a generated local candidate and local broker with the test database. No production table/volume was reset, truncated or deleted.

## Actual COUNT and PostgreSQL evidence

The executed demo submitted a mixed batch for unique source **demo-1791535778083**:

```json
{
  "results": [
    {
      "event_id": "LIMIT-450",
      "source_id": "demo-1791535778083",
      "status": "ACCEPTED",
      "message": "Event processed"
    },
    {
      "event_id": "LIMIT-501",
      "status": "REJECTED",
      "message": "quantity: COUNT quantity must be an integer between 1 and 500."
    }
  ]
}
```

Direct SQL in production_test confirmed:

| Source             | Event ID  | Attempt status | Original quantity |
| ------------------ | --------- | -------------- | ----------------- |
| demo-1791535778083 | LIMIT-450 | ACCEPTED       | 450               |
| demo-1791535778083 | LIMIT-501 | REJECTED       | 501               |

The same source's summary after the earlier demo correction/ACK and new mixed batch was:

```json
{
  "net_total": 450,
  "processed_events": 3,
  "pending_ack": 1,
  "unresolved": 0,
  "duplicates": 1,
  "conflicts": 0,
  "rejected_submissions": 1
}
```

This includes real earlier demo events: COUNT/VOID contribute processed 2/net 0, followed by accepted COUNT 450, while COUNT 501 creates only an attempt. The simpler fresh-source integration case asserts net_total 450/processed_events 1/rejected_submissions 1. Boundary rejection cases assert net_total 0/processed_events 0/rejected_submissions 1 and no production event row.

The summary query is the direct parameterized aggregate:

```sql
(SELECT COUNT(*) FROM submission_attempts
 WHERE status='REJECTED'
 AND ($1::text IS NULL OR source_id=$1))::text AS rejected_submissions
```

It counts every matching REJECTED attempt from either transport, including repeated bad IDs. It neither joins production_events nor counts their final rejected statuses. A pending VOID that later loses competition does not create a REJECTED attempt merely because its event row becomes rejected; its original attempt remains pending. Existing six metrics preserve their definitions.

## Independent source-filter evidence

The integration case `two source filters count repeated rejected attempts independently; sourceless attempts only unfiltered` observes LINE-01 rejected_submissions 2, LINE-02 1, unfiltered 4 including one source-less rejection, and unused source 0. LINE-01 total 450/processed 1; LINE-02 total 0/processed 0. Pending/Exceptions filtering is also asserted.

The browser case compares **all seven** visible numbers to actual filtered API responses and verifies both Pending and Exceptions. It uses a second source containing `&?/#`, so encodeURIComponent handling is exercised. After manual/periodic refresh tests, direct SQL found these latest desktop sources:

| Source                             | Rejected attempts |
| ---------------------------------- | ----------------- |
| LINE-01-desktop-1791535591410      | 2                 |
| LINE-02 &?/#-desktop-1791535591410 | 3                 |

Their combined cohort is 5, while the overall test database also contains other test sources. Clearing the filter is asserted against the real unfiltered baseline plus the inserted data, not an invented zero/global total. Source changes immediately clear old metrics/rows/selections; delayed and failed fetch checks confirm old-source data is not mislabeled as new-source data.

Screenshots inspected after passing checks are in ignored `.local/change-request-desktop.png` and `.local/change-request-mobile.png`. They show seven readable cards and actual test-database counts; they are not examiner-broker screenshots.

## Seven-field MQTT and historical replay evidence

Integration case `MQTT COUNT 501 remains COMPLETED with seven-field state, durable rejection and exact replay` observes:

```json
{
  "status": "COMPLETED",
  "results": [
    {
      "event_id": "MQ-BAD",
      "status": "REJECTED",
      "message": "quantity: COUNT quantity must be an integer between 1 and 500."
    }
  ],
  "state": {
    "net_total": 0,
    "processed_events": 0,
    "pending_ack": 0,
    "unresolved": 0,
    "duplicates": 0,
    "conflicts": 0,
    "rejected_submissions": 1
  }
}
```

Repeated identical challenge returns the same response and leaves the attempt count at 1. The mixed MQTT case accepts 450, rejects 501, and counts both a prior REST rejection and the MQTT rejection. These service tests use real PostgreSQL; transport is separately exercised below.

The **real local Mosquitto** run persisted LOCAL-LIMIT-501 as COMPLETED, individual LOCAL-BAD REJECTED, with this actual global test-database state:

```json
{
  "net_total": 2417,
  "processed_events": 18,
  "pending_ack": 12,
  "unresolved": 0,
  "duplicates": 1,
  "conflicts": 0,
  "rejected_submissions": 22
}
```

Those nonzero values reflect all existing test records at its processing snapshot, not constants. The local candidate's valid COUNT quantity sum remained 35 (31+4 from prior restart/outbox checks) after 501 rejection; one MQTT rejection attempt was recorded for that candidate. The script verifies seven keys, compares the rejected count to SQL, and retains original status/replay/restart checks.

Historical compatibility test `historical six-field MQTT responses and COUNT above 500 stay intact during replay` seeds an old accepted COUNT 750 and six-field response. Replay returns that original response without revalidating its events, changing serialized_response or adding attempts. A fresh empty challenge receives seven fields while historical quantity/status remain 750/ACCEPTED. No migration is needed because the new rule applies to incoming validation, not a retroactive database constraint.

Read-only production inspection after restart also found these existing candidate-18 responses still at six fields:

| Challenge                   | Existing event count | Status    | Publication          | Stored response MD5 fingerprint  |
| --------------------------- | -------------------- | --------- | -------------------- | -------------------------------- |
| VERIFY-1791529985300-6d4700 | 0                    | COMPLETED | recorded, attempts 2 | 2dccf3a94b246b524c2abf09225d6297 |
| CH-18-d1124f338f            | 2                    | COMPLETED | recorded, attempts 1 | 702d90b41cec033b5cb7af16c8961184 |

The second record was processed at 2026-10-09T08:12:00Z, before this feature, with one ACCEPTED and one REJECTED MQTT attempt. This is newly observed persisted **prior nonempty production processing/publication** evidence, updating the older audit's empty-only snapshot. A database row alone does not prove examiner origin. It does not verify new seven-field live processing, and no new live challenge was intentionally published in this change-request run.

## Existing behavior regression coverage

All original 16 tests passed: COUNT totals, canonical duplicate/timezone normalization, pending resolution and factory ACK, repeated supervisor ACK, original challenge replay, mixed invalid batches, conflicts, competing VOIDs, scoped IDs/ACK ambiguity, concurrent duplicates/reversals, concurrent challenge replay, challenge validation, rollback, source-less exception filtering, non-COUNT targets and response outbox retries. The unchanged worker also passed real local ONLINE/HEARTBEAT/OFFLINE will, correlation, conflict, QoS1, restart and durable outbox checks. No new REST endpoint or duplicated processing rule was introduced.

## Git and delivery status

- Existing repository and history retained. Feature hash: **e0ea7a9088012055ae2d4375a14734d4eaa46122**, exact required message above.
- Remote origin: `https://github.com/Arfiny007/Full-Stack-Assesment.git`. Read-only `git ls-remote origin refs/heads/master` observed **1638205b0a8bfa548438eb00dc1d8fa003f193d1**, the pre-feature audit revision.
- Feature and this report are **local commits only**. No push command was executed; no successful push of this feature is asserted.
- Per the official security instruction, public push is deferred until the historical disposable-credential concern is safely resolved under a separately authorized workflow. No history rewrite was performed. The presence of an existing remote/base commit does not make a new public push safe.
- No `.env`, credential-bearing runtime configuration, dependencies, builds, test screenshots/caches or database dumps were staged. Current templates use placeholders/environment references; earlier Git history concern remains disclosed.
- The earlier source ZIP is a historical artifact and has not been regenerated for this feature. Prepare an updated source package before submitting this revision. Genuine ChatGPT/Codex exports must still be attached; no transcripts were fabricated.

## Honest limitations

All requested feature checks above passed. New live examiner-issued seven-field validation was not executed; local MQTT and prior production evidence are distinguished explicitly. Candidate/examiner independent execution/grade is not asserted. Existing assumptions such as optional expires_at, one active MQTT worker per candidate, unpaginated history and JavaScript aggregate precision remain unchanged. Direct SQL can store quantities above 500 because preserving the historical database constraints was deliberate; supported REST/MQTT ingress enforces the new range.

The final audit file retains its original historical observations; this report and the appended current verification sections describe the new contract. No optional architecture work or production-data deletion was used to make checks pass.
