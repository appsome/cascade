import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { CREDENTIAL_PROVIDERS } from '../../config/credentialProviders.js';
import {
	createSet,
	deleteSet,
	deleteSetCredential,
	listSets,
	listSetUsage,
	renameSet,
	setDefaultSet,
	writeSetCredential,
} from '../../db/repositories/orgCredentialSetsRepository.js';
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
import { adminProcedure, protectedProcedure, router, superAdminProcedure } from '../trpc.js';
import { maskCredentialValue } from './_shared/maskCredential.js';
import { assertOrgAdmin, resolveActorRole } from './_shared/orgRole.js';
import { assertWebhookPasswordStrength } from './_shared/webhookPasswordPolicy.js';

const PROVIDER_IDS = CREDENTIAL_PROVIDERS.map((p) => p.id) as [string, ...string[]];

function conflictOnUniqueViolation(err: unknown, message: string): never {
	if (String(err).includes('uq_org_credential_sets_org_provider_name')) {
		throw new TRPCError({ code: 'CONFLICT', message });
	}
	throw err;
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
				assertWebhookPasswordStrength(input.envVarKey, input.value);
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

	// Named credential sets (org_credential_sets) — multiple credentials per
	// provider (engines + GitHub/GitLab) with per-project selection. Values
	// never leave the server unmasked.
	credentialSets: router({
		list: adminProcedure.query(async ({ ctx }) => {
			assertOrgAdmin(await resolveActorRole(ctx));
			const [sets, usage] = await Promise.all([
				listSets(ctx.effectiveOrgId),
				listSetUsage(ctx.effectiveOrgId),
			]);
			return sets.map((set) => ({
				id: set.id,
				provider: set.provider,
				name: set.name,
				isDefault: set.isDefault,
				keys: set.keys.map((key) => ({
					envVarKey: key.envVarKey,
					isConfigured: true,
					maskedValue: maskCredentialValue(key.value),
				})),
				usage: usage
					.filter((u) => u.setId === set.id)
					.map((u) => ({ projectId: u.projectId, projectName: u.projectName })),
			}));
		}),

		create: adminProcedure
			.input(z.object({ provider: z.enum(PROVIDER_IDS), name: z.string().min(1).max(64) }))
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				try {
					const id = await createSet(ctx.effectiveOrgId, input.provider, input.name);
					return { id };
				} catch (err) {
					conflictOnUniqueViolation(
						err,
						`A ${input.provider} entry named "${input.name}" already exists`,
					);
				}
			}),

		rename: adminProcedure
			.input(z.object({ setId: z.number().int(), name: z.string().min(1).max(64) }))
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				try {
					await renameSet(ctx.effectiveOrgId, input.setId, input.name);
				} catch (err) {
					conflictOnUniqueViolation(err, `An entry named "${input.name}" already exists`);
				}
			}),

		delete: adminProcedure
			.input(z.object({ setId: z.number().int(), force: z.boolean().optional() }))
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				return deleteSet(ctx.effectiveOrgId, input.setId, { force: input.force ?? false });
			}),

		setDefault: adminProcedure
			.input(z.object({ setId: z.number().int() }))
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				await setDefaultSet(ctx.effectiveOrgId, input.setId);
			}),

		setKey: adminProcedure
			.input(
				z.object({
					setId: z.number().int(),
					envVarKey: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
					value: z.string().min(1),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				assertWebhookPasswordStrength(input.envVarKey, input.value);
				await writeSetCredential(ctx.effectiveOrgId, input.setId, input.envVarKey, input.value);
			}),

		deleteKey: adminProcedure
			.input(
				z.object({ setId: z.number().int(), envVarKey: z.string().regex(/^[A-Z_][A-Z0-9_]*$/) }),
			)
			.mutation(async ({ ctx, input }) => {
				assertOrgAdmin(await resolveActorRole(ctx));
				await deleteSetCredential(ctx.effectiveOrgId, input.setId, input.envVarKey);
			}),
	}),
});
