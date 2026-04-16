/**
 * Shared label-id resolver for PM providers whose APIs require UUIDs.
 *
 * Linear's issueUpdate.labelIds rejects names; passing a name produces a
 * silent failure (the label just doesn't attach). This resolver makes
 * the misconfiguration visible at call time instead of invisible in the
 * provider's response.
 *
 * Trello and JIRA don't need this — Trello's labels are board-scoped IDs
 * already and JIRA accepts names natively. The Linear adapter currently
 * has its own copy of this logic at `src/pm/linear/adapter.ts`; plan 006/4
 * replaces that copy with a call to this shared helper.
 */

import { logger } from '../../../utils/logging.js';

/** RFC-4122 UUIDs in canonical 8-4-4-4-12 hex form. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolveLabelIdContext {
	/** Used in the warn log so operators can trace the failing provider. */
	readonly providerId: string;
	/** Optional extra context (e.g. teamId) for diagnostics. */
	readonly extra?: Record<string, unknown>;
}

/**
 * Resolve a label slot name (e.g. `"processing"`) or raw label id to a
 * UUID. Returns `null` when the value cannot be resolved to a UUID and
 * the caller must therefore skip the label operation.
 *
 * Resolution order:
 *   1. Look up `slotOrId` in `mapping`; if found and UUID-shaped, return it.
 *   2. Otherwise, if `slotOrId` itself is UUID-shaped, return it unchanged.
 *   3. Otherwise warn and return `null`.
 */
export function resolveLabelId(
	slotOrId: string,
	mapping: Record<string, string> | undefined,
	ctx: ResolveLabelIdContext,
): string | null {
	const mapped = mapping?.[slotOrId];
	const candidate = mapped ?? slotOrId;
	if (UUID_PATTERN.test(candidate)) return candidate;

	logger.warn('Label value is not a UUID — skipping', {
		providerId: ctx.providerId,
		input: slotOrId,
		resolved: mapped ?? '<no mapping>',
		...ctx.extra,
	});
	return null;
}
