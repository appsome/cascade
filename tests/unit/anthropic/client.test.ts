import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	clearAnthropicLimitsCache,
	fetchClaudeSubscriptionLimits,
} from '../../../src/anthropic/client.js';

describe('fetchClaudeSubscriptionLimits', () => {
	beforeEach(() => {
		clearAnthropicLimitsCache();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		clearAnthropicLimitsCache();
	});

	function makeFetchResponse(data: unknown, ok = true, status = 200) {
		return Promise.resolve({
			ok,
			status,
			statusText: ok ? 'OK' : 'Unauthorized',
			json: () => Promise.resolve(data),
		});
	}

	// Reflects the actual api/oauth/profile response shape used by the Claude Code CLI
	const sampleResponse = {
		account: {
			display_name: 'Test User',
			created_at: '2025-01-01T00:00:00Z',
		},
		organization: {
			organization_type: 'claude_max',
			rate_limit_tier: 'default_claude_max_5x',
			has_extra_usage_enabled: false,
			billing_type: 'subscription',
			subscription_created_at: '2025-01-01T00:00:00Z',
			uuid: 'org-uuid-123',
		},
	};

	it('returns subscription info on success', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('test-oauth-token');

		expect(result).not.toBeNull();
		expect(result?.plan).toBe('claude_max');
		// Usage stats are not available from the profile endpoint; always 0
		expect(result?.messagesUsed).toBe(0);
		expect(result?.messagesLimit).toBe(0);
		expect(result?.tokensUsed).toBe(0);
		expect(result?.tokensLimit).toBe(0);
		expect(result?.resetsAt).toBe('');
	});

	it('masks the token showing only last 4 chars', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('sk-ant-oauth-abcd1234');

		expect(result?.tokenMasked).toBe('****1234');
	});

	it('sends Authorization header with Bearer token', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		await fetchClaudeSubscriptionLimits('my-oauth-token');

		expect(fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer my-oauth-token',
				}),
			}),
		);
	});

	it('calls the oauth/profile endpoint', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		await fetchClaudeSubscriptionLimits('my-oauth-token');

		expect(fetch).toHaveBeenCalledWith(
			'https://api.anthropic.com/api/oauth/profile',
			expect.any(Object),
		);
	});

	it('returns null on 4xx response', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse({}, false, 401) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('bad-token');

		expect(result).toBeNull();
	});

	it('returns null on 5xx response', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse({}, false, 500) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('some-token');

		expect(result).toBeNull();
	});

	it('returns null on network error', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

		const result = await fetchClaudeSubscriptionLimits('some-token');

		expect(result).toBeNull();
	});

	it('returns null on timeout', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new DOMException('Timeout', 'AbortError'));

		const result = await fetchClaudeSubscriptionLimits('some-token');

		expect(result).toBeNull();
	});

	it('returns null when response has no organization field', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			// Response missing the organization field (invalid shape)
			makeFetchResponse({ account: { display_name: 'Test' } }) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('some-token');

		expect(result).toBeNull();
	});

	it('returns unknown plan when organization_type is missing', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse({
				organization: { rate_limit_tier: 'default' },
			}) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('some-token');

		expect(result).not.toBeNull();
		expect(result?.plan).toBe('unknown');
	});

	it('caches results for subsequent calls with the same token', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		await fetchClaudeSubscriptionLimits('my-token');
		// Second call should use cache (fetch called only once)
		await fetchClaudeSubscriptionLimits('my-token');

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('does not share cache between different tokens', async () => {
		vi.mocked(fetch)
			.mockReturnValueOnce(makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>)
			.mockReturnValueOnce(makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>);

		await fetchClaudeSubscriptionLimits('token-a');
		await fetchClaudeSubscriptionLimits('token-b');

		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('clearAnthropicLimitsCache allows re-fetching', async () => {
		vi.mocked(fetch)
			.mockReturnValueOnce(makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>)
			.mockReturnValueOnce(makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>);

		await fetchClaudeSubscriptionLimits('my-token');
		clearAnthropicLimitsCache();
		await fetchClaudeSubscriptionLimits('my-token');

		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
