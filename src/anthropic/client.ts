const ANTHROPIC_ACCOUNT_URL = 'https://api.anthropic.com/api/account';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

export interface ClaudeSubscriptionLimits {
	plan: string;
	messagesUsed: number;
	messagesLimit: number;
	tokensUsed: number;
	tokensLimit: number;
	resetsAt: string;
	tokenMasked: string;
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

/**
 * Fetch Claude subscription limits for the given OAuth token.
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
		const response = await fetch(ANTHROPIC_ACCOUNT_URL, {
			headers: {
				Authorization: `Bearer ${oauthToken}`,
				'anthropic-version': '2023-06-01',
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			return null;
		}

		const json = (await response.json()) as Record<string, unknown>;

		// Parse defensively — return null if the shape doesn't match expectations
		const usage = json.usage as Record<string, unknown> | undefined;

		if (!usage) {
			return null;
		}

		const plan = typeof json.plan === 'string' ? json.plan : 'unknown';
		const messagesUsed = typeof usage.messages_used === 'number' ? usage.messages_used : 0;
		const messagesLimit = typeof usage.messages_limit === 'number' ? usage.messages_limit : 0;
		const tokensUsed = typeof usage.tokens_used === 'number' ? usage.tokens_used : 0;
		const tokensLimit = typeof usage.tokens_limit === 'number' ? usage.tokens_limit : 0;
		const resetsAt = typeof usage.resets_at === 'string' ? usage.resets_at : '';

		const result: ClaudeSubscriptionLimits = {
			plan,
			messagesUsed,
			messagesLimit,
			tokensUsed,
			tokensLimit,
			resetsAt,
			tokenMasked: maskToken(oauthToken),
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
