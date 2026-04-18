/**
 * Tests the wizard step generator introduced by plan 009/1 task 11.
 *
 * Scope in plan 1 is **dormant scaffolding** — the generator returns a
 * placeholder for every declared step kind. Plans 2/3/4 swap in real
 * shared components. The tests here guard three invariants the generator
 * must satisfy regardless of what's behind each placeholder:
 *
 *   1. Every StandardStepKind returns a React element without throwing.
 *   2. Custom steps return a placeholder that references the custom
 *      component name.
 *   3. Unknown kinds log a console.warn and return a placeholder rather
 *      than crashing the wizard.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomStep, StandardStep } from '../../../src/integrations/pm/manifest.js';
import { renderStandardStep } from '../../../web/src/components/projects/pm-providers/generator.js';

describe('renderStandardStep (pm-wizard generator scaffolding)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		'credentials',
		'container-pick',
		'status-mapping',
		'label-mapping',
		'webhook-url-display',
		'project-scope',
	] as const)('renders a placeholder for standard kind %s', (kind) => {
		const step: StandardStep = { kind, id: `step-${kind}` };
		const element = renderStandardStep(step, { providerId: 'fake' });
		const html = renderToStaticMarkup(element);
		expect(html).toContain(`data-step-kind="${kind}"`);
		// Placeholder message mentions the kind (React SSR escapes quotes → use the raw token).
		expect(html).toContain(kind);
	});

	it('renders a placeholder for a custom step that names the component', () => {
		const step: CustomStep = { kind: 'custom', id: 'step-custom', component: 'MySpecialStep' };
		const element = renderStandardStep(step, { providerId: 'fake' });
		const html = renderToStaticMarkup(element);
		expect(html).toContain('MySpecialStep');
	});

	it('logs a console.warn once for unknown kinds', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const unknownStep = { kind: 'unknown-kind', id: 'weird' } as unknown as StandardStep;
		renderStandardStep(unknownStep, { providerId: 'fake-duplicate-warn-provider' });
		renderStandardStep(unknownStep, { providerId: 'fake-duplicate-warn-provider' });
		// Second invocation with same kind+provider should NOT re-warn.
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0]?.[0]).toContain('unknown-kind');
	});

	it('does not throw for any known input (sanity)', () => {
		const step: StandardStep = { kind: 'credentials', id: 'creds' };
		expect(() => renderStandardStep(step, { providerId: 'fake' })).not.toThrow();
	});
});
