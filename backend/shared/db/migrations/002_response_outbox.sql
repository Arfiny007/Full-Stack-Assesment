ALTER TABLE mqtt_challenge_history ADD COLUMN serialized_response text;
UPDATE mqtt_challenge_history SET serialized_response=response::text;
ALTER TABLE mqtt_challenge_history ALTER COLUMN serialized_response SET NOT NULL;
ALTER TABLE mqtt_challenge_history ADD COLUMN published_at timestamptz;
ALTER TABLE mqtt_challenge_history ADD COLUMN publish_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE mqtt_challenge_history ADD COLUMN last_publish_error text;
CREATE INDEX unpublished_mqtt_history ON mqtt_challenge_history(candidate_id,id) WHERE published_at IS NULL;
ALTER TABLE production_events ADD CONSTRAINT complete_event_shape CHECK (
  (type='COUNT' AND quantity IS NOT NULL AND target_event_id IS NULL) OR
  (type='VOID' AND quantity IS NULL AND target_event_id IS NOT NULL)
);
