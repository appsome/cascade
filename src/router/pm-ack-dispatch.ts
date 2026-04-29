/**
 * Consolidated PM-ack dispatch helper.
 *
 * Replaces the parallel-path drift between two near-identical helpers:
 *
 *   - `src/router/adapters/github.ts:postPMAck`   (had Trello + JIRA only;
 *                                                   silently skipped Linear,
 *                                                   producing 24 WARN/day on
 *                                                   prod cascade-router)
 *   - `src/triggers/shared/pm-ack.ts:postPMAckComment`  (had all three branches)
 *
 * Both call sites now delegate to this helper. The helper indexes the manifest
 * registry directly via `getPMProvider(pmType).platformClientFactory(projectId)`
 * — no per-PM-type literal branching. Adding a future PM provider to the
 * registry is automatically reachable from the dispatch path; the conformance
 * harness asserts this on every CI run.
 *
 * On a genuinely-unknown PM type (project pinned to a deleted provider, or a
 * configuration error), the helper logs at ERROR and captures to Sentry under
 * the stable tag `pm_ack_unknown_pm_type` — silent warn-and-skip is removed.
 *
 * See spec 017 (router-side silent-failure hardening), failure mode A.
 */

import { getPMProvider } from '../integrations/pm/registry.js';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';

export interface DispatchPMAckArgs {
	projectId: string;
	workItemId: string;
	pmType: string | undefined;
	message: string;
	agentType?: string;
}

export interface PMAckResult {
	commentId: string | number;
	message: string;
}

/**
 * Post a PM-side acknowledgment comment via the manifest registry.
 *
 * Returns `{ commentId, message }` on success, or `undefined` when:
 * - the underlying `platformClientFactory.postComment` returned `null`
 *   (existing failure-shape contract on `PlatformCommentClient`), OR
 * - the `pmType` is not registered in the manifest registry (logs ERROR
 *   + captures Sentry under tag `pm_ack_unknown_pm_type`).
 */
export async function dispatchPMAck(args: DispatchPMAckArgs): Promise<PMAckResult | undefined> {
	const { projectId, workItemId, pmType, message, agentType } = args;

	const manifest = pmType ? getPMProvider(pmType) : null;
	if (!manifest) {
		const err = new Error('Unknown PM type for PM-focused agent ack');
		logger.error('Unknown PM type for PM-focused agent ack', { pmType, agentType, projectId });
		captureException(err, {
			tags: { source: 'pm_ack_unknown_pm_type' },
			extra: { pmType, agentType, projectId, workItemId },
		});
		return undefined;
	}

	const client = manifest.platformClientFactory(projectId);
	const commentId = await client.postComment(workItemId, message);
	if (commentId == null) return undefined;
	return { commentId, message };
}
