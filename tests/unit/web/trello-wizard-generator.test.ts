/**
 * Trello wizardSpec + renderStandardStep integration (plan 009/2 task 5).
 *
 * Verifies that every step declared on `trelloManifest.wizardSpec`
 * renders through the plan-1 generator (`renderStandardStep`) without
 * crashing. In plan 1 the generator returns typed placeholders for
 * every standard kind — plans 009/3–4 (or a later dedicated plan) swap
 * in real shared step components. Until then, Trello's live wizard
 * continues to use its per-provider step adapters; the generator path
 * exists in parallel so wizardSpec is genuinely wired, not just
 * declarative metadata.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { trelloManifest } from '../../../src/integrations/pm/trello/manifest.js';
import { renderStandardStep } from '../../../web/src/components/projects/pm-providers/generator.js';

describe('Trello wizardSpec through the shared generator', () => {
	it('renders every declared step via renderStandardStep', () => {
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);

		for (const step of steps) {
			const element = renderStandardStep(step, { providerId: 'trello' });
			const html = renderToStaticMarkup(element);
			expect(html).toContain('data-provider-id="trello"');
			expect(html).toContain(`data-step-kind="${step.kind}"`);
		}
	});

	it('declared steps use only known StandardStepKinds (no custom in plan 2 scope)', () => {
		const knownKinds = new Set([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'webhook-url-display',
			'project-scope',
		]);
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(knownKinds.has(step.kind)).toBe(true);
		}
	});

	it('step ids are unique within Trello wizardSpec', () => {
		const ids = (trelloManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
