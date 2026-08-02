import { TRPCError } from '@trpc/server';
import { resolveActorRoleInOrg } from '../../context.js';

type Role = 'member' | 'admin' | 'superadmin';

/**
 * Resolve the caller's role *in the effective org*. The `adminProcedure`
 * middleware is a coarse global-role gate; this refines it with the per-org
 * membership role (users.ts pattern) so an admin who has switched into an org
 * where they are only a member cannot perform admin actions there.
 */
export function resolveActorRole(ctx: {
	user: { id: string; role: Role; orgId: string };
	effectiveOrgId: string;
}): Promise<Role> {
	return resolveActorRoleInOrg({
		userId: ctx.user.id,
		globalRole: ctx.user.role,
		homeOrgId: ctx.user.orgId,
		orgId: ctx.effectiveOrgId,
	});
}

/** Require the caller to be an admin (or superadmin) in the effective org. */
export function assertOrgAdmin(actorRole: Role): void {
	if (actorRole !== 'admin' && actorRole !== 'superadmin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
	}
}
