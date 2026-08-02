-- 0062_org_credentials.sql
-- Organization-scoped shared credentials. Projects inherit these at
-- resolution time; a project_credentials row with the same env_var_key
-- overrides the org value for that project. Values are encrypted with
-- AAD = org_id (project credentials use AAD = project_id).
BEGIN;

CREATE TABLE IF NOT EXISTS org_credentials (
  id           SERIAL PRIMARY KEY,
  org_id       TEXT    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  env_var_key  TEXT    NOT NULL,
  value        TEXT    NOT NULL,
  name         TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_credentials_org_env_var_key
  ON org_credentials(org_id, env_var_key);

COMMIT;
