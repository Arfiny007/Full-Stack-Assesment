# Actual verification

Verified during the implementation session on 9 October 2026 (Asia/Dhaka) on Windows with Node 24.11.0, npm 11.6.1, Docker 29.4.3, PostgreSQL 18 in Docker, Chrome, Vitest 5.0.3 and Vite 6.4.4.

| Command / check                      | Observed outcome                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                        | Completed; lockfile saved                                                                                                              |
| `docker compose up -d`               | PostgreSQL container running and healthy on 55432                                                                                      |
| `npm run db:migrate`                 | Both migrations applied to production; migration runner is repeatable                                                                  |
| `npm test`                           | 16/16 Vitest integration tests passed against separate PostgreSQL `production_test`                                                    |
| `npm run typecheck`                  | Backend and frontend TypeScript checks passed                                                                                          |
| `npm run build`                      | TypeScript compilation and Vite production build passed                                                                                |
| `npm start`                          | Express production server started and serves the built dashboard on loopback 3100                                                      |
| `npm run dev`                        | Express and Vite started; Vite HTTP 200 and API proxy returned persisted MQTT state                                                    |
| `npm run demo`                       | REST assertions passed: pending VOID, COUNT resolution, duplicate, database summary, repeated/auto ACK                                 |
| `npm run test:browser`               | 2/2 Chrome checks passed at 1440px desktop and 390px mobile, with no page errors or page-level horizontal overflow                     |
| `npm run test:mqtt`                  | Real local Mosquitto QoS1 responses, ONLINE, HEARTBEAT, OFFLINE will, replay/restart/conflict and unpublished-response recovery passed |
| `npm run mqtt:probe`                 | Examiner broker accepted CONNACK and QoS1 SUBACK for the supplied candidate                                                            |
| `npm run test:mqtt:live`             | Examiner broker delivered COMPLETED and exact response replay for a self-generated `VERIFY-*` empty batch; no production event effects |
| `npm audit` / `npm audit --omit=dev` | Zero reported vulnerabilities after updating Vitest                                                                                    |

The first browser attempt targeted another application's IPv4 port 3000 and failed; this app now explicitly uses loopback port 3100. The initial mobile width check exposed grid/table overflow; setting grid child minimum width to zero fixed it, and both browser checks then passed. Live traffic exposed a response-history INSERT parameter inferred as both JSONB and text; separate SQL parameters fixed it, followed by passing database, local transport and live replay checks.

An examiner-origin challenge arrived before that SQL fix and its transaction rolled back. No successful examiner scenario or grade is claimed. The successful live end-to-end test used an intentionally self-generated empty event array. The local MQTT test independently exercised real COUNT persistence and exactly-once business effects after process restart. Candidate-specific settings remain in ignored `.env`. Browser/demo records remain in production under identifiable `browser-*` / `demo-*` sources; the live smoke response captures the actual existing database summary. Screenshots and build/dependency files are ignored.

The repository has meaningful progress commits for the PostgreSQL business layer, durable MQTT/tests, and dashboard/documentation. The real AI conversation record still needs to be exported and attached by the candidate. See README for reproducible commands and the technical explanation for deployment limitations.

## Official change request verification — 9 October 2026

The entries above record the original six-field contract. The official change adds COUNT integer range 1–500 and a seventh PostgreSQL-backed rejected_submissions metric; it supersedes the earlier limit/summary for newly processed inputs while preserving historical MQTT responses. See CHANGE_REQUEST_VERIFICATION.md for the current requirement table, exact files/functions, SQL evidence, feature commit and remote status.

| Command/check                                    | Actual change-request outcome                                                                                                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck                                | Passed backend/frontend checks.                                                                                                                                                                                  |
| npm test                                         | 29/29 PostgreSQL tests passed, including the original 16 regressions and 13 new cases; duration 6.43s.                                                                                                           |
| npm run build                                    | tsc and Vite passed; 28 modules; Vite build 2.77s.                                                                                                                                                               |
| npm run test:browser                             | 4/4 Chrome tests passed at 1440px/390px; duration 1.2m. Seven cards, real source-filtered counts, clear, stale-selection protection, manual/periodic refresh, empty/error recovery and no page overflow checked. |
| npm run demo with DEMO_URL=http://127.0.0.1:3101 | Passed original VOID/duplicate/ACK assertions and new mixed 450 ACCEPTED / 501 REJECTED assertions; source total 450, processed 3, rejected_submissions 1.                                                       |
| npm run test:mqtt with local Mosquitto           | Passed real QoS1/status, exact replay, restart/outbox recovery and COUNT 501 rejection within COMPLETED with seven state fields.                                                                                 |
| PostgreSQL test-data queries                     | Confirmed recorded source/status/original quantity for 450/501, separate line counts and a seven-field MQTT response. No production data reset or deletion.                                                      |

Browser checks now launch scripts/browser-server.ts on 3101 by default, using the existing _test database guard and MQTT disabled. The REST demo used that same test instance; MQTT checks used local Mosquitto and production_test. Browser request delay/abort tests simulate transport loading/errors while successful state/mutation values come from actual PostgreSQL. The first new browser run exposed a test route-teardown race; waiting for handlers during teardown fixed the test and the rerun passed all four cases.

No migration was added. Historical production rows and six-field serialized challenge responses are not rewritten; the regression fixture also preserves a historical COUNT 750 while fresh summaries have seven fields. The running production application was restarted with the verified build to keep API/static frontend contracts aligned. This is not a new claim of live nonempty examiner verification.

The Git remote now exists, unlike the earlier audit snapshot. This change is committed locally; no public push or history rewrite is performed because the earlier disposable-credential history concern remains unresolved. Export the genuine conversation records and resolve required examiner handoff items separately. The earlier submission ZIP is a historical snapshot and needs regeneration for this feature before submission.

Current read-only production evidence observed during the change request: candidate 18 already has CH-18-d1124f338f, processed at 2026-10-09T08:12:00Z, COMPLETED with two events (one ACCEPTED and one REJECTED) and published_at recorded. It predates this feature and retains its original six-field response. This updates the earlier audit's empty-only snapshot, but the database does not independently prove who issued the challenge. No new live seven-field examiner scenario was intentionally sent or verified during this change; the new protocol behavior was executed against local Mosquitto. Candidate/examiner-origin confirmation remains separate from persisted processing evidence.
