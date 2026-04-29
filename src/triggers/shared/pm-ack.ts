/**
 * Shared PM acknowledgment posting utility for webhook handlers.
 *
 * Centralises the logic for posting acknowledgment comments to PM tools
 * (Trello/JIRA/Linear) for PM-focused agents triggered from GitHub or other
 * non-PM sources.
 *
 * Used by:
 * - Worker-side: `triggers/github/webhook-handler.ts` (maybePostPmAckComment)
 *
 * After spec 017 / plan 1, this delegates to `dispatchPMAck` in
 * `src/router/pm-ack-dispatch.ts` — the single source of truth for PM-ack
 * dispatch. No per-PM-type literal branching here. The legacy `string | null`
 * return contract is preserved for the existing call site in
 * `src/triggers/github/webhook-handler.ts:maybePostPmAckComment`.
 */

import { dispatchPMAck } from '../../router/pm-ack-dispatch.js';

/**
 * Post a PM acknowledgment comment via the consolidated dispatch helper.
 *
 * Returns the comment ID as a string if successfully posted, or `null` if
 * the PM type is not supported or posting failed.
 *
 * @param projectId  The project ID for credential resolution.
 * @param workItemId The work item ID to post the comment on (card ID / issue key).
 * @param pmType     The PM provider type ('trello', 'jira', or 'linear').
 * @param message    The acknowledgment message to post.
 * @param agentType  Used only for warning log context when pmType is unknown.
 */
export async function postPMAckComment(
	projectId: string,
	workItemId: string,
	pmType: string | undefined,
	message: string,
	agentType?: string,
): Promise<string | null> {
	const result = await dispatchPMAck({ projectId, workItemId, pmType, message, agentType });
	if (!result) return null;
	return String(result.commentId);
}
