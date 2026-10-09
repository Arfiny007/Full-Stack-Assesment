# Production Event Processing Dashboard

A TypeScript modular monolith with Express, PostgreSQL, Zod, MQTT.js and a responsive React dashboard. Production serves the Vite build from Express. Both transports call the same transactional event service.

## Prerequisites

- Node.js **22.12+** (verified with 24.11.0), npm, Git.
- Docker Desktop running with Linux containers and Docker Compose v2.
- Free loopback ports **55432** (PostgreSQL), **3100** (Express), **5173** (Vite), and **3101** (isolated browser verification).
- Internet for installation, container pulls, and the examiner's MQTT broker.
- Optional Google Chrome for browser checks; optional local Mosquitto container for MQTT transport checks.

## Install and start

Run from the repository root:

```sh
npm install
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` in a POSIX shell). Replace all three `REPLACE_WITH_LOCAL_PASSWORD` placeholders with the same local password; URL-encode it inside the connection URLs if it contains reserved URI characters. Compose reads `POSTGRES_PASSWORD` from ignored `.env`; no working password is supplied in the source template. Keep `CANDIDATE_ID` empty for local-only operation or set the examiner-assigned value for MQTT.

An existing PostgreSQL volume retains its role password: editing environment values does not change the password already stored in PostgreSQL. Keep the URLs consistent with that existing role, or change the role password explicitly before changing the URLs. Do not delete database volumes merely to change configuration.

```sh
docker compose up -d
docker compose ps
npm run db:migrate
npm run dev
```

Wait until PostgreSQL is healthy before migrating. Open **http://127.0.0.1:5173** for development. The backend is at **http://127.0.0.1:3100**. Compose initializes `production` and the separate `production_test` database on its first volume initialization; the test database remains separate from the application's one production database. If an existing volume lacks it:

```sh
docker compose exec -T postgres psql -U assessment -d production -c "CREATE DATABASE production_test;"
```

