import { Queue } from 'bullmq';
import { captureException } from '../sentry.js';
import type { TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { parseRedisUrl } from '../utils/redis.js';
import { routerConfig } from './config.js';

const connection = parseRedisUrl(routerConfig.redisUrl);

// Job types
// Note: ackCommentId is `string` for Trello/JIRA (string IDs from their APIs)
// and `number` for GitHub (numeric IDs from GitHub API). Downstream consumers
// (ProgressMonitor) normalize to string via the adapter layer.
export interface TrelloJob {
	type: 'trello';
	source: 'trello';
	payload: unknown;
	projectId: string;
	workItemId: string;
	actionType: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
	/** When true, the worker must post the ack comment before processing (deferred ack). */
	pendingAck?: boolean;
	/** Pre-generated ack message text for deferred ack posting. */
	ackMessage?: string;
}

export interface GitHubJob {
	type: 'github';
	source: 'github';
	payload: unknown;
	eventType: string;
	repoFullName: string;
	receivedAt: string;
	ackCommentId?: number;
	ackMessage?: string;
	triggerResult?: TriggerResult;
}

export interface JiraJob {
	type: 'jira';
	source: 'jira';
	payload: unknown;
	projectId: string;
	issueKey: string;
	webhookEvent: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
	/** When true, the worker must post the ack comment before processing (deferred ack). */
	pendingAck?: boolean;
	/** Pre-generated ack message text for deferred ack posting. */
	ackMessage?: string;
}

export interface SentryJob {
	type: 'sentry';
	source: 'sentry';
	payload: unknown;
	projectId: string;
	/** Sentry resource type: 'event_alert' | 'metric_alert' | 'issue' */
	eventType: string;
	receivedAt: string;
	triggerResult?: TriggerResult;
}

export interface LinearJob {
	type: 'linear';
	source: 'linear';
	payload: unknown;
	projectId: string;
	workItemId?: string;
	eventType: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
	/** When true, the worker must post the ack comment before processing (deferred ack). */
	pendingAck?: boolean;
	/** Pre-generated ack message text for deferred ack posting. */
	ackMessage?: string;
}

export type CascadeJob = TrelloJob | GitHubJob | JiraJob | SentryJob | LinearJob;

// Create the job queue
export const jobQueue = new Queue<CascadeJob>('cascade-jobs', {
	connection,
	defaultJobOptions: {
		// Spec 015/2: bounded retries on dispatch failures only. Terminal
		// errors (validation, image-not-found-after-fallback) bypass via
		// `UnrecoverableError`. Agents themselves still handle their own
		// internal errors — these attempts apply only to the dispatch path
		// (the time between BullMQ pulling the job and the worker
		// container *starting*, before the agent is even running).
		attempts: 4,
		backoff: { type: 'exponential', delay: 5_000 },
		removeOnComplete: {
			age: 24 * 60 * 60, // Keep completed jobs for 24 hours
			count: 100, // Keep last 100 completed jobs
		},
		removeOnFail: {
			age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
		},
	},
});

// Queue event logging
jobQueue.on('error', (err) => {
	logger.error('Queue error', { error: String(err) });
	captureException(err, { tags: { source: 'job_queue' } });
});

logger.info('Queue initialized', { redisUrl: routerConfig.redisUrl });

// Helper to add a job
export async function addJob(job: CascadeJob): Promise<string> {
	const jobId = `${job.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const result = await jobQueue.add(job.type, job, { jobId });
	logger.info('Job added to queue', { id: result.id, type: job.type });
	return result.id ?? jobId;
}

export interface ScheduleCoalescedJobResult {
	jobId: string;
	superseded: boolean;
}

/**
 * Schedule a PM job as a BullMQ delayed job keyed by `coalesceKey`.
 *
 * If a delayed/waiting job with the same key already exists it is removed
 * before the new job is added, superseding the previous dispatch. Active
 * (already running) jobs are left untouched; `superseded` is `false` in that
 * case.
 *
 * This replaces the in-memory `create-coalesce-window.ts` mechanism with a
 * durable, per-key deduplication that coalesces across any agent types for
 * the same `${projectId}:${workItemId}` within the settle window.
 */
export async function scheduleCoalescedJob(
	job: CascadeJob,
	coalesceKey: string,
	delayMs: number,
): Promise<ScheduleCoalescedJobResult> {
	const jobId = `coalesce:${coalesceKey}`;
	let superseded = false;

	// Remove any existing delayed/waiting job with the same key so the new
	// job supersedes it. Active jobs are left alone — they are already running.
	const existing = await jobQueue.getJob(jobId);
	if (existing) {
		const state = await existing.getState();
		if (state === 'delayed' || state === 'waiting') {
			await existing.remove();
			superseded = true;
		}
	}

	await jobQueue.add(job.type, job, { jobId, delay: delayMs });
	logger.info('Coalesced job scheduled', { jobId, coalesceKey, delayMs, superseded });
	return { jobId, superseded };
}

// Get queue stats
export async function getQueueStats() {
	const [waiting, active, completed, failed] = await Promise.all([
		jobQueue.getWaitingCount(),
		jobQueue.getActiveCount(),
		jobQueue.getCompletedCount(),
		jobQueue.getFailedCount(),
	]);
	return { waiting, active, completed, failed };
}
