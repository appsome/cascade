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

	const sampleResponse = {
		plan: 'claude_max',
		usage: {
			messages_used: 1234,
			messages_limit: 20000,
			tokens_used: 500000,
			tokens_limit: 10000000,
			resets_at: '2026-05-01T00:00:00Z',
		},
	};

	it('returns limits data on success', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('test-oauth-token');

		expect(result).not.toBeNull();
		expect(result?.plan).toBe('claude_max');
		expect(result?.messagesUsed).toBe(1234);
		expect(result?.messagesLimit).toBe(20000);
		expect(result?.tokensUsed).toBe(500000);
		expect(result?.tokensLimit).toBe(10000000);
		expect(result?.resetsAt).toBe('2026-05-01T00:00:00Z');
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

	it('returns null when response has no usage field', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse({ plan: 'claude_max' }) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('some-token');

		expect(result).toBeNull();
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
