/**
 * Trello manifest wizardSpec (plan 009/2 task 4).
 *
 * Declares the wizard step sequence the generic generator should render:
 * credentials → board-pick (container) → label-mapping → webhook-url.
 * Trello-specific UI (custom-field mapping beyond the standard kinds)
 * lives in the provider folder as `kind: 'custom'` steps.
 */

import { describe, expect, it } from 'vitest';
import { trelloManifest } from '../../../../src/integrations/pm/trello/manifest.js';

describe('trelloManifest.wizardSpec', () => {
	it('is declared', () => {
		expect(trelloManifest.wizardSpec).toBeDefined();
	});

	it('includes the standard step kinds in expected order', () => {
		const kinds = trelloManifest.wizardSpec?.steps.map((s) => s.kind) ?? [];
		// Credentials first (API key + token), then board pick, then mappings.
		// Exact order mirrors the existing Trello wizard flow.
		expect(kinds).toEqual([
			'credentials',
			'container-pick',
			'label-mapping',
			'status-mapping',
			'webhook-url-display',
		]);
	});

	it('each step has a stable id', () => {
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(step.id).toBeTruthy();
		}
	});
});
