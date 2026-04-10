/**
 * OAuth profile endpoint used by the Claude Code CLI to fetch subscription info.
 * Returns organization type (plan), rate limit tier, and account display name.
 * Note: per-token usage stats (messages/tokens used) are not available via this
 * endpoint — they are only surfaced via rate-limit response headers during API calls.
 */
const ANTHROPIC_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
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
 * Fetch Claude subscription info for the given OAuth token via the oauth/profile endpoint.
 * Returns null on any error (network, auth, unexpected shape, etc.).
 * Results are cached in memory for 5 minutes per unique token.
 *
 * Note: per-token usage stats (messages/tokens used vs. limit) are not available
 * from this endpoint. The returned `messagesUsed`, `messagesLimit`, `tokensUsed`,
 * `tokensLimit`, and `resetsAt` fields will always be 0/"" — the UI hides them
 * when the limit is 0.
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
		const response = await fetch(ANTHROPIC_PROFILE_URL, {
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

		// Parse defensively — return null if the shape doesn't match expectations.
		// The profile response contains: { organization: { organization_type, rate_limit_tier, ... }, account: { ... } }
		const organization = json.organization as Record<string, unknown> | undefined;

		if (!organization) {
			return null;
		}

		// organization_type is e.g. "claude_max", "claude_pro", "claude_enterprise", "claude_team"
		const plan =
			typeof organization.organization_type === 'string'
				? organization.organization_type
				: 'unknown';

		const result: ClaudeSubscriptionLimits = {
			plan,
			// Usage stats (messages/tokens) are not available from this endpoint;
			// the UI hides these fields when limit is 0.
			messagesUsed: 0,
			messagesLimit: 0,
			tokensUsed: 0,
			tokensLimit: 0,
			resetsAt: '',
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
