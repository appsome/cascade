/**
 * OAuth usage endpoint — returns per-bucket utilization percentages and reset times
 * for the authenticated subscription.
 */
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

/** A single rate-limit bucket from the usage API. */
export interface UsageBucket {
	/** Human-readable label (e.g. "5-Hour Window", "Sonnet 7-Day") */
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
	data: ClaudeSubscriptionLimits;
	timestamp: number;
}

/**
 * Per-token cache. Keyed by full token for lookup; only the masked value is
 * surfaced in returned data.
 */
const cacheByToken = new Map<string, CacheEntry>();

/**
 * Masks a token, showing only the last 4 characters.
 */
function maskToken(token: string): string {
	return `****${token.slice(-4)}`;
}

/** Maps API response keys to human-readable labels. */
const BUCKET_LABELS: Record<string, string> = {
	five_hour: '5-Hour Window',
	seven_day: '7-Day Overall',
	seven_day_oauth_apps: '7-Day OAuth Apps',
	seven_day_opus: '7-Day Opus',
	seven_day_sonnet: '7-Day Sonnet',
	seven_day_cowork: '7-Day Cowork',
	iguana_necktie: 'Iguana Necktie',
};

/** Parse usage buckets from the API response JSON. */
function parseBuckets(json: Record<string, unknown>): UsageBucket[] {
	const buckets: UsageBucket[] = [];
	for (const [key, label] of Object.entries(BUCKET_LABELS)) {
		const raw = json[key] as { utilization?: number; resets_at?: string } | null | undefined;
		if (raw && typeof raw.utilization === 'number' && typeof raw.resets_at === 'string') {
			buckets.push({ label, utilization: raw.utilization, resetsAt: raw.resets_at });
		}
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
 * Results are cached in memory for 5 minutes per unique token.
 */
export async function fetchClaudeSubscriptionLimits(
	oauthToken: string,
): Promise<ClaudeSubscriptionLimits | null> {
	// Return cached result if still valid
	const cached = cacheByToken.get(oauthToken);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
		return cached.data;
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
	} catch {
		// Return null on any failure (network error, timeout, parse error, etc.)
		return null;
	}
}

/**
 * Clear the in-memory limits cache (useful for testing).
 */
export function clearAnthropicLimitsCache(): void {
	cacheByToken.clear();
}
