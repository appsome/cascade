import type { UsageBucket } from './client.js';

/**
 * Model-family ↔ usage-bucket relevance matching for engine-credential
 * rotation. Pure functions — no I/O.
 *
 * Anthropic's /api/oauth/usage buckets fall into three classes:
 * - GLOBAL windows ("five_hour", "seven_day" — exact match only) gate every
 *   model.
 * - MODEL-CLASS windows whose key contains a family token
 *   ("seven_day_opus", "seven_day_sonnet", a future "seven_day_fable")
 *   gate only runs of that family.
 * - Everything else ("seven_day_oauth_apps", "seven_day_cowork",
 *   "iguana_necktie", unknown non-family keys) never gates.
 */
export const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

const FAMILY_SET = new Set<string>(MODEL_FAMILIES);
const GLOBAL_BUCKET_KEYS = new Set(['five_hour', 'seven_day']);

/**
 * Extract the model family from a CASCADE/Anthropic model id.
 * 'claude-opus-4-8[1m]' → 'opus'; 'claude-fable-5' → 'fable';
 * 'claude-sonnet-4-5-20250929' → 'sonnet'; unrecognized → null.
 */
export function extractModelFamily(modelId: string): ModelFamily | null {
	const tokens = modelId.toLowerCase().split(/[^a-z0-9]+/);
	for (const token of tokens) {
		if (FAMILY_SET.has(token)) return token as ModelFamily;
	}
	return null;
}

/**
 * Whether a bucket gates runs of the given model family.
 * Global buckets match EXACTLY ('seven_day_opus' must never match via a
 * 'seven_day' prefix check). A null family (unrecognized model id) is gated
 * by the global buckets only.
 */
export function isBucketRelevantToModel(bucketKey: string, family: ModelFamily | null): boolean {
	if (GLOBAL_BUCKET_KEYS.has(bucketKey)) return true;
	if (family === null) return false;

	const tokens = bucketKey.toLowerCase().split('_');
	const bucketFamily = tokens.find((token) => FAMILY_SET.has(token));
	if (!bucketFamily) return false;
	return bucketFamily === family;
}

/** The subset of buckets that gate a run of the given model. */
export function gatingBuckets(buckets: UsageBucket[], modelId: string): UsageBucket[] {
	const family = extractModelFamily(modelId);
	return buckets.filter((bucket) => isBucketRelevantToModel(bucket.key, family));
}
