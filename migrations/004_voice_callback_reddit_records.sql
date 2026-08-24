BEGIN;

ALTER TABLE system_settings ALTER COLUMN admin_timezone SET DEFAULT 'America/Los_Angeles';
UPDATE system_settings SET admin_timezone = 'America/Los_Angeles'
WHERE admin_timezone = 'UTC' AND timezone_confirmed = false;

CREATE TABLE IF NOT EXISTS lead_context_snapshots (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  prompt_version_id TEXT NOT NULL,
  profile_version_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(conversation_id)
);

CREATE TABLE IF NOT EXISTS qualification_answers (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source TEXT NOT NULL,
  transcript_turn_refs INTEGER[] NOT NULL DEFAULT '{}',
  conflict BOOLEAN NOT NULL DEFAULT false,
  captured_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS qualification_answers_conversation_idx ON qualification_answers(conversation_id, captured_at);

CREATE TABLE IF NOT EXISTS qualification_decisions (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('READY_FOR_TRANSFER','NEEDS_REVIEW','REFERRAL')),
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  decided_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_attempts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  officer_id TEXT,
  destination_masked TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','DIALING','OFFICER_ANSWERED','SUMMARY_DELIVERED','BRIDGED','FAILED','DECLINED','CALLBACK_OFFERED')),
  provider_call_id TEXT,
  provider_transfer_id TEXT UNIQUE,
  consent_turn_ref INTEGER,
  failure_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS transfer_attempts_conversation_idx ON transfer_attempts(conversation_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS callback_appointments (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  officer_id TEXT,
  source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  transfer_attempt_id TEXT REFERENCES transfer_attempts(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  borrower_timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('BOOKED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','MISSED')),
  consent_record_id TEXT,
  cancellation_reason TEXT,
  provider_correlation_ids TEXT[] NOT NULL DEFAULT '{}',
  confirmation_attempt_id TEXT REFERENCES contact_attempts(id) ON DELETE SET NULL,
  reminder_attempt_id TEXT REFERENCES contact_attempts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS callback_appointments_work_idx ON callback_appointments(status, starts_at, officer_id);

CREATE TABLE IF NOT EXISTS reddit_connections (
  id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  connected_by_id TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reddit_publications (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  final_text TEXT NOT NULL,
  approved_by_id TEXT NOT NULL,
  approved_by_name TEXT NOT NULL,
  subreddit_rules_confirmed BOOLEAN NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
  reddit_comment_id TEXT,
  permalink TEXT,
  provider_response JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_health_checks (
  integration_id TEXT PRIMARY KEY,
  ok BOOLEAN NOT NULL,
  message TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  verified_by_id TEXT NOT NULL,
  verified_by_name TEXT NOT NULL
);

INSERT INTO schema_migrations (version) VALUES ('004_voice_callback_reddit_records') ON CONFLICT (version) DO NOTHING;

COMMIT;
