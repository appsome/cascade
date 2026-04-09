-- 0048_add_gitlab_scm_provider.sql
-- Add gitlab as a valid SCM provider in the integration category/provider CHECK constraint.
ALTER TABLE project_integrations
  DROP CONSTRAINT IF EXISTS chk_integration_category_provider,
  ADD CONSTRAINT chk_integration_category_provider CHECK (
    (category = 'pm'       AND provider IN ('trello', 'jira'))
    OR (category = 'scm'   AND provider IN ('github', 'gitlab'))
    OR (category = 'email' AND provider IN ('imap', 'gmail'))
    OR (category = 'sms'   AND provider IN ('twilio'))
    OR (category = 'alerting' AND provider IN ('sentry'))
  );
