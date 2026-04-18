/**
 * Tests the single canonical registration entrypoint introduced by plan 009/1.
 *
 * The entrypoint exists so router, worker, CLI, and dashboard all register
 * the same set of integrations (PM + SCM + alerting) through one file. Before
 * this, each runtime surface side-effect-imported the three barrels
 * individually — and forgetting one of them in one surface was the root
 * cause of bugs #1118, #1131, #1134, and #1097 during Linear's rollout.
 *
 * Note: side-effect imports from other test files in this session have
 * likely already populated the registry. This test asserts the entrypoint
 * *results* in the expected providers being present, not that it's the
 * sole source — the "sole source" assertion is plan 5's job.
 */

import { describe, expect, it } from 'vitest';
import { registerAllIntegrations } from '../../../src/integrations/entrypoint.js';
import { listPMProviders } from '../../../src/integrations/pm/registry.js';

describe('src/integrations/entrypoint.ts', () => {
	it('exports registerAllIntegrations as a callable no-op', () => {
		// The function is a no-op — registration happens as a side effect of
		// importing the entrypoint module. We still export the function so
		// test setups that want to make registration explicit can call it.
		expect(typeof registerAllIntegrations).toBe('function');
		expect(() => registerAllIntegrations()).not.toThrow();
	});

	it('registers every real PM provider (trello, jira, linear) on import', () => {
		// Side-effect import at the top of this file has already registered
		// every PM provider. The registry now contains at least the three
		// real providers.
		const ids = listPMProviders().map((m) => m.id);
		expect(ids).toContain('trello');
		expect(ids).toContain('jira');
		expect(ids).toContain('linear');
	});
});
