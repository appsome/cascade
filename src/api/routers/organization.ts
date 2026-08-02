import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	deleteOrgCredential,
	listOrgCredentials,
	listOrgCredentialsMeta,
	writeOrgCredential,
} from '../../db/repositories/orgCredentialsRepository.js';
import {
	createOrganization,
	getOrganization,
	listAllOrganizations,
	updateOrganization,
} from '../../db/repositories/settingsRepository.js';
import { captureException } from '../../sentry.js';
import { resolveActorRoleInOrg } from '../context.js';
import { adminProcedure, protectedProcedure, router, superAdminProcedure } from '../trpc.js';
import { maskCredentialValue } from './_shared/maskCredential.js';

type Role = 'member' | 'admin' | 'superadmin';

/**
 * Resolve the caller's role *in the effective org*. The `adminProcedure`
 * middleware is a coarse global-role gate; this refines it with the per-org
 * membership role (same pattern as users.ts) so an admin who has switched
 * into an org where they are only a member cannot manage that org's
 * credentials.
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

export const organizationRouter = router({
	get: protectedProcedure.query(async ({ ctx }) => {
		return getOrganization(ctx.effectiveOrgId);
	}),

	update: adminProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await updateOrganization(ctx.effectiveOrgId, { name: input.name });
		}),

	list: superAdminProcedure.query(async () => {
		return listAllOrganizations();
	}),

	create: superAdminProcedure
		.input(
			z.object({
				id: z
					.string()
					.min(1)
					.regex(/^[a-z0-9-]+$/),
				name: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			return createOrganization(input);
		}),

	updateById: superAdminProcedure
		.input(z.object({ id: z.string(), name: z.string().min(1) }))
		.mutation(async ({ input }) => {
			await updateOrganization(input.id, { name: input.name });
		}),

	// Organization-scoped shared credentials (org_credentials table). Projects
	// inherit these; a project_credentials row with the same env var key
	// overrides the org value for that project.
	credentials: router({
		/**
		 * List masked metadata for all org-scoped credentials.
		 * Never returns plaintext values — only masked last-4-chars preview.
		 */
		list: adminProcedure.query(async ({ ctx }) => {
			assertOrgAdmin(await resolveActorRole(ctx));
			try {
				const rows = await listOrgCredentials(ctx.effectiveOrgId);
				return rows.map((row) => ({
					envVarKey: row.envVarKey,
					name: row.name,
					isConfigured: true,
					maskedValue: maskCredentialValue(row.value),
				}));
			} catch (err) {
				// Decryption key missing/wrong — return metadata without value preview
				captureException(err, {
					tags: { source: 'org_credentials_list' },
					extra: { orgId: ctx.effectiveOrgId },
					level: 'warning',
				});
				const meta = await listOrgCredentialsMeta(ctx.effectiveOrgId);
				return meta.map((row) => ({
					envVarKey: row.envVarKey,
					name: row.name,
					isConfigured: true,
					maskedValue: '****',
				}));
			}
		}),

		/**
		 * Upsert an org-scoped credential (write-only — never exposes plaintext).
		 */
		set: adminProcedure
			.input(
				z.object({
					envVarKey: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
					value: z.string().min(1),
					name: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				await writeOrgCredential(
					ctx.effectiveOrgId,
					input.envVarKey,
					input.value,
					input.name ?? null,
				);
			}),

		/**
		 * Delete an org-scoped credential.
		 */
		delete: adminProcedure
			.input(z.object({ envVarKey: z.string().min(1) }))
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				await deleteOrgCredential(ctx.effectiveOrgId, input.envVarKey);
			}),
	}),
});
