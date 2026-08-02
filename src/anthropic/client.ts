import { logger } from '../utils/logging.js';

/**
 * OAuth usage endpoint — returns per-bucket utilization percentages and reset times
 * for the authenticated subscription.
 */
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NEGATIVE_CACHE_TTL_MS = 60 * 1000; // 1 minute — bounds pool-wide timeout cost under rotation
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

/** A single rate-limit bucket from the usage API. */
export interface UsageBucket {
	/**
	 * Machine-readable wire key (e.g. "five_hour", "seven_day_opus").
	 * Unknown keys pass through verbatim — rotation gating matches on this,
	 * so a future model-class bucket (e.g. a Fable window) works untouched.
	 */
	key: string;
	/** Human-readable label (e.g. "5-Hour Window", "7-Day Sonnet") */
	label: string;
	/** Utilization percentage 0–100 */
	utilization: number;
	/** ISO-8601 reset timestamp */
	resetsAt: string;
}

export interface ClaudeSubscriptionLimits {
	tokenMasked: string;
	buckets: UsageBucket[];
	extraUsage: {
		isEnabled: boolean;
		monthlyLimit: number | null;
		usedCredits: number | null;
		utilization: number | null;
	} | null;
}

interface CacheEntry {
	data: ClaudeSubscriptionLimits | null;
	timestamp: number;
}

/**
 * Per-token cache. Keyed by full token for lookup; only the masked value is
 * surfaced in returned data. Failures are negative-cached (data: null) for a
 * shorter TTL so a flapping usage API doesn't cost a 10s timeout per pool
 * candidate on every dispatch.
 */
const cacheByToken = new Map<string, CacheEntry>();

/**
 * Masks a token, showing only the last 4 characters.
 */
function maskToken(token: string): string {
	return `****${token.slice(-4)}`;
}

/** Maps known API response keys to human-readable labels (display only). */
const BUCKET_LABELS: Record<string, string> = {
	five_hour: '5-Hour Window',
	seven_day: '7-Day Overall',
	seven_day_oauth_apps: '7-Day OAuth Apps',
	seven_day_opus: '7-Day Opus',
	seven_day_sonnet: '7-Day Sonnet',
	seven_day_cowork: '7-Day Cowork',
	iguana_necktie: 'Iguana Necktie',
};

/** "seven_day_fable" → "Seven Day Fable" — fallback label for unknown keys. */
function humanizeBucketKey(key: string): string {
	return key
		.split('_')
		.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
		.join(' ');
}

/**
 * Parse usage buckets from the API response JSON. Iterates the RESPONSE keys
 * (not a fixed catalog) so unknown buckets flow through with their wire key —
 * only entries that don't look like a bucket (extra_usage, scalars) are
 * skipped. Known keys render in BUCKET_LABELS insertion order first, then
 * unknown keys in response order.
 */
function parseBuckets(json: Record<string, unknown>): UsageBucket[] {
	const parseOne = (key: string): UsageBucket | null => {
		if (key === 'extra_usage') return null;
		const raw = json[key] as { utilization?: number; resets_at?: string } | null | undefined;
		if (raw && typeof raw.utilization === 'number' && typeof raw.resets_at === 'string') {
			return {
				key,
				label: BUCKET_LABELS[key] ?? humanizeBucketKey(key),
				utilization: raw.utilization,
				resetsAt: raw.resets_at,
			};
		}
		return null;
	};

	const buckets: UsageBucket[] = [];
	for (const key of Object.keys(BUCKET_LABELS)) {
		const bucket = parseOne(key);
		if (bucket) buckets.push(bucket);
	}
	for (const key of Object.keys(json)) {
		if (key in BUCKET_LABELS) continue;
		const bucket = parseOne(key);
		if (bucket) buckets.push(bucket);
	}
	return buckets;
}

/** Parse the extra_usage block from the API response JSON. */
function parseExtraUsage(json: Record<string, unknown>): ClaudeSubscriptionLimits['extraUsage'] {
	const rawExtra = json.extra_usage as Record<string, unknown> | null | undefined;
	if (!rawExtra || typeof rawExtra.is_enabled !== 'boolean') {
		return null;
	}
	return {
		isEnabled: rawExtra.is_enabled,
		monthlyLimit: typeof rawExtra.monthly_limit === 'number' ? rawExtra.monthly_limit : null,
		usedCredits: typeof rawExtra.used_credits === 'number' ? rawExtra.used_credits : null,
		utilization: typeof rawExtra.utilization === 'number' ? rawExtra.utilization : null,
	};
}

/**
 * Fetch Claude subscription usage for the given OAuth token via the /api/oauth/usage endpoint.
 * Returns null on any error (network, auth, unexpected shape, etc.).
 * Successes are cached in memory for 5 minutes per unique token; failures
 * for 1 minute (negative cache).
 */
export async function fetchClaudeSubscriptionLimits(
	oauthToken: string,
): Promise<ClaudeSubscriptionLimits | null> {
	// Return cached result if still valid (negative entries use the short TTL)
	const cached = cacheByToken.get(oauthToken);
	if (cached) {
		const ttl = cached.data === null ? NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS;
		if (Date.now() - cached.timestamp < ttl) {
			return cached.data;
		}
	}

	try {
		const response = await fetch(ANTHROPIC_USAGE_URL, {
			headers: {
				Authorization: `Bearer ${oauthToken}`,
				'anthropic-beta': 'oauth-2025-04-20',
				'Content-Type': 'application/json',
				'User-Agent': 'claude-code/2.1.87',
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			logger.warn('Anthropic usage API returned non-OK status', {
				status: response.status,
				token: maskToken(oauthToken),
			});
			cacheByToken.set(oauthToken, { data: null, timestamp: Date.now() });
			return null;
		}

		const json = (await response.json()) as Record<string, unknown>;
		const result: ClaudeSubscriptionLimits = {
			tokenMasked: maskToken(oauthToken),
			buckets: parseBuckets(json),
			extraUsage: parseExtraUsage(json),
		};

		cacheByToken.set(oauthToken, { data: result, timestamp: Date.now() });
		return result;
	} catch (err) {
		// Network error, timeout, parse error, etc.
		logger.warn('Anthropic usage API fetch failed', {
			token: maskToken(oauthToken),
			error: String(err),
		});
		cacheByToken.set(oauthToken, { data: null, timestamp: Date.now() });
		return null;
	}
}

/**
 * Clear the in-memory limits cache (useful for testing).
 */
export function clearAnthropicLimitsCache(): void {
	cacheByToken.clear();
}
