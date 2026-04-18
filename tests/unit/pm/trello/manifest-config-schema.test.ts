/**
 * Trello manifest configSchema (plan 009/2 task 1).
 *
 * Extracts the Trello Zod schema from the inline CASCADE-config
 * `trello` field into a dedicated file (`src/integrations/pm/trello/config-schema.ts`)
 * so the manifest can declare `configSchema: trelloConfigSchema` and
 * the conformance harness can run round-trip identity against it.
 *
 * The existing inline schema in src/config/schema.ts stays in place
 * through plans 2-4 for backward compat; plan 5 deletes it.
 *
 * NOTE: Trello API credentials (apiKey, token, apiSecret) live in the
 * project_credentials table, not in this config. The schema only
 * covers the project-scoped settings: boardId, lists, labels, customFields.
 */

import { describe, expect, it } from 'vitest';
import { trelloConfigSchema } from '../../../../src/integrations/pm/trello/config-schema.js';
import { trelloManifest } from '../../../../src/integrations/pm/trello/manifest.js';

const fullFixture = {
	boardId: 'trello-board-abc',
	lists: { backlog: 'list-1', todo: 'list-2', done: 'list-3' },
	labels: { bug: 'label-red', feature: 'label-green' },
	customFields: { cost: 'cf-cost-123' },
};

describe('trelloConfigSchema', () => {
	it('round-trip identity: parse → serialize → reparse → deep-equal', () => {
		const parsed1 = trelloConfigSchema.parse(fullFixture);
		const parsed2 = trelloConfigSchema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});

	it('rejects missing boardId', () => {
		const { boardId: _, ...rest } = fullFixture;
		expect(() => trelloConfigSchema.parse(rest)).toThrow();
	});

	it('accepts omitted customFields (optional)', () => {
		const { customFields: _, ...rest } = fullFixture;
		expect(() => trelloConfigSchema.parse(rest)).not.toThrow();
	});

	it('accepts empty lists + labels records', () => {
		const parsed = trelloConfigSchema.parse({ boardId: 'b', lists: {}, labels: {} });
		expect(parsed.lists).toEqual({});
		expect(parsed.labels).toEqual({});
	});
});

describe('trelloManifest exposes configSchema', () => {
	it('trelloManifest.configSchema is the extracted trelloConfigSchema', () => {
		expect(trelloManifest.configSchema).toBe(trelloConfigSchema);
	});

	it('trelloManifest.configFixture parses cleanly against the schema', () => {
		const schema = trelloManifest.configSchema;
		expect(schema).toBeDefined();
		if (!schema) return;
		expect(() => schema.parse(trelloManifest.configFixture)).not.toThrow();
	});
});