For production-style local serving:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3100**. Stop a previous backend before starting another on the same port. `PORT` overrides the backend port; update the proxy in `frontend/vite.config.ts` if changing it for development. For browser/demo commands use `BROWSER_BASE_URL` / `DEMO_URL` when changing ports. The server binds to loopback for local assessment use. `npm run db:migrate` is repeatable and records applied migrations. Native PostgreSQL also works: create the two databases and set both URLs before migrating.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run demo
```

`npm test` uses Vitest, real PostgreSQL and Supertest: COUNT totals, canonical duplicates, pending VOID resolution, repeated ACK, persisted challenge replay, mixed validation, conflicts, competing corrections, source ambiguity, concurrency, rollback, source filtering, rejected references and response outbox retries. It requires `TEST_DATABASE_URL` to point to a distinct database with a name ending `_test`; it truncates tables only in that dedicated database. Do not run database tests and the MQTT transport check concurrently.

`npm run demo` needs the running HTTP server. It asserts VOID-before-COUNT, duplicate safety, real source-filtered totals and repeated ACK; it leaves traceable records under a uniquely named `demo-*` source.

With Chrome installed, PostgreSQL available, TEST_DATABASE_URL configured, and the frontend built:

```sh
npm run test:browser
```

Playwright starts a guarded test server on loopback 3101 using TEST_DATABASE_URL and MQTT disabled; it refuses to reuse an existing server. Browser checks use real test PostgreSQL data, verify seven metrics, source filtering/clearing, manual/periodic refresh, stale-selection protection, validation, error recovery, ACK and page width at 1440px and 390px. Screenshots are written to ignored `.local/`. BROWSER_BASE_URL explicitly overrides server management; point overrides only at an isolated test database. Do not run Vitest truncation while browser or MQTT checks are active.

Optional isolated local MQTT verification:

```sh
docker compose --profile mqtt-test up -d mqtt-test
npm run test:mqtt
```

This uses Mosquitto on loopback port 18884, a generated local candidate and the dedicated test database. It starts/stops real backend processes, checks QoS1 responses, ONLINE, 25-second HEARTBEAT, OFFLINE will, replay after restart, conflicts and recovery of a committed unpublished response. It does not publish challenges to the examiner's broker. `TEST_MQTT_URL` can override the local broker URL.

## REST examples

PowerShell example:

```powershell
$count = @{source_id='line-demo'; event_id='EV-101'; type='COUNT'; quantity=12; event_time='2026-10-09T08:00:00+06:00'} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/events -ContentType application/json -Body $count
Invoke-RestMethod http://127.0.0.1:3100/api/state
$ack = @{event_ids=@('EV-101','EV-101'); source_id='line-demo'} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/ack -ContentType application/json -Body $ack
$void = @{source_id='line-demo'; event_id='EV-102'; type='VOID'; target_event_id='EV-101'; event_time='2026-10-09T08:01:00+06:00'} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/events -ContentType application/json -Body $void
```

Equivalent curl (use `curl.exe` on Windows):

```sh
curl -H 'Content-Type: application/json' --data-binary @scripts/example-count.json http://127.0.0.1:3100/api/events
curl 'http://127.0.0.1:3100/api/state?view=pending&source_id=line-demo'
curl 'http://127.0.0.1:3100/api/state?view=exceptions'
```

- `POST /api/events`: one JSON object or array; returns `{results:[...]}` in input order. HTTP 200 includes individual ACCEPTED, DUPLICATE, CONFLICT, PENDING_REFERENCE or REJECTED outcomes. An invalid top-level scalar/null or malformed JSON gets 400. An empty array is valid. Objects with invalid/missing event fields are individually REJECTED and audited. Maximum JSON body is 1 MB.
- `GET /api/state?view=summary|pending|exceptions&source_id=...`: default summary returns `{summary:{net_total,processed_events,pending_ack,unresolved,duplicates,conflicts,rejected_submissions},mqtt:{...}}`. Pending and exceptions return their corresponding array plus MQTT metadata. The seven indicators are queried from PostgreSQL in one statement.
- `POST /api/ack`: `{event_ids:["EV-101","EV-102"],source_id:"line-demo"}`. Optional `source_id` disambiguates composite IDs. Results use only ACKED, ALREADY_ACKED, NOT_READY, NOT_FOUND. An ambiguous unqualified ID is NOT_READY with an explanation; no record is silently chosen. Repeated IDs produce ACKED then ALREADY_ACKED.

COUNT requires an integer quantity between 1 and 500 inclusive; VOID requires target_event_id and null/omitted quantity. COUNT target must be null/omitted. Both require nonempty IDs and an ISO timestamp with timezone. Completed VOIDs are automatically acknowledged; supervisor ACK on a COUNT never blocks a correction. Pending VOID references resolve only within their source.

## MQTT examiner configuration

Set the **examiner-assigned** `CANDIDATE_ID` in `.env` and restart. The ID is never hardcoded in application source or `.env.example`. Blank disables MQTT without preventing HTTP startup.

```dotenv
CANDIDATE_ID=YOUR_EXAMINER_ASSIGNED_ID
MQTT_URL=mqtt://152.42.238.142:1883
```

Client ID: `fse01-{candidate_id}-{random_suffix}`. MQTT 3.1.1; QoS 1; no retained publishes.

| Purpose                      | Topic                             |
| ---------------------------- | --------------------------------- |
| Challenge subscription       | `fse-01/{candidate_id}/challenge` |
| Response publication         | `fse-01/{candidate_id}/response`  |
| ONLINE / HEARTBEAT / OFFLINE | `fse-01/{candidate_id}/status`    |

Sample examiner challenge (replace candidate ID and expiration):

```json
{
  "protocol_version": "1.0",
  "candidate_id": "YOUR_EXAMINER_ASSIGNED_ID",
  "challenge_id": "CH-001",
  "command": "PROCESS_EVENTS",
  "expires_at": "2099-01-01T00:00:00Z",
  "events": [
    {
      "source_id": "line-demo",
      "event_id": "MQ-101",
      "type": "COUNT",
      "quantity": 8,
      "event_time": "2026-10-09T08:00:00+06:00"
    }
  ]
}
```

After SUBACK, the worker publishes ONLINE. It processes the events and stores COMPLETED with processed_at, ordered results, and exactly the seven state fields for newly processed challenges before publishing and awaiting PUBACK. Identical challenge replay returns the original response, including the original timestamp/state. Changed body under the same ID returns FAILED / CHALLENGE_CONFLICT. Unsupported protocol, candidate mismatch, malformed challenge, expiration and internal errors get their specified codes. Individually rejected events still yield COMPLETED.

`expires_at` is optional because the supplied request does not require the field; when supplied it must be a timezone-qualified ISO timestamp and is enforced. Replay checks stored identity before expiration so a delayed retry can receive its original response. Responses, conflicts, validation failures and publication attempts are persisted. Reconnect uses 1–30 second exponential backoff, subscribes again, publishes ONLINE and flushes the outbox. Heartbeats run every 25 seconds. A retained-false OFFLINE will is configured; graceful shutdown also publishes OFFLINE.

```sh
npm run mqtt:probe
```

This read-only probe verifies broker CONNACK and QoS1 subscriptions using the configured candidate. It does not fabricate an examiner challenge. Check the dashboard's connection and last challenge/response fields, or inspect persisted history:

`npm run test:mqtt:live` additionally publishes a clearly named `VERIFY-*` empty-batch challenge to the assigned candidate's challenge topic, receives COMPLETED, then verifies exact replay. It requires a running backend and stores challenge history but adds no production events. This is an explicitly self-generated live smoke check, not an examiner-issued scenario or grading result.

```sh
docker compose exec -T postgres psql -U assessment -d production -c "SELECT challenge_id,status,published_at,publish_attempts FROM mqtt_challenges ORDER BY id DESC LIMIT 10;"
```

## Submission

See [TECHNICAL_EXPLANATION.md](TECHNICAL_EXPLANATION.md), [AI_USAGE.md](AI_USAGE.md), and [VERIFICATION.md](VERIFICATION.md). Git excludes environment secrets, dependency/build caches, screenshots and PDFs. Export and attach the real conversation record separately per the assessment instructions. No assessment PDF or fabricated conversation is included.

This is a runnable local assessment implementation. Authentication, TLS termination, rate limiting, durable multi-instance MQTT leadership, pagination and operational monitoring remain deployment work; see the technical explanation.

## Official FSE-01 change request: quantity limit and rejected submissions

New COUNT submissions must have integer quantity 1–500 inclusive. Values such as 501, 0, negative and fractional quantities return an item-level REJECTED message, are stored in submission_attempts and remain visible in Exceptions. Valid siblings still commit. The rule is in backend/modules/events/schema.ts and is reused by REST and MQTT through processEvents; no migration or historical data rewrite was needed.

Summary now includes seven numeric fields. `rejected_submissions` is the PostgreSQL count of attempts whose status is exactly REJECTED, filtered by the recorded source when source_id is supplied. It includes REST/MQTT attempts, counts repeated rejected submissions, excludes duplicate/conflict/pending attempts, and does not join or double-count rejected event rows. The other six indicators retain their definitions. The existing source filter applies to all seven cards, Pending and Exceptions; Clear filter restores all sources and changing source clears old data/ACK selections.

New MQTT PROCESS_EVENTS responses include the seven-field state. COUNT 501 is an individual REJECTED result within overall COMPLETED. Historical challenge replays return their ORIGINAL serialized response, even when it contains only six fields; responses are not upgraded or rewritten. Historical production COUNT rows above 500 remain intact; fresh submissions are subject to the new validation rule.

`npm run demo` also asserts a mixed [COUNT 450, COUNT 501] batch, total 450 and rejected_submissions 1 for its unique source. For test-only execution, start `node --import tsx scripts/browser-server.ts` in one terminal, then set `$env:DEMO_URL='http://127.0.0.1:3101'` in another before running `npm run demo` (PowerShell). Stop the isolated server afterward.

See CHANGE_REQUEST_VERIFICATION.md for current command results, exact modified functions, replay regression evidence and commit/push status. FINAL_SUBMISSION_AUDIT.md remains the historical pre-change audit, including its original six-field observations. No new successful live nonempty examiner challenge is claimed.
