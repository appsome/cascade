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
	/** workItemTitle stored as a context hint for generateAckMessage at fire time. NOT the literal comment text. */
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
	/** workItemTitle stored as a context hint for generateAckMessage at fire time. NOT the literal comment text. */
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
	/** workItemTitle stored as a context hint for generateAckMessage at fire time. NOT the literal comment text. */
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
	/**
	 * Data from the superseded delayed/waiting job. Present when
	 * `superseded === true`. Used by the caller to release the orphaned
	 * in-memory locks that were marked for the previous dispatch — those locks
	 * are never released via `worker.on('failed')` because BullMQ's `remove()`
	 * does not fire that event.
	 */
	supersededJobData?: CascadeJob;
	/**
	 * True when a job with the same coalesce ID is already active (running).
	 * BullMQ silently ignores `add()` for a duplicate active jobId, so we skip
	 * the `add()` call entirely and return this flag instead. The caller must
	 * NOT mark new in-memory locks — no new job was created.
	 */
	activeExists?: boolean;
}

/**
 * Schedule a PM job as a BullMQ delayed job keyed by `coalesceKey`.
 *
 * If a delayed/waiting job with the same key already exists it is removed
 * before the new job is added, superseding the previous dispatch. Active
 * (already running) jobs are left untouched and `activeExists` is returned
 * as `true` so the caller can skip lock marking.
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
	let supersededJobData: CascadeJob | undefined;

	// Remove any existing delayed/waiting job with the same key so the new
	// job supersedes it. Active jobs are left alone — they are already running.
	//
	// TOCTOU NOTE: The getJob → getState → remove → add sequence is not atomic.
	// Two concurrent webhook handlers for the same coalesceKey can both read the
	// existing delayed job, both attempt remove() (the second no-ops silently),
	// and then both call add() — but BullMQ silently ignores a duplicate jobId
	// for a non-completed job, so the second event's data is lost. In practice
	// this race is rare: the coalesce window exists for events tens-to-hundreds
	// of milliseconds apart, not truly simultaneous arrivals. A Lua-script
	// atomic compare-and-replace would close this, but the operational impact is
	// low enough that a documented best-effort approach is acceptable here.
	const existing = await jobQueue.getJob(jobId);
	if (existing) {
		const state = await existing.getState();
		if (state === 'delayed' || state === 'waiting') {
			// Capture job data before removal so the caller can release orphaned locks.
			supersededJobData = existing.data;
			await existing.remove();
			superseded = true;
		} else if (state === 'active') {
			// An active (running) job already holds this ID. BullMQ would
			// silently ignore add() for a duplicate active jobId — no new job
			// would be created, but the caller wouldn't know and would mark
			// locks incorrectly. Return activeExists=true so the caller can
			// log accurately and skip marking new in-memory locks.
			logger.info('Coalesced job skipped — active job with same ID already running', {
				jobId,
				coalesceKey,
			});
			return { jobId, superseded: false, activeExists: true };
		}
	}

	await jobQueue.add(job.type, job, { jobId, delay: delayMs });
	logger.info('Coalesced job scheduled', { jobId, coalesceKey, delayMs, superseded });
	return { jobId, superseded, supersededJobData };
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
