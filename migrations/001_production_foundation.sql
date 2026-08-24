BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  admin_timezone TEXT NOT NULL DEFAULT 'UTC',
  timezone_confirmed BOOLEAN NOT NULL DEFAULT false,
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  repository_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (repository_mode IN ('legacy', 'normalized')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  public_ref TEXT NOT NULL UNIQUE,
  status_token_hash TEXT UNIQUE,
  status_token_expires_at TIMESTAMPTZ,
  state TEXT NOT NULL,
  assigned_officer_id TEXT,
  borrower_timezone TEXT,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_state_idx ON leads(state);
CREATE INDEX IF NOT EXISTS leads_officer_idx ON leads(assigned_officer_id);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  phone_e164 TEXT,
  email_normalized TEXT,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS people_lead_idx ON people(lead_id);
CREATE INDEX IF NOT EXISTS people_phone_idx ON people(phone_e164);

CREATE TABLE IF NOT EXISTS contact_attempts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  outcome TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT UNIQUE,
  cadence_step_key TEXT UNIQUE,
  data JSONB NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS attempts_lead_idx ON contact_attempts(lead_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contact_attempt_id TEXT REFERENCES contact_attempts(id) ON DELETE SET NULL,
  provider_call_id TEXT UNIQUE,
  status TEXT NOT NULL,
  prompt_version_id TEXT NOT NULL,
  profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  data JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS transcript_turns (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  provider_event_id TEXT,
  PRIMARY KEY (conversation_id, turn),
  UNIQUE (conversation_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events(lead_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS field_candidates (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  field_path TEXT NOT NULL,
  value JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_turns INTEGER[] NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS field_candidates_review_idx ON field_candidates(lead_id, review_status);

CREATE TABLE IF NOT EXISTS lead_fields (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  value JSONB NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (lead_id, field_path)
);

CREATE TABLE IF NOT EXISTS crm_records (
  record_type TEXT NOT NULL,
  id TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  occurred_at TIMESTAMPTZ,
  PRIMARY KEY (record_type, id)
);
CREATE INDEX IF NOT EXISTS crm_records_lead_idx ON crm_records(lead_id, record_type);

CREATE TABLE IF NOT EXISTS integration_credentials (
  key TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_routes (
  id TEXT PRIMARY KEY,
  priority INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('OPENAI', 'ANTHROPIC', 'NVIDIA')),
  model TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(priority),
  UNIQUE(provider, model)
);

CREATE TABLE IF NOT EXISTS voice_agent_profiles (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  transcriber JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_version_id TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_profile_single_active_idx ON voice_agent_profiles(active) WHERE active;

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'primary',
  payload JSONB NOT NULL,
  request_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'RETRY', 'QUARANTINED', 'DEAD')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS webhook_inbox_work_idx ON webhook_inbox(status, next_attempt_at, received_at);

CREATE TABLE IF NOT EXISTS outbox_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'RETRY', 'DEAD')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS outbox_work_idx ON outbox_jobs(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (scope, subject_hash)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  result TEXT NOT NULL,
  ip_address TEXT,
  correlation_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id, occurred_at DESC);

INSERT INTO system_settings (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('001_production_foundation') ON CONFLICT (version) DO NOTHING;

COMMIT;
