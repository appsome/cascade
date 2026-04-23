/**
 * Guards for ManifestProviderWizardSection — request-storm fix.
 *
 * Before the storm fix, each ManifestProviderWizardSection instance called
 * `def.useProviderHooks?.()` internally. For Linear (6 steps), that
 * created 6 separate React hook instances, each firing Effect 2 on mount
 * → 18 batched discovery calls in production.
 *
 * The fix: move useProviderHooks to a single-instance ManifestStepsSection
 * wrapper in pm-wizard.tsx, and pass the result down as a prop.
 *
 * These tests are source-level guards that will permanently prevent
 * re-introducing the per-step-instance hook call.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MANIFEST_SECTION_PATH = resolve(
	REPO_ROOT,
	'web/src/components/projects/pm-providers/manifest-section.tsx',
);
const PM_WIZARD_PATH = resolve(REPO_ROOT, 'web/src/components/projects/pm-wizard.tsx');

describe('ManifestProviderWizardSection — storm fix guard', () => {
	it('manifest-section.tsx does NOT invoke useProviderHooks (hook must live in parent)', () => {
		const source = readFileSync(MANIFEST_SECTION_PATH, 'utf8');
		// Strip comments so the assertion targets executable code only. The
		// component's JSDoc explains that it receives the result via a prop; the
		// actual call must not exist in code.
		const codeOnly = source
			.replace(/\/\*[\s\S]*?\*\//g, '') // block comments
			.replace(/\/\/[^\n]*/g, ''); // line comments
		expect(
			codeOnly,
			'useProviderHooks must not be called inside ManifestProviderWizardSection — ' +
				'calling it N times (once per step) creates N hook instances and N discovery request sets. ' +
				'The call must live in ManifestStepsSection (pm-wizard.tsx), called exactly once.',
		).not.toContain('useProviderHooks');
	});

	it('manifest-section.tsx accepts providerHooks as a prop', () => {
		const source = readFileSync(MANIFEST_SECTION_PATH, 'utf8');
		expect(
			source,
			'providerHooks must appear as a prop in ManifestProviderWizardSectionProps',
		).toContain('providerHooks');
	});

	it('pm-wizard.tsx has a single ManifestStepsSection wrapper that calls useProviderHooks once', () => {
		const source = readFileSync(PM_WIZARD_PATH, 'utf8');
		expect(source, 'ManifestStepsSection must exist in pm-wizard.tsx').toContain(
			'ManifestStepsSection',
		);
		// useProviderHooks is called exactly once — inside ManifestStepsSection.
		const matches = source.match(/useProviderHooks\s*\?\./g) ?? [];
		expect(
			matches.length,
			`useProviderHooks must be called exactly once (found ${matches.length}). ` +
				'Multiple call sites recreate the storm.',
		).toBe(1);
	});

	it('pm-wizard.tsx keys ManifestStepsSection by provider id', () => {
		const source = readFileSync(PM_WIZARD_PATH, 'utf8');
		expect(source).toContain('key={manifestDef.id}');
	});
});
