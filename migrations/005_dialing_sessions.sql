BEGIN;

CREATE TABLE IF NOT EXISTS dialing_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('MANUAL_NEXT','AUTO_SEQUENTIAL')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  current_item_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dialing_queue_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES dialing_sessions(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING','CALLING','COMPLETED','BLOCKED','FAILED','SKIPPED')),
  attempt_id TEXT REFERENCES contact_attempts(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  reason TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(session_id, position),
  UNIQUE(session_id, lead_id)
);
CREATE INDEX IF NOT EXISTS dialing_queue_work_idx ON dialing_queue_items(session_id, status, position);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dialing_sessions_current_item_fk'
      AND conrelid = 'dialing_sessions'::regclass
  ) THEN
    ALTER TABLE dialing_sessions
      ADD CONSTRAINT dialing_sessions_current_item_fk
      FOREIGN KEY (current_item_id) REFERENCES dialing_queue_items(id) ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('005_dialing_sessions') ON CONFLICT (version) DO NOTHING;

COMMIT;
