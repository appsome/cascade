import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockSuspendRunById,
	mockCreateSuspendedRun,
	mockFindSuspendedRunByJobId,
	mockRequeueSuspendedRun,
	mockUpdateRunSuspension,
	mockGetRunById,
	mockCountActiveRuns,
	mockFailQueuedOrRunningRun,
	mockScheduleResume,
	mockSubmitDashboardJob,
	mockReleaseLocks,
	mockResolveCredential,
	mockAddJob,
	mockCaptureMessage,
} = vi.hoisted(() => ({
	mockSuspendRunById: vi.fn().mockResolvedValue(true),
	mockCreateSuspendedRun: vi.fn().mockResolvedValue('run-new'),
	mockFindSuspendedRunByJobId: vi.fn().mockResolvedValue(null),
	mockRequeueSuspendedRun: vi.fn().mockResolvedValue(true),
	mockUpdateRunSuspension: vi.fn().mockResolvedValue(true),
	mockGetRunById: vi.fn(),
	mockCountActiveRuns: vi.fn().mockResolvedValue(0),
	mockFailQueuedOrRunningRun: vi.fn().mockResolvedValue(true),
	mockScheduleResume: vi.fn().mockResolvedValue('resume-job-1'),
	mockSubmitDashboardJob: vi.fn().mockResolvedValue('dash-job-1'),
	mockReleaseLocks: vi.fn().mockResolvedValue(undefined),
	mockResolveCredential: vi.fn(),
	mockAddJob: vi.fn().mockResolvedValue('cascade-job-1'),
	mockCaptureMessage: vi.fn(),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	suspendRunById: mockSuspendRunById,
	createSuspendedRun: mockCreateSuspendedRun,
	findSuspendedRunByJobId: mockFindSuspendedRunByJobId,
	requeueSuspendedRun: mockRequeueSuspendedRun,
	updateRunSuspension: mockUpdateRunSuspension,
	getRunById: mockGetRunById,
	countActiveRuns: mockCountActiveRuns,
	failQueuedOrRunningRun: mockFailQueuedOrRunningRun,
	DEFAULT_STALE_RUN_THRESHOLD_MS: 2 * 60 * 60 * 1000,
}));

vi.mock('../../../src/queue/client.js', () => ({
	scheduleResumeSuspendedRun: mockScheduleResume,
	submitDashboardJob: mockSubmitDashboardJob,
}));

vi.mock('../../../src/router/dispatch-compensator.js', () => ({
	releaseLocksForFailedJob: mockReleaseLocks,
}));

vi.mock('../../../src/router/engine-credential-rotation.js', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		resolveClaudeCredentialForJob: mockResolveCredential,
	};
});

vi.mock('../../../src/router/queue.js', () => ({
	addJob: mockAddJob,
}));

vi.mock('../../../src/sentry.js', () => ({
	addBreadcrumb: vi.fn(),
	captureException: vi.fn(),
	captureMessage: mockCaptureMessage,
}));

import type { ResumeSuspendedRunJob } from '../../../src/queue/client.js';
import type { RotationDecision } from '../../../src/router/engine-credential-rotation.js';
import {
	handleResumeSuspendedRun,
	suspendJobForRateLimit,
} from '../../../src/router/run-suspension.js';

function suspendDecision(
	overrides: Partial<Extract<RotationDecision, { kind: 'suspend' }>> = {},
): Extract<RotationDecision, { kind: 'suspend' }> {
	return {
		kind: 'suspend',
		reason: 'all 2 Anthropic credentials at/over 95%',
		resumeAt: new Date(Date.now() + 30 * 60 * 1000),
		gatingBucketLabels: ['5-Hour Window'],
		poolSize: 2,
		...overrides,
	};
}

function fakeJob(data: Record<string, unknown>, id = 'job-1'): Job<never> {
	return { id, data } as unknown as Job<never>;
}

const ctx = { projectId: 'proj-1', agentType: 'implementation', workItemId: 'card-1' };

