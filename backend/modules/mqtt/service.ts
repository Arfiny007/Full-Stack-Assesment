import { createHash } from "node:crypto";
import { z } from "zod";
import { transaction } from "../../shared/db/index.js";
import { canonical } from "../events/schema.js";
import { processEvents } from "../events/service.js";
import { summary } from "../state/repository.js";
import * as repo from "./repository.js";
const schema = z.object({
  protocol_version: z.literal("1.0"),
  candidate_id: z.string().min(1),
  challenge_id: z.string().min(1).max(200),
  command: z.literal("PROCESS_EVENTS"),
  expires_at: z.string().datetime({ offset: true }).optional(),
  events: z.array(z.unknown()),
});
export type ChallengeResponse = {
  protocol_version: "1.0";
  candidate_id: string;
  challenge_id: string | null;
  status: "FAILED" | "COMPLETED";
  processed_at: string;
  [key: string]: unknown;
};
export async function handleChallenge(
  body: unknown,
  candidate: string,
): Promise<ChallengeResponse> {
  const raw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const id =
    typeof raw.challenge_id === "string" &&
    raw.challenge_id.length > 0 &&
    raw.challenge_id.length <= 200
      ? raw.challenge_id
      : null;
  const canon = canonical(body);
  const digest = createHash("sha256").update(canon).digest("hex");
  const fail = (error_code: string, message: string): ChallengeResponse => ({
    protocol_version: "1.0",
    candidate_id: candidate,
    challenge_id: id,
    status: "FAILED",
    processed_at: new Date().toISOString(),
    error_code,
    message,
  });
  return transaction(async (db) => {
    if (id) {
      await repo.lockChallenge(db, candidate, id);
      const prior = await repo.findChallenge(db, candidate, id);
      if (prior) {
        const response: ChallengeResponse =
          prior.canonical_body === canon
            ? JSON.parse(prior.serialized_response)
            : fail(
                "CHALLENGE_CONFLICT",
                "Challenge ID already used with different body",
              );
        await repo.history(db, candidate, id, body, response);
        return response;
      }
    }
    let response: ChallengeResponse;
    const parsed = schema.safeParse(body);
    if (raw.protocol_version !== "1.0")
      response = fail("UNSUPPORTED_PROTOCOL", "protocol_version must be 1.0");
    else if (raw.candidate_id !== candidate)
      response = fail(
        "CANDIDATE_MISMATCH",
        "candidate_id differs from configured candidate",
      );
    else if (!parsed.success)
      response = fail("VALIDATION_ERROR", parsed.error.message);
    else if (
      parsed.data.expires_at &&
      Date.parse(parsed.data.expires_at) <= Date.now()
    )
      response = fail("CHALLENGE_EXPIRED", "Challenge expired");
    else {
      const results = await processEvents(
        parsed.data.events,
        { transport: "MQTT", challenge_id: id! },
        db,
      );
      response = {
        protocol_version: "1.0",
        candidate_id: candidate,
        challenge_id: id,
        status: "COMPLETED",
        processed_at: new Date().toISOString(),
        results,
        state: await summary(undefined, db),
      };
    }
    if (id)
      await repo.saveChallenge(db, candidate, id, canon, digest, response);
    await repo.history(db, candidate, id, body, response);
    return response;
  });
}
export async function recordChallengeFailure(
  body: unknown,
  candidate: string,
  error_code: string,
  message: string,
): Promise<ChallengeResponse> {
  const id =
    body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).challenge_id === "string"
      ? (body as { challenge_id: string }).challenge_id
      : null;
  const response: ChallengeResponse = {
    protocol_version: "1.0",
    candidate_id: candidate,
    challenge_id: id,
    status: "FAILED",
    processed_at: new Date().toISOString(),
    error_code,
    message,
  };
  await transaction((db) => repo.history(db, candidate, id, body, response));
  return response;
}
