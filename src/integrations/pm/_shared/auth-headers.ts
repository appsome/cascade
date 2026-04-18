/**
 * Canonical Authorization-header builders for PM providers.
 *
 * Single source of truth for each provider's auth convention. Divergent
 * copies of these (e.g. Linear ack-comment client, Linear bot-identity
 * resolver) shipped the HTTP 400 bug fixed in PR #1119 — the fix moves
 * here so every call site for a given provider uses the same function.
 *
 * Contract: these functions are pure. They take the credential material
 * and return a header object. No fetch, no caching, no side effects.
 */

/**
 * Linear personal API keys (`lin_api_*`) are sent **bare** in the
 * Authorization header. The `Bearer` prefix is OAuth-only and causes
 * Linear to return HTTP 400 with a personal key. Content-Type is
 * included for convenience because every Linear call is GraphQL.
 */
export function linearAuthHeader(apiKey: string): Record<string, string> {
	return {
		Authorization: apiKey,
		'Content-Type': 'application/json',
	};
}

/**
 * GitHub personal access tokens and fine-grained tokens use Bearer.
 * Includes the JSON accept header and api-version that the router uses
 * consistently — see `src/router/platformClients/credentials.ts`
 * (`resolveGitHubHeaders`) for the original. This module supersedes it.
 */
export function githubAuthHeader(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
	};
}

/**
 * JIRA Cloud API token auth is HTTP Basic with
 * `base64(email + ":" + apiToken)` as the credentials.
 */
export function jiraAuthHeader(email: string, apiToken: string): Record<string, string> {
	const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
	return {
		Authorization: `Basic ${auth}`,
	};
}
