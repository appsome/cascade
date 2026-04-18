/**
 * Linear manifest wizardSpec (plan 009/4 task 4).
 *
 * Declares the standard-step sequence including the project-scope
 * step from spec 005. Custom Linear UI (reaction config, etc.) stays
 * in the provider folder as `kind: 'custom'`.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { linearManifest } from '../../../../src/integrations/pm/linear/manifest.js';
import { renderStandardStep } from '../../../../web/src/components/projects/pm-providers/generator.js';

describe('linearManifest.wizardSpec', () => {
	it('is declared', () => {
		expect(linearManifest.wizardSpec).toBeDefined();
	});

	it('includes standard step kinds in the expected order (including project-scope from spec 005)', () => {
		const kinds = linearManifest.wizardSpec?.steps.map((s) => s.kind) ?? [];
		expect(kinds).toEqual([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'project-scope',
			'webhook-url-display',
		]);
	});

	it('each step has a stable unique id', () => {
		const ids = (linearManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(ids.length).toBeGreaterThan(0);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('Linear wizardSpec through renderStandardStep', () => {
	it('renders every declared step through the shared generator', () => {
		const steps = linearManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			const element = renderStandardStep(step, { providerId: 'linear' });
			const html = renderToStaticMarkup(element);
			expect(html).toContain('data-provider-id="linear"');
			expect(html).toContain(`data-step-kind="${step.kind}"`);
		}
	});

	it('project-scope step renders (spec 005 preservation)', () => {
		const projectScope = linearManifest.wizardSpec?.steps.find((s) => s.kind === 'project-scope');
		expect(projectScope).toBeDefined();
		if (!projectScope) return;
		const html = renderToStaticMarkup(renderStandardStep(projectScope, { providerId: 'linear' }));
		expect(html).toContain('data-step-kind="project-scope"');
	});
});
