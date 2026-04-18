import { beforeEach, describe, expect, it } from 'vitest';
import type { PMProviderManifest } from '../../../src/integrations/pm/manifest.js';
import {
	_resetPMProviderRegistryForTesting,
	getPMProvider,
	listPMProviders,
	registerPMProvider,
} from '../../../src/integrations/pm/registry.js';

function makeStubManifest(overrides: Partial<PMProviderManifest> = {}): PMProviderManifest {
	const base: PMProviderManifest = {
		id: 'stub',
		label: 'Stub',
		category: 'pm',
		credentialRoles: [{ role: 'api_key', label: 'API Key', envVarKey: 'STUB_API_KEY' }],
		webhookRoute: '/stub/webhook',
		verifyWebhookSignature: () => true,
		routerAdapter: { type: 'stub' } as unknown as PMProviderManifest['routerAdapter'],
		extractProjectIdFromJob: async () => null,
		pmIntegration: {} as unknown as PMProviderManifest['pmIntegration'],
		triggerHandlers: [],
		platformClientFactory: () =>
			({}) as unknown as ReturnType<PMProviderManifest['platformClientFactory']>,
	};
	return { ...base, ...overrides };
}

describe('pmProviderRegistry', () => {
	beforeEach(() => {
		_resetPMProviderRegistryForTesting();
	});

	it('registerPMProvider — registers a manifest and listPMProviders returns it', () => {
		const m = makeStubManifest({ id: 'alpha' });
		registerPMProvider(m);
		expect(listPMProviders()).toEqual([m]);
	});

	it('registerPMProvider — throws on duplicate id', () => {
		registerPMProvider(makeStubManifest({ id: 'alpha' }));
		expect(() => registerPMProvider(makeStubManifest({ id: 'alpha' }))).toThrow(
			/already registered/i,
		);
	});

	it('getPMProvider — returns null for unknown id', () => {
		expect(getPMProvider('unknown')).toBeNull();
	});

	it('getPMProvider — returns the registered manifest by id', () => {
		const m = makeStubManifest({ id: 'alpha', label: 'Alpha' });
		registerPMProvider(m);
		expect(getPMProvider('alpha')).toBe(m);
	});

	it('listPMProviders — returns manifests in registration order', () => {
		const a = makeStubManifest({ id: 'alpha' });
		const b = makeStubManifest({ id: 'beta' });
		const c = makeStubManifest({ id: 'gamma' });
		registerPMProvider(a);
		registerPMProvider(b);
		registerPMProvider(c);
		expect(listPMProviders().map((p) => p.id)).toEqual(['alpha', 'beta', 'gamma']);
	});
});
