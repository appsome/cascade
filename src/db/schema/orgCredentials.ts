import { pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

/**
 * Organization-scoped shared credentials. Projects inherit these at
 * resolution time; a project_credentials row with the same env_var_key
 * overrides the org value for that project. Values are encrypted with
 * AAD = org_id (project credentials use AAD = project_id).
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
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [uniqueIndex('uq_org_credentials_org_env_var_key').on(table.orgId, table.envVarKey)],
);
