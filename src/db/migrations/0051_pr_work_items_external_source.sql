ALTER TABLE pr_work_items ADD COLUMN external_source text;
ALTER TABLE pr_work_items ADD COLUMN external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_work_items_project_external
    ON pr_work_items (project_id, external_source, external_id)
    WHERE external_source IS NOT NULL;
