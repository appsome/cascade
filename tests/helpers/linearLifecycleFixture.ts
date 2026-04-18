/**
 * Linear lifecycle fixture for the behavioral conformance harness
 * (plan 009/4 task 6).
 *
 * Returns an in-memory PMProvider labeled `type: 'linear'` (via the
 * shared fake) that the harness exercises through
 * `runLifecycleScenario`. Real Linear adapter coverage — including
 * inline-checklist round-trip via the engine from spec 008 — lives
 * in `tests/unit/pm/linear/adapter.test.ts` (vi.mock-driven). This
 * fixture proves the manifest's lifecycle opt-in wires cleanly.
 */

import type { PMProvider } from '../../src/pm/types.js';
import { createFakePMProvider } from './fakePMProvider.js';

export async function linearLifecycleFixture(): Promise<{
	provider: PMProvider;
	containerId: string;
}> {
	const { provider } = createFakePMProvider();
	return {
		provider,
		containerId: 'fake-container-a',
	};
}
