/**
 * pmProviderRegistry — the process-singleton registry of PM provider manifests.
 *
 * Providers register themselves at module-load time via `registerPMProvider()`;
 * the router, worker, and dashboard look them up by `id`. A conformance
 * harness (tests/unit/integrations/pm-conformance.test.ts) iterates the
 * registry to enforce contract completeness at CI time.
 *
 * Duplicate-id registrations throw — this is how we catch provider modules
 * that forgot to rename their manifest after cloning from a sibling.
 *
 * See `src/integrations/pm/manifest.ts` for the contract.
 */

import type { PMProviderManifest } from './manifest.js';

const registry: PMProviderManifest[] = [];
const byId = new Map<string, PMProviderManifest>();

export function registerPMProvider(manifest: PMProviderManifest): void {
	if (byId.has(manifest.id)) {
		throw new Error(
			`PM provider '${manifest.id}' already registered — duplicate ids are not allowed`,
		);
	}
	registry.push(manifest);
	byId.set(manifest.id, manifest);
}

export function getPMProvider(id: string): PMProviderManifest | null {
	return byId.get(id) ?? null;
}

export function listPMProviders(): readonly PMProviderManifest[] {
	// Return a shallow clone so callers can't splice the source array.
	return registry.slice();
}

/**
 * Test-only helper. Production code MUST NOT call this.
 * Clears the registry between tests to prevent registration leakage.
 */
export function _resetPMProviderRegistryForTesting(): void {
	registry.length = 0;
	byId.clear();
}
