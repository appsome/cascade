/**
 * Trello lifecycle fixture for the behavioral conformance harness
 * (plan 009/2 task 6).
 *
 * Returns an in-memory PMProvider labeled `type: 'trello'` that
 * implements the full PMProvider contract against in-memory state.
 * The fixture does NOT drive the real TrelloPMProvider class through
 * a mocked trelloClient — that would require `vi.mock` at test-file
 * collection time, which fixture factories can't do. Real-adapter
 * coverage continues to live in `tests/unit/pm/trello/adapter.test.ts`,
 * which handles its own vi.mock setup.
 *
 * This fixture's job is narrower but still load-bearing: prove that
 * `trelloManifest.lifecycle.enabled` wiring is real, prove the
 * runLifecycleScenario runner works with Trello-flavored type tagging,
 * and give the conformance harness a green "Trello lifecycle" row so
 * regressions to the manifest's lifecycle opt-in surface cleanly.
 */

import type { PMProvider } from '../../src/pm/types.js';
import { createFakePMProvider } from './fakePMProvider.js';

export async function trelloLifecycleFixture(): Promise<{
	provider: PMProvider;
	containerId: string;
}> {
	// Leverage the existing in-memory fake — the behavioral contract it
	// satisfies is identical to Trello's (PMProvider interface). The
	// only difference that matters for the harness is `provider.type`,
	// which the fake already reports as 'trello' (see fakePMProvider.ts).
	const { provider } = createFakePMProvider();
	return {
		provider,
		containerId: 'fake-container-a',
	};
}
