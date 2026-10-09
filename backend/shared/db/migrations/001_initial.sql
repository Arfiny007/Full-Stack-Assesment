CREATE TABLE IF NOT EXISTS production_sources (
  source_id text PRIMARY KEY CHECK (length(source_id) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS production_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES production_sources(source_id),
  event_id text NOT NULL CHECK (length(event_id) > 0),
  type text NOT NULL CHECK (type IN ('COUNT','VOID')),
  quantity integer,
  target_event_id text,
  original_payload jsonb NOT NULL,
  normalized_payload jsonb NOT NULL,
  event_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL CHECK (status IN ('ACCEPTED','PENDING_REFERENCE','REJECTED')),
  failure_reason text,
  reversed_by bigint REFERENCES production_events(id),
  applied_target_id bigint REFERENCES production_events(id),
  acked_at timestamptz,
  acked_by text,
  UNIQUE(source_id,event_id),
  CHECK ((type='COUNT' AND quantity>0 AND target_event_id IS NULL) OR
         (type='VOID' AND quantity IS NULL AND length(target_event_id)>0)),
  CHECK (acked_at IS NULL OR status='ACCEPTED'),
  CHECK (applied_target_id IS NULL OR (type='VOID' AND status='ACCEPTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_void_per_count ON production_events(applied_target_id) WHERE applied_target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pending_target ON production_events(source_id,target_event_id,id) WHERE status='PENDING_REFERENCE';
CREATE INDEX IF NOT EXISTS events_ack ON production_events(source_id,id) WHERE status='ACCEPTED' AND acked_at IS NULL;
CREATE TABLE IF NOT EXISTS submission_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text,
  event_id text,
  production_event_id bigint REFERENCES production_events(id),
  transport text NOT NULL CHECK (transport IN ('REST','MQTT')),
  challenge_id text,
  original_payload jsonb NOT NULL,
  normalized_payload jsonb,
  status text NOT NULL CHECK (status IN ('ACCEPTED','DUPLICATE','CONFLICT','PENDING_REFERENCE','REJECTED')),
  message text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS attempt_source_status ON submission_attempts(source_id,status);
CREATE TABLE IF NOT EXISTS mqtt_challenges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id text NOT NULL,
  challenge_id text NOT NULL,
  canonical_body text NOT NULL,
  body_digest text NOT NULL,
  response jsonb NOT NULL,
  serialized_response text NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_publish_error text,
  UNIQUE(candidate_id,challenge_id)
);
CREATE TABLE IF NOT EXISTS mqtt_challenge_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id text NOT NULL,
  challenge_id text,
  body jsonb NOT NULL,
  response jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
