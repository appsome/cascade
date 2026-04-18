/**
 * LinearPMProvider branded-ID narrowing (plan 009/4 task 3 — THE PAYOFF).
 *
 * Linear shipped three production bugs in 2026-04 from storing state
 * names where state UUIDs were required (#1117 status mapping, #1137
 * create issue, #1139 checklist sub-issue). Branded StateId /
 * ContainerId / LabelId types make each of those mistakes a compile
 * error at direct `LinearPMProvider` callers.
 *
 * The PMProvider interface itself keeps `string` for backward compat;
 * the adapter narrows via TypeScript method bivariance.
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('../../../../src/linear/client.js', () => ({
	withLinearCredentials: vi.fn(async (_creds: unknown, fn: () => unknown) => fn()),
	linearClient: {
		listIssues: vi.fn(async () => []),
		updateIssueState: vi.fn(),
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
		getIssue: vi.fn(async () => ({
			id: 'issue-1',
			title: 'x',
			description: '',
			url: '',
			state: { name: 'Todo' },
			labels: [],
		})),
	},
}));

import type { ContainerId, LabelId, StateId } from '../../../../src/pm/ids.js';
import { InvalidIdError, parseStateId } from '../../../../src/pm/ids.js';
import { LinearPMProvider } from '../../../../src/pm/linear/adapter.js';

const config = {
	teamId: 'team-uuid-0001',
	statuses: { todo: 'state-todo-uuid', done: 'state-done-uuid' },
	labels: { processing: 'label-processing-uuid' },
};

describe('LinearPMProvider — branded ID narrowing', () => {
	it('type-level: method params that CAN narrow DO narrow', () => {
		const adapter = new LinearPMProvider(config);

		// #1137 regression guard: moveWorkItem's destination narrows to
		// ContainerId (Linear state ID, a UUID). A bare state name like
		// 'In Progress' is a compile error at a direct-adapter call site.
		type MoveParams = Parameters<typeof adapter.moveWorkItem>;
		expectTypeOf<MoveParams[1]>().toEqualTypeOf<ContainerId>();

		// addLabel / removeLabel narrow to LabelId (UUID). Storing a
		// label name where an ID is expected was the shape of adjacent
		// bugs (#1117 / #1139).
		type AddLabelParams = Parameters<typeof adapter.addLabel>;
		expectTypeOf<AddLabelParams[1]>().toEqualTypeOf<LabelId>();

		// listWorkItems narrows containerId (= team UUID) to ContainerId.
		type ListParams = Parameters<typeof adapter.listWorkItems>;
		expectTypeOf<ListParams[0]>().toEqualTypeOf<ContainerId | undefined>();

		// createWorkItem keeps CreateWorkItemConfig (object-property
		// invariance); internal parsing happens at the boundary.
		type CreateParams = Parameters<typeof adapter.createWorkItem>;
		expectTypeOf<CreateParams[0]['containerId']>().toEqualTypeOf<string>();
	});

	it('parseStateId rejects empty string with InvalidIdError (Linear UUID shape enforcement)', () => {
		expect(() => parseStateId('')).toThrow(InvalidIdError);
		expect(() => parseStateId('   ')).toThrow(InvalidIdError);
	});

	it('parseStateId produces a branded StateId for a UUID-shaped string', () => {
		const id = parseStateId('0bd4a4e5-9d8c-4e7f-8b1a-1234567890ab');
		expectTypeOf(id).toEqualTypeOf<StateId>();
	});
});
