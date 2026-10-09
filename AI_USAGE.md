# AI assistance disclosure

Codex generated the implementation in this repository from the user's pasted assessment request during this session. This includes the schema/migrations, PostgreSQL transaction and event services, REST routes, MQTT worker/replay/outbox, React dashboard, tests, demo scripts, configuration and documentation. The initial workspace contained no existing project files to reuse.

Codex inspected the installed tools, ran real shell commands, installed dependencies, started Docker PostgreSQL/Mosquitto, applied migrations, exercised tests/builds and reviewed their output. Review included normalized identity, transaction rollback, source locking, competing VOID resolution, ACK ambiguity, concurrent requests and durable response replay. Code was modified in response to actual checks: Vitest dependency audit findings, a PostgreSQL JSONB/text parameter inference error observed during live MQTT processing, and an existing application's occupation of IPv4 port 3000. Browser checks exercise actual API writes, not mocked metric values.

The user supplied the examiner candidate ID through the conversation. It is stored only in the ignored local `.env`, not hardcoded in the repository. Official MQTT.js/Vitest documentation was consulted. No sub-agents were used. No photographed assessment PDF was added. No manual human code review or successful examiner grade is claimed.

See `VERIFICATION.md` for the actual final outcomes and limitations. AI-generated code still requires the candidate's review and understanding before submission; do not represent it as unaided work.

## Attach the real conversation record

Export this actual Codex/ChatGPT conversation using the application's available export or copy mechanism. Review it for credentials and personal information, then attach it separately in the examiner's required submission format. If the examiner requires an in-repository record, add the real reviewed export as `AI_CONVERSATION_RECORD.md` before submitting. This repository does not fabricate conversation transcripts or claim an export has already been attached.
