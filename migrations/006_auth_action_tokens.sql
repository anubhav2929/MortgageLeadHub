BEGIN;

CREATE TABLE IF NOT EXISTS auth_action_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_action_tokens_user_idx ON auth_action_tokens(user_id, purpose, expires_at DESC);

INSERT INTO schema_migrations (version) VALUES ('006_auth_action_tokens') ON CONFLICT (version) DO NOTHING;

COMMIT;
