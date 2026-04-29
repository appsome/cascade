import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock BullMQ + redis utils so the module can be imported without a real Redis.
// vi.hoisted() runs before vi.mock() factories so mock instances are available
// inside factory closures.
// ---------------------------------------------------------------------------

const { mockJobInstance, mockQueueInstance } = vi.hoisted(() => {
	const mockJobInstance = {
		getState: vi.fn(),
		remove: vi.fn(),
	};
	const mockQueueInstance = {
		on: vi.fn(),
		add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
		getJob: vi.fn().mockResolvedValue(null),
		getWaitingCount: vi.fn().mockResolvedValue(0),
		getActiveCount: vi.fn().mockResolvedValue(0),
		getCompletedCount: vi.fn().mockResolvedValue(0),
		getFailedCount: vi.fn().mockResolvedValue(0),
	};
	return { mockJobInstance, mockQueueInstance };
});

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => mockQueueInstance),
}));

vi.mock('../../../src/utils/redis.js', () => ({
	parseRedisUrl: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { redisUrl: 'redis://localhost:6379' },
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import type { CascadeJob } from '../../../src/router/queue.js';
import { scheduleCoalescedJob } from '../../../src/router/queue.js';

const sampleJob: CascadeJob = {
	type: 'jira',
	source: 'jira',
	payload: {},
	projectId: 'proj-1',
	issueKey: 'PROJ-42',
	webhookEvent: 'jira:issue_created',
	receivedAt: new Date().toISOString(),
};

describe('scheduleCoalescedJob', () => {
	beforeEach(() => {
		mockQueueInstance.getJob.mockResolvedValue(null);
		mockQueueInstance.add.mockResolvedValue({ id: 'coalesce:proj-1:PROJ-42' });
		mockJobInstance.getState.mockReset();
		mockJobInstance.remove.mockReset();
	});

	it('schedules a new delayed job when no existing job exists', async () => {
		mockQueueInstance.getJob.mockResolvedValue(null);

		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.jobId).toBe('coalesce:proj-1:PROJ-42');
		expect(result.superseded).toBe(false);
		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			'jira',
			sampleJob,
			expect.objectContaining({ jobId: 'coalesce:proj-1:PROJ-42', delay: 10_000 }),
		);
	});

	it('removes existing delayed job and returns superseded=true with supersededJobData', async () => {
		const existingData: CascadeJob = {
			...sampleJob,
			projectId: 'proj-old',
			triggerResult: { agentType: 'planning', workItemId: 'PROJ-42', agentInput: {} },
		};
		const mockJobWithData = { ...mockJobInstance, data: existingData };
		mockJobWithData.getState = vi.fn().mockResolvedValue('delayed');
		mockJobWithData.remove = vi.fn().mockResolvedValue(undefined);
		mockQueueInstance.getJob.mockResolvedValue(mockJobWithData);

		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.superseded).toBe(true);
		expect(result.supersededJobData).toEqual(existingData);
		expect(mockJobWithData.remove).toHaveBeenCalledOnce();
		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			'jira',
			sampleJob,
			expect.objectContaining({ jobId: 'coalesce:proj-1:PROJ-42', delay: 10_000 }),
		);
	});

	it('returns activeExists=true and skips add() when an active job has the same ID', async () => {
		mockJobInstance.getState.mockResolvedValue('active');
		mockJobInstance.remove.mockResolvedValue(undefined);
		mockQueueInstance.getJob.mockResolvedValue(mockJobInstance);

		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.superseded).toBe(false);
		expect(result.activeExists).toBe(true);
		expect(mockJobInstance.remove).not.toHaveBeenCalled();
		// Must NOT add a new job — BullMQ would silently ignore it for active IDs
		// and the caller would incorrectly mark locks for a non-existent job.
		expect(mockQueueInstance.add).not.toHaveBeenCalled();
	});

	it('uses the coalesceKey to derive the BullMQ job ID', async () => {
		const result = await scheduleCoalescedJob(sampleJob, 'my-project:ISSUE-99', 5_000);
		expect(result.jobId).toBe('coalesce:my-project:ISSUE-99');
		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			expect.any(String),
			expect.anything(),
			expect.objectContaining({ jobId: 'coalesce:my-project:ISSUE-99' }),
		);
	});
});
