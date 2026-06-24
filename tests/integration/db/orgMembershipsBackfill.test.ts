/**
 * Integration test for migration 0053: multi-org membership schema
 * (spec 021, plan 1 of 4).
 *
 * Verifies the dormant schema additions and the one-membership-per-user
 * backfill:
 *   - the org_memberships table exists and is selectable
 *   - sessions.active_org_id is a nullable, NULL-by-default column
 *   - every existing user gets exactly one membership in their home org
 *   - the global 'superadmin' role maps to an 'admin' membership
 *   - users.org_id / users.role are left untouched (home org + global role)
 *   - the backfill is idempotent and active_org_id stays dormant (NULL)
 *
 * The migration is idempotent and already ran at test bootstrap; this test
 * seeds rows that look like pre-migration state, re-runs the migration body, and
 * asserts the resulting memberships.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import { orgMemberships, sessions, users } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedSession, seedUser } from '../helpers/seed.js';

const MIGRATION_PATH = fileURLToPath(
	new URL('../../../src/db/migrations/0053_org_memberships.sql', import.meta.url),
);

/**
 * Re-runs the migration body minus its transaction wrappers (drizzle's raw sql
 * tag runs inside its own connection). The migration is fully idempotent, so
 * re-running after seeding users is safe.
 */
async function runMigration(): Promise<void> {
	const migrationText = await readFile(MIGRATION_PATH, 'utf-8');
	const body = migrationText
		.split('\n')
		.filter((line) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(line))
		.join('\n');
	await getDb().execute(sql.raw(body));
}

async function listMemberships() {
	return getDb()
		.select({
			userId: orgMemberships.userId,
			orgId: orgMemberships.orgId,
			role: orgMemberships.role,
		})
		.from(orgMemberships);
}

describe('migration 0053 — org_memberships table + active-org + backfill', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg('test-org', 'Test Org');
	});

	describe('schema', () => {
		it('creates the org_memberships table (selectable, empty after truncate)', async () => {
			expect(await listMemberships()).toEqual([]);
		});

		it('exposes a nullable sessions.active_org_id (NULL by default)', async () => {
			const user = await seedUser({ email: 'dormant@example.com' });
			// seedSession never sets active_org_id — a successful insert proves the
			// column is nullable with no NOT NULL constraint.
			await seedSession({ userId: user.id, token: 'dormant-token' });

			const [row] = await getDb()
				.select({ activeOrgId: sessions.activeOrgId })
				.from(sessions)
				.where(eq(sessions.token, 'dormant-token'));
			expect(row.activeOrgId).toBeNull();
		});
	});

	describe('backfill', () => {
		it('creates exactly one membership per existing user', async () => {
			await seedUser({ email: 'a@example.com', role: 'member' });
			await seedUser({ email: 'b@example.com', role: 'admin' });
			await seedUser({ email: 'c@example.com', role: 'member' });

			await runMigration();

			const memberships = await listMemberships();
			expect(memberships).toHaveLength(3);
			expect(new Set(memberships.map((m) => m.userId)).size).toBe(3);
		});

		it('copies the home org and member/admin role verbatim', async () => {
			const member = await seedUser({ email: 'm@example.com', role: 'member' });
			const admin = await seedUser({ email: 'adm@example.com', role: 'admin' });

			await runMigration();

			const byUser = new Map((await listMemberships()).map((m) => [m.userId, m]));
			expect(byUser.get(member.id)).toMatchObject({ orgId: 'test-org', role: 'member' });
			expect(byUser.get(admin.id)).toMatchObject({ orgId: 'test-org', role: 'admin' });
		});

		it('maps the global superadmin role to an admin membership', async () => {
			const sa = await seedUser({ email: 'super@example.com', role: 'superadmin' });

			await runMigration();

			const [membership] = await listMemberships();
			expect(membership).toMatchObject({ userId: sa.id, orgId: 'test-org', role: 'admin' });

			// users.role stays the global superadmin role — kept, not rewritten.
			const [userRow] = await getDb()
				.select({ role: users.role })
				.from(users)
				.where(eq(users.id, sa.id));
			expect(userRow.role).toBe('superadmin');
		});

		it('scopes each membership to the user home org across multiple orgs', async () => {
			await seedOrg('org-2', 'Second Org');
			const u1 = await seedUser({ email: 'one@example.com', orgId: 'test-org', role: 'member' });
			const u2 = await seedUser({ email: 'two@example.com', orgId: 'org-2', role: 'admin' });

			await runMigration();

			const byUser = new Map((await listMemberships()).map((m) => [m.userId, m]));
			expect(byUser.get(u1.id)?.orgId).toBe('test-org');
			expect(byUser.get(u2.id)?.orgId).toBe('org-2');
		});

		it('is idempotent: re-running adds no duplicate memberships', async () => {
			await seedUser({ email: 'idem@example.com', role: 'member' });

			await runMigration();
			const first = await listMemberships();

			await runMigration();
			const second = await listMemberships();

			expect(first).toHaveLength(1);
			expect(second).toHaveLength(1);
		});

		it('leaves active_org_id dormant (NULL) on existing sessions', async () => {
			const user = await seedUser({ email: 'still-logged-in@example.com', role: 'member' });
			await seedSession({ userId: user.id, token: 'pre-migration-token' });

			await runMigration();

			const [row] = await getDb()
				.select({ activeOrgId: sessions.activeOrgId })
				.from(sessions)
				.where(eq(sessions.token, 'pre-migration-token'));
			// Session survives the migration (user stays logged in) and active_org_id
			// is untouched — plan 2 resolves it; plan 1 ships dormant.
			expect(row.activeOrgId).toBeNull();
		});
	});

	describe('constraints', () => {
		it('cascade-deletes memberships when the user is deleted', async () => {
			const user = await seedUser({ email: 'todelete@example.com', role: 'member' });
			await runMigration();
			expect(await listMemberships()).toHaveLength(1);

			await getDb().delete(users).where(eq(users.id, user.id));

			expect(await listMemberships()).toHaveLength(0);
		});

		it('rejects a second membership for the same (user, org)', async () => {
			const user = await seedUser({ email: 'dup@example.com', role: 'member' });
			await runMigration();

			await expect(
				getDb()
					.insert(orgMemberships)
					.values({ userId: user.id, orgId: 'test-org', role: 'admin' }),
			).rejects.toThrow();
		});
	});
});
