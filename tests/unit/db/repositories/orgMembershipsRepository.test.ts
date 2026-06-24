import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	orgMemberships: {
		id: 'id',
		userId: 'user_id',
		orgId: 'org_id',
		role: 'role',
	},
	organizations: {
		id: 'id',
		name: 'name',
	},
}));

import {
	getOrgMembership,
	listOrgMembershipsForUser,
} from '../../../../src/db/repositories/orgMembershipsRepository.js';

describe('orgMembershipsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb();
	});

	describe('getOrgMembership', () => {
		it('returns the membership row when the user belongs to the org', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ orgId: 'org-2', role: 'admin' }]);

			const result = await getOrgMembership('user-1', 'org-2');
			expect(result).toEqual({ orgId: 'org-2', role: 'admin' });
		});

		it('returns null when there is no membership', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getOrgMembership('user-1', 'org-2');
			expect(result).toBeNull();
		});
	});

	describe('listOrgMembershipsForUser', () => {
		it('returns every org the user belongs to joined with the org name', async () => {
			const rows = [
				{ id: 'org-1', name: 'Org One', role: 'admin' },
				{ id: 'org-2', name: 'Org Two', role: 'member' },
			];
			mockDb.chain.where.mockResolvedValueOnce(rows);

			const result = await listOrgMembershipsForUser('user-1');
			expect(result).toEqual(rows);
			expect(mockDb.chain.innerJoin).toHaveBeenCalled();
		});

		it('returns an empty array when the user has no memberships', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listOrgMembershipsForUser('user-1');
			expect(result).toEqual([]);
		});
	});
});
