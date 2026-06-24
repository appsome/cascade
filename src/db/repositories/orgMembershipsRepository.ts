import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { organizations, orgMemberships } from '../schema/index.js';

/**
 * Read helpers for the multi-org membership model (spec 021, plan 2 of 4).
 *
 * Plan 1 shipped the `org_memberships` table dormant; plan 2 is the first
 * consumer. These reads drive effective-org resolution, the active-org switch
 * endpoint, and the per-org actor-role helper that user-management permission
 * checks consume. Grant/create/list mutations land in plan 3.
 */

/** A user's membership in a single org. */
export interface OrgMembership {
	orgId: string;
	/** Per-org role ('member' | 'admin'). Distinct from the global `users.role`. */
	role: string;
}

/** An org a user belongs to, with its name and the user's per-org role. */
export interface MyOrg {
	id: string;
	name: string;
	role: string;
}

/**
 * Get a user's membership in a specific org, or `null` when they are not a
 * member. Used to validate active-org switches and to resolve the per-org role.
 */
export async function getOrgMembership(
	userId: string,
	orgId: string,
): Promise<OrgMembership | null> {
	const db = getDb();
	const [row] = await db
		.select({ orgId: orgMemberships.orgId, role: orgMemberships.role })
		.from(orgMemberships)
		.where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)));
	return row ?? null;
}

/**
 * List every org a user is a member of, joined with the org name and the
 * user's per-org role. Powers the `listMyOrgs` switcher read.
 */
export async function listOrgMembershipsForUser(userId: string): Promise<MyOrg[]> {
	const db = getDb();
	return db
		.select({
			id: orgMemberships.orgId,
			name: organizations.name,
			role: orgMemberships.role,
		})
		.from(orgMemberships)
		.innerJoin(organizations, eq(orgMemberships.orgId, organizations.id))
		.where(eq(orgMemberships.userId, userId));
}
