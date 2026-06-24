/**
 * Integration tests for the multi-org membership MANAGEMENT surface
 * (spec 021, plan 3 of 4).
 *
 * Exercises the plan-3 mutations + listing against a real database:
 *   - addOrgMembership grant (idempotent re-grant updates the per-org role)
 *   - listOrgMembers membership-based listing (true membership across home orgs,
 *     per-org role, excludeGlobalRole filter)
 *   - createUserWithMembership atomic create (user + mirrored membership; a
 *     duplicate-email unique violation rolls back, leaving no orphan rows)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	addOrgMembership,
	getOrgMembership,
	listOrgMembers,
} from '../../../src/db/repositories/orgMembershipsRepository.js';
import {
	createUserWithMembership,
	getUserByEmail,
} from '../../../src/db/repositories/usersRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedMembership, seedOrg, seedUser } from '../helpers/seed.js';

describe('multi-org membership management (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg('home-org', 'Home Org');
		await seedOrg('other-org', 'Other Org');
	});

	describe('addOrgMembership', () => {
		it('grants a new membership with the requested role', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'g@example.com', role: 'member' });

			await addOrgMembership({ userId: user.id, orgId: 'other-org', role: 'admin' });

			expect(await getOrgMembership(user.id, 'other-org')).toEqual({
				orgId: 'other-org',
				role: 'admin',
			});
		});

		it('is idempotent: re-granting updates the per-org role without error', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'h@example.com', role: 'member' });
			await seedMembership({ userId: user.id, orgId: 'other-org', role: 'member' });

			// Re-grant with a different role — must not throw on the unique index.
			await addOrgMembership({ userId: user.id, orgId: 'other-org', role: 'admin' });

			expect(await getOrgMembership(user.id, 'other-org')).toEqual({
				orgId: 'other-org',
				role: 'admin',
			});
			// Still exactly one membership row for this (user, org).
			const members = await listOrgMembers('other-org');
			expect(members.filter((m) => m.id === user.id)).toHaveLength(1);
		});
	});

	describe('listOrgMembers', () => {
		it('returns the org true membership including accounts whose home org is elsewhere', async () => {
			const local = await seedUser({
				orgId: 'other-org',
				email: 'local@example.com',
				role: 'member',
			});
			await seedMembership({ userId: local.id, orgId: 'other-org', role: 'member' });

			// A user whose HOME org is home-org but who is a member of other-org.
			const guest = await seedUser({
				orgId: 'home-org',
				email: 'guest@example.com',
				role: 'member',
			});
			await seedMembership({ userId: guest.id, orgId: 'other-org', role: 'admin' });

			const members = await listOrgMembers('other-org');

			expect(members).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: local.id, email: 'local@example.com', role: 'member' }),
					// Per-org role (admin) wins over the guest's global role (member).
					expect.objectContaining({ id: guest.id, email: 'guest@example.com', role: 'admin' }),
				]),
			);
			expect(members).toHaveLength(2);
			// orgId reflects the listed org, not the account's home org.
			for (const m of members) {
				expect(m.orgId).toBe('other-org');
			}
		});

		it('excludeGlobalRole hides accounts whose GLOBAL role matches', async () => {
			const admin = await seedUser({ orgId: 'other-org', email: 'a@example.com', role: 'admin' });
			await seedMembership({ userId: admin.id, orgId: 'other-org', role: 'admin' });
			const sa = await seedUser({
				orgId: 'other-org',
				email: 'sa@example.com',
				role: 'superadmin',
			});
			await seedMembership({ userId: sa.id, orgId: 'other-org', role: 'admin' });

			const visible = await listOrgMembers('other-org', { excludeGlobalRole: 'superadmin' });
			expect(visible.map((m) => m.id)).toEqual([admin.id]);

			const all = await listOrgMembers('other-org');
			expect(all.map((m) => m.id).sort()).toEqual([admin.id, sa.id].sort());
		});

		it('returns an empty array for an org with no members', async () => {
			expect(await listOrgMembers('other-org')).toEqual([]);
		});
	});

	describe('createUserWithMembership', () => {
		it('creates the account and a mirrored membership atomically', async () => {
			const { id } = await createUserWithMembership({
				orgId: 'home-org',
				email: 'new@example.com',
				passwordHash: '$2b$10$hash',
				name: 'New User',
				role: 'admin',
				membershipRole: 'admin',
			});

			// The account exists with its home org + global role…
			const account = await getUserByEmail('new@example.com');
			expect(account?.id).toBe(id);
			expect(account?.orgId).toBe('home-org');
			expect(account?.role).toBe('admin');

			// …and immediately appears in the membership-based listing with the
			// per-org role.
			const members = await listOrgMembers('home-org');
			expect(members).toEqual([
				expect.objectContaining({ id, email: 'new@example.com', role: 'admin' }),
			]);
		});

		it('rolls back on a duplicate-email unique violation, leaving no orphan membership', async () => {
			// Seed an account that owns the email in a DIFFERENT org.
			await seedUser({ orgId: 'home-org', email: 'dupe@example.com', role: 'member' });

			// drizzle wraps the pg DatabaseError in a DrizzleQueryError; the
			// '23505' code lives on `.cause`.
			await expect(
				createUserWithMembership({
					orgId: 'other-org',
					email: 'dupe@example.com',
					passwordHash: '$2b$10$hash',
					name: 'Dupe',
					role: 'member',
					membershipRole: 'member',
				}),
			).rejects.toMatchObject({ cause: { code: '23505' } });

			// The transaction rolled back: other-org gained no member.
			expect(await listOrgMembers('other-org')).toEqual([]);
		});
	});
});