describe('suspendJobForRateLimit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSuspendRunById.mockResolvedValue(true);
		mockFindSuspendedRunByJobId.mockResolvedValue(null);
		mockCreateSuspendedRun.mockResolvedValue('run-new');
		mockScheduleResume.mockResolvedValue('resume-job-1');
	});

	it('flips the pre-created run for manual-run jobs with a runId', async () => {
		const decision = suspendDecision();
		await suspendJobForRateLimit(fakeJob({ type: 'manual-run', runId: 'run-q1' }), decision, ctx);

		expect(mockSuspendRunById).toHaveBeenCalledWith('run-q1', decision.reason, decision.resumeAt);
		expect(mockCreateSuspendedRun).not.toHaveBeenCalled();
	});

	it('creates a suspended row keyed by jobId for webhook jobs', async () => {
		const decision = suspendDecision();
		await suspendJobForRateLimit(
			fakeJob({ type: 'github', triggerResult: { triggerType: 'check-suite-success' } }, 'job-77'),
			decision,
			ctx,
		);

		expect(mockFindSuspendedRunByJobId).toHaveBeenCalledWith('job-77');
		expect(mockCreateSuspendedRun).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
				engine: 'claude-code',
				triggerType: 'check-suite-success',
				jobId: 'job-77',
			}),
		);
	});

	it('is idempotent across BullMQ retries (existing suspended row reused)', async () => {
		mockFindSuspendedRunByJobId.mockResolvedValue('run-existing');
		await suspendJobForRateLimit(fakeJob({ type: 'github' }, 'job-77'), suspendDecision(), ctx);

		expect(mockCreateSuspendedRun).not.toHaveBeenCalled();
		expect(mockScheduleResume).toHaveBeenCalledWith(
			expect.objectContaining({ runId: 'run-existing' }),
			expect.any(Number),
		);
	});

	it('never flips the runId of retry-run/debug-analysis jobs (references the ORIGINAL run)', async () => {
		await suspendJobForRateLimit(
			fakeJob({ type: 'retry-run', runId: 'original-run' }),
			suspendDecision(),
			ctx,
		);

		expect(mockSuspendRunById).not.toHaveBeenCalled();
		expect(mockCreateSuspendedRun).toHaveBeenCalled();
	});

	it('explicitly releases dispatch locks (suspension completes the job — no failed event)', async () => {
		const jobData = { type: 'manual-run', runId: 'run-q1' };
		await suspendJobForRateLimit(fakeJob(jobData), suspendDecision(), ctx);

		expect(mockReleaseLocks).toHaveBeenCalledWith(jobData);
	});

	it('routes dashboard job types back to cascade-dashboard-jobs and webhooks to cascade-jobs', async () => {
		await suspendJobForRateLimit(
			fakeJob({ type: 'manual-run', runId: 'r1' }),
			suspendDecision(),
			ctx,
		);
		expect(mockScheduleResume).toHaveBeenCalledWith(
			expect.objectContaining({ originalQueue: 'cascade-dashboard-jobs' }),
			expect.any(Number),
		);

		await suspendJobForRateLimit(fakeJob({ type: 'linear' }), suspendDecision(), ctx);
		expect(mockScheduleResume).toHaveBeenLastCalledWith(
			expect.objectContaining({ originalQueue: 'cascade-jobs' }),
			expect.any(Number),
		);
	});

	it('propagates scheduling failures so BullMQ retries the dispatch', async () => {
		mockScheduleResume.mockRejectedValueOnce(new Error('redis down'));

		await expect(
			suspendJobForRateLimit(fakeJob({ type: 'manual-run', runId: 'r1' }), suspendDecision(), ctx),
		).rejects.toThrow('redis down');
	});
});

