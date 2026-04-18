/**
 * Linear manifest configSchema (plan 009/4 task 1).
 *
 * The payoff schema. `projectId` was stripped by Zod twice during the
 * 2026-04 workstream (#1138 + #1142) — at the mapper layer, then at
 * the schema layer. Extracting a single canonical `linearConfigSchema`
 * with `projectId` declared + the manifest's round-trip invariant
 * permanently locks this class.
 *
 * NOTE: Linear API credentials (API key) live in the project_credentials
 * table, not in this config. Schema covers project-scoped settings only.
 */

import { describe, expect, it } from 'vitest';
import { linearConfigSchema } from '../../../../src/integrations/pm/linear/config-schema.js';
import { linearManifest } from '../../../../src/integrations/pm/linear/manifest.js';

const fullFixture = {
	teamId: 'team-uuid-0001',
	projectId: 'project-uuid-0001',
	statuses: { backlog: 'state-backlog', todo: 'state-todo', done: 'state-done' },
	labels: {
		processing: 'label-processing',
		processed: 'label-processed',
		error: 'label-error',
		readyToProcess: 'label-ready',
		auto: 'label-auto',
	},
	customFields: { cost: 'cf-cost' },
};

describe('linearConfigSchema', () => {
	it('round-trip identity: parse → serialize → reparse → deep-equal', () => {
		const parsed1 = linearConfigSchema.parse(fullFixture);
		const parsed2 = linearConfigSchema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});

	/**
	 * #1142 regression guard: if projectId is dropped from the schema
	 * declaration (or silently stripped by Zod), this test fails. This
	 * is the test that would have caught PR #1138 / #1142 before they
	 * shipped.
	 */
	it('#1142 regression: projectId survives round-trip', () => {
		const parsed = linearConfigSchema.parse(fullFixture);
		expect(parsed.projectId).toBe('project-uuid-0001');

		const serialized = JSON.parse(JSON.stringify(parsed));
		expect(serialized.projectId).toBe('project-uuid-0001');

		const reparsed = linearConfigSchema.parse(serialized);
		expect(reparsed.projectId).toBe('project-uuid-0001');
	});

	it('projectId is optional (spec-005 post-behavior)', () => {
		const { projectId: _, ...rest } = fullFixture;
		const parsed = linearConfigSchema.parse(rest);
		expect(parsed.projectId).toBeUndefined();
	});

	it('rejects missing teamId', () => {
		const { teamId: _, ...rest } = fullFixture;
		expect(() => linearConfigSchema.parse(rest)).toThrow();
	});

	it('accepts minimal config (teamId + statuses only)', () => {
		const parsed = linearConfigSchema.parse({
			teamId: 't',
			statuses: {},
		});
		expect(parsed.teamId).toBe('t');
	});

	it('accepts labels block with partial keys (all optional)', () => {
		const parsed = linearConfigSchema.parse({
			teamId: 't',
			statuses: {},
			labels: { processing: 'p' },
		});
		expect(parsed.labels?.processing).toBe('p');
	});
});

describe('linearManifest exposes configSchema', () => {
	it('linearManifest.configSchema is the extracted linearConfigSchema', () => {
		expect(linearManifest.configSchema).toBe(linearConfigSchema);
	});

	it('linearManifest.configFixture parses cleanly', () => {
		const schema = linearManifest.configSchema;
		expect(schema).toBeDefined();
		if (!schema) return;
		expect(() => schema.parse(linearManifest.configFixture)).not.toThrow();
	});

	it('linearManifest.configFixture includes projectId (exercises #1142 path end-to-end)', () => {
		const schema = linearManifest.configSchema;
		if (!schema) return;
		const parsed = schema.parse(linearManifest.configFixture) as { projectId?: string };
		expect(parsed.projectId).toBeDefined();
	});
});
