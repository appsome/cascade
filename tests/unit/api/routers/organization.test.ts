import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockGetOrganization,
	mockUpdateOrganization,
	mockListAllOrganizations,
	mockListOrgCredentials,
	mockListOrgCredentialsMeta,
	mockWriteOrgCredential,
	mockDeleteOrgCredential,
	mockGetOrgMembership,
} = vi.hoisted(() => ({
	mockGetOrganization: vi.fn(),
	mockUpdateOrganization: vi.fn(),
	mockListAllOrganizations: vi.fn(),
	mockListOrgCredentials: vi.fn(),
	mockListOrgCredentialsMeta: vi.fn(),
	mockWriteOrgCredential: vi.fn(),
	mockDeleteOrgCredential: vi.fn(),
	mockGetOrgMembership: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	getOrganization: mockGetOrganization,
	updateOrganization: mockUpdateOrganization,
	listAllOrganizations: mockListAllOrganizations,
}));

vi.mock('../../../../src/db/repositories/orgCredentialsRepository.js', () => ({
	listOrgCredentials: mockListOrgCredentials,
	listOrgCredentialsMeta: mockListOrgCredentialsMeta,
	writeOrgCredential: mockWriteOrgCredential,
	deleteOrgCredential: mockDeleteOrgCredential,
}));

// Per-org actor-role refinement reads memberships through this repository.
// Default (no membership row) falls back to the global role in the home org,
// so admin/member fixtures acting in their home org behave as their global role.
vi.mock('../../../../src/db/repositories/orgMembershipsRepository.js', () => ({
	getOrgMembership: mockGetOrgMembership,
}));

vi.mock('../../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import { organizationRouter } from '../../../../src/api/routers/organization.js';

const createCaller = createCallerFor(organizationRouter);

const mockUser = createMockUser();
const mockSuperAdmin = createMockSuperAdmin();

describe('organizationRouter', () => {
	describe('get', () => {
		it('returns organization for user orgId', async () => {
			const mockOrg = { id: 'org-1', name: 'My Org' };
			mockGetOrganization.mockResolvedValue(mockOrg);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.get();

			expect(mockGetOrganization).toHaveBeenCalledWith('org-1');
			expect(result).toEqual(mockOrg);
		});

		it('returns null when organization not found', async () => {
			mockGetOrganization.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.get();
			expect(result).toBeNull();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.get(), 'UNAUTHORIZED');
		});
	});

	describe('update', () => {
		it('updates organization name', async () => {
			mockUpdateOrganization.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ name: 'New Name' });

			expect(mockUpdateOrganization).toHaveBeenCalledWith('org-1', { name: 'New Name' });
		});

		it('rejects empty name', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.update({ name: '' })).rejects.toThrow();
		});

		it('throws FORBIDDEN when user is a member (not admin)', async () => {
			const memberUser = createMockUser({ role: 'member' });
			const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });
			await expectTRPCError(caller.update({ name: 'New' }), 'FORBIDDEN');
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.update({ name: 'New' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('list', () => {
		it('returns all organizations for superadmin user', async () => {
			const orgs = [
				{ id: 'org-1', name: 'Org One' },
				{ id: 'org-2', name: 'Org Two' },
			];
			mockListAllOrganizations.mockResolvedValue(orgs);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			const result = await caller.list();

			expect(mockListAllOrganizations).toHaveBeenCalled();
			expect(result).toEqual(orgs);
		});

		it('throws FORBIDDEN when user is admin (not superadmin)', async () => {
			const adminUser = createMockUser({ role: 'admin' });
			const caller = createCaller({ user: adminUser, effectiveOrgId: adminUser.orgId });
			await expectTRPCError(caller.list(), 'FORBIDDEN');
		});

		it('throws FORBIDDEN when user is not admin', async () => {
			const memberUser = {
				id: 'user-2',
				orgId: 'org-1',
				email: 'member@example.com',
				name: 'Member',
				role: 'member',
			};
			const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });
			await expectTRPCError(caller.list(), 'FORBIDDEN');
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('credentials', () => {
		beforeEach(() => {
			vi.clearAllMocks();
			// No membership row → resolveActorRoleInOrg falls back to the global
			// role in the home org.
			mockGetOrgMembership.mockResolvedValue(null);
		});

		describe('list', () => {
			it('returns masked values scoped to the effective org', async () => {
				mockListOrgCredentials.mockResolvedValue([
					{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'ghp_1234567890abcd', name: 'GH' },
					{ envVarKey: 'SHORT_KEY', value: 'short', name: null },
				]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list();

				expect(mockListOrgCredentials).toHaveBeenCalledWith('org-1');
				expect(result).toEqual([
					{
						envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
						name: 'GH',
						isConfigured: true,
						maskedValue: '****abcd',
					},
					{ envVarKey: 'SHORT_KEY', name: null, isConfigured: true, maskedValue: '****' },
				]);
			});

			it('falls back to metadata when decryption fails', async () => {
				mockListOrgCredentials.mockRejectedValue(new Error('decrypt failed'));
				mockListOrgCredentialsMeta.mockResolvedValue([{ envVarKey: 'KEY_A', name: 'A' }]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list();

				expect(result).toEqual([
					{ envVarKey: 'KEY_A', name: 'A', isConfigured: true, maskedValue: '****' },
				]);
			});

			it('throws FORBIDDEN for a global member', async () => {
				const memberUser = createMockUser({ role: 'member' });
				const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });
				await expectTRPCError(caller.credentials.list(), 'FORBIDDEN');
			});

			it('throws FORBIDDEN for a global admin who is only a member in the effective org', async () => {
				mockGetOrgMembership.mockResolvedValue({ role: 'member' });
				const caller = createCaller({ user: mockUser, effectiveOrgId: 'other-org' });
				await expectTRPCError(caller.credentials.list(), 'FORBIDDEN');
			});
		});

		describe('set', () => {
			it('writes to the effective org', async () => {
				mockWriteOrgCredential.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.set({
					envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
					value: 'ghp_new',
					name: 'GH',
				});

				expect(mockWriteOrgCredential).toHaveBeenCalledWith(
					'org-1',
					'GITHUB_TOKEN_IMPLEMENTER',
					'ghp_new',
					'GH',
				);
			});

			it('rejects invalid env var keys', async () => {
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
				await expect(
					caller.credentials.set({ envVarKey: 'lower_case', value: 'x' }),
				).rejects.toThrow();
				expect(mockWriteOrgCredential).not.toHaveBeenCalled();
			});

			it('throws FORBIDDEN for a global member', async () => {
				const memberUser = createMockUser({ role: 'member' });
				const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });
				await expectTRPCError(
					caller.credentials.set({ envVarKey: 'SOME_KEY', value: 'x' }),
					'FORBIDDEN',
				);
			});
		});

		describe('delete', () => {
			it('deletes from the effective org', async () => {
				mockDeleteOrgCredential.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.delete({ envVarKey: 'SOME_KEY' });

				expect(mockDeleteOrgCredential).toHaveBeenCalledWith('org-1', 'SOME_KEY');
			});

			it('throws FORBIDDEN for a global admin who is only a member in the effective org', async () => {
				mockGetOrgMembership.mockResolvedValue({ role: 'member' });
				const caller = createCaller({ user: mockUser, effectiveOrgId: 'other-org' });
				await expectTRPCError(caller.credentials.delete({ envVarKey: 'SOME_KEY' }), 'FORBIDDEN');
			});
		});
	});
});
