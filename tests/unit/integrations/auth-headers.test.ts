/**
 * Shared auth-header builders — single source of truth for every PM
 * provider's Authorization header convention. The Linear `Bearer`-prefix
 * bug that shipped this session (PR #1119) came from three divergent
 * copies of the same builder; these tests guard against regression.
 */

import { describe, expect, it } from 'vitest';
import {
	githubAuthHeader,
	jiraAuthHeader,
	linearAuthHeader,
} from '../../../src/integrations/pm/_shared/auth-headers.js';

describe('linearAuthHeader', () => {
	it('returns the bare API key with no Bearer prefix', () => {
		// Regression against PR #1119: Linear personal API keys (lin_api_*) must
		// NOT be sent with `Bearer ` — Linear interprets the prefix as an OAuth
		// token and returns HTTP 400.
		const headers = linearAuthHeader('lin_api_test123');
		expect(headers.Authorization).toBe('lin_api_test123');
		expect(headers.Authorization).not.toMatch(/^Bearer\s/);
		expect(headers['Content-Type']).toBe('application/json');
	});
});

describe('githubAuthHeader', () => {
	it('returns Bearer token plus Accept and API-version headers', () => {
		const headers = githubAuthHeader('ghp_test');
		expect(headers).toEqual({
			Authorization: 'Bearer ghp_test',
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
		});
	});
});

describe('jiraAuthHeader', () => {
	it('returns Basic <base64(email:apiToken)>', () => {
		const headers = jiraAuthHeader('bot@example.com', 'jira-api-token');
		const expected = `Basic ${Buffer.from('bot@example.com:jira-api-token').toString('base64')}`;
		expect(headers.Authorization).toBe(expected);
	});
});
