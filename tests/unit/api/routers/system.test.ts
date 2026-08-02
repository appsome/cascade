import { afterEach, describe, expect, it } from 'vitest';
import { systemRouter } from '../../../../src/api/routers/system.js';
import { createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const createCaller = createCallerFor(systemRouter);

const mockUser = createMockUser();

describe('systemRouter', () => {
	describe('getPublicUrl', () => {
		const originalEnv = process.env.WEBHOOK_CALLBACK_BASE_URL;

		afterEach(() => {
			if (originalEnv === undefined) {
				delete process.env.WEBHOOK_CALLBACK_BASE_URL;
			} else {
				process.env.WEBHOOK_CALLBACK_BASE_URL = originalEnv;
			}
		});

		it('returns the WEBHOOK_CALLBACK_BASE_URL when set', async () => {
			process.env.WEBHOOK_CALLBACK_BASE_URL = 'https://cascade.example.com';
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getPublicUrl();

			expect(result).toEqual({ routerPublicUrl: 'https://cascade.example.com' });
		});

		it('returns null when WEBHOOK_CALLBACK_BASE_URL is not set', async () => {
			delete process.env.WEBHOOK_CALLBACK_BASE_URL;
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getPublicUrl();

			expect(result).toEqual({ routerPublicUrl: null });
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.getPublicUrl(), 'UNAUTHORIZED');
		});

		it('returns the URL for member role (protected procedure, not admin-only)', async () => {
			process.env.WEBHOOK_CALLBACK_BASE_URL = 'https://cascade.example.com';
			const memberUser = createMockUser({ role: 'member' });
			const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });

			const result = await caller.getPublicUrl();

			expect(result.routerPublicUrl).toBe('https://cascade.example.com');
		});
	});
});
