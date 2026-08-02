import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { orgCredentialSets } from './orgCredentialSets.js';
import { projects } from './projects.js';

/**
 * Which named org credential set(s) a project uses per provider.
 * Single row for github/gitlab/openai/openrouter; ordered rows
 * (position 0 = primary) for anthropic — the engine-rotation pool.
 * References only; no secrets, no encryption.
 */
export const projectCredentialSelections = pgTable(
	'project_credential_selections',
	{
		id: serial('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		setId: integer('set_id')
			.notNull()
			.references(() => orgCredentialSets.id, { onDelete: 'cascade' }),
		position: integer('position').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_pcs_project_provider_set').on(table.projectId, table.provider, table.setId),
		index('idx_pcs_project').on(table.projectId),
	],
);
