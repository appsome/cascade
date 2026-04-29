import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetPMProvider, mockIsActivePipelineOverCapacity, mockLogger, mockCaptureException } =
	vi.hoisted(() => ({
		mockGetPMProvider: vi.fn(),
		mockIsActivePipelineOverCapacity: vi.fn(),
		mockLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
		mockCaptureException: vi.fn(),
	}));

vi.mock('../../../../src/pm/context.js', () => ({
	getPMProvider: mockGetPMProvider,
}));

vi.mock('../../../../src/triggers/shared/backlog-check.js', () => ({
	isActivePipelineOverCapacity: mockIsActivePipelineOverCapacity,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

vi.mock('../../../../src/sentry.js', () => ({
	captureException: mockCaptureException,
}));

import { shouldBlockForPipelineCapacity } from '../../../../src/triggers/shared/pipeline-capacity-gate.js';
import { createMockProject } from '../../../helpers/factories.js';

const project = createMockProject({ maxInFlightItems: 1 });

beforeEach(() => {
	vi.resetAllMocks();
});

describe('shouldBlockForPipelineCapacity', () => {
	it('does not gate non-slot-consuming agent types (review, planning, splitting, backlog-manager)', async () => {
		for (const agentType of ['review', 'planning', 'splitting', 'backlog-manager', 'debug']) {
			expect(
				await shouldBlockForPipelineCapacity({
					project,
					agentType,
					workItemId: 'UA-1',
					source: 'jira',
				}),
			).toBe(false);
		}
		expect(mockGetPMProvider).not.toHaveBeenCalled();
		expect(mockIsActivePipelineOverCapacity).not.toHaveBeenCalled();
	});

	it('blocks implementation when active pipeline is over capacity', async () => {
		const fakeProvider = { type: 'jira' };
		mockGetPMProvider.mockReturnValue(fakeProvider);
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: true,
			reason: 'over-capacity',
			inFlightCount: 2,
			limit: 1,
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-3',
			source: 'jira',
		});

		expect(blocked).toBe(true);
		expect(mockIsActivePipelineOverCapacity).toHaveBeenCalledWith(project, fakeProvider, {
			excludeWorkItemId: 'UA-3',
		});
		expect(mockLogger.info).toHaveBeenCalledWith(
			'pipeline-at-capacity: skipping status-changed trigger',
			expect.objectContaining({
				agentType: 'implementation',
				workItemId: 'UA-3',
				inFlightCount: 2,
				limit: 1,
			}),
		);
	});

	it('allows implementation when below capacity', async () => {
		mockGetPMProvider.mockReturnValue({ type: 'jira' });
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: false,
			reason: 'below-capacity',
			inFlightCount: 0,
			limit: 1,
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-3',
			source: 'jira',
		});

		expect(blocked).toBe(false);
	});

	it('FAILS CLOSED (blocks) when no PM provider scope is available; logs ERROR and captures Sentry under tag pipeline_capacity_gate_no_pm_provider', async () => {
		// Spec 017 / plan 2: this branch used to log WARN and return false
		// (allow). After plan 2 wraps every PM router adapter in PM-provider
		// scope, hitting this branch on the routine path is no longer
		// expected — it represents a real AsyncLocalStorage scope leak that
		// operators need to investigate. Failing closed (block + error +
		// Sentry) is preferable to silently failing open and re-introducing
		// the original incident class (3+ concurrent implementation runs
		// against a `maxInFlightItems: 1` project).
		mockGetPMProvider.mockImplementation(() => {
			throw new Error('No PMProvider in scope');
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-3',
			source: 'jira',
		});

		expect(blocked).toBe(true);
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringMatching(/pipeline-capacity-gate: PM provider unavailable/),
			expect.objectContaining({ workItemId: 'UA-3', source: 'jira' }),
		);
		expect(mockLogger.warn).not.toHaveBeenCalled();
		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				tags: expect.objectContaining({ source: 'pipeline_capacity_gate_no_pm_provider' }),
				extra: expect.objectContaining({
					projectId: expect.any(String),
					workItemId: 'UA-3',
					triggerSource: 'jira',
					agentType: 'implementation',
				}),
			}),
		);
	});

	it('positive path still works after fail-closed conversion: provider in scope and pipeline-over-capacity returns true', async () => {
		// Regression pin against the over-capacity branch breaking during the
		// fail-closed migration. This duplicates an earlier test's positive
		// assertion explicitly to ensure plan 2 doesn't accidentally short-
		// circuit the routine path.
		mockGetPMProvider.mockReturnValue({ type: 'jira' });
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: true,
			reason: 'over-capacity',
			inFlightCount: 2,
			limit: 1,
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-4',
			source: 'jira',
		});

		expect(blocked).toBe(true);
		expect(mockCaptureException).not.toHaveBeenCalled();
	});

	it('positive path: provider in scope, pipeline below capacity returns false', async () => {
		// Companion regression pin to the over-capacity test above.
		mockGetPMProvider.mockReturnValue({ type: 'jira' });
		mockIsActivePipelineOverCapacity.mockResolvedValue({
			overCapacity: false,
			reason: undefined,
			inFlightCount: 0,
			limit: 1,
		});

		const blocked = await shouldBlockForPipelineCapacity({
			project,
			agentType: 'implementation',
			workItemId: 'UA-5',
			source: 'jira',
		});

		expect(blocked).toBe(false);
		expect(mockCaptureException).not.toHaveBeenCalled();
	});
});
