/**
 * JIRA manifest configSchema (plan 009/3 task 1).
 *
 * Extracts the JIRA Zod schema from its inline location in
 * src/config/schema.ts into a dedicated file so the manifest can
 * declare `configSchema: jiraConfigSchema` and the conformance
 * harness can run round-trip identity against it.
 *
 * The inline copy in src/config/schema.ts stays in place and is
 * marked @deprecated pointing here. Plan 5 routes the config mapper
 * through the manifest registry and deletes the duplicate.
 *
 * NOTE: JIRA API credentials (email, apiToken) live in the
 * project_credentials table, not in this config. The schema only
 * covers project-scoped settings.
 */

import { describe, expect, it } from 'vitest';
import { jiraConfigSchema } from '../../../../src/integrations/pm/jira/config-schema.js';
import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';

const fullFixture = {
	projectKey: 'CASCADE',
	baseUrl: 'https://example.atlassian.net',
	statuses: { backlog: '10000', todo: '10001', done: '10002' },
	issueTypes: { task: 'Task', bug: 'Bug' },
	customFields: { cost: 'customfield_10100' },
	labels: {
		processing: 'cascade-processing',
		processed: 'cascade-processed',
		error: 'cascade-error',
		readyToProcess: 'cascade-ready',
	},
};

describe('jiraConfigSchema', () => {
	it('round-trip identity: parse → serialize → reparse → deep-equal', () => {
		const parsed1 = jiraConfigSchema.parse(fullFixture);
		const parsed2 = jiraConfigSchema.parse(JSON.parse(JSON.stringify(parsed1)));
		expect(parsed2).toEqual(parsed1);
	});

	it('rejects missing projectKey', () => {
		const { projectKey: _, ...rest } = fullFixture;
		expect(() => jiraConfigSchema.parse(rest)).toThrow();
	});

	it('rejects missing baseUrl', () => {
		const { baseUrl: _, ...rest } = fullFixture;
		expect(() => jiraConfigSchema.parse(rest)).toThrow();
	});

	it('rejects invalid baseUrl (not a URL)', () => {
		expect(() => jiraConfigSchema.parse({ ...fullFixture, baseUrl: 'not a url' })).toThrow();
	});

	it('accepts minimal config (projectKey + baseUrl + statuses)', () => {
		const parsed = jiraConfigSchema.parse({
			projectKey: 'X',
			baseUrl: 'https://x.atlassian.net',
			statuses: {},
		});
		expect(parsed.projectKey).toBe('X');
	});

	it('applies label defaults when labels block is present but keys are missing', () => {
		// The inline schema declares .default() on each label key, but only
		// fires when the outer labels object exists.
		const parsed = jiraConfigSchema.parse({
			projectKey: 'X',
			baseUrl: 'https://x.atlassian.net',
			statuses: {},
			labels: {},
		});
		expect(parsed.labels?.processing).toBe('cascade-processing');
		expect(parsed.labels?.readyToProcess).toBe('cascade-ready');
	});
});

describe('jiraManifest exposes configSchema', () => {
	it('jiraManifest.configSchema is the extracted jiraConfigSchema', () => {
		expect(jiraManifest.configSchema).toBe(jiraConfigSchema);
	});

	it('jiraManifest.configFixture parses cleanly against the schema', () => {
		const schema = jiraManifest.configSchema;
		expect(schema).toBeDefined();
		if (!schema) return;
		expect(() => schema.parse(jiraManifest.configFixture)).not.toThrow();
	});
});
