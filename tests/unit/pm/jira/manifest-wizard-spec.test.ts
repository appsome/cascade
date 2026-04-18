/**
 * JIRA manifest wizardSpec (plan 009/3 task 4).
 *
 * Declares the standard-step sequence the generic generator renders:
 * credentials → project-pick → status-mapping → label-mapping →
 * webhook-url. JIRA-specific UI (if any) stays in the provider folder
 * as `kind: 'custom'` steps.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';
import { renderStandardStep } from '../../../../web/src/components/projects/pm-providers/generator.js';

describe('jiraManifest.wizardSpec', () => {
	it('is declared', () => {
		expect(jiraManifest.wizardSpec).toBeDefined();
	});

	it('includes the standard step kinds in expected order', () => {
		const kinds = jiraManifest.wizardSpec?.steps.map((s) => s.kind) ?? [];
		expect(kinds).toEqual([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'webhook-url-display',
		]);
	});

	it('each step has a stable id', () => {
		const steps = jiraManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(step.id).toBeTruthy();
		}
	});

	it('step ids are unique', () => {
		const ids = (jiraManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('JIRA wizardSpec through renderStandardStep', () => {
	it('renders every declared step through the shared generator', () => {
		const steps = jiraManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);
		for (const step of steps) {
			const element = renderStandardStep(step, { providerId: 'jira' });
			const html = renderToStaticMarkup(element);
			expect(html).toContain('data-provider-id="jira"');
			expect(html).toContain(`data-step-kind="${step.kind}"`);
		}
	});
});
