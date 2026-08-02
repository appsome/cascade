import { sql } from 'drizzle-orm';
import { boolean, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

/**
 * A named credential entry ("personal", "work") on an org provider tab.
 * Value rows live in org_credentials with set_id pointing here; this table
 * stores no secrets. Provider ids come from CREDENTIAL_PROVIDERS
 * (src/config/credentialProviders.ts). Exactly one default set per
 * (org, provider) — the fallback when a project makes no selection.
 */
export const orgCredentialSets = pgTable(
	'org_credential_sets',
	{
		id: serial('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		name: text('name').notNull(),
		isDefault: boolean('is_default').notNull().default(false),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_org_credential_sets_org_provider_name').on(
			table.orgId,
			table.provider,
			table.name,
		),
		uniqueIndex('uq_org_credential_sets_default')
			.on(table.orgId, table.provider)
			.where(sql`is_default`),
	],
);
