/**
 * JIRA lifecycle fixture for the behavioral conformance harness
 * (plan 009/3 task 6).
 *
 * Returns an in-memory PMProvider labeled `type: 'jira'` that
 * implements the full PMProvider contract against in-memory state.
 * Same shape as the Trello fixture (plan 009/2): leverages the
 * existing `createFakePMProvider` helper; real JIRA adapter coverage
 * continues in `tests/unit/pm/jira/adapter.test.ts` (vi.mock-driven).
 *
 * The fixture exists so `jiraManifest.lifecycle.fixtureKey: 'jira'`
 * has a corresponding entry in the conformance harness's
 * `LIFECYCLE_FIXTURES` registry, proving JIRA's lifecycle opt-in wires
 * cleanly without a test-only import into production code.
 */

import type { PMProvider } from '../../src/pm/types.js';
import { createFakePMProvider } from './fakePMProvider.js';

export async function jiraLifecycleFixture(): Promise<{
	provider: PMProvider;
	containerId: string;
}> {
	const { provider } = createFakePMProvider();
	return {
		provider,
		containerId: 'fake-container-a',
	};
}
