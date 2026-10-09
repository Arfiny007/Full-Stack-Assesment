import { pool, type Db } from "../../shared/db/index.js";
export async function lockChallenge(db: Db, candidate: string, id: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    JSON.stringify([candidate, id]),
  ]);
}
export async function findChallenge(db: Db, candidate: string, id: string) {
  return (
    await db.query(
      "SELECT * FROM mqtt_challenges WHERE candidate_id=$1 AND challenge_id=$2",
      [candidate, id],
    )
  ).rows[0];
}
export async function saveChallenge(
  db: Db,
  candidate: string,
  id: string,
  canonical: string,
  digest: string,
  response: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO mqtt_challenges(candidate_id,challenge_id,canonical_body,body_digest,response,serialized_response,status)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      candidate,
      id,
      canonical,
      digest,
      JSON.stringify(response),
      JSON.stringify(response),
      response.status,
    ],
  );
}
export async function history(
  db: Db,
  candidate: string,
  id: string | null,
  body: unknown,
  response: unknown,
) {
  await db.query(
    "INSERT INTO mqtt_challenge_history(candidate_id,challenge_id,body,response,serialized_response) VALUES($1,$2,$3,$4,$5)",
    [
      candidate,
      id,
      JSON.stringify(body ?? null),
      JSON.stringify(response),
      JSON.stringify(response),
    ],
  );
}
export async function markPublished(
  candidate: string,
  id: string | null,
  response: string,
  error?: string,
) {
  await pool.query(
    `UPDATE mqtt_challenge_history SET publish_attempts=publish_attempts+1,last_publish_error=$3,
    published_at=CASE WHEN $3::text IS NULL THEN clock_timestamp() ELSE NULL END
    WHERE candidate_id=$1 AND serialized_response=$2 AND published_at IS NULL`,
    [candidate, response, error ?? null],
  );
  await pool.query(
    `UPDATE mqtt_challenges SET publish_attempts=publish_attempts+1,last_publish_error=$4,
    published_at=CASE WHEN $4::text IS NULL THEN clock_timestamp() ELSE NULL END
    WHERE candidate_id=$1 AND challenge_id=$2 AND serialized_response=$3`,
    [candidate, id, response, error ?? null],
  );
}
export async function unpublished(candidate: string) {
  return (
    await pool.query(
      "SELECT challenge_id,serialized_response FROM mqtt_challenge_history WHERE candidate_id=$1 AND published_at IS NULL ORDER BY id",
      [candidate],
    )
  ).rows;
}
export async function metadata(candidate: string | null) {
  const latest = (
    await pool.query(
      "SELECT challenge_id,received_at,response FROM mqtt_challenge_history WHERE ($1::text IS NULL OR candidate_id=$1) ORDER BY id DESC LIMIT 1",
      [candidate],
    )
  ).rows[0];
  const info = (
    await pool.query(
      `SELECT COUNT(*)::int AS challenge_count,
    (SELECT last_publish_error FROM mqtt_challenges WHERE ($1::text IS NULL OR candidate_id=$1) AND last_publish_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS publish_error
    FROM mqtt_challenges WHERE ($1::text IS NULL OR candidate_id=$1)`,
      [candidate],
    )
  ).rows[0];
  return {
    last_challenge_id: latest?.challenge_id ?? null,
    last_challenge_time: latest?.received_at ?? null,
    response_status: latest?.response?.status ?? null,
    challenge_count: info.challenge_count,
    last_error:
      latest?.response?.status === "FAILED"
        ? latest.response.message
        : (info.publish_error ?? null),
  };
}
