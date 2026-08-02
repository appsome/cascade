/**
 * Engine-credential rotation: pick the least-utilized Claude Code OAuth token
 * from the project's Anthropic credential pool at dispatch time, model-aware
 * (Anthropic buckets differ per model class — Fable separate from Sonnet/Opus).
 *
 * Accepted race: two concurrent dispatches may select the same token — that is
 * FINE. Utilization data is eventually consistent (the 5-minute usage cache is
 * already accepted staleness); rotation is load-spreading, not a reservation
 * system.
 */

import { gatingBuckets } from '../anthropic/bucket-matching.js';
import { fetchClaudeSubscriptionLimits } from '../anthropic/client.js';
import { DEFAULT_CLAUDE_CODE_MODEL } from '../backends/claude-code/models.js';
import { resolveEngineName } from '../backends/resolution.js';
import {
	type CredentialPoolMember,
	resolveCredentialPool,
} from '../db/repositories/credentialsRepository.js';
import { logger } from '../utils/logging.js';
import { loadProjectConfig, routerConfig } from './config.js';

const CLAUDE_CODE_TOKEN_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';

export const RESUME_FALLBACK_DELAY_MS = 15 * 60 * 1000; // 15 minutes
export const RESUME_MIN_DELAY_MS = 60 * 1000; // 1 minute
export const RESUME_MAX_DELAY_MS = 8 * 24 * 60 * 60 * 1000; // 8 days (7-day windows + slack)
export const RESUME_JITTER_MS = 60 * 1000; // 0–60s

export type RotationDecision =
	| { kind: 'none' }
	| { kind: 'token'; credentialId: string; credentialName: string; token: string }
	| {
			kind: 'suspend';
			reason: string;
			resumeAt: Date;
			gatingBucketLabels: string[];
			poolSize: number;
	  };

interface Candidate {
	member: CredentialPoolMember;
	token: string;
	/** Max utilization across the model's gating buckets; null = limits unknown. */
	score: number | null;
	/** Gating buckets at/over the threshold (for resumeAt + reason). */
	exhaustedBuckets: { key: string; label: string; utilization: number; resetsAt: string }[];
}

function extractJobModelOverride(jobData: unknown): string | undefined {
	const data = jobData as {
		modelOverride?: string;
		triggerResult?: { agentInput?: { modelOverride?: string } };
	};
	return data?.modelOverride ?? data?.triggerResult?.agentInput?.modelOverride ?? undefined;
}

function memberCredentialId(member: CredentialPoolMember): string {
	return member.setId !== null ? String(member.setId) : member.source;
}

function computeResumeAt(candidates: Candidate[]): Date {
	const now = Date.now();
	let earliest: number | null = null;
	for (const candidate of candidates) {
		for (const bucket of candidate.exhaustedBuckets) {
			const resetMs = Date.parse(bucket.resetsAt);
			if (Number.isNaN(resetMs) || resetMs <= now) continue;
			if (earliest === null || resetMs < earliest) earliest = resetMs;
		}
	}
	const base = earliest ?? now + RESUME_FALLBACK_DELAY_MS;
	const jittered = base + Math.floor(Math.random() * RESUME_JITTER_MS);
	const clamped = Math.min(
		Math.max(jittered, now + RESUME_MIN_DELAY_MS),
		now + RESUME_MAX_DELAY_MS,
	);
	return new Date(clamped);
}

/**
 * Decide which Claude Code OAuth token a dispatch should use.
 *
 * - `none` — rotation does not apply (engine ≠ claude-code, no project, or the
 *   pool has no members with a token). Legacy env building proceeds unchanged.
 * - `token` — inject this token as CLAUDE_CODE_OAUTH_TOKEN.
 * - `suspend` — every pool candidate with known limits is at/over the
 *   threshold on the run model's gating buckets; the run should be suspended
 *   until `resumeAt`. Never returned on limits-fetch failure (availability
 *   over precision) or when `agentType` is undefined (no run-row bookkeeping
 *   possible — degrades to pool order).
 */
