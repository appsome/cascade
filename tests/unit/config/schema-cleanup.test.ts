/**
 * Asserts that plan 009/5 task 2 removed the inline Zod schemas for
 * Trello / JIRA / Linear from src/config/schema.ts. The project
 * config's `trello`/`jira`/`linear` fields now reference the
 * per-manifest config schemas directly — single source of truth.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jiraConfigSchema } from '../../../src/integrations/pm/jira/config-schema.js';
import { linearConfigSchema } from '../../../src/integrations/pm/linear/config-schema.js';
import { trelloConfigSchema } from '../../../src/integrations/pm/trello/config-schema.js';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_PATH = resolve(PROJECT_ROOT, 'src/config/schema.ts');

describe('src/config/schema.ts — post-009/5 cleanup', () => {
	it('does not define JiraConfigSchema inline', () => {
		const source = readFileSync(SCHEMA_PATH, 'utf8');
		expect(source).not.toMatch(/const\s+JiraConfigSchema\s*=\s*z\.object/);
	});

	it('does not define LinearConfigSchema inline', () => {
		const source = readFileSync(SCHEMA_PATH, 'utf8');
		expect(source).not.toMatch(/const\s+LinearConfigSchema\s*=\s*z\.object/);
	});

	it('imports the manifest-owned config schemas', () => {
		const source = readFileSync(SCHEMA_PATH, 'utf8');
		expect(source).toMatch(/trelloConfigSchema/);
		expect(source).toMatch(/jiraConfigSchema/);
		expect(source).toMatch(/linearConfigSchema/);
	});
});

describe('projectId-on-Linear round-trip regression (mirrors plan 009/4 #1142 guard)', () => {
	it('projectId survives round-trip through the manifest-owned schema', () => {
		const fixture = {
			teamId: 'team-1',
			projectId: 'project-1',
			statuses: { todo: 'state-todo' },
		};
		const parsed = linearConfigSchema.parse(fixture) as { projectId?: string };
		expect(parsed.projectId).toBe('project-1');
		const reparsed = linearConfigSchema.parse(JSON.parse(JSON.stringify(parsed))) as {
			projectId?: string;
		};
		expect(reparsed.projectId).toBe('project-1');
	});
});

describe('imports are wired correctly', () => {
	it('trelloConfigSchema accepts a minimal fixture', () => {
		expect(() => trelloConfigSchema.parse({ boardId: 'b', lists: {}, labels: {} })).not.toThrow();
	});

	it('jiraConfigSchema accepts a minimal fixture', () => {
		expect(() =>
			jiraConfigSchema.parse({
				projectKey: 'X',
				baseUrl: 'https://x.atlassian.net',
				statuses: {},
			}),
		).not.toThrow();
	});

	it('linearConfigSchema accepts a minimal fixture', () => {
		expect(() => linearConfigSchema.parse({ teamId: 't', statuses: {} })).not.toThrow();
	});
});
