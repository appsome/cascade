import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockListAllClaudeCodeCredentials,
	mockListAllNamedClaudeCodeTokens,
	mockListProjectCredentialSelections,
	mockGetProjectOwnCredential,
	mockFetchClaudeSubscriptionLimits,
	mockVerifyProjectOrgAccess,
	mockGetOrgMembership,
} = vi.hoisted(() => ({
	mockListAllClaudeCodeCredentials: vi.fn(),
	mockListAllNamedClaudeCodeTokens: vi.fn(),
	mockListProjectCredentialSelections: vi.fn(),
	mockGetProjectOwnCredential: vi.fn(),
	mockFetchClaudeSubscriptionLimits: vi.fn(),
	mockVerifyProjectOrgAccess: vi.fn(),
	mockGetOrgMembership: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listAllClaudeCodeCredentials: mockListAllClaudeCodeCredentials,
	listAllNamedClaudeCodeTokens: mockListAllNamedClaudeCodeTokens,
	listProjectCredentialSelections: mockListProjectCredentialSelections,
	getProjectOwnCredential: mockGetProjectOwnCredential,
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
		{ key: 'five_hour', label: '5-Hour Window', utilization: 33, resetsAt: '2026-04-10T19:00:00Z' },
		{ key: 'seven_day', label: '7-Day Overall', utilization: 3, resetsAt: '2026-04-17T10:00:00Z' },
	],
	extraUsage: { isEnabled: false, monthlyLimit: null, usedCredits: null, utilization: null },
};

describe('claudeCodeLimitsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetOrgMembership.mockResolvedValue(null);
		mockListAllNamedClaudeCodeTokens.mockResolvedValue([]);
		mockListProjectCredentialSelections.mockResolvedValue([]);
		mockListAllClaudeCodeCredentials.mockResolvedValue([]);
		mockGetProjectOwnCredential.mockResolvedValue(null);
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

		it('labels named-set and project sources with attribution', async () => {
			mockListAllNamedClaudeCodeTokens.mockResolvedValue([
				{ setId: 1, setName: 'personal', isDefault: true, value: 'personal-token' },
				{ setId: 2, setName: 'work', isDefault: false, value: 'work-token' },
			]);
			mockListAllClaudeCodeCredentials.mockResolvedValue([
				{ projectId: 'proj-1', projectName: 'Project One', value: 'proj-token' },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: mockAdmin, effectiveOrgId: mockAdmin.orgId });
			const result = await caller.forOrg();

			expect(result).toEqual([
				{ scope: 'org', setId: 1, setName: 'personal', limits: sampleLimits },
				{ scope: 'org', setId: 2, setName: 'work', limits: sampleLimits },
				{
					scope: 'project',
					projectId: 'proj-1',
					projectName: 'Project One',
					limits: sampleLimits,
				},
			]);
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('personal-token');
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('work-token');
			expect(mockFetchClaudeSubscriptionLimits).toHaveBeenCalledWith('proj-token');
		});

		it('keeps a failed source with limits: null instead of dropping it', async () => {
			mockListAllNamedClaudeCodeTokens.mockResolvedValue([
				{ setId: 1, setName: 'Default', isDefault: true, value: 'org-token' },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(null);

			const caller = createCaller({ user: mockAdmin, effectiveOrgId: mockAdmin.orgId });
			const result = await caller.forOrg();

			expect(result).toEqual([{ scope: 'org', setId: 1, setName: 'Default', limits: null }]);
		});

		it('scopes lookups to the effective org', async () => {
			const caller = createCaller({ user: mockAdmin, effectiveOrgId: mockAdmin.orgId });
			await caller.forOrg();

			expect(mockListAllNamedClaudeCodeTokens).toHaveBeenCalledWith('org-1');
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

		it('marks the project override active over the org candidates', async () => {
			mockGetProjectOwnCredential.mockResolvedValue('proj-token');
			mockListAllNamedClaudeCodeTokens.mockResolvedValue([
				{ setId: 1, setName: 'Default', isDefault: true, value: 'org-token' },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			const result = await caller.forProject({ projectId: 'p1' });

			expect(result).toEqual([
				{ scope: 'project', projectId: 'p1', active: true, limits: sampleLimits },
				{
					scope: 'org',
					setId: 1,
					setName: 'Default',
					inPool: false,
					active: false,
					limits: sampleLimits,
				},
			]);
			expect(mockGetProjectOwnCredential).toHaveBeenCalledWith('p1', 'CLAUDE_CODE_OAUTH_TOKEN');
		});

		it('marks the default set active when no project override exists', async () => {
			mockListAllNamedClaudeCodeTokens.mockResolvedValue([
				{ setId: 1, setName: 'Default', isDefault: true, value: 'org-token' },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			const result = await caller.forProject({ projectId: 'p1' });

			expect(result).toEqual([
				{
					scope: 'org',
					setId: 1,
					setName: 'Default',
					inPool: false,
					active: true,
					limits: sampleLimits,
				},
			]);
		});

		it('lists the selected pool in order with inPool attribution', async () => {
			mockListAllNamedClaudeCodeTokens.mockResolvedValue([
				{ setId: 1, setName: 'Default', isDefault: true, value: 'default-token' },
				{ setId: 2, setName: 'work', isDefault: false, value: 'work-token' },
			]);
			mockListProjectCredentialSelections.mockResolvedValue([
				{ provider: 'anthropic', setId: 2, setName: 'work', position: 0 },
				{ provider: 'anthropic', setId: 1, setName: 'Default', position: 1 },
				{ provider: 'github', setId: 9, setName: 'gh', position: 0 },
			]);
			mockFetchClaudeSubscriptionLimits.mockResolvedValue(sampleLimits);

			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			const result = await caller.forProject({ projectId: 'p1' });

			expect(result).toEqual([
				{
					scope: 'org',
					setId: 2,
					setName: 'work',
					inPool: true,
					active: true,
					limits: sampleLimits,
				},
				{
					scope: 'org',
					setId: 1,
					setName: 'Default',
					inPool: true,
					active: false,
					limits: sampleLimits,
				},
			]);
		});

		it('returns empty array when nothing is configured', async () => {
			const caller = createCaller({ user: member, effectiveOrgId: member.orgId });
			expect(await caller.forProject({ projectId: 'p1' })).toEqual([]);
		});
	});
});
