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
| `npm run dev` | Express and Vite started; Vite HTTP 200 and API proxy returned persisted MQTT state |
| `npm run demo`                       | REST assertions passed: pending VOID, COUNT resolution, duplicate, database summary, repeated/auto ACK                                 |
| `npm run test:browser`               | 2/2 Chrome checks passed at 1440px desktop and 390px mobile, with no page errors or page-level horizontal overflow                     |
| `npm run test:mqtt`                  | Real local Mosquitto QoS1 responses, ONLINE, HEARTBEAT, OFFLINE will, replay/restart/conflict and unpublished-response recovery passed |
| `npm run mqtt:probe`                 | Examiner broker accepted CONNACK and QoS1 SUBACK for the supplied candidate                                                            |
| `npm run test:mqtt:live`             | Examiner broker delivered COMPLETED and exact response replay for a self-generated `VERIFY-*` empty batch; no production event effects |
| `npm audit` / `npm audit --omit=dev` | Zero reported vulnerabilities after updating Vitest                                                                                    |

The first browser attempt targeted another application's IPv4 port 3000 and failed; this app now explicitly uses loopback port 3100. The initial mobile width check exposed grid/table overflow; setting grid child minimum width to zero fixed it, and both browser checks then passed. Live traffic exposed a response-history INSERT parameter inferred as both JSONB and text; separate SQL parameters fixed it, followed by passing database, local transport and live replay checks.

An examiner-origin challenge arrived before that SQL fix and its transaction rolled back. No successful examiner scenario or grade is claimed. The successful live end-to-end test used an intentionally self-generated empty event array. The local MQTT test independently exercised real COUNT persistence and exactly-once business effects after process restart. Candidate-specific settings remain in ignored `.env`. Browser/demo records remain in production under identifiable `browser-*` / `demo-*` sources; the live smoke response captures the actual existing database summary. Screenshots and build/dependency files are ignored.

The repository has meaningful progress commits for the PostgreSQL business layer, durable MQTT/tests, and dashboard/documentation. The real AI conversation record still needs to be exported and attached by the candidate. See README for reproducible commands and the technical explanation for deployment limitations.
