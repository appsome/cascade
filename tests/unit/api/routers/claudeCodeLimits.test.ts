import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockListAllClaudeCodeCredentials,
	mockListProjectCredentials,
	mockResolveOrgCredential,
	mockFetchClaudeSubscriptionLimits,
	mockVerifyProjectOrgAccess,
	mockGetOrgMembership,
} = vi.hoisted(() => ({
	mockListAllClaudeCodeCredentials: vi.fn(),
	mockListProjectCredentials: vi.fn(),
	mockResolveOrgCredential: vi.fn(),
	mockFetchClaudeSubscriptionLimits: vi.fn(),
	mockVerifyProjectOrgAccess: vi.fn(),
	mockGetOrgMembership: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listAllClaudeCodeCredentials: mockListAllClaudeCodeCredentials,
	listProjectCredentials: mockListProjectCredentials,
}));

vi.mock('../../../../src/db/repositories/orgCredentialsRepository.js', () => ({
	resolveOrgCredential: mockResolveOrgCredential,
}));

vi.mock('../../../../src/anthropic/client.js', () => ({
	fetchClaudeSubscriptionLimits: mockFetchClaudeSubscriptionLimits,
}));

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: mockVerifyProjectOrgAccess,
}));

// Per-org actor-role refinement reads memberships through this repository.
// Default (no membership row) falls back to the global role in the home org.
vi.mock('../../../../src/db/repositories/orgMembershipsRepository.js', () => ({
	getOrgMembership: mockGetOrgMembership,
}));

import { claudeCodeLimitsRouter } from '../../../../src/api/routers/claudeCodeLimits.js';

const createCaller = createCallerFor(claudeCodeLimitsRouter);

const mockAdmin = createMockUser({ role: 'admin' });

const sampleLimits = {
	tokenMasked: '****abcd',
	buckets: [
		{ label: '5-Hour Window', utilization: 33, resetsAt: '2026-04-10T19:00:00Z' },
		{ label: '7-Day Overall', utilization: 3, resetsAt: '2026-04-17T10:00:00Z' },
	],
	extraUsage: { isEnabled: false, monthlyLimit: null, usedCredits: null, utilization: null },
};

describe('claudeCodeLimitsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
		mockGetOrgMembership.mockResolvedValue(null);
		mockResolveOrgCredential.mockResolvedValue(null);
		mockListAllClaudeCodeCredentials.mockResolvedValue([]);
		mockListProjectCredentials.mockResolvedValue([]);
		mockVerifyProjectOrgAccess.mockResolvedValue(undefined);
	});

	describe('forOrg', () => {
		it('rejects members (global role)', async () => {
			const caller = createCaller(createMockContext({ role: 'member' }));
			await expectTRPCError(caller.forOrg(), 'FORBIDDEN');
		});

		it('rejects a global admin who is only a member in the effective org', async () => {
			mockGetOrgMembership.mockResolvedValue({ role: 'member' });
			const caller = createCaller({ user: mockAdmin, effectiveOrgId: 'other-org' });
			await expectTRPCError(caller.forOrg(), 'FORBIDDEN');
		});

		it('returns empty array when no token source is configured', async () => {
			const caller = createCaller({ user: mockAdmin, effectiveOrgId: mockAdmin.orgId });
			expect(await caller.forOrg()).toEqual([]);
		});

		it('labels org, project, and env sources with attribution', async () => {
			mockResolveOrgCredential.mockResolvedValue('org-token');
			mockListAllClaudeCodeCredentials.mockResolvedValue([
				{ projectId: 'proj-1', projectName: 'Project One', value: 'proj-token' },
			]);
			process.env.CLAUDE_CODE_OAUTH_TOKEN = 'env-token';
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: mockAdmin, effectiveOrgId: mockAdmin.orgId });
			const result = await caller.forOrg();

			expect(result).toEqual([
				{ scope: 'org', limits: sampleLimits },
				{
					scope: 'project',
					projectId: 'proj-1',
					projectName: 'Project One',
					limits: sampleLimits,
				},
				{ scope: 'env', limits: sampleLimits },
			]);
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('org-token');
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('proj-token');
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('env-token');
		});

		it('keeps a failed source with limits: null instead of dropping it', async () => {
			mockResolveOrgCredential.mockResolvedValue('org-token');
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(null);

			const caller = createCaller({ user: mockAdmin, effectiveOrgId: mockAdmin.orgId });
			const result = await caller.forOrg();

			expect(result).toEqual([{ scope: 'org', limits: null }]);
		});

		it('scopes lookups to the effective org', async () => {
			const caller = createCaller({ user: mockAdmin, effectiveOrgId: mockAdmin.orgId });
			await caller.forOrg();

			expect(mockResolveOrgCredential).toHaveBeenCalledWith('org-1', 'CLAUDE_CODE_OAUTH_TOKEN');
			expect(mockListAllClaudeCodeCredentials).toHaveBeenCalledWith('org-1');
		});
	});

	describe('forProject', () => {
		const member = createMockUser({ role: 'member' });

		it('verifies project org access', async () => {
			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			await caller.forProject({ projectId: 'p1' });
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('p1', 'org-1');
		});

		it('marks the project override active over the org token', async () => {
			mockListProjectCredentials.mockResolvedValue([
				{ envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'proj-token', name: null },
			]);
			mockResolveOrgCredential.mockResolvedValue('org-token');
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			const result = await caller.forProject({ projectId: 'p1' });

			expect(result).toEqual([
				{ scope: 'project', projectId: 'p1', active: true, limits: sampleLimits },
				{ scope: 'org', active: false, limits: sampleLimits },
			]);
		});

		it('marks the org token active when no project override exists', async () => {
			mockResolveOrgCredential.mockResolvedValue('org-token');
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			const result = await caller.forProject({ projectId: 'p1' });

			expect(result).toEqual([{ scope: 'org', active: true, limits: sampleLimits }]);
		});

		it('includes the env token as an inactive informational source', async () => {
			process.env.CLAUDE_CODE_OAUTH_TOKEN = 'env-token';
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			const result = await caller.forProject({ projectId: 'p1' });

			expect(result).toEqual([{ scope: 'env', active: false, limits: sampleLimits }]);
		});

		it('returns empty array when nothing is configured', async () => {
			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			expect(await caller.forProject({ projectId: 'p1' })).toEqual([]);
		});
	});
});
