-- 0064_run_suspension_and_credential_attribution.sql
-- Rate-limit suspension (status='suspended' + resume_at) and
-- engine-credential rotation attribution on agent_runs.
-- engine_credential_* are snapshot columns (no FK) so run history survives
-- credential-set deletion. status is already free-text; the existing
-- idx_agent_runs_status covers suspended lookups.
BEGIN;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS resume_at TIMESTAMP;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS engine_credential_id TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS engine_credential_name TEXT;

COMMIT;
