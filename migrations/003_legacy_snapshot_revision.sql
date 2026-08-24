BEGIN;

-- Existing production installations predate optimistic concurrency control.
-- Add the revision in place before the snapshot migration takes a row lock.
CREATE TABLE IF NOT EXISTS mlh_store (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE mlh_store ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

COMMIT;
