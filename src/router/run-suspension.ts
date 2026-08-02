/**
 * Rate-limit run suspension + resume (engine-credential rotation).
 *
 * When every Anthropic credential in a project's rotation pool is at/over the
 * utilization threshold on the run model's gating buckets, the dispatch is
 * SUSPENDED instead of failed: the run row flips to status='suspended', all
 * in-memory dispatch locks are released (suspension COMPLETES the BullMQ job,
 * so the failed-event compensation never fires — the release must be
 * explicit), and a delayed resume job re-submits the original job when the
 * earliest gating bucket resets.
 */

import type { Job } from 'bullmq';
import {
	countActiveRuns,
	createSuspendedRun,
	DEFAULT_STALE_RUN_THRESHOLD_MS,
	failQueuedOrRunningRun,
	findSuspendedRunByJobId,
	getRunById,
	requeueSuspendedRun,
	suspendRunById,
	updateRunSuspension,
} from '../db/repositories/runsRepository.js';
import {
	type ResumeSuspendedRunJob,
	scheduleResumeSuspendedRun,
	submitDashboardJob,
} from '../queue/client.js';
import { addBreadcrumb, captureException, captureMessage } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { releaseLocksForFailedJob } from './dispatch-compensator.js';
import {
	RESUME_MIN_DELAY_MS,
	type RotationDecision,
	resolveClaudeCredentialForJob,
} from './engine-credential-rotation.js';
import type { CascadeJob } from './queue.js';

/** Re-suspension count at which the flapping canary fires. */
const SUSPEND_FLAP_CANARY_THRESHOLD = 10;

const DASHBOARD_JOB_TYPES = new Set(['manual-run', 'retry-run', 'debug-analysis']);

interface SuspendContext {
	projectId: string;
	agentType: string;
	workItemId?: string;
}

function resumeDelayMs(resumeAt: Date): number {
	return Math.max(resumeAt.getTime() - Date.now(), RESUME_MIN_DELAY_MS);
}

/**
 * Suspend a dispatch whose credential pool is exhausted. Called from
 * spawnWorker BEFORE any container exists; returning normally completes the
 * BullMQ job (no retry burned, no failed event). Every step is idempotent —
 * a throw propagates so BullMQ retries the dispatch, and re-entry finds the
 * already-suspended row / already-released locks.
 */
export async function suspendJobForRateLimit(
	job: Job<CascadeJob>,
	decision: Extract<RotationDecision, { kind: 'suspend' }>,
	ctx: SuspendContext,
): Promise<void> {
	const data = job.data as unknown as {
		type: string;
		runId?: string;
		triggerResult?: { triggerType?: string };
	};

	// 1. Run-row bookkeeping — one row per logical run, reused across
	//    suspend/resume. Only manual-run jobs carry a runId that refers to THIS
	//    dispatch's own pre-created queued row; retry-run/debug-analysis runId
	//    fields reference the ORIGINAL/analyzed run and must never be flipped.
	let runId: string;
	if (data.type === 'manual-run' && data.runId) {
		runId = data.runId;
		await suspendRunById(runId, decision.reason, decision.resumeAt);
	} else {
		const existing = await findSuspendedRunByJobId(String(job.id));
		runId =
			existing ??
			(await createSuspendedRun({
				projectId: ctx.projectId,
				workItemId: ctx.workItemId,
				agentType: ctx.agentType,
				engine: 'claude-code',
				triggerType: data.triggerResult?.triggerType,
				reason: decision.reason,
				resumeAt: decision.resumeAt,
				jobId: String(job.id),
			}));
	}

	// 2. Release in-memory dispatch locks. Suspension completes the job, so the
	//    worker.on('failed') compensation path never runs — without this the
	//    work-item lock + agent-type counter would leak for ~30min and reject
	//    every follow-up webhook for the trio. releaseLocksForFailedJob never
	//    throws and is idempotent.
	await releaseLocksForFailedJob(job.data);

	// 3. Schedule the delayed resume.
	const resumeJob: ResumeSuspendedRunJob = {
		type: 'resume-suspended-run',
		runId,
		originalQueue: DASHBOARD_JOB_TYPES.has(data.type) ? 'cascade-dashboard-jobs' : 'cascade-jobs',
		originalJobData: job.data,
		suspendCount: 1,
		projectId: ctx.projectId,
		agentType: ctx.agentType,
		workItemId: ctx.workItemId,
	};
	await scheduleResumeSuspendedRun(resumeJob, resumeDelayMs(decision.resumeAt));

	logger.info('[rotation] Suspended run — all pool credentials exhausted', {
		runId,
		jobId: job.id,
		projectId: ctx.projectId,
		agentType: ctx.agentType,
		poolSize: decision.poolSize,
		gatingBuckets: decision.gatingBucketLabels,
		resumeAt: decision.resumeAt.toISOString(),
	});
	addBreadcrumb({
		category: 'rotation',
		message: 'run suspended (rate limit)',
		level: 'info',
		data: { runId, projectId: ctx.projectId, agentType: ctx.agentType },
	});
}

