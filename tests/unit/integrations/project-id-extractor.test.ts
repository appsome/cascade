/**
 * Registry-driven project-id extractor.
 *
 * The per-provider if-else chain in `src/router/worker-env.ts::extractProjectIdFromJob`
 * had a forgotten Linear branch — workers spawned without credentials for every
 * Linear job (PR #1118). Once providers register manifests with their own
 * `extractProjectIdFromJob` hook, iterating the registry replaces the chain.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { extractProjectIdFromJobViaRegistry } from '../../../src/integrations/pm/_shared/project-id-extractor.js';
import type { PMProviderManifest } from '../../../src/integrations/pm/manifest.js';
import {
	_resetPMProviderRegistryForTesting,
	registerPMProvider,
} from '../../../src/integrations/pm/registry.js';
import type { CascadeJob } from '../../../src/router/queue.js';

function makeStubManifest(
	id: string,
	extractor: (job: CascadeJob) => Promise<string | null>,
): PMProviderManifest {
	return {
		id,
		label: id,
		category: 'pm',
		credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'STUB' }],
		webhookRoute: `/${id}/webhook`,
		verifyWebhookSignature: () => true,
		routerAdapter: { type: id } as unknown as PMProviderManifest['routerAdapter'],
		extractProjectIdFromJob: extractor,
		pmIntegration: {} as unknown as PMProviderManifest['pmIntegration'],
		triggerHandlers: [],
		platformClientFactory: () =>
			({}) as unknown as ReturnType<PMProviderManifest['platformClientFactory']>,
	};
}

describe('extractProjectIdFromJobViaRegistry', () => {
	beforeEach(() => {
		_resetPMProviderRegistryForTesting();
	});

	it('returns the projectId when a registered provider owns the job type', async () => {
		registerPMProvider(
			makeStubManifest('alpha', async (job) => {
				const d = job as unknown as { type: string; projectId?: string };
				return d.type === 'alpha' ? (d.projectId ?? null) : null;
			}),
		);
		const job = { type: 'alpha', projectId: 'proj-1' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJobViaRegistry(job)).toBe('proj-1');
	});

	it('returns null when no registered provider owns the job type', async () => {
		registerPMProvider(
			makeStubManifest('alpha', async (job) => {
				const d = job as unknown as { type: string; projectId?: string };
				return d.type === 'alpha' ? (d.projectId ?? null) : null;
			}),
		);
		const job = { type: 'beta', projectId: 'proj-2' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJobViaRegistry(job)).toBeNull();
	});

	it('iterates manifests in registration order and returns the first match', async () => {
		// Two providers both claim the job type to prove iteration stops at the
		// first non-null return. Only the first-registered manifest's result
		// should be observed.
		registerPMProvider(makeStubManifest('alpha', async () => 'from-alpha'));
		registerPMProvider(makeStubManifest('beta', async () => 'from-beta'));
		const job = { type: 'shared', projectId: 'proj-3' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJobViaRegistry(job)).toBe('from-alpha');
	});
});
