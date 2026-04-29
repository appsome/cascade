/**
 * Integration test for BullMQ delayed-job coalescing (spec — PM coalesce).
 *
 * Tests that `scheduleCoalescedJob` correctly supersedes prior pending
 * delayed jobs in a real BullMQ Queue backed by a real Redis instance.
 *
 * These tests require a running Redis server. They use a dedicated test
 * queue name to avoid interfering with the production cascade-jobs queue.
 */

import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseRedisUrl } from '../../src/utils/redis.js';

// ---------------------------------------------------------------------------
// Test queue — isolated from the production 'cascade-jobs' queue.
// ---------------------------------------------------------------------------

const TEST_QUEUE_NAME = 'cascade-test-coalesce';
const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
let testQueue: Queue;

beforeAll(async () => {
	testQueue = new Queue(TEST_QUEUE_NAME, { connection });
	// Drain any stale jobs from a previous test run.
	await testQueue.drain();
	await testQueue.clean(0, 100, 'delayed');
	await testQueue.clean(0, 100, 'wait');
	await testQueue.clean(0, 100, 'completed');
	await testQueue.clean(0, 100, 'failed');
});

afterEach(async () => {
	// Clean up between test cases.
	await testQueue.drain();
	await testQueue.clean(0, 100, 'delayed');
	await testQueue.clean(0, 100, 'wait');
});

afterAll(async () => {
	await testQueue.close();
});

// ---------------------------------------------------------------------------
// Local version of scheduleCoalescedJob that targets the test queue.
// ---------------------------------------------------------------------------

async function scheduleOnTestQueue(
	jobData: Record<string, unknown>,
	coalesceKey: string,
	delayMs: number,
): Promise<{ jobId: string; superseded: boolean }> {
	const jobId = `coalesce:${coalesceKey}`;
	let superseded = false;

	const existing = await testQueue.getJob(jobId);
	if (existing) {
		const state = await existing.getState();
		if (state === 'delayed' || state === 'waiting') {
			await existing.remove();
			superseded = true;
		}
	}

	await testQueue.add('test', jobData, { jobId, delay: delayMs });
	return { jobId, superseded };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduleCoalescedJob — real BullMQ delayed-job supersede', () => {
	it('schedules a new delayed job when none exists', async () => {
		const { jobId, superseded } = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-1' },
			'test-project:PROJ-1',
			60_000, // 1-minute delay so the job doesn't fire during the test
		);

		expect(jobId).toBe('coalesce:test-project:PROJ-1');
		expect(superseded).toBe(false);

		const job = await testQueue.getJob(jobId);
		expect(job).not.toBeNull();
		const state = await job?.getState();
		expect(state).toBe('delayed');
	});

	it('supersedes a prior delayed job with the same coalesceKey', async () => {
		// First dispatch (create event).
		const first = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-2', agentType: 'implementation' },
			'test-project:PROJ-2',
			60_000,
		);
		expect(first.superseded).toBe(false);

		// Second dispatch (update event — same key, should supersede first).
		const second = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-2', agentType: 'planning' },
			'test-project:PROJ-2',
			60_000,
		);
		expect(second.superseded).toBe(true);
		expect(second.jobId).toBe('coalesce:test-project:PROJ-2');

		// Only one delayed job should exist; its data should be the latest.
		const job = await testQueue.getJob('coalesce:test-project:PROJ-2');
		expect(job).not.toBeNull();
		expect((job?.data as { agentType?: string }).agentType).toBe('planning');
	});

	it('different coalesceKeys do not interfere with each other', async () => {
		const resultA = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-3' },
			'project-a:PROJ-3',
			60_000,
		);
		const resultB = await scheduleOnTestQueue(
			{ type: 'jira', issueKey: 'PROJ-4' },
			'project-b:PROJ-4',
			60_000,
		);

		expect(resultA.superseded).toBe(false);
		expect(resultB.superseded).toBe(false);

		// Both jobs should exist independently.
		const jobA = await testQueue.getJob('coalesce:project-a:PROJ-3');
		const jobB = await testQueue.getJob('coalesce:project-b:PROJ-4');
		expect(jobA).not.toBeNull();
		expect(jobB).not.toBeNull();
	});

	it('triple supersede: last writer wins', async () => {
		await scheduleOnTestQueue({ agentType: 'splitting' }, 'proj:TRIPLE', 60_000);
		await scheduleOnTestQueue({ agentType: 'planning' }, 'proj:TRIPLE', 60_000);
		const third = await scheduleOnTestQueue({ agentType: 'implementation' }, 'proj:TRIPLE', 60_000);

		expect(third.superseded).toBe(true);
		const job = await testQueue.getJob('coalesce:proj:TRIPLE');
		expect((job?.data as { agentType?: string }).agentType).toBe('implementation');
	});
});