/**
 * Fired when a suspended run's resume delay elapses. Re-checks limits and
 * either re-suspends (still exhausted) or requeues the run and re-submits the
 * original job through the normal dispatch path (which re-runs the limit
 * check at spawn — a spike between here and spawn just suspends again).
 */
export async function handleResumeSuspendedRun(job: Job<ResumeSuspendedRunJob>): Promise<void> {
	const { runId, originalQueue, originalJobData, suspendCount, projectId, agentType, workItemId } =
		job.data;

	// Status guard — covers cancel-during-suspension (cancel just flips the
	// row; this stale delayed job then self-neutralizes here).
	const run = await getRunById(runId);
	if (!run || run.status !== 'suspended') {
		logger.info('[rotation] Resume skipped — run no longer suspended', {
			runId,
			status: run?.status ?? 'missing',
		});
		return;
	}

	// Supersede guard — a newer run dispatched for the same work item during
	// suspension wins; resuming would violate the same-type-per-work-item
	// invariant.
	if (workItemId) {
		const conflicting = await countActiveRuns({
			projectId,
			workItemId,
			maxAgeMs: DEFAULT_STALE_RUN_THRESHOLD_MS,
			includeQueued: true,
			excludeRunId: runId,
		});
		if (conflicting > 0) {
			await failQueuedOrRunningRun(
				runId,
				'Superseded by a newer run dispatched for this work item during rate-limit suspension',
			);
			logger.info('[rotation] Resume superseded — newer run exists for work item', {
				runId,
				projectId,
				workItemId,
			});
			return;
		}
	}

	// Fresh limit pre-check — avoids a pointless queued→suspended flip-flop.
	const decision = await resolveClaudeCredentialForJob(originalJobData, projectId, agentType);
	if (decision.kind === 'suspend') {
		const nextCount = suspendCount + 1;
		await updateRunSuspension(runId, decision.reason, decision.resumeAt);
		await scheduleResumeSuspendedRun(
			{ ...job.data, suspendCount: nextCount },
			resumeDelayMs(decision.resumeAt),
		);
		logger.info('[rotation] Still exhausted at resume — re-suspended', {
			runId,
			suspendCount: nextCount,
			resumeAt: decision.resumeAt.toISOString(),
		});
		if (nextCount >= SUSPEND_FLAP_CANARY_THRESHOLD) {
			captureMessage('Run re-suspended repeatedly — rotation pool never recovers', {
				level: 'warning',
				tags: { source: 'rotation_suspend_flap' },
				extra: { runId, projectId, agentType, suspendCount: nextCount },
			});
		}
		return;
	}

	if (!(await requeueSuspendedRun(runId))) {
		// Raced with a cancel between the status guard and here.
		logger.info('[rotation] Resume skipped — run was cancelled during requeue', { runId });
		return;
	}

	// Thread the run id into the original job data so the worker reuses the
	// requeued row instead of inserting a duplicate.
	const resumedData = structuredClone(originalJobData) as Record<string, unknown>;
	const dataType = String(resumedData.type ?? '');
	if (dataType === 'manual-run') {
		resumedData.runId = runId; // triggerManualRun activates it (existing path)
	} else if (dataType === 'retry-run' || dataType === 'debug-analysis') {
		resumedData.preCreatedRunId = runId;
	} else {
		const triggerResult = resumedData.triggerResult as
			| { agentInput?: Record<string, unknown> }
			| undefined;
		if (triggerResult?.agentInput) {
			triggerResult.agentInput.preCreatedRunId = runId;
		} else {
			// Shouldn't happen for agent-dispatching webhook jobs (agentType came
			// from triggerResult). The worker will create a fresh row; the requeued
			// row ages out of duplicate guards. Accepted rare leak.
			logger.warn('[rotation] Resume job has no triggerResult.agentInput — runId not threaded', {
				runId,
				jobType: dataType,
			});
		}
	}

	try {
		if (originalQueue === 'cascade-jobs') {
			// Lazy import — ./queue.js creates its Redis connection at module load,
			// and this module sits on the container-manager import path (tests and
			// dashboard surfaces load it without a Redis).
			const { addJob } = await import('./queue.js');
			await addJob(resumedData as unknown as CascadeJob);
		} else {
			await submitDashboardJob(resumedData as never);
		}
	} catch (err) {
		// Do NOT rethrow: a BullMQ retry of this resume job would double-submit
		// after a partial success.
		await failQueuedOrRunningRun(runId, `Failed to re-enqueue after suspension: ${String(err)}`);
		captureException(err, {
			tags: { source: 'rotation_resume_requeue' },
			extra: { runId, projectId, agentType, originalQueue },
		});
		return;
	}

	logger.info('[rotation] Resumed suspended run — re-submitted original job', {
		runId,
		projectId,
		agentType,
		originalQueue,
		suspendCount,
	});
}
