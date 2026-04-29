/**
 * Tests for the shared `postPMAckComment` helper. After plan 017/1, it
 * delegates to `dispatchPMAck` from `src/router/pm-ack-dispatch.ts` and
 * preserves its existing `string | null` return contract for backward
 * compatibility with `src/triggers/github/webhook-handler.ts:maybePostPmAckComment`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatchPMAck } = vi.hoisted(() => ({
	mockDispatchPMAck: vi.fn(),
}));

vi.mock('../../../../src/router/pm-ack-dispatch.js', () => ({
	dispatchPMAck: mockDispatchPMAck,
}));

import { postPMAckComment } from '../../../../src/triggers/shared/pm-ack.js';

describe('postPMAckComment (shared)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('delegates to dispatchPMAck with the same arg shape', async () => {
		mockDispatchPMAck.mockResolvedValue({ commentId: 'abc', message: 'msg' });

		await postPMAckComment('proj-1', 'item-1', 'linear', 'msg', 'backlog-manager');

		expect(mockDispatchPMAck).toHaveBeenCalledWith({
			projectId: 'proj-1',
			workItemId: 'item-1',
			pmType: 'linear',
			message: 'msg',
			agentType: 'backlog-manager',
		});
	});

	it('returns the unwrapped commentId as a string when dispatch succeeds (string id)', async () => {
		mockDispatchPMAck.mockResolvedValue({ commentId: 'comment-123', message: 'msg' });

		const result = await postPMAckComment('proj-1', 'item-1', 'trello', 'msg');

		expect(result).toBe('comment-123');
	});

	it('returns the commentId as a string when dispatch returns a numeric id (JIRA-shaped)', async () => {
		mockDispatchPMAck.mockResolvedValue({ commentId: 12345, message: 'msg' });

		const result = await postPMAckComment('proj-2', 'PROJ-1', 'jira', 'msg');

		expect(result).toBe('12345'); // String() normalization preserves the existing string|null contract
	});

	it('returns null when dispatch returns undefined (null comment id from underlying client)', async () => {
		mockDispatchPMAck.mockResolvedValue(undefined);

		const result = await postPMAckComment('proj-1', 'item-1', 'linear', 'msg');

		expect(result).toBeNull();
	});
});
