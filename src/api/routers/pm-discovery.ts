/**
 * PM discovery tRPC router — registry-driven provider metadata.
 *
 * Plan 006/1 ships this minimal endpoint set: listing registered
 * providers and their credential roles. Plans 006/2–006/4 add generic
 * `createLabel` / `createLabels` procedures as each provider migrates
 * its hooks into the manifest.
 *
 * Lives alongside the legacy `integrationsDiscoveryRouter` during the
 * migration window. Plan 006/5 deletes any PM endpoints in the legacy
 * router that this one supersedes.
 */

import { z } from 'zod';
import { getPMProvider, listPMProviders } from '../../integrations/pm/registry.js';
import { protectedProcedure, router } from '../trpc.js';

const providerIdInput = z.object({
	providerId: z.string().min(1),
});

export const pmDiscoveryRouter = router({
	/**
	 * List every registered PM provider with the minimal metadata the
	 * dashboard provider-select dropdown needs. Returned array order is
	 * registration order — deterministic across Node process restarts.
	 */
	listProviders: protectedProcedure.query(() =>
		listPMProviders().map((m) => ({
			id: m.id,
			label: m.label,
			credentialRoles: m.credentialRoles.map((r) => ({ ...r })),
		})),
	),

	/**
	 * Return the credential-role list for a specific provider. Throws when
	 * the provider is not registered.
	 */
	providerCredentialRoles: protectedProcedure.input(providerIdInput).query(({ input }) => {
		const manifest = getPMProvider(input.providerId);
		if (!manifest) throw new Error(`Unknown PM provider '${input.providerId}'`);
		return manifest.credentialRoles.map((r) => ({ ...r }));
	}),
});
