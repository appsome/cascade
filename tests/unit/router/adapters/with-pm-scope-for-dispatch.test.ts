/**
 * Tests for the shared `withPMScopeForDispatch` helper at
 * `src/router/adapters/_shared.ts`. PM router adapters (Linear/Trello/JIRA)
 * call this helper to wrap `triggerRegistry.dispatch(ctx)` in PM-provider
 * AsyncLocalStorage scope, mirroring the GitHub adapter's existing shape at
 * `src/router/adapters/github.ts:withPMProvider(pmProvider, ...)`.
 *
 * Without this wrapping, `getPMProvider()` calls inside trigger handlers —
 * notably the pipeline-capacity gate at
 * `src/triggers/shared/pipeline-capacity-gate.ts` — throw, the gate falls
 * through to its conservative branch, and the in-flight cap is silently
 * disabled for every PM `status-changed` trigger. Verified live on
 * 2026-04-29 (32 occurrences/day in prod cascade-router).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreatePMProvider } = vi.hoisted(() => ({
	mockCreatePMProvider: vi.fn(),
}));

// Mock the legacy createPMProvider compatibility adapter — it's the function
// used elsewhere in the router (see github.ts:262) to materialize a PMProvider
// for use inside withPMProvider().
vi.mock('../../../../src/pm/index.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/pm/index.js')>();
	return {
		...actual,
		createPMProvider: mockCreatePMProvider,
	};
});

import { getPMProvider } from '../../../../src/pm/context.js';
import { withPMScopeForDispatch } from '../../../../src/router/adapters/_shared.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

const fakeProject: ProjectConfig = {
	id: 'proj-1',
	repo: 'org/repo',
	pm: { type: 'linear' },
} as ProjectConfig;

describe('withPMScopeForDispatch', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('resolves the project PM provider via createPMProvider and runs dispatch inside withPMProvider scope', async () => {
		const fakeProvider = { type: 'linear', __marker: 'fake' };
		mockCreatePMProvider.mockReturnValue(fakeProvider);

		const innerSawProvider = await withPMScopeForDispatch(fakeProject, async () => {
			// getPMProvider() must succeed here; returns the same provider instance.
			return getPMProvider();
		});

		expect(mockCreatePMProvider).toHaveBeenCalledWith(fakeProject);
		expect(innerSawProvider).toBe(fakeProvider);
	});

	it('returns whatever the dispatch callback returns (preserves TriggerResult passthrough)', async () => {
		mockCreatePMProvider.mockReturnValue({ type: 'linear' });
		const expectedResult = { agentType: 'review', agentInput: {} };

		const result = await withPMScopeForDispatch(fakeProject, async () => expectedResult);

		expect(result).toBe(expectedResult);
	});

	it('returns null when the dispatch callback returns null', async () => {
		mockCreatePMProvider.mockReturnValue({ type: 'linear' });

		const result = await withPMScopeForDispatch(fakeProject, async () => null);

		expect(result).toBeNull();
	});

	it('propagates errors thrown by the dispatch callback (does not swallow)', async () => {
		mockCreatePMProvider.mockReturnValue({ type: 'linear' });

		await expect(
			withPMScopeForDispatch(fakeProject, async () => {
				throw new Error('dispatch boom');
			}),
		).rejects.toThrow('dispatch boom');
	});
});
