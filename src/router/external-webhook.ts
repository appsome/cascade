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
 * Deliberately hand-rolled rather than built on createWebhookHandler: that
 * factory parses before verifying and treats a missing secret as "skip
 * verification" (fail open) — both wrong for a token-authenticated endpoint.
 * The logging discipline (webhook_logs row per decision) is mirrored instead.
 * The Authorization header is never logged.
 */

import { timingSafeEqual } from 'node:crypto';
import type { Context, Handler } from 'hono';
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

function timingSafeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

interface ReplyExtras {
	runId?: string;
	bodyRaw?: string;
}

function reply(
	c: Context,
	status: 200 | 401 | 403 | 404 | 413 | 500,
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
	return c.json({ error: decisionReason }, status);
}

export function createExternalWebhookHandler(): Handler {
	return async (c) => {
		const projectId = c.req.param('projectId') ?? '';
		const agentType = c.req.param('agentType') ?? '';

		// 1. Cheap slug guard before any DB hit
		if (!projectId || !isValidAgentTypeSlug(agentType)) {
			return reply(c, 404, 'Invalid agent type');
		}

		// 2. Project must exist (config also needed for engine resolution)
		const pc = await loadProjectConfigById(projectId);
		if (!pc) {
			return reply(c, 404, 'Unknown project');
		}

		// 3. Resolve password — FAIL CLOSED when unset
		const password = await resolveProjectCredential(
			projectId,
			externalWebhookCredentialKey(agentType),
		);
		if (!password) {
			return reply(
				c,
				403,
				'No webhook password configured for this agent — rejecting (fail closed)',
			);
		}

		// 4. Bearer parse + timing-safe compare
		const auth = c.req.header('authorization') ?? '';
		const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
		if (!token || !timingSafeCompare(token, password)) {
			return reply(c, 401, 'Invalid or missing bearer token');
		}

		// 5. Enablement — one resolver call covers: agent_configs row exists,
		//    definition declares the event, DB config / defaultEnabled. 404 for
		//    both undeclared and disabled (anti-probing); the decisionReason in
		//    webhook_logs distinguishes them for operators.
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

		// 6. Body read + cap (content-length pre-check, post-read check for chunked)
		const declaredLength = Number(c.req.header('content-length') ?? 0);
		if (declaredLength > EXTERNAL_WEBHOOK_BODY_MAX_BYTES) {
			return reply(c, 413, 'Body too large');
		}
		const body = await c.req.text();
		if (Buffer.byteLength(body, 'utf8') > EXTERNAL_WEBHOOK_BODY_MAX_BYTES) {
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
			return reply(c, 500, `Enqueue failed: ${String(err)}`);
		}

		return reply(c, 200, `Job queued: ${agentType} agent (external webhook)`, {
			runId,
			bodyRaw: body || undefined,
		});
	};
}
