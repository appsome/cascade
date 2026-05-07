import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	type JiraIntegrationConfig,
	jiraConfigSchema,
} from '../../../src/integrations/pm/jira/config-schema.js';
import {
	type LinearIntegrationConfig,
	linearConfigSchema,
} from '../../../src/integrations/pm/linear/config-schema.js';
import { trelloConfigSchema } from '../../../src/integrations/pm/trello/config-schema.js';

describe('PM config schemas — alerts slot', () => {
	it('trelloConfigSchema accepts lists.alerts and labels.cascade-alert without error', () => {
		const result = trelloConfigSchema.safeParse({
			boardId: 'b1',
			lists: { alerts: 'list-id-alerts', todo: 'list-id-todo' },
			labels: { 'cascade-alert': 'lbl-id' },
		});
		expect(result.success).toBe(true);
	});

	it('jiraConfigSchema accepts statuses.alerts and labels.cascadeAlert', () => {
		const result = jiraConfigSchema.safeParse({
			projectKey: 'P',
			baseUrl: 'https://acme.atlassian.net',
			statuses: { alerts: 'In Triage', todo: 'To Do' },
			labels: { cascadeAlert: 'cascade-alert' },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.labels?.cascadeAlert).toBe('cascade-alert');
		}
	});

	it('linearConfigSchema accepts statuses.alerts and labels.cascadeAlert', () => {
		const result = linearConfigSchema.safeParse({
			teamId: 'team-1',
			statuses: { alerts: 'state-uuid-triage', todo: 'state-uuid-todo' },
			labels: { cascadeAlert: 'label-uuid' },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.labels?.cascadeAlert).toBe('label-uuid');
		}
	});

	it('JiraIntegrationConfig labels has optional cascadeAlert field', () => {
		expectTypeOf<JiraIntegrationConfig['labels']>().toEqualTypeOf<
			| {
					processing?: string;
					processed?: string;
					error?: string;
					readyToProcess?: string;
					cascadeAlert?: string;
			  }
			| undefined
		>();
	});

	it('LinearIntegrationConfig labels has optional cascadeAlert field', () => {
		expectTypeOf<LinearIntegrationConfig['labels']>().toEqualTypeOf<
			| {
					processing?: string;
					processed?: string;
					error?: string;
					readyToProcess?: string;
					auto?: string;
					cascadeAlert?: string;
			  }
			| undefined
		>();
	});
});
