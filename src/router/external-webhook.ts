/**
 * External webhook endpoint — dispatch an agent from any third-party system.
 *
 * POST /external/webhook/:projectId/:agentType
 *   Authorization: Bearer <password>
 *
 * The password lives in project_credentials under
 * EXTERNAL_WEBHOOK_PASSWORD_<AGENT_TYPE> (org-credential inheritance applies).
 * Authentication FAILS CLOSED: no stored password → every request is rejected.
 * The POST body (capped at 64 KiB) reaches the agent as trigger context via
 * the manual-run path's triggerCommentBody.
 *
 * Hardening notes (adversarial review, 2026-08-02):
 * - All pre-auth failures (unknown project, no password configured, wrong
 *   token) return an identical generic 401 so unauthenticated callers cannot
 *   enumerate projects or distinguish password-armed agents. The distinct
 *   decisionReasons live only in webhook_logs (superadmin surface).
 * - Failed attempts are rate-limited per client IP via the shared sliding
 *   window limiter; successful auth resets the counter.
 * - The Bearer scheme is matched case-insensitively (RFC 7235).
 * - The body is read incrementally and aborted at the cap, not buffered first.
 * - Error responses never include internal error details; those go to logs.
 * - The Authorization header is never logged.
 *
 * Deliberately hand-rolled rather than built on createWebhookHandler: that
 * factory parses before verifying and treats a missing secret as "skip
 * verification" (fail open) — both wrong for a token-authenticated endpoint.
 */

import { timingSafeEqual } from 'node:crypto';
import type { Context, Handler } from 'hono';
import { checkRateLimit, recordSuccessfulLogin } from '../api/auth/rateLimiter.js';
import { resolveEngineName } from '../backends/resolution.js';
import { loadProjectConfigById } from '../config/provider.js';
import { resolveProjectCredential } from '../db/repositories/credentialsRepository.js';
import { createQueuedRun, failQueuedOrRunningRun } from '../db/repositories/runsRepository.js';
import { submitDashboardJob } from '../queue/client.js';
import { getResolvedTriggerConfig } from '../triggers/config-resolver.js';
import {
	EXTERNAL_WEBHOOK_EVENT,
	externalWebhookCredentialKey,
	isValidAgentTypeSlug,
} from '../triggers/shared/external-webhook.js';
import { logger } from '../utils/logging.js';
import { logWebhookCall } from '../utils/webhookLogger.js';

/** Kept below the 96 KiB JOB_DATA inline threshold (src/router/job-data-offload.ts). */
export const EXTERNAL_WEBHOOK_BODY_MAX_BYTES = 64 * 1024;

const UNAUTHORIZED_MESSAGE = 'Unauthorized';

function timingSafeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/** RFC 7235: the auth scheme token is case-insensitive. */
function parseBearerToken(authorizationHeader: string): string {
	const match = /^bearer\s+(.+)$/i.exec(authorizationHeader);
	return match?.[1] ?? '';
}

function getClientIp(c: Context): string {
	const forwarded = c.req.header('x-forwarded-for');
	if (forwarded) {
		return forwarded.split(',')[0].trim();
	}
	return 'unknown';
}

/**
 * Read the request body incrementally, aborting as soon as the byte count
 * exceeds the cap — an oversized or endless body never gets fully buffered.
 * Returns null when the cap was exceeded.
 */
async function readBodyWithCap(c: Context, maxBytes: number): Promise<string | null> {
	const stream = c.req.raw.body;
	if (!stream) return '';

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks).toString('utf8');
}

interface ReplyExtras {
	runId?: string;
	bodyRaw?: string;
	/** Override the response body message (responses default to decisionReason). */
	publicMessage?: string;
}

function reply(
	c: Context,
	status: 200 | 401 | 404 | 413 | 429 | 500,
	decisionReason: string,
	extras: ReplyExtras = {},
) {
	// Headers deliberately omitted from the log — the Authorization header
	// carries the webhook password. Body is logged only on success.
	logWebhookCall({
		source: 'external',
		method: 'POST',
		path: c.req.path,
		bodyRaw: status === 200 ? extras.bodyRaw : undefined,
		statusCode: status,
		projectId: c.req.param('projectId'),
		eventType: EXTERNAL_WEBHOOK_EVENT,
		processed: status === 200,
		decisionReason,
	});
	if (status === 200) {
		return c.json({ ok: true, runId: extras.runId }, 200);
	}
	return c.json({ error: extras.publicMessage ?? decisionReason }, status);
}

