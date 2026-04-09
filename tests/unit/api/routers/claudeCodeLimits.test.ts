import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, createMockSuperAdmin } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const { mockListAllClaudeCodeCredentials, mockFetchClaudeSubscriptionLimits } = vi.hoisted(() => ({
	mockListAllClaudeCodeCredentials: vi.fn(),
	mockFetchClaudeSubscriptionLimits: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listAllClaudeCodeCredentials: mockListAllClaudeCodeCredentials,
}));

vi.mock('../../../../src/anthropic/client.js', () => ({
	fetchClaudeSubscriptionLimits: mockFetchClaudeSubscriptionLimits,
}));

import { claudeCodeLimitsRouter } from '../../../../src/api/routers/claudeCodeLimits.js';

const createCaller = createCallerFor(claudeCodeLimitsRouter);

const sampleLimits = {
	plan: 'claude_max',
	messagesUsed: 1000,
	messagesLimit: 20000,
	tokensUsed: 500000,
	tokensLimit: 10000000,
	resetsAt: '2026-05-01T00:00:00Z',
	tokenMasked: '****abcd',
};

describe('claudeCodeLimitsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Clear the global env var between tests
		delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
	});

	describe('query', () => {
		it('requires superadmin role — rejects regular users', async () => {
			const caller = createCaller(createMockContext({ role: 'member' }));
			await expectTRPCError(caller.query(), 'FORBIDDEN');
		});

		it('requires superadmin role — rejects admin users', async () => {
			const caller = createCaller(createMockContext({ role: 'admin' }));
			await expectTRPCError(caller.query(), 'FORBIDDEN');
		});

		it('returns empty array when no credentials and no env var', async () => {
			mockListAllClaudeCodeCredentials.mockResolvedValueOnce([]);

			const caller = createCaller({
				user: createMockSuperAdmin(),
				effectiveOrgId: 'org-1',
			});
			const result = await caller.query();

			expect(result).toEqual([]);
		});

		it('fetches limits for credentials found in DB', async () => {
			mockListAllClaudeCodeCredentials.mockResolvedValueOnce([
				{ projectId: 'proj-1', value: 'token-aaa' },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValueOnce(sampleLimits);

			const caller = createCaller({
				user: createMockSuperAdmin(),
				effectiveOrgId: 'org-1',
			});
			const result = await caller.query();

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(sampleLimits);
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('token-aaa');
		});

		it('deduplicates tokens from multiple projects', async () => {
			mockListAllClaudeCodeCredentials.mockResolvedValueOnce([
				{ projectId: 'proj-1', value: 'shared-token' },
				{ projectId: 'proj-2', value: 'shared-token' },
				{ projectId: 'proj-3', value: 'other-token' },
			]);
			mockFetchClaudeSubscriptionLimits
				.mockResolvedValueOnce({ ...sampleLimits, tokenMasked: '****oken' })
				.mockResolvedValueOnce({ ...sampleLimits, tokenMasked: '****oken2' });

			const caller = createCaller({
				user: createMockSuperAdmin(),
				effectiveOrgId: 'org-1',
			});
			const result = await caller.query();

			// Should only call fetch twice (once per unique token)
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledTimes(2);
			expect(result).toHaveLength(2);
		});

		it('includes global env var token', async () => {
			process.env.CLAUDE_CODE_OAUTH_TOKEN = 'global-env-token';
			mockListAllClaudeCodeCredentials.mockResolvedValueOnce([]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValueOnce(sampleLimits);

			const caller = createCaller({
				user: createMockSuperAdmin(),
				effectiveOrgId: 'org-1',
			});
			const result = await caller.query();

			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('global-env-token');
			expect(result).toHaveLength(1);
		});

		it('deduplicates global env var against project credentials', async () => {
			process.env.CLAUDE_CODE_OAUTH_TOKEN = 'shared-token';
			mockListAllClaudeCodeCredentials.mockResolvedValueOnce([
				{ projectId: 'proj-1', value: 'shared-token' },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValueOnce(sampleLimits);

			const caller = createCaller({
				user: createMockSuperAdmin(),
				effectiveOrgId: 'org-1',
			});
			const result = await caller.query();

			// Even though token appears in both DB and env, fetch only once
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledTimes(1);
			expect(result).toHaveLength(1);
		});

		it('filters out null results from failed API calls', async () => {
			mockListAllClaudeCodeCredentials.mockResolvedValueOnce([
				{ projectId: 'proj-1', value: 'token-good' },
				{ projectId: 'proj-2', value: 'token-bad' },
			]);
			mockFetchClaudeSubscriptionLimits
				.mockResolvedValueOnce(sampleLimits) // token-good succeeds
				.mockResolvedValueOnce(null); // token-bad fails

			const caller = createCaller({
				user: createMockSuperAdmin(),
				effectiveOrgId: 'org-1',
			});
			const result = await caller.query();

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(sampleLimits);
		});

		it('returns empty array when all API calls return null', async () => {
			mockListAllClaudeCodeCredentials.mockResolvedValueOnce([
				{ projectId: 'proj-1', value: 'token-bad' },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValueOnce(null);

			const caller = createCaller({
				user: createMockSuperAdmin(),
				effectiveOrgId: 'org-1',
			});
			const result = await caller.query();

			expect(result).toEqual([]);
		});
	});
});