describe('handleResumeSuspendedRun', () => {
	const baseResumeJob: ResumeSuspendedRunJob = {
		type: 'resume-suspended-run',
		runId: 'run-s1',
		originalQueue: 'cascade-jobs',
		originalJobData: {
			type: 'linear',
			triggerResult: { agentType: 'implementation', agentInput: { project: {} } },
		},
		suspendCount: 1,
		projectId: 'proj-1',
		agentType: 'implementation',
		workItemId: 'card-1',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRunById.mockResolvedValue({ id: 'run-s1', status: 'suspended' });
		mockCountActiveRuns.mockResolvedValue(0);
		mockResolveCredential.mockResolvedValue({
			kind: 'token',
			credentialId: '1',
			credentialName: 'personal',
			token: 'tok',
		});
		mockRequeueSuspendedRun.mockResolvedValue(true);
	});

	it('no-ops when the run is no longer suspended (cancelled during suspension)', async () => {
		mockGetRunById.mockResolvedValue({ id: 'run-s1', status: 'failed' });

		await handleResumeSuspendedRun(fakeJob(baseResumeJob) as never);

		expect(mockRequeueSuspendedRun).not.toHaveBeenCalled();
		expect(mockAddJob).not.toHaveBeenCalled();
	});

	it('fails the run as superseded when a newer run exists for the work item', async () => {
		mockCountActiveRuns.mockResolvedValue(1);

		await handleResumeSuspendedRun(fakeJob(baseResumeJob) as never);

		expect(mockCountActiveRuns).toHaveBeenCalledWith(
			expect.objectContaining({ excludeRunId: 'run-s1', includeQueued: true }),
		);
		expect(mockFailQueuedOrRunningRun).toHaveBeenCalledWith(
			'run-s1',
			expect.stringContaining('Superseded'),
		);
		expect(mockAddJob).not.toHaveBeenCalled();
	});

	it('re-suspends with an incremented count when limits are still exhausted', async () => {
		const decision = suspendDecision();
		mockResolveCredential.mockResolvedValue(decision);

		await handleResumeSuspendedRun(fakeJob(baseResumeJob) as never);

		expect(mockUpdateRunSuspension).toHaveBeenCalledWith(
			'run-s1',
			decision.reason,
			decision.resumeAt,
		);
		expect(mockScheduleResume).toHaveBeenCalledWith(
			expect.objectContaining({ suspendCount: 2 }),
			expect.any(Number),
		);
		expect(mockAddJob).not.toHaveBeenCalled();
	});

	it('fires the flapping canary at the re-suspension threshold', async () => {
		mockResolveCredential.mockResolvedValue(suspendDecision());

		await handleResumeSuspendedRun(fakeJob({ ...baseResumeJob, suspendCount: 9 }) as never);

		expect(mockCaptureMessage).toHaveBeenCalledWith(
			expect.stringContaining('re-suspended repeatedly'),
			expect.objectContaining({ tags: { source: 'rotation_suspend_flap' } }),
		);
	});

	it('requeues and re-submits webhook jobs with preCreatedRunId threaded into agentInput', async () => {
		await handleResumeSuspendedRun(fakeJob(baseResumeJob) as never);

		expect(mockRequeueSuspendedRun).toHaveBeenCalledWith('run-s1');
		expect(mockAddJob).toHaveBeenCalledTimes(1);
		const submitted = mockAddJob.mock.calls[0][0] as {
			triggerResult: { agentInput: { preCreatedRunId?: string } };
		};
		expect(submitted.triggerResult.agentInput.preCreatedRunId).toBe('run-s1');
		// Deep copy — the original job data must not be mutated.
		expect(
			(baseResumeJob.originalJobData as { triggerResult: { agentInput: Record<string, unknown> } })
				.triggerResult.agentInput.preCreatedRunId,
		).toBeUndefined();
	});

	it('re-submits manual-run jobs with runId on the dashboard queue', async () => {
		await handleResumeSuspendedRun(
			fakeJob({
				...baseResumeJob,
				originalQueue: 'cascade-dashboard-jobs',
				originalJobData: { type: 'manual-run', projectId: 'proj-1', agentType: 'implementation' },
			}) as never,
		);

		expect(mockSubmitDashboardJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'manual-run', runId: 'run-s1' }),
		);
	});

	it('re-submits retry-run jobs with preCreatedRunId', async () => {
		await handleResumeSuspendedRun(
			fakeJob({
				...baseResumeJob,
				originalQueue: 'cascade-dashboard-jobs',
				originalJobData: { type: 'retry-run', runId: 'original-run', projectId: 'proj-1' },
			}) as never,
		);

		expect(mockSubmitDashboardJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'retry-run',
				runId: 'original-run',
				preCreatedRunId: 'run-s1',
			}),
		);
	});

	it('skips re-submit when the requeue races a cancel', async () => {
		mockRequeueSuspendedRun.mockResolvedValue(false);

		await handleResumeSuspendedRun(fakeJob(baseResumeJob) as never);

		expect(mockAddJob).not.toHaveBeenCalled();
	});

	it('fails the run without rethrowing when re-enqueue fails (no double-submit on retry)', async () => {
		mockAddJob.mockRejectedValue(new Error('redis gone'));

		await expect(
			handleResumeSuspendedRun(fakeJob(baseResumeJob) as never),
		).resolves.toBeUndefined();

		expect(mockFailQueuedOrRunningRun).toHaveBeenCalledWith(
			'run-s1',
			expect.stringContaining('Failed to re-enqueue'),
		);
	});
});
