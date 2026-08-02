import { fetchClaudeSubscriptionLimits } from '../../anthropic/client.js';
import { listAllClaudeCodeCredentials } from '../../db/repositories/credentialsRepository.js';
import { router, superAdminProcedure } from '../trpc.js';

export const claudeCodeLimitsRouter = router({
	/**
	 * Fetch Claude Code subscription limits for all unique OAuth tokens configured
	 * across org projects, plus the global env var if set.
	 *
	 * Superadmin only. Returns masked token + limits data — never raw tokens.
	 */
	query: superAdminProcedure.query(async ({ ctx }) => {
		// Gather tokens from project credentials
		const projectCredentials = await listAllClaudeCodeCredentials(ctx.effectiveOrgId);

		// Build a deduplicated set of tokens (value → first seen)
		const tokenMap = new Map<string, boolean>();
		const tokens: string[] = [];

		for (const cred of projectCredentials) {
			if (!tokenMap.has(cred.value)) {
				tokenMap.set(cred.value, true);
				tokens.push(cred.value);
			}
		}

		// Also include the global env var if set
		const globalToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
		if (globalToken && !tokenMap.has(globalToken)) {
			tokenMap.set(globalToken, true);
			tokens.push(globalToken);
		}

		// Fetch limits for each unique token in parallel
		const results = await Promise.all(tokens.map((token) => fetchClaudeSubscriptionLimits(token)));

		// Filter nulls (API errors / unavailable)
		return results.filter((r) => r !== null);
	}),
});
