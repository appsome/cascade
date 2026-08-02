import { isNull, sql } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { orgCredentialSets } from './orgCredentialSets.js';

/**
 * Organization-scoped shared credentials. Projects inherit these at
 * resolution time; a project_credentials row with the same env_var_key
 * overrides the org value for that project. Values are encrypted with
 * AAD = org_id (project credentials use AAD = project_id).
 *
 * Two tiers in one table, split by set_id:
 * - set_id IS NULL — flat base tier (PM/alerting/custom keys), one row per
 *   (org, env_var_key), exactly the pre-0063 model.
 * - set_id IS NOT NULL — value belongs to a named org_credential_sets entry
 *   (engine + SCM providers), one row per (set, env_var_key).
 */
export const orgCredentials = pgTable(
	'org_credentials',
	{
		id: serial('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		envVarKey: text('env_var_key').notNull(),
		value: text('value').notNull(),
		name: text('name'),
		setId: integer('set_id').references(() => orgCredentialSets.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_org_credentials_org_env_var_key')
			.on(table.orgId, table.envVarKey)
			.where(isNull(table.setId)),
		uniqueIndex('uq_org_credentials_set_env_var_key')
			.on(table.setId, table.envVarKey)
			.where(sql`set_id IS NOT NULL`),
	],
);
