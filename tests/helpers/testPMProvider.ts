/**
 * Minimal PM provider manifest fixture used to exercise the conformance
 * harness with zero reliance on a real provider. Plan 006/1 ships this
 * fixture alongside the harness; it stays post-migration as a reference
 * implementation for future provider authors.
 *
 * Characteristics chosen to exercise every contract hook:
 *   - A required credential role + an optional one
 *   - A job type ('test-provider') the extractor claims
 *   - An HMAC-SHA256 webhook verifier via the shared factory
 *   - A no-op parseWebhookPayload that returns null
 *   - All contract surfaces populated with safe defaults
 */

import { makeHmacSha256Verifier } from '../../src/integrations/pm/_shared/webhook-verifier.js';
import type { PMProviderManifest } from '../../src/integrations/pm/manifest.js';
import {
	_resetPMProviderRegistryForTesting,
	registerPMProvider,
} from '../../src/integrations/pm/registry.js';

export const TEST_PROVIDER_ID = 'test-provider';

export const testPMProvider: PMProviderManifest = {
	id: TEST_PROVIDER_ID,
	label: 'Test Provider (fixture)',
	category: 'pm',

	credentialRoles: [
		{ role: 'api_key', label: 'API Key', envVarKey: 'TEST_PROVIDER_API_KEY' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'TEST_PROVIDER_WEBHOOK_SECRET',
			optional: true,
		},
	],

	webhookRoute: `/${TEST_PROVIDER_ID}/webhook`,

	verifyWebhookSignature: makeHmacSha256Verifier({
		headerName: 'x-test-provider-signature',
	}),

	parseWebhookPayload: () => null,

	routerAdapter: { type: TEST_PROVIDER_ID } as unknown as PMProviderManifest['routerAdapter'],

	extractProjectIdFromJob: async (jobData) => {
		const d = jobData as unknown as { type?: string; projectId?: string };
		if (d.type !== TEST_PROVIDER_ID) return null;
		return d.projectId ?? null;
	},

	pmIntegration: {
		type: TEST_PROVIDER_ID,
		category: 'pm' as const,
	} as unknown as PMProviderManifest['pmIntegration'],

	triggerHandlers: [
		{
			name: 'test-provider-noop',
			description: 'No-op trigger used by the conformance harness fixture.',
			supportedTriggers: [],
			matches: () => false,
			handle: async () => null,
		},
	],

	platformClientFactory: () =>
		({
			postComment: async () => null,
			deleteComment: async () => {},
			updateComment: async () => {},
		}) as unknown as ReturnType<PMProviderManifest['platformClientFactory']>,
};

/** Isolate the test provider between test runs to prevent registry leakage. */
export function registerTestProvider(): void {
	_resetPMProviderRegistryForTesting();
	registerPMProvider(testPMProvider);
}

export function unregisterTestProvider(): void {
	_resetPMProviderRegistryForTesting();
}
