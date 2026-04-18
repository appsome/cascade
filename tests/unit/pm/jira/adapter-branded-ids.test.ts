/**
 * JiraPMProvider adapter accepts branded IDs at class-level method
 * signatures (plan 009/3 task 3).
 *
 * Same pattern as Trello: PMProvider interface keeps `string`; the
 * adapter narrows scalar parameters via TypeScript method bivariance.
 * `createWorkItem` stays on `CreateWorkItemConfig` due to TS
 * object-property invariance — documented in the adapter jsdoc.
 */

import { describe, expectTypeOf, it, vi } from 'vitest';

vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(async (_creds, fn) => fn()),
	jiraClient: {
		getIssue: vi.fn(async () => ({
			key: 'CASC-1',
			fields: { summary: 'Test', description: '', status: { name: 'To Do' }, labels: [] },
		})),
		searchIssues: vi.fn(async () => ({ issues: [] })),
		transitionIssue: vi.fn(),
		getTransitions: vi.fn(async () => ({ transitions: [] })),
		updateLabels: vi.fn(),
		getIssueLabels: vi.fn(async () => []),
	},
}));

import type { ContainerId, LabelId, StateId } from '../../../../src/pm/ids.js';
import { parseContainerId, parseLabelId, parseStateId } from '../../../../src/pm/ids.js';
import { JiraPMProvider } from '../../../../src/pm/jira/adapter.js';

const config = {
	projectKey: 'CASC',
	baseUrl: 'https://example.atlassian.net',
	statuses: { todo: 'To Do', inProgress: 'In Progress', done: 'Done' },
};

describe('JiraPMProvider — branded ID narrowing', () => {
	it('parseStateId / parseContainerId / parseLabelId produce distinct branded types', () => {
		const s = parseStateId('10001');
		const c = parseContainerId('CASC');
		const l = parseLabelId('cascade-ready');
		expectTypeOf(s).toEqualTypeOf<StateId>();
		expectTypeOf(c).toEqualTypeOf<ContainerId>();
		expectTypeOf(l).toEqualTypeOf<LabelId>();
	});

	it('type-level: method params that CAN narrow DO narrow', () => {
		const adapter = new JiraPMProvider(config);

		// moveWorkItem's destination narrows (JIRA stores a transition name
		// OR a target state id on the adapter side; we accept the branded
		// ContainerId at the TrelloPMProvider convention — JIRA's semantics
		// reuse ContainerId here because `destination` is treated as an
		// opaque identifier by the adapter).
		type MoveParams = Parameters<typeof adapter.moveWorkItem>;
		expectTypeOf<MoveParams[1]>().toEqualTypeOf<ContainerId>();

		// addLabel / removeLabel narrow their label parameter to LabelId.
		type AddLabelParams = Parameters<typeof adapter.addLabel>;
		expectTypeOf<AddLabelParams[1]>().toEqualTypeOf<LabelId>();

		// listWorkItems narrows containerId to ContainerId | undefined.
		type ListParams = Parameters<typeof adapter.listWorkItems>;
		expectTypeOf<ListParams[0]>().toEqualTypeOf<ContainerId | undefined>();

		// createWorkItem stays on CreateWorkItemConfig (object-property
		// invariance) — documented in the adapter jsdoc.
		type CreateParams = Parameters<typeof adapter.createWorkItem>;
		expectTypeOf<CreateParams[0]['containerId']>().toEqualTypeOf<string>();
	});
});