export async function resolveClaudeCredentialForJob(
	jobData: unknown,
	projectId: string | null,
	agentType: string | undefined,
): Promise<RotationDecision> {
	if (!projectId) return { kind: 'none' };

	const { fullProjects } = await loadProjectConfig();
	const project = fullProjects.find((p) => p.id === projectId);
	if (!project) return { kind: 'none' };

	const engine = resolveEngineName(agentType ?? '', project);
	if (engine !== 'claude-code') return { kind: 'none' };

	let pool: CredentialPoolMember[];
	try {
		pool = await resolveCredentialPool(projectId, 'anthropic');
	} catch (err) {
		logger.warn('[rotation] Failed to resolve credential pool — skipping rotation', {
			projectId,
			error: String(err),
		});
		return { kind: 'none' };
	}

	const members = pool.filter((m) => m.values[CLAUDE_CODE_TOKEN_KEY]);
	if (members.length === 0) return { kind: 'none' };

	// Router-side approximation of modelResolution.ts precedence. The configKey
	// aliasing (respond-to-review → review) is not replicated — only the model
	// FAMILY matters for bucket gating and alias pairs share a family.
	const model =
		extractJobModelOverride(jobData) ??
		(agentType ? project.agentModels?.[agentType] : undefined) ??
		project.model ??
		DEFAULT_CLAUDE_CODE_MODEL;

	const threshold = routerConfig.rotationUtilizationThreshold;

	const candidates: Candidate[] = await Promise.all(
		members.map(async (member) => {
			const token = member.values[CLAUDE_CODE_TOKEN_KEY];
			const limits = await fetchClaudeSubscriptionLimits(token);
			if (!limits) {
				return { member, token, score: null, exhaustedBuckets: [] };
			}
			const gating = gatingBuckets(limits.buckets, model);
			const score = gating.reduce((max, bucket) => Math.max(max, bucket.utilization), 0);
			return {
				member,
				token,
				score,
				exhaustedBuckets: gating.filter((b) => b.utilization >= threshold),
			};
		}),
	);

	// Single candidate + known-good or unknown limits — fast path, but a single
	// exhausted candidate still suspends below.
	const known = candidates.filter((c) => c.score !== null);
	const underThreshold = known.filter((c) => (c.score as number) < threshold);

	if (underThreshold.length > 0) {
		// Least utilized; ties broken by pool order (position).
		let best = underThreshold[0];
		for (const candidate of underThreshold.slice(1)) {
			if (
				(candidate.score as number) < (best.score as number) ||
				((candidate.score as number) === (best.score as number) &&
					candidate.member.position < best.member.position)
			) {
				best = candidate;
			}
		}
		logger.info('[rotation] Selected engine credential', {
			projectId,
			agentType,
			model,
			credential: best.member.setName,
			score: best.score,
			poolSize: members.length,
		});
		return {
			kind: 'token',
			credentialId: memberCredentialId(best.member),
			credentialName: best.member.setName,
			token: best.token,
		};
	}

	const unknown = candidates.filter((c) => c.score === null);
	if (unknown.length > 0) {
		// Limits unavailable for some candidates — never suspend on fetch
		// failure; use the first unknown in pool order.
		const fallback = unknown[0];
		logger.warn('[rotation] Limits unavailable — falling back to pool order', {
			projectId,
			agentType,
			credential: fallback.member.setName,
			unknownCount: unknown.length,
			poolSize: members.length,
		});
		return {
			kind: 'token',
			credentialId: memberCredentialId(fallback.member),
			credentialName: fallback.member.setName,
			token: fallback.token,
		};
	}

	// Every candidate has known limits and all are at/over the threshold.
	if (agentType === undefined) {
		// No run-row bookkeeping possible without an agent type — degrade to
		// pool order instead of suspending (mirrors recordSpawnFailureStub).
		const fallback = candidates[0];
		logger.warn('[rotation] Pool exhausted but agentType unknown — degrading to pool order', {
			projectId,
			poolSize: members.length,
		});
		return {
			kind: 'token',
			credentialId: memberCredentialId(fallback.member),
			credentialName: fallback.member.setName,
			token: fallback.token,
		};
	}

	const resumeAt = computeResumeAt(candidates);
	const bucketLabels = [
		...new Set(candidates.flatMap((c) => c.exhaustedBuckets.map((b) => b.label))),
	];
	const reason = `All ${members.length} Anthropic credential${members.length === 1 ? '' : 's'} at/over ${threshold}% on rate-limit windows [${bucketLabels.join(', ')}] for model ${model}; resumes ~${resumeAt.toISOString()}`;

	return {
		kind: 'suspend',
		reason,
		resumeAt,
		gatingBucketLabels: bucketLabels,
		poolSize: members.length,
	};
}
