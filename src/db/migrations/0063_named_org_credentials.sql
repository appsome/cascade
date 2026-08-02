-- 0063_named_org_credentials.sql
-- Named org credential sets: multiple credentials per provider (engines +
-- GitHub/GitLab) with per-project selection. org_credentials stays the single
-- encrypted value store (AAD = org_id); rows either belong to a named set
-- (set_id) or remain flat base-tier rows (set_id IS NULL — PM/alerting/custom).
--
-- The env_var_key → provider VALUES mapping below MUST mirror
-- CREDENTIAL_PROVIDERS in src/config/credentialProviders.ts
-- (a hygiene test greps this file for every key).
BEGIN;

CREATE TABLE IF NOT EXISTS org_credential_sets (
  id         SERIAL PRIMARY KEY,
  org_id     TEXT    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider   TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_credential_sets_org_provider_name
  ON org_credential_sets(org_id, provider, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_credential_sets_default
  ON org_credential_sets(org_id, provider) WHERE is_default;

ALTER TABLE org_credentials
  ADD COLUMN IF NOT EXISTS set_id INTEGER REFERENCES org_credential_sets(id) ON DELETE CASCADE;

-- Split the flat unique index into base-tier and set-tier partial indexes.
DROP INDEX IF EXISTS uq_org_credentials_org_env_var_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_credentials_org_env_var_key
  ON org_credentials(org_id, env_var_key) WHERE set_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_credentials_set_env_var_key
  ON org_credentials(set_id, env_var_key) WHERE set_id IS NOT NULL;

-- Backfill: adopt existing engine/SCM rows into an auto-created 'Default' set
-- per (org, provider). Values untouched — same table, same AAD (org_id).
INSERT INTO org_credential_sets (org_id, provider, name, is_default)
SELECT DISTINCT oc.org_id, m.provider, 'Default', true
FROM org_credentials oc
JOIN (VALUES
  ('CLAUDE_CODE_OAUTH_TOKEN', 'anthropic'),
  ('ANTHROPIC_API_KEY',       'anthropic'),
  ('OPENAI_API_KEY',          'openai'),
  ('CODEX_AUTH_JSON',         'openai'),
  ('OPENROUTER_API_KEY',      'openrouter'),
  ('GITHUB_TOKEN_IMPLEMENTER', 'github'),
  ('GITHUB_TOKEN_REVIEWER',    'github'),
  ('GITHUB_WEBHOOK_SECRET',    'github'),
  ('GITLAB_TOKEN_IMPLEMENTER', 'gitlab'),
  ('GITLAB_TOKEN_REVIEWER',    'gitlab'),
  ('GITLAB_WEBHOOK_SECRET',    'gitlab')
) AS m(env_var_key, provider) ON m.env_var_key = oc.env_var_key
WHERE oc.set_id IS NULL
ON CONFLICT (org_id, provider, name) DO NOTHING;

UPDATE org_credentials oc
SET set_id = s.id
FROM (VALUES
  ('CLAUDE_CODE_OAUTH_TOKEN', 'anthropic'),
  ('ANTHROPIC_API_KEY',       'anthropic'),
  ('OPENAI_API_KEY',          'openai'),
  ('CODEX_AUTH_JSON',         'openai'),
  ('OPENROUTER_API_KEY',      'openrouter'),
  ('GITHUB_TOKEN_IMPLEMENTER', 'github'),
  ('GITHUB_TOKEN_REVIEWER',    'github'),
  ('GITHUB_WEBHOOK_SECRET',    'github'),
  ('GITLAB_TOKEN_IMPLEMENTER', 'gitlab'),
  ('GITLAB_TOKEN_REVIEWER',    'gitlab'),
  ('GITLAB_WEBHOOK_SECRET',    'gitlab')
) AS m(env_var_key, provider)
JOIN org_credential_sets s
  ON s.provider = m.provider AND s.is_default
WHERE oc.env_var_key = m.env_var_key
  AND s.org_id = oc.org_id
  AND oc.set_id IS NULL;

CREATE TABLE IF NOT EXISTS project_credential_selections (
  id         SERIAL PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider   TEXT    NOT NULL,
  set_id     INTEGER NOT NULL REFERENCES org_credential_sets(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pcs_project_provider_set
  ON project_credential_selections(project_id, provider, set_id);

CREATE INDEX IF NOT EXISTS idx_pcs_project
  ON project_credential_selections(project_id);

COMMIT;
