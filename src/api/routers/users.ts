import { TRPCError } from '@trpc/server';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
	createUser,
	deleteUser,
	deleteUserSessions,
	getUserById,
	listOrgUsers,
	updateUser,
} from '../../db/repositories/usersRepository.js';
import { resolveActorRoleInOrg } from '../context.js';
import { adminProcedure, router } from '../trpc.js';

type Role = 'member' | 'admin' | 'superadmin';
type ActorContext = { id: string; role: Role; effectiveOrgId: string };
type TargetUser = { id: string; orgId: string; role: string };

/**
 * Resolve the caller's role *in the effective org* (spec 021 plan 2).
 *
 * The `adminProcedure` middleware is a coarse global-role gate; this refines it
 * with the per-org membership role so an org admin who has switched into an org
 * where they are only a member cannot perform admin actions there (spec AC #8).
 * Superadmin stays global (spec AC #7).
 */
function resolveActorRole(ctx: {
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
function assertOrgAdmin(actorRole: Role): void {
	if (actorRole !== 'admin' && actorRole !== 'superadmin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
	}
}

/**
 * Centralizes the permission rules for editing/deleting a user. Throws TRPCError
 * with the appropriate code on any policy violation; returns silently if allowed.
 *
 * `actor.role` is the caller's PER-ORG role (resolved via `resolveActorRole`),
 * not the global `users.role` — per-org membership governs permissions
 * (spec 021 AC #4).
 *
 * Rules (apply to both `update` and `delete`):
 *   1. Cross-org access is hidden as `NOT_FOUND` (don't leak existence) unless
 *      the actor is a superadmin (who can act across orgs).
 *   2. Only superadmins can act on a superadmin target user.
 *
 * Update-specific extras (when `input.role` is set):
 *   3. No self-role-change (prevent self-demotion).
 *   4. Only superadmins can assign or change the superadmin role.
 */
function assertUserAccessAllowed(
	actor: ActorContext,
	target: TargetUser,
	options: { newRole?: Role; verb: 'edit' | 'delete' } = { verb: 'edit' },
): void {
	if (target.orgId !== actor.effectiveOrgId && actor.role !== 'superadmin') {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	if (target.role === 'superadmin' && actor.role !== 'superadmin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: `Only superadmins can ${options.verb} superadmin users`,
		});
	}
	if (options.newRole !== undefined) {
		if (actor.id === target.id) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot change your own role' });
		}
		const wouldElevate = options.newRole === 'superadmin';
		const wouldDemoteSuper = target.role === 'superadmin' && options.newRole !== 'superadmin';
		if ((wouldElevate || wouldDemoteSuper) && actor.role !== 'superadmin') {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: wouldElevate
					? 'Only superadmins can assign superadmin role'
					: 'Only superadmins can change a superadmin user role',
			});
		}
	}
}

export const usersRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		const actorRole = await resolveActorRole(ctx);
		assertOrgAdmin(actorRole);
		if (actorRole === 'superadmin') {
			return listOrgUsers(ctx.effectiveOrgId);
		}
		return listOrgUsers(ctx.effectiveOrgId, { excludeRole: 'superadmin' });
	}),

	create: adminProcedure
		.input(
			z.object({
				email: z.string().email(),
				name: z.string().min(1),
				password: z.string().min(12),
				role: z.enum(['member', 'admin', 'superadmin']).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actorRole = await resolveActorRole(ctx);
			assertOrgAdmin(actorRole);

			const role = input.role ?? 'member';

			// Only superadmins can create users with superadmin role
			if (role === 'superadmin' && actorRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can create superadmin users',
				});
			}

			const passwordHash = await bcrypt.hash(input.password, 10);

			return createUser({
				orgId: ctx.effectiveOrgId,
				email: input.email,
				name: input.name,
				passwordHash,
				role,
			});
		}),

	update: adminProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).optional(),
				email: z.string().email().optional(),
				role: z.enum(['member', 'admin', 'superadmin']).optional(),
				password: z.string().min(12).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actorRole = await resolveActorRole(ctx);
			assertOrgAdmin(actorRole);

			const targetUser = await getUserById(input.id);
			if (!targetUser) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			assertUserAccessAllowed(
				{
					id: ctx.user.id,
					role: actorRole,
					effectiveOrgId: ctx.effectiveOrgId,
				},
				targetUser,
				{ newRole: input.role, verb: 'edit' },
			);

			const updates: {
				name?: string;
				email?: string;
				role?: string;
				passwordHash?: string;
			} = {};

			if (input.name !== undefined) updates.name = input.name;
			if (input.email !== undefined) updates.email = input.email;
			if (input.role !== undefined) updates.role = input.role;
			if (input.password !== undefined) {
				updates.passwordHash = await bcrypt.hash(input.password, 10);
			}

			await updateUser(input.id, updates);

			// Invalidate all sessions for the target user when their password changes.
			// This prevents stale sessions from remaining valid after a password reset.
			if (updates.passwordHash !== undefined) {
				await deleteUserSessions(input.id);
			}
		}),

	delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const actorRole = await resolveActorRole(ctx);
		assertOrgAdmin(actorRole);

		// Prevent self-deletion
		if (ctx.user.id === input.id) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'Cannot delete your own account',
			});
		}

		const targetUser = await getUserById(input.id);
		if (!targetUser) {
			throw new TRPCError({ code: 'NOT_FOUND' });
		}

		assertUserAccessAllowed(
			{ id: ctx.user.id, role: actorRole, effectiveOrgId: ctx.effectiveOrgId },
			targetUser,
			{ verb: 'delete' },
		);

		await deleteUser(input.id);
	}),
});
