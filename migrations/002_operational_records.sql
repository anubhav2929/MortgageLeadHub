BEGIN;

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_lead_idx ON notes(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee_id TEXT,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS tasks_work_idx ON tasks(status, due_at, assignee_id);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  disclosure_version_id TEXT NOT NULL,
  exact_text_snapshot TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  source_url TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS consent_latest_idx ON consent_records(lead_id, scope, captured_at DESC);

CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  scope TEXT NOT NULL,
  channel TEXT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  evidence_event_id TEXT,
  UNIQUE(phone_e164, scope, channel)
);
CREATE INDEX IF NOT EXISTS suppressions_phone_idx ON suppressions(phone_e164);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  officer_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  password_hash TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS lead_documents (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  object_key TEXT,
  category TEXT NOT NULL,
  retention_until TIMESTAMPTZ,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS lead_documents_lead_idx ON lead_documents(lead_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  reviewer_id TEXT NOT NULL,
  source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  prompt_version_id TEXT,
  model_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_history_lead_idx ON field_history(lead_id, field_path, changed_at DESC);

CREATE TABLE IF NOT EXISTS inbound_call_triage (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_call_id TEXT NOT NULL UNIQUE,
  from_phone TEXT,
  reason TEXT NOT NULL,
  candidate_lead_ids TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'OPEN',
  linked_lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS inbound_triage_work_idx ON inbound_call_triage(status, received_at);

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_logs_append_only'
      AND tgrelid = 'audit_logs'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER audit_logs_append_only
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
  END IF;
END;
$$;

COMMIT;