/** Identical public 401 for every pre-auth failure — anti-enumeration. */
function unauthorized(c: Context, decisionReason: string) {
	return reply(c, 401, decisionReason, { publicMessage: UNAUTHORIZED_MESSAGE });
}

export function createExternalWebhookHandler(): Handler {
	return async (c) => {
		const projectId = c.req.param('projectId') ?? '';
		const agentType = c.req.param('agentType') ?? '';

		// 0. Per-IP sliding-window rate limit — every attempt counts until a
		//    successful authentication resets the counter.
		const rateKey = `external-webhook:${getClientIp(c)}`;
		const rateCheck = checkRateLimit(rateKey);
		if (rateCheck.limited) {
			c.header('Retry-After', String(rateCheck.retryAfterSeconds));
			return reply(c, 429, 'Rate limited', {
				publicMessage: 'Too many attempts. Please try again later.',
			});
		}

		// 1. Cheap slug guard before any DB hit (format error — no state info)
		if (!projectId || !isValidAgentTypeSlug(agentType)) {
			return reply(c, 404, 'Invalid agent type');
		}

		// 2-4. Authentication. Unknown project, missing password (fail closed),
		// and wrong token all collapse into the same generic 401; the
		// decisionReason in webhook_logs distinguishes them for operators.
		const pc = await loadProjectConfigById(projectId);
		if (!pc) {
			return unauthorized(c, 'Unknown project');
		}

		const password = await resolveProjectCredential(
			projectId,
			externalWebhookCredentialKey(agentType),
		);
		if (!password) {
			return unauthorized(
				c,
				'No webhook password configured for this agent — rejecting (fail closed)',
			);
		}

		const token = parseBearerToken(c.req.header('authorization') ?? '');
		if (!token || !timingSafeCompare(token, password)) {
			return unauthorized(c, 'Invalid or missing bearer token');
		}
		recordSuccessfulLogin(rateKey);

		// 5. Enablement — one resolver call covers: agent_configs row exists,
		//    definition declares the event, DB config / defaultEnabled. The
		//    caller is authenticated at this point, so a specific 404 is fine.
		const triggerConfig = await getResolvedTriggerConfig(
			projectId,
			agentType,
			EXTERNAL_WEBHOOK_EVENT,
		);
		if (!triggerConfig) {
			return reply(c, 404, 'Agent not enabled or external-webhook trigger not declared');
		}
		if (!triggerConfig.enabled) {
			return reply(c, 404, 'external-webhook trigger disabled for this agent');
		}

		// 6. Body read with incremental cap (never fully buffers an oversized body)
		const body = await readBodyWithCap(c, EXTERNAL_WEBHOOK_BODY_MAX_BYTES);
		if (body === null) {
			return reply(c, 413, 'Body too large');
		}

		// 7. Dispatch — exact manual-run pattern (src/api/routers/runs.ts:404-451).
		//    The router consumes cascade-dashboard-jobs itself and spawns the
		//    worker container; triggerManualRun re-checks enablement + integrations.
		const engine = resolveEngineName(agentType, pc.project);
		const runId = await createQueuedRun({
			projectId,
			agentType,
			engine,
			triggerType: 'external-webhook',
		});
		try {
			await submitDashboardJob({
				type: 'manual-run',
				projectId,
				agentType,
				triggerCommentBody: body.trim() ? body : undefined,
				triggerType: 'external-webhook',
				triggerEvent: EXTERNAL_WEBHOOK_EVENT,
				runId,
			});
		} catch (err) {
			await failQueuedOrRunningRun(runId, 'Failed to enqueue external webhook run');
			logger.error('External webhook enqueue failed', {
				projectId,
				agentType,
				error: String(err),
			});
			return reply(c, 500, `Enqueue failed: ${String(err)}`, {
				publicMessage: 'Failed to queue the run',
			});
		}

		return reply(c, 200, `Job queued: ${agentType} agent (external webhook)`, {
			runId,
			bodyRaw: body || undefined,
		});
	};
}
