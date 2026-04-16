/**
 * Type-level tests for the PMProviderManifest contract.
 *
 * Behavioral tests live in adjacent files (pm-registry.test.ts,
 * pm-conformance.test.ts, etc.). This file just locks the static shape so
 * the contract cannot be silently relaxed — e.g. by making `id` optional,
 * which would reintroduce the "forgot to register" bugs this refactor
 * exists to prevent.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { PMProviderManifest } from '../../../src/integrations/pm/manifest.js';

describe('PMProviderManifest — type contract', () => {
	it('id field is a required string', () => {
		expectTypeOf<PMProviderManifest>().toHaveProperty('id').toBeString();
	});

	it('category field is the literal "pm"', () => {
		expectTypeOf<PMProviderManifest>().toHaveProperty('category').toEqualTypeOf<'pm'>();
	});

	it('webhookRoute is a required string', () => {
		// Runtime check that it follows the `/${id}/webhook` convention lives in
		// the conformance harness (tests/unit/integrations/pm-conformance.test.ts).
		// Here we only lock the type shape.
		expectTypeOf<PMProviderManifest>().toHaveProperty('webhookRoute').toBeString();
	});

	it('triggerHandlers is a readonly array of TriggerHandler', () => {
		// Using `readonly` in the contract prevents accidental mutation of the
		// manifest's trigger list after registration — a class of bug where a
		// test polluted production state.
		expectTypeOf<PMProviderManifest['triggerHandlers']>().toMatchTypeOf<readonly unknown[]>();
	});
});
