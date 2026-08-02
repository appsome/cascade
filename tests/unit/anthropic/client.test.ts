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

	// Reflects the actual /api/oauth/usage response shape
	const sampleResponse = {
		five_hour: { utilization: 33, resets_at: '2026-04-10T19:00:00.772723+00:00' },
		seven_day: { utilization: 3, resets_at: '2026-04-17T09:59:59.772747+00:00' },
		seven_day_oauth_apps: null,
		seven_day_opus: null,
		seven_day_sonnet: { utilization: 44, resets_at: '2026-04-10T16:59:59.772755+00:00' },
		seven_day_cowork: null,
		iguana_necktie: null,
		extra_usage: {
			is_enabled: false,
			monthly_limit: null,
			used_credits: null,
			utilization: null,
		},
	};

	it('returns usage buckets on success', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('test-oauth-token');

		expect(result).not.toBeNull();
		expect(result?.buckets).toHaveLength(3);
		expect(result?.buckets[0]).toEqual({
			label: '5-Hour Window',
			utilization: 33,
			resetsAt: '2026-04-10T19:00:00.772723+00:00',
		});
		expect(result?.buckets[1]).toEqual({
			label: '7-Day Overall',
			utilization: 3,
			resetsAt: '2026-04-17T09:59:59.772747+00:00',
		});
		expect(result?.buckets[2]).toEqual({
			label: '7-Day Sonnet',
			utilization: 44,
			resetsAt: '2026-04-10T16:59:59.772755+00:00',
		});
	});

	it('parses extra_usage when enabled with values', async () => {
		const responseWithExtra = {
			...sampleResponse,
			extra_usage: {
				is_enabled: true,
				monthly_limit: 100,
				used_credits: 42.5,
				utilization: 42,
			},
		};
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(responseWithExtra) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('test-token');

		expect(result?.extraUsage).toEqual({
			isEnabled: true,
			monthlyLimit: 100,
			usedCredits: 42.5,
			utilization: 42,
		});
	});

	it('returns extra_usage as non-enabled when disabled', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('test-token');

		expect(result?.extraUsage).toEqual({
			isEnabled: false,
			monthlyLimit: null,
			usedCredits: null,
			utilization: null,
		});
	});

	it('skips null buckets', async () => {
		const sparseResponse = {
			five_hour: null,
			seven_day: { utilization: 10, resets_at: '2026-04-17T00:00:00Z' },
			seven_day_oauth_apps: null,
			seven_day_opus: null,
			seven_day_sonnet: null,
			seven_day_cowork: null,
			iguana_necktie: null,
			extra_usage: null,
		};
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sparseResponse) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('test-token');

		expect(result?.buckets).toHaveLength(1);
		expect(result?.buckets[0]?.label).toBe('7-Day Overall');
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

	it('calls the oauth/usage endpoint', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse(sampleResponse) as ReturnType<typeof fetch>,
		);

		await fetchClaudeSubscriptionLimits('my-oauth-token');

		expect(fetch).toHaveBeenCalledWith(
			'https://api.anthropic.com/api/oauth/usage',
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

	it('returns empty buckets when response has no recognized fields', async () => {
		vi.mocked(fetch).mockReturnValueOnce(
			makeFetchResponse({ something_unexpected: true }) as ReturnType<typeof fetch>,
		);

		const result = await fetchClaudeSubscriptionLimits('some-token');

		expect(result).not.toBeNull();
		expect(result?.buckets).toEqual([]);
		expect(result?.extraUsage).toBeNull();
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
