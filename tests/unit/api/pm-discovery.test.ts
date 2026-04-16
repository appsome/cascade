/**
 * Unit tests for the new registry-driven PM discovery router.
 *
 * The router is intentionally minimal in plan 006/1 — it exposes the
 * list of registered providers and their credential-role metadata. Plans
 * 006/2–006/4 extend it with generic `createLabel` / `createLabels`
 * endpoints as each provider migrates.
 *
 * These tests call the router's procedures through a caller so we avoid
 * mocking Hono transports.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock auth/db-bound modules the router transitively imports. The procedures
// we're testing here are readonly and don't touch the DB, but the router
// exports live in a module that brings in session + DB glue via trpc.ts.
vi.mock('../../../src/api/trpc.js', async () => {
	const { initTRPC } = await import('@trpc/server');
	const t = initTRPC.context<{ effectiveOrgId: string }>().create();
	return {
		router: t.router,
		protectedProcedure: t.procedure,
		t,
	};
});

import { pmDiscoveryRouter } from '../../../src/api/routers/pm-discovery.js';
import type { PMProviderManifest } from '../../../src/integrations/pm/manifest.js';
import {
	_resetPMProviderRegistryForTesting,
	registerPMProvider,
} from '../../../src/integrations/pm/registry.js';

function makeStub(id: string, label: string): PMProviderManifest {
	return {
		id,
		label,
		category: 'pm',
		credentialRoles: [
			{ role: 'api_key', label: 'API Key', envVarKey: `${id.toUpperCase()}_API_KEY` },
			{
				role: 'webhook_secret',
				label: 'Webhook Secret',
				envVarKey: `${id.toUpperCase()}_WEBHOOK_SECRET`,
				optional: true,
			},
		],
		webhookRoute: `/${id}/webhook`,
		verifyWebhookSignature: () => true,
		parseWebhookPayload: () => null,
		routerAdapter: { type: id } as unknown as PMProviderManifest['routerAdapter'],
		extractProjectIdFromJob: async () => null,
		pmIntegration: {} as unknown as PMProviderManifest['pmIntegration'],
		triggerHandlers: [],
		platformClientFactory: () =>
			({}) as unknown as ReturnType<PMProviderManifest['platformClientFactory']>,
	};
}

describe('pmDiscoveryRouter', () => {
	beforeEach(() => {
		_resetPMProviderRegistryForTesting();
	});

	it('listProviders returns registered providers with id, label, and credential roles', async () => {
		registerPMProvider(makeStub('alpha', 'Alpha'));
		registerPMProvider(makeStub('beta', 'Beta'));

		const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
		const result = await caller.listProviders();

		expect(result).toEqual([
			{
				id: 'alpha',
				label: 'Alpha',
				credentialRoles: [
					{ role: 'api_key', label: 'API Key', envVarKey: 'ALPHA_API_KEY' },
					{
						role: 'webhook_secret',
						label: 'Webhook Secret',
						envVarKey: 'ALPHA_WEBHOOK_SECRET',
						optional: true,
					},
				],
			},
			{
				id: 'beta',
				label: 'Beta',
				credentialRoles: [
					{ role: 'api_key', label: 'API Key', envVarKey: 'BETA_API_KEY' },
					{
						role: 'webhook_secret',
						label: 'Webhook Secret',
						envVarKey: 'BETA_WEBHOOK_SECRET',
						optional: true,
					},
				],
			},
		]);
	});

	it('listProviders returns an empty array when the registry is empty', async () => {
		const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
		expect(await caller.listProviders()).toEqual([]);
	});

	it('providerCredentialRoles returns the credentialRoles for a registered provider', async () => {
		registerPMProvider(makeStub('alpha', 'Alpha'));
		const caller = pmDiscoveryRouter.createCaller({ effectiveOrgId: 'org-1' });
		const result = await caller.providerCredentialRoles({ providerId: 'alpha' });
		expect(result.map((r) => r.role)).toEqual(['api_key', 'webhook_secret']);
	});
});
